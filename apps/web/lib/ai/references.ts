/**
 * Attribution for web-grounded recipes. Dependency-free so client components
 * (the concierge's form-draft mappers) can use it without pulling in the SDK.
 */

export type RecipeReference = { title: string; url: string };

/** Attribution block appended to a grounded recipe's notes. */
export function referencesNote(references: RecipeReference[]): string {
  return `Inspired by:\n${references.map((r) => `• ${r.title} — ${r.url}`).join("\n")}`;
}

/** Notes and source URL for a recipe, with its references folded in. */
export function withReferences(
  notes: string | null,
  references: RecipeReference[] | undefined
): { notes: string | null; sourceUrl: string | null } {
  if (!references?.length) return { notes, sourceUrl: null };
  return {
    notes: [notes, referencesNote(references)].filter(Boolean).join("\n\n"),
    sourceUrl: references[0]!.url,
  };
}
