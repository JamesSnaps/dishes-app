"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, RefreshCw } from "lucide-react";
import { Button, Sheet, SheetContent, SheetHeader, SheetTitle, Textarea } from "@dishes/ui";
import { generateSimilarConcepts, generateFullRecipe, type ConceptCard, type GeneratedRecipe } from "@/app/actions/ai";

// ── Tiny helpers (mirrors concierge-client.tsx) ───────────────────────────────

const CUISINE_EMOJI: Record<string, string> = {
  italian: "🍝", japanese: "🍣", mexican: "🌮", indian: "🍛", chinese: "🥡",
  thai: "🍜", french: "🥐", american: "🍔", mediterranean: "🫒", greek: "🥗",
  vietnamese: "🍜", moroccan: "🫕", turkish: "🥙", korean: "🍲", british: "🥧",
  spanish: "🥘",
};

function cuisineEmoji(cuisine: string): string {
  const key = (cuisine ?? "").toLowerCase();
  for (const [k, v] of Object.entries(CUISINE_EMOJI)) {
    if (key.includes(k)) return v;
  }
  return "🍽️";
}

function difficultyClass(d: string) {
  if (d === "easy") return "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800";
  if (d === "hard") return "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/60 dark:text-red-400 dark:border-red-800";
  return "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-400 dark:border-amber-800";
}

function recipeToSessionDefaults(r: GeneratedRecipe) {
  return {
    title: r.title, description: r.description, cuisine: r.cuisine,
    difficulty: r.difficulty, prepTimeMinutes: r.prepTimeMinutes,
    cookTimeMinutes: r.cookTimeMinutes, servings: r.servings,
    servingsUnit: r.servingsUnit, tags: r.tags, notes: r.notes,
    ingredients: r.ingredients, steps: r.steps,
  };
}

// ── Concept card ──────────────────────────────────────────────────────────────

