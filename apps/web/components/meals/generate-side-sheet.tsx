/**
 * Asks the AI for side dishes that go with one or more recipes, then drafts
 * the one you pick as a new recipe already marked Side.
 *
 * Example: from roast chicken, "Generate a side dish" with the note "something
 * green" returns five ideas; picking garlic greens opens a new recipe form
 * with the role set to Side.
 */
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Salad, Sparkles } from "lucide-react";
import { Button, Sheet, SheetContent, SheetHeader, SheetTitle, Textarea } from "@dishes/ui";
import { startRecipeJob, generateSideConcepts } from "@/app/actions/ai";
import { useAiJobRunner, useAsyncBusy } from "@/lib/ai-jobs-client";
import type { RecipeJobResult } from "@/lib/ai/job-types";
import { recipeJobToDefaults, stashAiDraft } from "@/lib/ai/recipe-defaults";
import type { ConceptCard } from "@/lib/ai/recipe-generation";

type Phase = "idle" | "loading-concepts" | "concepts" | "loading-recipe";

function SideFlow({
  recipeIds,
  accompanies,
  onClose,
}: {
  recipeIds: string[];
  accompanies: string;
  onClose?: () => void;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [note, setNote] = useState("");
  const [concepts, setConcepts] = useState<ConceptCard[] | null>(null);
  const [withDishes, setWithDishes] = useState(accompanies);
  const [error, setError] = useState<string | null>(null);
  const [generatingIdx, setGeneratingIdx] = useState<number | null>(null);
  const [, startTransition] = useAsyncBusy();
  const { run } = useAiJobRunner();

  function runGenerateConcepts(currentNote: string) {
    setError(null);
    setConcepts(null);
    setGeneratingIdx(null);
    setPhase("loading-concepts");
    startTransition(async () => {
      const result = await generateSideConcepts(recipeIds, currentNote);
      if (result.error || !result.concepts) {
        setError(result.error ?? "Something went wrong.");
        setPhase("idle");
        return;
      }
      if (result.accompanies) setWithDishes(result.accompanies);
      setConcepts(result.concepts);
      setPhase("concepts");
    });
  }

  function handleSelectConcept(concept: ConceptCard, idx: number) {
    setError(null);
    setGeneratingIdx(idx);
    setPhase("loading-recipe");
    startTransition(async () => {
      // A background job: leave the page and the app-wide tray offers the recipe.
      const out = await run<RecipeJobResult>(
        startRecipeJob(concept, undefined, undefined, undefined, { mealRole: "side", accompanies: withDishes }),
        { kind: "recipe", label: concept.title }
      );
      if (!out) return;
      if ("error" in out) {
        setError(out.error);
        setPhase("concepts");
        setGeneratingIdx(null);
        return;
      }
      stashAiDraft(recipeJobToDefaults(out.result));
      onClose?.();
      router.push("/recipes/new");
    });
  }

  if (phase === "loading-concepts") {
    return (
      <div className="flex items-center justify-center gap-3 py-10 text-muted-foreground">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
        <span className="text-sm">Thinking of sides…</span>
      </div>
    );
  }

  if ((phase === "concepts" || phase === "loading-recipe") && concepts) {
    return (
      <div className="space-y-3">
        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
        )}
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Five sides to go with {withDishes}. Pick one to draft the recipe.
          </p>
          <button
            type="button"
            onClick={() => {
              setPhase("idle");
              setConcepts(null);
            }}
            disabled={phase === "loading-recipe"}
            className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className="h-3 w-3" />
            Start over
          </button>
        </div>
        <ul className="space-y-2">
          {concepts.map((concept, index) => {
            const busy = generatingIdx === index;
            return (
              <li key={`${concept.title}-${index}`}>
                <button
                  type="button"
                  disabled={phase === "loading-recipe"}
                  onClick={() => handleSelectConcept(concept, index)}
                  className="flex w-full items-start gap-3 rounded-xl border border-transparent bg-success-tint p-3 text-left shadow-sm transition-colors disabled:opacity-60"
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-success-tint text-success">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Salad className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold leading-snug">{concept.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{concept.description}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}
      <div>
        <label className="mb-1.5 block text-sm font-medium">
          Anything specific? <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Textarea
          placeholder='e.g. "Something green", "Ready in 15 minutes", "No dairy"'
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className="min-h-[80px] resize-none"
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) runGenerateConcepts(note);
          }}
        />
      </div>
      <Button
        type="button"
        className="w-full border-0 bg-success text-card"
        disabled={!recipeIds.length}
        onClick={() => runGenerateConcepts(note)}
      >
        <Sparkles className="mr-2 h-4 w-4" />
        Suggest side dishes
      </Button>
    </div>
  );
}

export function GenerateSideSheet({
  recipeIds,
  accompanies,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
  inline = false,
}: {
  recipeIds: string[];
  accompanies: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
  /** Render the flow in place. Use this inside another dialog so two overlays don't stack. */
  inline?: boolean;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    setIsDesktop(mq.matches);
    const handler = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  if (inline) {
    return (
      <div className="space-y-2 rounded-xl border border-transparent bg-success-tint p-3">
        <p className="text-sm font-semibold">Generate a new side dish</p>
        <p className="text-xs text-muted-foreground">
          A new recipe, marked as a side, written to go with {accompanies || "this meal"}.
        </p>
        <SideFlow recipeIds={recipeIds} accompanies={accompanies} />
      </div>
    );
  }

  return (
    <>
      {!hideTrigger && (
        <Button
          type="button"
          className="border-0 bg-success text-card shadow-sm"
          onClick={() => setOpen(true)}
        >
          <Salad className="mr-2 h-4 w-4" />
          Generate a side dish
        </Button>
      )}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side={isDesktop ? "right" : "bottom"}
          className={
            isDesktop
              ? "flex w-[440px] flex-col overflow-hidden p-0 sm:max-w-[440px]"
              : "flex h-[92dvh] flex-col overflow-hidden p-0"
          }
        >
          <SheetHeader className="shrink-0 border-b px-4 pb-3 pr-12 pt-5">
            <SheetTitle className="flex items-center gap-2">
              <Salad className="h-4 w-4" />
              Generate a side dish
            </SheetTitle>
            <p className="text-sm text-muted-foreground">
              Sides to serve with {accompanies || "this dish"}. The one you pick is drafted as a new Side recipe.
            </p>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-4">
            {open && (
              <SideFlow
                recipeIds={recipeIds}
                accompanies={accompanies}
                onClose={() => setOpen(false)}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
