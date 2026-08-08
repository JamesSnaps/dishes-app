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

    const {
      recipeTitle,
      stepNumber,
      stepInstruction,
      stepIngredients,
      allIngredients,
      allSteps,
      servingsSummary,
      messages,
    } = await request.json();

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

    // Native fetch — node-fetch breaks streaming with "Premature close" on Node 22.23+
    const client = new OpenAI({
      apiKey: decrypt(config.encryptedApiKey),
      fetch: globalThis.fetch,
    });

    type IngredientCtx = { amount?: string; unit?: string; name: string; groupLabel?: string };
    type StepCtx = { number: number; instruction: string; groupLabel?: string };

    const formatIngredient = (i: IngredientCtx) =>
      [i.amount, i.unit, i.name].filter(Boolean).join(" ");

    const ingredientList = Array.isArray(stepIngredients) && stepIngredients.length > 0
      ? (stepIngredients as IngredientCtx[]).map(formatIngredient).join(", ")
      : "none listed";

    // Full ingredient list, grouped by section where the recipe has sections.
    const fullIngredients = Array.isArray(allIngredients) && allIngredients.length > 0
      ? (allIngredients as IngredientCtx[])
          .map((i) => `- ${formatIngredient(i)}${i.groupLabel ? ` (${i.groupLabel})` : ""}`)
          .join("\n")
      : "not provided";

    // Every step, with the current one marked so the model knows where we are.
    const fullSteps = Array.isArray(allSteps) && allSteps.length > 0
      ? (allSteps as StepCtx[])
          .map(
            (s) =>
              `${s.number === stepNumber ? "→" : " "} ${s.number}.${
                s.groupLabel ? ` [${s.groupLabel}]` : ""
              } ${s.instruction}`
          )
          .join("\n")
      : "not provided";

    const systemPrompt = `You are a helpful cooking assistant. Someone is actively cooking and has a quick question — answer concisely and practically. They may have messy hands so keep it to 2–4 sentences unless a short list genuinely helps.

You have the whole recipe below, not just the current step. Use it: when the question touches on what comes next, what was done earlier, timing across steps, leftover quantities of an ingredient, or substitutions, reason over the full recipe rather than the current step alone. Do not tell the user to check the recipe — you can already see it.

Recipe: ${recipeTitle}
${servingsSummary ? `${servingsSummary}\n` : ""}
All ingredients:
${fullIngredients}

All steps (→ marks the step they are on now):
${fullSteps}

They are currently on step ${stepNumber}: ${stepInstruction}
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
