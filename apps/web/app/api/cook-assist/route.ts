import { NextRequest } from "next/server";
import OpenAI from "openai";
import { db } from "@/lib/db";
import { aiConfigurations } from "@dishes/db/schema";
import { eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";

export async function POST(request: NextRequest) {
  try {
    const user = await getAutheliaUser();
    const household = await requireHousehold(user);

    const { recipeTitle, stepNumber, stepInstruction, stepIngredients, messages } =
      await request.json();

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response("Messages are required", { status: 400 });
    }

    const [config] = await db
      .select({
        encryptedApiKey: aiConfigurations.encryptedApiKey,
        model: aiConfigurations.model,
      })
      .from(aiConfigurations)
      .where(eq(aiConfigurations.householdId, household.householdId))
      .limit(1);

    if (!config) {
      return new Response("AI not configured. Add your API key in Settings → AI.", { status: 422 });
    }

    const client = new OpenAI({ apiKey: decrypt(config.encryptedApiKey) });

    const ingredientList = Array.isArray(stepIngredients) && stepIngredients.length > 0
      ? (stepIngredients as Array<{ amount?: string; unit?: string; name: string }>)
          .map((i) => [i.amount, i.unit, i.name].filter(Boolean).join(" "))
          .join(", ")
      : "none listed";

    const systemPrompt = `You are a helpful cooking assistant. Someone is actively cooking and has a quick question — answer concisely and practically. They may have messy hands so keep it to 2–4 sentences unless a short list genuinely helps.

Recipe: ${recipeTitle}
Current step (step ${stepNumber}): ${stepInstruction}
Ingredients used in this step: ${ingredientList}`;

    const abort = new AbortController();
    const stream = await client.chat.completions.create(
      {
        model: config.model,
        stream: true,
        messages: [
          { role: "system", content: systemPrompt },
          ...(messages as Array<{ role: "user" | "assistant"; content: string }>),
        ],
      },
      { signal: abort.signal }
    );

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const text = chunk.choices[0]?.delta?.content ?? "";
            if (text) controller.enqueue(encoder.encode(text));
          }
        } catch {
          // Stream was aborted or errored — swallow to avoid unhandled rejection
        }
        controller.close();
      },
      cancel() {
        abort.abort();
      },
    });

    return new Response(readable, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "An error occurred";
    return new Response(msg, { status: 500 });
  }
}
