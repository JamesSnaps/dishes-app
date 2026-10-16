"use client";

import { useRef, useState } from "react";
import { Button } from "@dishes/ui";
import { MEAL_ROLE_LABELS, type MealRole } from "@dishes/shared";
import { suggestMealComponents } from "@/app/actions/ai";
import { GenerateSideSheet } from "@/components/meals/generate-side-sheet";

type Suggestion = { recipeId: string; title: string; role: MealRole; reason: string };

export function ComponentSuggestions({ recipeIds, excludedRecipeIds = [], mealTitle, onAdd }: {
  recipeIds: string[];
  excludedRecipeIds?: string[];
  mealTitle: string;
  onAdd: (suggestion: Suggestion) => void;
}) {
  const [context, setContext] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [resultKey, setResultKey] = useState("");
  const key = JSON.stringify([recipeIds.slice().sort(), mealTitle, context, excludedRecipeIds.slice().sort()]);
  const currentKey = useRef(key);
  currentKey.current = key;

  async function suggest() {
    const requestedKey = key;
    setPending(true);
    setError(null);
    try {
      const result = await suggestMealComponents({ recipeIds: [...new Set(recipeIds)], mealTitle, context, excludedRecipeIds });
      if (currentKey.current !== requestedKey) return;
      setResultKey(requestedKey);
      setError(result.error ?? null);
      setSuggestions(result.suggestions ?? null);
    } catch {
      if (currentKey.current === requestedKey) setError("Couldn't get suggestions. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return <div className="space-y-2 rounded-xl border p-3">
    <p className="text-sm font-semibold">What goes with this?</p>
    <label className="block text-xs text-muted-foreground">
      Context (optional)
      <textarea value={context} onChange={(e) => setContext(e.target.value)} maxLength={1500} rows={2}
        placeholder="e.g. Sunday roast for six, lighter sides, or a sauce without dairy"
        className="mt-1 w-full rounded-md border bg-background p-2 text-sm" />
    </label>
    <Button type="button" variant="outline" size="sm" disabled={pending || !recipeIds.length} onClick={suggest}>
      {pending ? "Finding accompaniments…" : "Suggest sides, sauces & extras"}
    </Button>
    {!recipeIds.length && <p className="text-xs text-muted-foreground">Select a dish first.</p>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {resultKey === key && suggestions?.length === 0 && <p className="text-xs text-muted-foreground">No suitable accompaniments found in your recipe library. Generate a new side below, or try different context.</p>}
    {resultKey === key && suggestions && <ul className="space-y-2" aria-live="polite">{suggestions.filter((s) => !recipeIds.includes(s.recipeId)).map((s) => <li key={s.recipeId} className="flex items-start gap-2">
      <div className="flex-1 text-sm"><span className="font-medium">{s.title}</span><span className="ml-2 text-xs text-muted-foreground">{MEAL_ROLE_LABELS[s.role]}</span><p className="text-xs text-muted-foreground">{s.reason}</p></div>
      <Button type="button" size="sm" variant="outline" onClick={() => onAdd(s)}>Add</Button>
    </li>)}</ul>}
    <p className="text-xs text-muted-foreground">Those suggestions come from your recipe library.</p>
    <GenerateSideSheet recipeIds={[...new Set(recipeIds)]} accompanies={mealTitle} inline />
  </div>;
}
