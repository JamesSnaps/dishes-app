/**
 * The second half of "Help me choose": from the menu as read
 * (`menu-reader.ts`) and the diner brief (`lib/diner-brief.ts`), suggest
 * dishes for each person eating, for the courses they want and in the mood
 * they're in — dietary requirements as hard rules, dislikes avoided, the
 * household's tastes and this week's heart-health targets as steers, recent
 * meals for variety. Or, for a swap, a couple of different options for one
 * person's course.
 *
 * Picks name a menu item by number, so the dish, its line and printed
 * calories come from the menu, word for word. Streamed: each pick is handed
 * on as soon as it's complete.
 */

import type OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { OUTSIDE_MEAL_COURSES, type OutsideMealCourseType } from "@dishes/shared";
import { maxTokensParam } from "@/lib/ai/recipe-generation";
import { completedItems, streamStructured } from "@/lib/ai/stream-structured";
import { renderDinerBrief, type DinerBrief } from "@/lib/diner-brief";
import type { MenuAvoid, MenuItem, MenuMood, MenuPick, ReadMenu } from "@/lib/menu-choice";

export { MENU_MOOD_LABELS, MENU_MOODS } from "@/lib/menu-choice";
export type { MenuAvoid, MenuMood, MenuPick };

const MOOD_WORDS: Record<MenuMood, string> = {
  light: "something light",
  hearty: "something hearty and filling",
  healthy: "the healthiest options",
  new: "something they haven't had lately, a bit different",
  treat: "a treat — they're not counting tonight, though dietary requirements still apply",
};

/** What they're after: the course and mood chips, and anything typed. */
export type MenuWants = { courses: OutsideMealCourseType[]; moods: MenuMood[]; note: string | null };

/** "Something else" for one person's course: not these items, maybe for a reason. */
export type MenuSwap = { diner: string; course: OutsideMealCourseType; exclude: number[]; hint: string | null };



/** The whole answer, as the non-streaming API returns it. */
export type MenuPicks = {
  date: string;
  restaurant: ReadMenu["restaurant"];
  /** One entry per person, in the brief's order. */
  diners: { name: string; picks: MenuPick[]; avoid: MenuAvoid[] }[];
  note: string | null;
  /** The menu as read — "See the whole menu", and what a swap sends back. */
  menu: ReadMenu;
};

/** Options per person per course: more choice for the main. */
export const OPTIONS_PER_COURSE = { main: 3, other: 2, swap: 2 } as const;
const MAX_AVOID_PER_DINER = 3;

const choiceSchema = z.object({
  picks: z.array(
    z.object({
      diner: z.string(),
      course: z.enum(OUTSIDE_MEAL_COURSES),
      item: z.number(),
      why: z.string(),
      lighterTweak: z.string().nullable(),
      estimatedKcal: z.number().nullable(),
    })
  ),
  avoid: z.array(z.object({ diner: z.string(), item: z.number(), why: z.string() })),
  note: z.string().nullable(),
});
type RawPick = z.infer<typeof choiceSchema>["picks"][number];
type RawAvoid = z.infer<typeof choiceSchema>["avoid"][number];

const SYSTEM_PROMPT = `You help a family choose what to order from a restaurant or takeaway menu. You get a brief about the people eating, the menu as a numbered list, and what they're after.

Rules:
- Dietary requirements in the brief are hard rules. Never pick a dish that breaks one. If it's unclear whether a dish does (hidden dairy, nuts, gluten), leave it out or say so in "why".
- Avoid listed dislikes, and lean towards what they love and what the household rates well.
- When the brief has weekly protein targets, steer by them: a protein "at the limit" or "already over" should be avoided this week, one "still short" is a plus. Say so in "why".
- Vary from what they ate in the last week. Honour the mood and anything they said.
- A child (young age, or "a child") gets simpler, milder dishes, or the children's menu if there is one.
- "item" is the dish's number from the menu list. Only pick numbered dishes, and only for the courses asked for. A course must suit the dish (a dessert from the desserts, a side from the sides).
- Give picks grouped by person, then course in eating order (starter, main, side, dessert, drink), best first.
- "why" is one short sentence in the brief's terms ("Oily fish — you're short this week", "Red meat's at its limit, so not the burger"). Speak to the person ("you").
- "lighterTweak": a realistic change to ask for (sauce on the side, salad instead of chips), or null when it's fine as it comes.
- "estimatedKcal": your rough figure for one restaurant portion when the menu prints none, else null.
- "avoid": up to 3 dishes per person worth steering clear of, by number, each with a short reason. Empty when nothing stands out.
- "note": anything worth saying about the menu as a whole (no vegetarian mains, everything fried), or null.

Use the names exactly as the brief gives them. British English.`;

function menuText(items: MenuItem[]): string {
  let section: string | null = null;
  const lines: string[] = [];
  for (const it of items) {
    if (it.section && it.section !== section) {
      section = it.section;
      lines.push(`[${section}]`);
    }
    lines.push(`${it.id}. ${it.line}${it.kcal ? ` (${it.kcal} kcal on the menu)` : ""}`);
  }
  return lines.join("\n");
}

