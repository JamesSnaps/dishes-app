import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-auth";
import { db } from "@/lib/db";
import {
  aiConfigurations,
  mealPlans,
  mealPlanEntries,
  recipes,
} from "@dishes/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import OpenAI from "openai";
import * as recipeService from "@/lib/services/recipes";
import {
  buildSystemAddendum,
  createStructuredRecipe,
  fullRecipeSystemPrompt,
  fullRecipeUserPrompt,
  maxTokensParam,
} from "@/lib/ai/recipe-generation";

const VALID_MEAL_TYPES = ["breakfast", "lunch", "dinner", "dessert", "snack"] as const;
type MealType = (typeof VALID_MEAL_TYPES)[number];

async function getOpenAiClient(householdId: string) {
  const [config] = await db
    .select({
      encryptedApiKey: aiConfigurations.encryptedApiKey,
      model: aiConfigurations.model,
      defaultPrompt: aiConfigurations.defaultPrompt,
      kitchenEquipment: aiConfigurations.kitchenEquipment,
      measurementSystem: aiConfigurations.measurementSystem,
    })
    .from(aiConfigurations)
    .where(eq(aiConfigurations.householdId, householdId))
    .limit(1);

  if (!config) throw new Error("AI not configured for this household");
  return {
    // Native fetch, not the SDK's bundled node-fetch — see lib/ai notes.
    client: new OpenAI({ apiKey: decrypt(config.encryptedApiKey), fetch: globalThis.fetch }),
    model: config.model,
    addendum: buildSystemAddendum(
      config.defaultPrompt,
      config.measurementSystem,
      config.kitchenEquipment
    ),
  };
}

/** How many recipes to write at once, so a full week isn't one burst of calls. */
const RECIPE_CONCURRENCY = 3;

function mondayOf(date: Date): string {
  const d = new Date(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().split("T")[0]!;
}

function dayName(dow: number): string {
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][dow] ?? String(dow);
}

/*
 * POST /api/integrations/meal-plan/generate
 *
 * Body (all optional):
 *   prompt      — description passed to the AI (default: "family-friendly weeknight dinners")
 *   week        — Monday date "YYYY-MM-DD" for the target week (default: current week)
 *   days        — array of day-of-week numbers to generate, 0=Mon … 6=Sun
 *                 (default: [0,1,2,...,count-1])
 *   count       — number of days from Mon when `days` is omitted, 1–7 (default: 7)
 *   mealType    — "breakfast" | "lunch" | "dinner" | "snack" (default: "dinner")
 *   overwrite   — if true, replaces existing entries for the same day+mealType slots
 *                 (default: false; returns 409 if any slot already exists)
 *   maxCaloriesPerMeal — optional cap (kcal per serving) the AI should respect;
 *                 generated recipes store the AI's per-serving calorie estimate
 */
