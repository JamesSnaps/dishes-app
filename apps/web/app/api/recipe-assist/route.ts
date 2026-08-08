import { NextRequest } from "next/server";
import OpenAI from "openai";
import { db } from "@/lib/db";
import {
  aiConfigurations,
  recipes,
  recipeIngredients,
  recipeSteps,
  recipeTags,
} from "@dishes/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { getRecipeCookHistory } from "@/app/actions/cook-history";

// Free-form Q&A about a whole recipe — "what goes with this?", "when should I
// start cooking?", "can I prep any of it ahead?". Unlike /api/cook-assist this
// isn't anchored to a step, and it loads the recipe server-side so the client
// only sends the question.
export async function POST(request: NextRequest) {
  try {
    const user = await getAutheliaUser();
    const household = await requireHousehold(user);

    const { recipeId, messages } = await request.json();

    if (typeof recipeId !== "string" || !recipeId) {
      return new Response("Recipe id is required", { status: 400 });
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response("Messages are required", { status: 400 });
    }

    const [config] = await db
      .select({
        encryptedApiKey: aiConfigurations.encryptedApiKey,
        model: aiConfigurations.model,
        measurementSystem: aiConfigurations.measurementSystem,
      })
      .from(aiConfigurations)
      .where(eq(aiConfigurations.householdId, household.householdId))
      .limit(1);

    if (!config) {
      return new Response("AI not configured. Add your API key in Settings → AI.", {
        status: 422,
      });
    }

    const [recipe, ingredients, steps, tags, cookHistory] = await Promise.all([
      db
        .select()
        .from(recipes)
        .where(
          and(eq(recipes.id, recipeId), eq(recipes.householdId, household.householdId))
        )
        .limit(1)
        .then((r) => r[0] ?? null),
      db
        .select()
        .from(recipeIngredients)
        .where(eq(recipeIngredients.recipeId, recipeId))
        .orderBy(asc(recipeIngredients.position)),
      db
        .select()
        .from(recipeSteps)
        .where(eq(recipeSteps.recipeId, recipeId))
        .orderBy(asc(recipeSteps.position)),
      db.select().from(recipeTags).where(eq(recipeTags.recipeId, recipeId)),
      getRecipeCookHistory(recipeId, household.householdId),
    ]);

    if (!recipe) return new Response("Recipe not found", { status: 404 });

    const ingredientLines = ingredients
      .map((i) =>
        `- ${[i.amount, i.unit, i.ingredientName].filter(Boolean).join(" ")}${
          i.preparation ? `, ${i.preparation}` : ""
        }${i.isOptional ? " (optional)" : ""}${
          i.groupLabel?.trim() ? ` [${i.groupLabel.trim()}]` : ""
        }`
      )
      .join("\n");

    const stepLines = steps
      .map(
        (s, i) =>
          `${i + 1}.${s.groupLabel?.trim() ? ` [${s.groupLabel.trim()}]` : ""} ${
            s.instruction
          }${s.durationMinutes ? ` (timer: ${s.durationMinutes} min)` : ""}`
      )
      .join("\n");

    // Past cooks give the model something to personalise against — how long it
    // actually takes this household, and what they thought last time.
    const historyLines = cookHistory
      .slice(0, 5)
      .map((e) => {
        const date = new Date(e.cookedAt).toLocaleDateString("en-GB", {
          month: "short",
          year: "numeric",
        });
        const parts: string[] = [];
        if (e.rating != null) parts.push(`rated ${e.rating / 2}/5`);
        if (e.actualDuration) parts.push(`took ${e.actualDuration} min`);
        if (e.cookedFor?.length) parts.push(`cooked for ${e.cookedFor.join(", ")}`);
        const head = `- ${date}${parts.length ? ` (${parts.join(", ")})` : ""}`;
        return [head, e.occasion && `Occasion: ${e.occasion}`, e.notes && `Notes: ${e.notes}`]
          .filter(Boolean)
          .join(" — ");
      })
      .join("\n");

    const totalTime =
      (recipe.prepTimeMinutes ?? 0) + (recipe.cookTimeMinutes ?? 0) || null;

    const systemPrompt = `You are a knowledgeable cooking companion answering questions about one specific recipe the user is looking at. Be concise and practical — 2–5 sentences, or a short list where it genuinely helps. Use ${
      config.measurementSystem === "imperial" ? "imperial" : "metric"
    } units.

You have the full recipe below. Use it: ground answers in the actual ingredients, steps and timings rather than generic advice, and never tell the user to "check the recipe" — you can see it. If they ask about timing (e.g. when to start for a given serving time), work backwards through the steps, and say what can be done ahead. If they ask what to serve alongside, suggest things that suit the cuisine and richness of this dish, and note anything already covered by the recipe. If a question genuinely can't be answered from the recipe, say so briefly and give your best general guidance.

RECIPE: ${recipe.title}
${recipe.description ? `${recipe.description}\n` : ""}Cuisine: ${
      recipe.cuisine || "unspecified"
    } · Difficulty: ${recipe.difficulty || "unspecified"} · Serves: ${
      recipe.servings ? `${parseFloat(recipe.servings)} ${recipe.servingsUnit ?? "servings"}` : "unspecified"
    }
Prep: ${recipe.prepTimeMinutes ?? "?"} min · Cook: ${recipe.cookTimeMinutes ?? "?"} min${
      totalTime ? ` · Total as written: ${totalTime} min` : ""
    }
${tags.length ? `Tags: ${tags.map((t) => t.tag).join(", ")}\n` : ""}
INGREDIENTS:
${ingredientLines || "none recorded"}

METHOD:
${stepLines || "no steps recorded"}
${recipe.notes ? `\nRECIPE NOTES:\n${recipe.notes}\n` : ""}${
      historyLines ? `\nTHIS HOUSEHOLD'S PAST COOKS:\n${historyLines}\n` : ""
    }`;

    // Native fetch — node-fetch breaks streaming with "Premature close" on Node 22.23+
    const client = new OpenAI({
      apiKey: decrypt(config.encryptedApiKey),
      fetch: globalThis.fetch,
    });

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