function askText(names: string[], wants: MenuWants, swap: MenuSwap | null): string {
  if (swap) {
    const parts = [
      `${swap.diner} wants something else for their ${swap.course}. Suggest ${OPTIONS_PER_COURSE.swap} different ${swap.course} options for ${swap.diner} only.`,
    ];
    if (swap.exclude.length) parts.push(`Don't suggest items ${swap.exclude.join(", ")}: they've seen those.`);
    if (swap.hint) parts.push(`They said: "${swap.hint}"`);
    parts.push("No avoid list this time.");
    return parts.join(" ");
  }
  const counts = wants.courses
    .map((c) => `${c === "main" ? OPTIONS_PER_COURSE.main : OPTIONS_PER_COURSE.other} ${c} options`)
    .join(", ");
  const parts = [`For each of ${names.join(", ")}: ${counts}.`];
  if (wants.moods.length) parts.push(`They're after ${wants.moods.map((m) => MOOD_WORDS[m]).join("; ")}.`);
  if (wants.note) parts.push(`They said: "${wants.note}"`);
  return parts.join(" ");
}

/**
 * Holds the model's picks to the brief and the ask, one at a time as they
 * stream: a known diner (any case), a course that was asked for, a real menu
 * item not excluded, no repeats, and no more options than asked for. Returns
 * null for anything else. Pure, for `scripts/check-menu-picks.ts`.
 */
export function pickFilter(ctx: { names: string[]; menu: ReadMenu; wants: MenuWants; swap: MenuSwap | null }) {
  const byId = new Map(ctx.menu.items.map((it) => [it.id, it]));
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  const avoidCounts = new Map<string, number>();
  const name = (raw: string) => {
    const n = ctx.names.find((x) => x.toLowerCase() === raw.trim().toLowerCase());
    return n && (!ctx.swap || n === ctx.swap.diner) ? n : null;
  };
  // Shown after "Ask for:", so a model that starts with it too isn't doubled.
  const tweak = (t: string | null) => {
    const v = t?.trim().replace(/^ask (them )?for:?\s*/i, "").trim();
    return v ? v[0]!.toUpperCase() + v.slice(1) : null;
  };
  const kcal = (n: number | null) => (n != null && Number.isFinite(n) && n > 0 && n < 10000 ? Math.round(n) : null);

  return {
    pick(raw: RawPick): MenuPick | null {
      const diner = name(raw.diner);
      const item = byId.get(raw.item);
      if (!diner || !item) return null;
      const courses = ctx.swap ? [ctx.swap.course] : ctx.wants.courses;
      if (!courses.includes(raw.course)) return null;
      if (ctx.swap?.exclude.includes(item.id)) return null;
      const slot = `${diner}|${raw.course}`;
      if (seen.has(`${slot}|${item.id}`)) return null;
      const max = ctx.swap ? OPTIONS_PER_COURSE.swap : raw.course === "main" ? OPTIONS_PER_COURSE.main : OPTIONS_PER_COURSE.other;
      if ((counts.get(slot) ?? 0) >= max) return null;
      seen.add(`${slot}|${item.id}`);
      counts.set(slot, (counts.get(slot) ?? 0) + 1);
      return {
        item: item.id,
        diner,
        course: raw.course,
        dish: item.name,
        menuLine: item.line,
        menuKcal: item.kcal,
        estimatedKcal: item.kcal ? null : kcal(raw.estimatedKcal),
        why: raw.why.trim(),
        lighterTweak: tweak(raw.lighterTweak),
      };
    },
    avoid(raw: RawAvoid): MenuAvoid | null {
      if (ctx.swap) return null;
      const diner = name(raw.diner);
      const item = byId.get(raw.item);
      if (!diner || !item || (avoidCounts.get(diner) ?? 0) >= MAX_AVOID_PER_DINER) return null;
      avoidCounts.set(diner, (avoidCounts.get(diner) ?? 0) + 1);
      return { diner, item: item.id, dish: item.name, why: raw.why.trim() };
    },
  };
}

/**
 * One streamed AI call. `onPick` and `onAvoid` see each one as soon as it's
 * complete and has passed `pickFilter`; the answer's note comes back at the end.
 */
export async function pickFromMenu(
  client: OpenAI,
  model: string,
  input: {
    brief: DinerBrief;
    menu: ReadMenu;
    wants: MenuWants;
    swap: MenuSwap | null;
    onPick: (pick: MenuPick) => void;
    onAvoid: (avoid: MenuAvoid) => void;
  }
): Promise<{ note: string | null }> {
  const names = input.brief.diners.map((d) => d.name);
  const filter = pickFilter({ names, menu: input.menu, wants: input.wants, swap: input.swap });
  const picks = completedItems<RawPick>("picks", (raw) => {
    const p = filter.pick(raw);
    if (p) input.onPick(p);
  });
  const slots = input.swap ? 1 : names.length * input.wants.courses.length;

  const raw = await streamStructured(
    client,
    {
      model,
      response_format: zodResponseFormat(choiceSchema, "menu_picks"),
      ...maxTokensParam(model, 500 + 260 * slots * OPTIONS_PER_COURSE.main),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `${renderDinerBrief(input.brief)}\n\nThe menu${input.menu.restaurant.name ? ` (${input.menu.restaurant.name})` : ""}:\n${menuText(input.menu.items)}\n\n${askText(names, input.wants, input.swap)}`,
        },
      ],
    },
    picks.partial
  );
  const parsed = choiceSchema.parse(raw);
  picks.done(parsed);
  for (const a of parsed.avoid) {
    const v = filter.avoid(a);
    if (v) input.onAvoid(v);
  }
  return { note: parsed.note?.trim() || null };
}
