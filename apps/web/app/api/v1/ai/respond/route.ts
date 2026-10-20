import { NextRequest } from "next/server";
import OpenAI from "openai";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { aiConfigurations } from "@dishes/db/schema";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { requireSession } from "@/lib/session";
import { apiError } from "@/lib/api/respond";
import { AuthError } from "@/lib/auth";
import { checkRateLimitFor } from "@/lib/rate-limit";
import { buildSystemAddendum, maxTokensParam } from "@/lib/ai/recipe-generation";
import { createLogger } from "@/lib/logger";

const log = createLogger("ai-respond");

/** Per member, so one runaway client can't spend the household's key. */
const RATE_LIMIT = 30;
const RATE_WINDOW_SECONDS = 60;

const schema = z.object({
  /** The conversation as the device's session has it: its instructions, prompts and answers. */
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string().max(60_000),
      })
    )
    .min(1)
    .max(60),
  /** A JSON schema the answer must follow (the device's GenerationSchema, encoded). */
  schema: z.record(z.string(), z.unknown()).optional(),
  /** Add the household's AI settings (measurements, default prompt, equipment) to the instructions. */
  settings: z.boolean().optional(),
  maxTokens: z.number().int().min(16).max(8000).optional(),
});

/**
 * Apple's JSON schema keeps property order in "x-order", which OpenAI doesn't
 * know; anything else it ignores in non-strict mode.
 */
function forOpenAI(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(forOpenAI);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== "x-order")
        .map(([key, v]) => [key, forOpenAI(v)])
    );
  }
  return value;
}

/**
 * POST — a model call through the household's own key, for the iOS app's
 * `DishesServerModel` (TODO_MOBILE.md, D5): the device's AI code runs the same
 * session against the server when its own model can't do the job. The
 * conversation in, the answer out as streamed plain text (JSON text when a
 * schema was sent). 422 when AI isn't set up, 429 past the member's limit.
 */
export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof AuthError) return apiError("unauthenticated", err.message, 401);
    throw err;
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("invalid_request", "Invalid request", 400, parsed.error.issues);
  const input = parsed.data;

  const limit = await checkRateLimitFor(`ai-respond:${session.memberId}`, RATE_LIMIT, RATE_WINDOW_SECONDS);
  if (!limit.allowed) {
    const res = apiError("invalid_request", "Too many AI requests — try again in a minute.", 429);
    res.headers.set("Retry-After", String(limit.retryAfter));
    return res;
  }

  const [config] = await db
    .select({
      encryptedApiKey: aiConfigurations.encryptedApiKey,
      model: aiConfigurations.model,
      defaultPrompt: aiConfigurations.defaultPrompt,
      kitchenEquipment: aiConfigurations.kitchenEquipment,
      measurementSystem: aiConfigurations.measurementSystem,
    })
    .from(aiConfigurations)
    .where(eq(aiConfigurations.householdId, session.householdId))
    .limit(1);
  if (!config) return apiError("invalid_request", "AI not configured. Add your API key in Settings → AI.", 422);

  const messages = input.messages.map((m) => ({ ...m }));
  if (input.settings) {
    const addendum = buildSystemAddendum(config.defaultPrompt, config.measurementSystem, config.kitchenEquipment);
    const system = messages.find((m) => m.role === "system");
    if (system) system.content += addendum;
    else if (addendum) messages.unshift({ role: "system", content: addendum.trim() });
  }

  // Native fetch — node-fetch breaks streaming with "Premature close" on Node 22.23+
  const client = new OpenAI({ apiKey: decrypt(config.encryptedApiKey), fetch: globalThis.fetch });
  const abort = new AbortController();
  let stream;
  try {
    stream = await client.chat.completions.create(
      {
        model: config.model,
        stream: true,
        messages,
        ...maxTokensParam(config.model, input.maxTokens ?? 2000),
        ...(input.schema
          ? {
              response_format: {
                type: "json_schema" as const,
                json_schema: { name: "answer", schema: forOpenAI(input.schema) as Record<string, unknown>, strict: false },
              },
            }
          : {}),
      },
      { signal: abort.signal }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "The AI call failed";
    log.info(`respond failed for ${session.householdId}: ${message}`);
    const status = /429|quota|rate limit/i.test(message) ? 429 : 422;
    return apiError("invalid_request", status === 429 ? "OpenAI rate limit or quota exceeded. Try again shortly." : message, status);
  }

  log.info(`respond: ${messages.length} messages, schema ${input.schema ? "yes" : "no"}, model ${config.model}`);
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content ?? "";
          if (text) controller.enqueue(encoder.encode(text));
        }
      } catch {
        // Aborted or failed mid-way: the client sees a short answer and its checks catch it.
      }
      controller.close();
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
