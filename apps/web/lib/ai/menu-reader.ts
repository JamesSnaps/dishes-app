/**
 * The first half of "Help me choose": read the menu, however it came
 * (`menu-sources.ts`), into a numbered list of dishes — section, name, the
 * menu's own description and any printed calories. Streamed, so each dish
 * name can be shown as it's read.
 *
 * The list is what the chooser picks from (by number, so a pick's menu line
 * and calories are the menu's, never the model's paraphrase), what "See the
 * whole menu" shows, and what a swap is sent instead of the photos again.
 */

import type OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { maxTokensParam } from "@/lib/ai/recipe-generation";
import { completedItems, streamStructured } from "@/lib/ai/stream-structured";

import type { MenuItem, ReadMenu } from "@/lib/menu-choice";

export type { MenuItem, ReadMenu };
export { courseOfSection } from "@/lib/menu-choice";

/** More than any menu needs; a longer list is a drinks list or a misread. */
export const MAX_MENU_ITEMS = 150;

const readSchema = z.object({
  menuReadable: z.boolean(),
  restaurant: z.object({ name: z.string().nullable(), cuisine: z.string().nullable() }),
  items: z.array(
    z.object({
      section: z.string().nullable(),
      name: z.string(),
      description: z.string().nullable(),
      kcal: z.number().nullable(),
    })
  ),
});

export class MenuUnreadableError extends Error {
  constructor(message = "The menu couldn't be read. Try a clearer photo, or paste the text.") {
    super(message);
    this.name = "MenuUnreadableError";
  }
}

const SYSTEM_PROMPT = `You transcribe restaurant and takeaway menus. You get the menu as photos, a PDF, a web page's text or typed text.

List every dish, in menu order:
- section: the heading it's under, exactly as written ("Starters", "Small plates", "From the grill"), or null.
- name: the dish's name as written.
- description: the rest of its menu text, word for word (ingredients, sides, sauce), without the price. null if there's none.
- kcal: calories only when the menu prints them for that dish, else null.

Skip prices, allergen codes, set-menu blurbs and anything that isn't a dish. Include sides and desserts; include drinks only if they're on the same menu, and at most 15 of them.
restaurant: its name and cuisine if the menu shows them, else null.
If you can't read a menu from what you were given, set menuReadable false and give no items.`;

/** One streamed AI call. `onDish` sees each dish's name as it's read. */
export async function readMenu(
  client: OpenAI,
  model: string,
  menu: OpenAI.ChatCompletionContentPart[],
  onDish: (name: string) => void
): Promise<ReadMenu> {
  const dishes = completedItems<{ name?: unknown }>("items", (item) => {
    if (typeof item?.name === "string" && item.name.trim()) onDish(item.name.trim());
  });
  const raw = await streamStructured(
    client,
    {
      model,
      response_format: zodResponseFormat(readSchema, "menu"),
      ...maxTokensParam(model, 6000),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: [...menu, { type: "text", text: "Transcribe this menu." }] },
      ],
    },
    dishes.partial
  );
  const parsed = readSchema.parse(raw);
  dishes.done(parsed);
  return tidyMenu(parsed);
}

const clean = (s: string | null | undefined) => s?.replace(/\s+/g, " ").trim() || null;

/** The model's reading, held to what the chooser needs. Throws when there's no menu in it. */
export function tidyMenu(parsed: z.infer<typeof readSchema>): ReadMenu {
  if (!parsed.menuReadable) throw new MenuUnreadableError();
  const items = parsed.items
    .flatMap((it) => {
      const name = clean(it.name);
      if (!name) return [];
      const description = clean(it.description);
      const kcal = it.kcal != null && Number.isFinite(it.kcal) && it.kcal > 0 && it.kcal < 10000 ? Math.round(it.kcal) : null;
      return [{ section: clean(it.section), name, line: description ? `${name}, ${description}` : name, kcal }];
    })
    .slice(0, MAX_MENU_ITEMS)
    .map((it, i) => ({ id: i + 1, ...it }));
  if (!items.length) throw new MenuUnreadableError();
  return { restaurant: { name: clean(parsed.restaurant.name), cuisine: clean(parsed.restaurant.cuisine) }, items };
}

/**
 * A menu sent back by a client for a swap, checked rather than trusted. The
 * nullable keys may also be missing: Swift's JSONEncoder leaves nil out.
 */
export const readMenuSchema = z.object({
  restaurant: z.object({
    name: z.string().max(200).nullable().default(null),
    cuisine: z.string().max(100).nullable().default(null),
  }),
  items: z
    .array(
      z.object({
        id: z.number().int().positive(),
        section: z.string().max(200).nullable().default(null),
        name: z.string().min(1).max(300),
        line: z.string().min(1).max(1000),
        kcal: z.number().int().positive().max(9999).nullable().default(null),
      })
    )
    .min(1)
    .max(MAX_MENU_ITEMS),
});