function SimilarConceptCard({
  concept, onSelect, isGenerating, disabled,
}: {
  concept: ConceptCard;
  onSelect: () => void;
  isGenerating: boolean;
  disabled: boolean;
}) {
  const emoji = cuisineEmoji(concept.cuisine);
  return (
    <div
      className={`flex flex-col rounded-xl border bg-card overflow-hidden transition-shadow hover:shadow-md ${disabled && !isGenerating ? "opacity-60 pointer-events-none" : ""}`}
    >
      <div className="flex h-20 items-center justify-center bg-gradient-to-br from-violet-50 via-orange-50 to-amber-50 dark:from-violet-950/60 dark:via-orange-950/40 dark:to-amber-950/50 text-4xl select-none">
        {emoji}
      </div>
      <div className="flex flex-col flex-1 gap-2 p-3">
        <h3 className="font-semibold text-sm leading-snug">{concept.title}</h3>
        <p className="text-xs text-muted-foreground line-clamp-2 flex-1">{concept.description}</p>
        <div className="flex flex-wrap gap-1">
          {concept.cuisine && (
            <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs text-violet-700 dark:border-violet-800 dark:bg-violet-950/60 dark:text-violet-400">
              {concept.cuisine}
            </span>
          )}
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs capitalize ${difficultyClass(concept.difficulty)}`}>
            {concept.difficulty}
          </span>
        </div>
        <Button
          size="sm"
          className="w-full gap-1.5 mt-1 bg-gradient-to-r from-violet-600 to-orange-500 hover:from-violet-700 hover:to-orange-600 border-0 text-white"
          onClick={onSelect}
          disabled={disabled}
        >
          {isGenerating ? (
            <><Loader2 className="h-3 w-3 animate-spin" />Creating…</>
          ) : (
            <><Sparkles className="h-3 w-3" />Create recipe</>
          )}
        </Button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  recipeId: string;
}

type Phase = "idle" | "loading-concepts" | "concepts" | "loading-recipe";

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    setIsDesktop(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isDesktop;
}

export function SimilarRecipesButton({ recipeId }: Props) {
  const isDesktop = useIsDesktop();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [note, setNote] = useState("");
  const [concepts, setConcepts] = useState<ConceptCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatingIdx, setGeneratingIdx] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  function handleOpen() {
    setOpen(true);
    setPhase("idle");
    setNote("");
    setConcepts(null);
    setError(null);
    setGeneratingIdx(null);
  }

  function runGenerateConcepts(currentNote: string) {
    setError(null);
    setConcepts(null);
    setGeneratingIdx(null);
    setPhase("loading-concepts");
    startTransition(async () => {
      const result = await generateSimilarConcepts(recipeId, currentNote);
      if (result.error) {
        setError(result.error);
        setPhase("idle");
        return;
      }
      setConcepts(result.concepts!);
      setPhase("concepts");
    });
  }

  function handleSelectConcept(concept: ConceptCard, idx: number) {
    setError(null);
    setGeneratingIdx(idx);
    setPhase("loading-recipe");
    startTransition(async () => {
      const result = await generateFullRecipe(concept);
      if (result.error || !result.recipe) {
        setError(result.error ?? "Something went wrong.");
        setPhase("concepts");
        setGeneratingIdx(null);
        return;
      }
      sessionStorage.setItem("ai_draft", JSON.stringify(recipeToSessionDefaults(result.recipe)));
      router.push("/recipes/new");
    });
  }

  return (
    <>
      <Button variant="outline" size="lg" className="w-full sm:w-auto" onClick={handleOpen}>
        <Sparkles className="mr-2 h-5 w-5" />
        Find similar recipes
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side={isDesktop ? "right" : "bottom"}
          className={
            isDesktop
              ? "w-[480px] sm:max-w-[480px] flex flex-col p-0 overflow-hidden"
              : "h-[92dvh] flex flex-col p-0 overflow-hidden"
          }
        >
          <SheetHeader className="px-4 pt-5 pb-3 border-b shrink-0 pr-12">
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              Find similar recipes
            </SheetTitle>
            <p className="text-sm text-muted-foreground">
              {phase === "concepts"
                ? "Pick one and we'll build the full recipe."
                : "AI will suggest 5 recipes inspired by this one."}
            </p>
          </SheetHeader>

          {/* Idle: note input + generate button */}
          {phase === "idle" && (
            <div className="flex flex-col gap-4 p-4 flex-1 overflow-y-auto">
              {error && (
                <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
              )}
              <div>
                <label className="text-sm font-medium mb-1.5 block">
                  Anything specific you&apos;d like? <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <Textarea
                  placeholder='e.g. "Make it vegetarian", "Something quicker", "Different cuisine"'
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="min-h-[90px] resize-none"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runGenerateConcepts(note);
                  }}
                />
              </div>
              <Button
                className="w-full bg-gradient-to-r from-violet-600 to-orange-500 hover:from-violet-700 hover:to-orange-600 border-0 text-white"
                onClick={() => runGenerateConcepts(note)}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Generate ideas
              </Button>
            </div>
          )}

          {/* Loading concepts */}
          {phase === "loading-concepts" && (
            <div className="flex flex-1 items-center justify-center gap-3 text-muted-foreground">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              <span className="text-sm">Finding similar recipes…</span>
            </div>
          )}

          {/* Concepts grid */}
          {(phase === "concepts" || phase === "loading-recipe") && concepts && (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {error && (
                <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
              )}
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">5 ideas inspired by this recipe</p>
                <button
                  type="button"
                  onClick={() => { setPhase("idle"); setConcepts(null); }}
                  disabled={phase === "loading-recipe"}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  <RefreshCw className="h-3 w-3" />
                  Start over
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {concepts.map((concept, i) => (
                  <SimilarConceptCard
                    key={i}
                    concept={concept}
                    onSelect={() => handleSelectConcept(concept, i)}
                    isGenerating={generatingIdx === i}
                    disabled={phase === "loading-recipe"}
                  />
                ))}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
