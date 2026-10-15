import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { db } from "@/lib/db";
import { aiConfigurations } from "@dishes/db/schema";
import { eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { maxTokensParam } from "@/lib/ai/recipe-generation";
import { addDaysToDate, localNow } from "@/lib/dinner-reminders/time";
import { getDeliveryConfig, isValidDate } from "./schedule";
import type { OrderUpdate } from "./orders";

/**
 * Reads a grocery retailer's email (Sainsbury's, Tesco, Ocado…) with the
 * household's AI and pulls out what the delivery tracker needs. Retailers
 * restyle these emails often, so this deliberately doesn't pattern-match
 * any one template.
 */

export class EmailExtractionError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export interface InboundEmail {
  subject?: string;
  from?: string;
  /** When the email arrived (ISO). Anchors dates written without a year. */
  receivedAt?: string;
  text?: string;
  html?: string;
}

const extractionSchema = z.object({
  kind: z.enum(["placed", "amended", "cancelled", "delivered", "other"]),
  retailer: z.string().nullable(),
  orderReference: z.string().nullable(),
  deliveryDate: z.string().nullable(),
  slotStart: z.string().nullable(),
  slotEnd: z.string().nullable(),
  total: z.number().nullable(),
});
export type EmailExtraction = z.infer<typeof extractionSchema>;

const MAX_EMAIL_CHARS = 15_000;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  pound: "£",
};

/** Good-enough HTML → text for an email: keeps line structure, drops markup. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d|table)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const SYSTEM_PROMPT = `You read emails from UK grocery delivery services (Sainsbury's, Tesco, Ocado, Asda, Morrisons, Waitrose and similar) and extract the order details as JSON.

kind:
- "placed": the order is confirmed / booked / "thanks for your order".
- "amended": an existing order was changed or updated.
- "cancelled": the order was cancelled.
- "delivered": the order was delivered, or a receipt with the final amount charged.
- "other": anything else — marketing, "you can still amend until…" reminders, slot reservations that aren't an order yet, surveys, emails from someone else entirely.

Fields (null when the email doesn't say):
- retailer: the shop's name as people say it, e.g. "Sainsbury's".
- orderReference: the order number exactly as written.
- deliveryDate: the delivery date as YYYY-MM-DD. Dates often have no year: use the one that puts the date nearest after the email's received date.
- slotStart, slotEnd: the delivery slot as 24-hour HH:MM, e.g. "7am - 8am" → "07:00" and "08:00".
- total: the order total in pounds as a number. For "delivered", the final amount charged; otherwise the order total (an estimate is fine). Never a subtotal, savings or a delivery charge on its own.`;

async function aiConfig(householdId: string) {
  const [config] = await db
    .select({ encryptedApiKey: aiConfigurations.encryptedApiKey, model: aiConfigurations.model })
    .from(aiConfigurations)
    .where(eq(aiConfigurations.householdId, householdId))
    .limit(1);
  return config ?? null;
}

export function emailBody(email: InboundEmail): string {
  const body = email.text?.trim() || (email.html ? htmlToText(email.html) : "");
  return body.slice(0, MAX_EMAIL_CHARS);
}

/** Turn the AI's answer into an order update, rejecting dates that can't be right. */
export function toOrderUpdate(extracted: EmailExtraction, receivedDate: string): OrderUpdate | null {
  if (extracted.kind === "other") return null;
  let deliveryDate = extracted.deliveryDate;
  if (
    deliveryDate &&
    (!isValidDate(deliveryDate) ||
      deliveryDate < addDaysToDate(receivedDate, -14) ||
      deliveryDate > addDaysToDate(receivedDate, 60))
  ) {
    deliveryDate = null;
  }
  return {
    kind: extracted.kind,
    retailer: extracted.retailer,
    orderReference: extracted.orderReference,
    deliveryDate,
    slot:
      extracted.slotStart && extracted.slotEnd ? `${extracted.slotStart}-${extracted.slotEnd}` : null,
    total: extracted.total,
  };
}

export async function extractOrderFromEmail(
  householdId: string,
  email: InboundEmail
): Promise<{ extracted: EmailExtraction; update: OrderUpdate | null }> {
  const body = emailBody(email);
  if (!body && !email.subject) throw new EmailExtractionError("The email has no text or html", 400);

  const config = await aiConfig(householdId);
  if (!config) {
    throw new EmailExtractionError("AI isn't set up for this household (Settings → AI)", 422);
  }

  const { timezone } = await getDeliveryConfig(householdId);
  const received = email.receivedAt ? new Date(email.receivedAt) : new Date();
  const receivedDate = localNow(
    timezone,
    Number.isNaN(received.getTime()) ? new Date() : received
  ).date;

  const client = new OpenAI({ apiKey: decrypt(config.encryptedApiKey), fetch: globalThis.fetch });
  let extracted: EmailExtraction;
  try {
    const completion = await client.chat.completions.create({
      model: config.model,
      response_format: zodResponseFormat(extractionSchema, "grocery_order"),
      ...maxTokensParam(config.model, 400),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            `Received: ${receivedDate}`,
            `From: ${email.from ?? "unknown"}`,
            `Subject: ${email.subject ?? ""}`,
            "",
            body,
          ].join("\n"),
        },
      ],
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("empty response");
    extracted = extractionSchema.parse(JSON.parse(raw));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[deliveries] email extraction failed household=${householdId}:`, msg);
    throw new EmailExtractionError(
      /api key|401/i.test(msg)
        ? "The AI key was rejected — check Settings → AI"
        : /429|quota|rate/i.test(msg)
          ? "The AI is rate limited right now — retry shortly"
          : "The AI couldn't read this email",
      502
    );
  }

  return { extracted, update: toOrderUpdate(extracted, receivedDate) };
}
