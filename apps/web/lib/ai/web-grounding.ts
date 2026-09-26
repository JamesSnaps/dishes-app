/**
 * Optional web grounding for full-recipe generation.
 *
 * Before the structured recipe is written, one Responses API call with the
 * built-in web search tool looks up a few reputable versions of the dish and
 * summarises their proportions, temperatures and times. That summary goes into
 * the generation prompt as reference material, and the cited pages become the
 * recipe's attribution.
 *
 * Grounding is best-effort: any failure (unsupported model, search error) is
 * logged and generation carries on ungrounded rather than failing the request.
 */

import OpenAI from "openai";
import type { ConceptCard } from "./recipe-generation";
import type { RecipeReference } from "./references";

export type RecipeGrounding = {
  /** Plain-text notes on the reference recipes, for the generation prompt. */
  summary: string;
  references: RecipeReference[];
};

const MAX_REFERENCES = 4;

// Nano models don't support the web search tool, so the search step steps up
// to the smallest model that does. The recipe itself still uses the household model.
function searchModelFor(model: string): string {
  return /nano/i.test(model) ? "gpt-4.1-mini" : model;
}

export async function groundRecipeConcept(
  client: OpenAI,
  model: string,
  concept: ConceptCard
): Promise<RecipeGrounding | null> {
  const response = await client.responses.create({
    model: searchModelFor(model),
    tools: [{ type: "web_search_preview", search_context_size: "low" }],
    input: `Find 2-3 well-regarded, reputable recipes for "${concept.title}" (${concept.cuisine}; ${concept.description}). Prefer established cookery sites, publications and chefs over content farms.

Then write brief reference notes covering what the sources agree on:
- key ingredient proportions (per stated servings)
- oven/hob temperatures and cooking times
- essential techniques or failure points
- any food safety temperatures that apply

Be concise (under 200 words). Do not reproduce any recipe verbatim.`,
  });

  const references: RecipeReference[] = [];
  const seen = new Set<string>();
  for (const item of response.output) {
    if (item.type !== "message") continue;
    for (const part of item.content) {
      if (part.type !== "output_text") continue;
      for (const ann of part.annotations) {
        if (ann.type !== "url_citation") continue;
        const url = stripTracking(ann.url);
        if (seen.has(url)) continue;
        seen.add(url);
        references.push({ title: ann.title || new URL(url).hostname, url });
      }
    }
  }

  const summary = response.output_text?.trim();
  if (!summary || references.length === 0) return null;
  return { summary, references: references.slice(0, MAX_REFERENCES) };
}

/** OpenAI appends utm_source=openai to cited links; keep attribution clean. */
function stripTracking(raw: string): string {
  try {
    const url = new URL(raw);
    url.searchParams.delete("utm_source");
    return url.toString();
  } catch {
    return raw;
  }
}

/** Appended to the user turn so the recipe is built from the references. */
export function groundingPromptSuffix(grounding: RecipeGrounding): string {
  return `\n\nReference notes from real published recipes (use these to keep proportions, temperatures and times realistic; write your own recipe and wording, don't copy):\n${grounding.summary}`;
}

