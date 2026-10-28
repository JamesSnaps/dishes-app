/**
 * "Help me choose": read a restaurant menu and suggest dishes for each person
 * eating, using the diner brief (`lib/diner-brief.ts`) — dietary requirements
 * as hard rules, dislikes avoided, the household's tastes and this week's
 * heart-health targets as steers, recent meals for variety.
 *
 * One call does both the reading and the choosing (they're at the table; two
 * round trips would double the wait). Each pick carries the menu's own line
 * and any printed calories, so picking it fills in the log sheet with exactly
 * what the nutrition estimate wants.
 */

import type OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { OUTSIDE_MEAL_COURSES, type OutsideMealCourseType } from "@dishes/shared";
import { maxTokensParam } from "@/lib/ai/recipe-generation";
import { renderDinerBrief, type DinerBrief } from "@/lib/diner-brief";

export type MenuPick = {
  dish: string;
  course: OutsideMealCourseType;
  /** The dish's line from the menu, word for word. */
  menuLine: string;
  /** Printed on the menu; null when it isn't. */
  menuKcal: number | null;
  /** The model's rough figure for a restaurant portion, when nothing's printed. */
  estimatedKcal: number | null;
  /** Why it suits this person, in the brief's terms. */
  why: string;
  /** e.g. "sauce on the side"; null when it's fine as it comes. */
  lighterTweak: string | null;
};

export type MenuPicks = {
  restaurant: { name: string | null; cuisine: string | null };
  diners: {
    name: string;
    picks: MenuPick[];
    avoid: { dish: string; why: string }[];
  }[];
  /** Anything worth saying about the menu as a whole (blurry photo, no veggie mains…). */
  note: string | null;
};

const pickSchema = z.object({
  dish: z.string(),
  course: z.enum(OUTSIDE_MEAL_COURSES),
  menuLine: z.string(),
  menuKcal: z.number().nullable(),
  estimatedKcal: z.number().nullable(),
  why: z.string(),
  lighterTweak: z.string().nullable(),
});

const picksSchema = z.object({
  menuReadable: z.boolean(),
  restaurant: z.object({ name: z.string().nullable(), cuisine: z.string().nullable() }),
  diners: z.array(
    z.object({
      name: z.string(),
      picks: z.array(pickSchema),
      avoid: z.array(z.object({ dish: z.string(), why: z.string() })),
    })
  ),
  note: z.string().nullable(),
});

const SYSTEM_PROMPT = `You help a family choose what to order from a restaurant or takeaway menu. You get the menu (photos, a PDF, a web page's text or typed text) and a brief about the people eating.

Rules:
- Dietary requirements in the brief are hard rules. Never pick a dish that breaks one. If it's unclear whether a dish does (hidden dairy, nuts, gluten), say so in "why" or leave it out.
- Avoid listed dislikes, and lean towards what they love and what the household rates well.
- When the brief has weekly protein targets, steer by them: a protein "at the limit" or "already over" should be avoided this week, one "still short" is a plus. Say so in "why".
- Vary from what they ate in the last week.
- A child (young age, or "a child") gets simpler, milder dishes or the children's menu.
- For each person give 2 or 3 picks, mostly mains. Add a starter, side or dessert only when it suits (a light starter, a vegetable side to balance a main).
- Only pick dishes that are on this menu. "dish" is its name as the menu gives it; "menuLine" is its full line from the menu, word for word (name and description, without the price).
- "menuKcal" only when the menu prints calories for that dish; otherwise null, and give "estimatedKcal": your rough figure for one restaurant portion. Never put an estimate in menuKcal.
- "why" is one short sentence in the brief's terms ("Oily fish — you're short this week", "Red meat's at its limit, so not the burger"). Speak to the person ("you").
- "lighterTweak": a realistic change to ask for (sauce on the side, salad instead of chips), or null when it's fine as it comes.
- "avoid": up to 3 dishes worth steering clear of for that person, each with a short reason. Empty when nothing stands out.
- restaurant: its name and cuisine if the menu shows them, else null.
- If you can't read a menu from what you were given, set menuReadable false, give no picks, and say why in "note". Otherwise "note" is for anything worth saying about the menu as a whole, or null.

Use the names exactly as the brief gives them, one entry per person eating, in the brief's order. British English.`;

/** The model's answer as it comes, before `tidyPicks`. */
export type MenuPicksReading = z.infer<typeof picksSchema>;

/** One AI call. Throws when the model's answer can't be used. */
export async function pickFromMenu(
  client: OpenAI,
  model: string,
  { brief, menu }: { brief: DinerBrief; menu: OpenAI.ChatCompletionContentPart[] }
): Promise<MenuPicks> {
  const names = brief.diners.map((d) => d.name);
  const completion = await client.chat.completions.create({
    model,
    response_format: zodResponseFormat(picksSchema, "menu_picks"),
    ...maxTokensParam(model, 700 + 450 * names.length),
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          ...menu,
          { type: "text", text: `${renderDinerBrief(brief)}\n\nSuggest dishes for: ${names.join(", ")}.` },
        ],
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("The AI returned nothing.");
  return tidyPicks(picksSchema.parse(JSON.parse(raw)), names);
}

const clean = (s: string | null | undefined) => s?.trim() || null;
const kcal = (n: number | null) => (n != null && Number.isFinite(n) && n > 0 && n < 10000 ? Math.round(n) : null);

/**
 * The model's answer, held to the brief: one entry per diner in the brief's
 * order (names matched in any case; anyone it left out gets none), at most
 * 3 picks and 3 to avoid each, and nothing blank.
 */
export function tidyPicks(parsed: MenuPicksReading, names: string[]): MenuPicks {
  const diners = names.map((name) => {
    const read = parsed.diners.find((d) => d.name.trim().toLowerCase() === name.toLowerCase());
    const picks = parsed.menuReadable
      ? (read?.picks ?? [])
          .filter((p) => p.dish.trim())
          .slice(0, 3)
          .map((p) => ({
            dish: p.dish.trim(),
            course: p.course,
            menuLine: p.menuLine.trim() || p.dish.trim(),
            menuKcal: kcal(p.menuKcal),
            estimatedKcal: kcal(p.menuKcal) ? null : kcal(p.estimatedKcal),
            why: p.why.trim(),
            lighterTweak: clean(p.lighterTweak),
          }))
      : [];
    const avoid = (read?.avoid ?? [])
      .filter((a) => a.dish.trim())
      .slice(0, 3)
      .map((a) => ({ dish: a.dish.trim(), why: a.why.trim() }));
    return { name, picks, avoid };
  });

  return {
    restaurant: { name: clean(parsed.restaurant.name), cuisine: clean(parsed.restaurant.cuisine) },
    diners,
    note: clean(parsed.note) ?? (parsed.menuReadable ? null : "The menu couldn't be read."),
  };
}