export const POST = withIntegrationAuth(
  "write:meal_plan",
  async (req: NextRequest, ctx) => {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      // empty body is fine — all fields have defaults
    }

    // ── Parse + validate inputs ────────────────────────────────────────────────

    const prompt = String(body.prompt ?? "family-friendly weeknight dinners");
    const rawWeek = body.week ? String(body.week) : mondayOf(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawWeek)) {
      return NextResponse.json({ error: "`week` must be a date in YYYY-MM-DD format" }, { status: 400 });
    }
    const weekStartDate = rawWeek;
    const overwrite = body.overwrite === true;

    const mealType: MealType = VALID_MEAL_TYPES.includes(body.mealType as MealType)
      ? (body.mealType as MealType)
      : "dinner";

    const maxCalRaw = parseInt(String(body.maxCaloriesPerMeal ?? ""), 10);
    const maxCaloriesPerMeal = Number.isFinite(maxCalRaw) && maxCalRaw > 0 ? maxCalRaw : null;

    // Resolve which days of the week to fill
    let targetDays: number[];
    if (Array.isArray(body.days)) {
      targetDays = (body.days as unknown[])
        .map(Number)
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
      if (targetDays.length === 0) {
        return NextResponse.json(
          { error: "`days` must contain at least one value between 0 (Mon) and 6 (Sun)" },
          { status: 400 }
        );
      }
      targetDays = [...new Set(targetDays)].sort();
    } else {
      const count = Math.min(7, Math.max(1, parseInt(String(body.count ?? "7"), 10) || 7));
      targetDays = Array.from({ length: count }, (_, i) => i);
    }

    // ── Upsert the week plan ───────────────────────────────────────────────────

    const [upsertedPlan] = await db
      .insert(mealPlans)
      .values({ householdId: ctx.householdId, weekStartDate, status: "draft" })
      .onConflictDoUpdate({
        target: [mealPlans.householdId, mealPlans.weekStartDate],
        set: { updatedAt: sql`now()` },
      })
      .returning({ id: mealPlans.id });

    const planId = upsertedPlan!.id;

    // Check for slot conflicts only when plan already had entries
    const conflicting = await db
        .select({ id: mealPlanEntries.id, dayOfWeek: mealPlanEntries.dayOfWeek })
        .from(mealPlanEntries)
        .where(
          and(
            eq(mealPlanEntries.mealPlanId, planId),
            eq(mealPlanEntries.mealType, mealType),
            inArray(mealPlanEntries.dayOfWeek, targetDays)
          )
        );

    if (conflicting.length > 0) {
      if (!overwrite) {
        const conflictDays = conflicting.map((e) => dayName(e.dayOfWeek)).join(", ");
        return NextResponse.json(
          {
            error: `Entries already exist for ${mealType} on: ${conflictDays}. Pass overwrite: true to replace them.`,
          },
          { status: 409 }
        );
      }
      // Remove only the conflicting slots — leave other meal types intact
      await db.delete(mealPlanEntries).where(
        inArray(
          mealPlanEntries.id,
          conflicting.map((e) => e.id)
        )
      );
    }

    // ── Ask AI for N concepts ──────────────────────────────────────────────────

    const { client, model, addendum } = await getOpenAiClient(ctx.householdId);

    const dayLabels = targetDays.map(dayName).join(", ");
    const completion = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      ...maxTokensParam(model, 300 * targetDays.length),
      messages: [
        {
          role: "system",
          content: `You are a meal planner. Return exactly ${targetDays.length} ${mealType} concept(s) for ${dayLabels} as JSON.
Format: {"meals": [{"title": string, "description": string (1 sentence), "cuisine": string, "difficulty": "easy"|"medium"|"hard", "prepTimeMinutes": number, "cookTimeMinutes": number, "calories": number (kcal per serving estimate)}]}
Return exactly ${targetDays.length} item(s) in the same order as the days listed. Make them varied.
Every concept MUST genuinely suit a ${mealType}: breakfast = breakfast food (eggs, pancakes, porridge, pastries, etc.), lunch = light/quick midday food (salads, sandwiches, soups, bowls — not full dinner-style mains), dinner = the heartier main meal, snack = small bites, dessert = sweet courses. Do not force dinner-style dishes into breakfast or lunch.${maxCaloriesPerMeal ? `\nCALORIE LIMIT: every meal must stay at or below roughly ${maxCaloriesPerMeal} kcal per serving — choose dishes and portions that fit, and set "calories" accordingly.` : ""}`,
        },
        { role: "user", content: prompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const { meals } = JSON.parse(raw) as {
      meals: Array<{
        title: string;
        description: string;
        cuisine: string;
        difficulty: "easy" | "medium" | "hard";
        prepTimeMinutes: number;
        cookTimeMinutes: number;
        calories?: number;
      }>;
    };

    if (!Array.isArray(meals) || meals.length < targetDays.length) {
      return NextResponse.json({ error: "AI returned fewer meals than requested" }, { status: 502 });
    }

    // ── Persist recipes + entries ──────────────────────────────────────────────

    type CreatedMeal = {
      dayOfWeek: number;
      day: string;
      mealType: MealType;
      recipeTitle: string;
      recipeId: string;
      calories: number | null;
      /** False when the full write-up failed and only the concept was saved. */
      complete: boolean;
    };

    const created: CreatedMeal[] = [];

    // Write each concept up as a complete recipe — ingredients, steps, tags and
    // nutrition — then link it into the plan. A concept saved on its own is an
    // empty recipe the family can't cook from, so this second pass is the point
    // of the endpoint, not a nicety. If one write-up fails the concept is still
    // saved and flagged `complete: false`, so a single bad response can't cost
    // the whole week.
    const generateOne = async (dow: number, meal: (typeof meals)[number]): Promise<CreatedMeal> => {
      // The concept's estimate, superseded by the full recipe's own nutrition
      // once that lands — the response should report what was actually stored.
      let calories =
        typeof meal.calories === "number" && Number.isFinite(meal.calories)
          ? Math.round(meal.calories)
          : null;

      const concept = {
        title: meal.title,
        description: meal.description,
        cuisine: meal.cuisine,
        difficulty: meal.difficulty,
        tags: [],
      };

      let recipeId: string;
      let complete = true;

      try {
        const full = await createStructuredRecipe(client, model, [
          { role: "system", content: fullRecipeSystemPrompt(addendum) },
          {
            role: "user",
            content: fullRecipeUserPrompt(concept, mealType, maxCaloriesPerMeal ?? calories ?? undefined),
          },
        ]);

        ({ recipeId } = await recipeService.createRecipe(
          { householdId: ctx.householdId, memberId: null },
          recipeService.generatedToWriteInput(full)
        ));

        const fullCalories = full.nutrition?.calories;
        if (typeof fullCalories === "number" && Number.isFinite(fullCalories)) {
          calories = Math.round(fullCalories);
        }
      } catch (err) {
        console.error(
          `[integrations/meal-plan/generate] could not write "${meal.title}" in full:`,
          err instanceof Error ? err.message : err
        );
        complete = false;
        const [stub] = await db
          .insert(recipes)
          .values({
            householdId: ctx.householdId,
            title: meal.title,
            description: meal.description,
            cuisine: meal.cuisine,
            difficulty: meal.difficulty,
            prepTimeMinutes: meal.prepTimeMinutes,
            cookTimeMinutes: meal.cookTimeMinutes,
            servings: "4",
            servingsUnit: "servings",
            isAiGenerated: true,
            ...(calories !== null ? { calories, nutritionSource: "ai" as const } : {}),
          })
          .returning({ id: recipes.id });
        recipeId = stub!.id;
      }

      await db.insert(mealPlanEntries).values({
        mealPlanId: planId,
        recipeId,
        dayOfWeek: dow,
        mealType,
      });

      return {
        dayOfWeek: dow,
        day: dayName(dow),
        mealType,
        recipeTitle: meal.title,
        recipeId,
        calories,
        complete,
      };
    };

    for (let i = 0; i < targetDays.length; i += RECIPE_CONCURRENCY) {
      const batch = targetDays.slice(i, i + RECIPE_CONCURRENCY);
      const results = await Promise.all(
        batch.map((dow, j) => generateOne(dow, meals[i + j]!))
      );
      created.push(...results);
    }

    return NextResponse.json({ planId, weekStartDate, mealType, meals: created }, { status: 201 });
  }
);
