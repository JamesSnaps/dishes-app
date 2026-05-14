"use client";

import { useState, useTransition } from "react";
import { Sparkles, ChevronRight, Loader2, AlertCircle } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Textarea,
  Badge,
} from "@dishes/ui";
import {
  generateConcepts,
  generateFullRecipe,
  type ConceptCard,
  type GeneratedRecipe,
} from "@/app/actions/ai";
import type { RecipeFormDefaults } from "./recipe-form";

// ── Helpers ────────────────────────────────────────────────────────────────────

function difficultyLabel(d: string) {
  return d.charAt(0).toUpperCase() + d.slice(1);
}

function difficultyVariant(d: string): "default" | "secondary" | "outline" {
  if (d === "easy") return "secondary";
  if (d === "hard") return "default";
  return "outline";
}

function recipeToDefaults(r: GeneratedRecipe): RecipeFormDefaults {
  return {
    title: r.title,
    description: r.description,
    cuisine: r.cuisine,
    difficulty: r.difficulty,
    prepTimeMinutes: r.prepTimeMinutes,
    cookTimeMinutes: r.cookTimeMinutes,
    servings: r.servings,
    servingsUnit: r.servingsUnit,
    tags: r.tags,
    notes: r.notes,
    ingredients: r.ingredients,
    steps: r.steps,
  };
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function ConceptCardItem({
  concept,
  onSelect,
  disabled,
}: {
  concept: ConceptCard;
  onSelect: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className="group w-full rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
    >
      <div className="mb-1 flex items-start justify-between gap-2">
        <span className="font-semibold leading-snug group-hover:text-primary">
          {concept.title}
        </span>
        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" />
      </div>
      <p className="mb-2 text-sm text-muted-foreground">{concept.description}</p>
      <div className="flex flex-wrap gap-1">
        {concept.cuisine && (
          <Badge variant="outline" className="text-xs">
            {concept.cuisine}
          </Badge>
        )}
        <Badge variant={difficultyVariant(concept.difficulty)} className="text-xs">
          {difficultyLabel(concept.difficulty)}
        </Badge>
        {concept.tags.slice(0, 3).map((tag) => (
          <Badge key={tag} variant="secondary" className="text-xs">
            {tag}
          </Badge>
        ))}
      </div>
    </button>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface AiConciergeProps {
  onRecipeGenerated: (defaults: RecipeFormDefaults) => void;
}

type Step = "prompt" | "concepts" | "generating";

export function AiConcierge({ onRecipeGenerated }: AiConciergeProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("prompt");
  const [promptText, setPromptText] = useState("");
  const [concepts, setConcepts] = useState<ConceptCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleOpen() {
    setOpen(true);
    setStep("prompt");
    setPromptText("");
    setConcepts([]);
    setError(null);
  }

  function handleClose() {
    if (isPending) return;
    setOpen(false);
  }

  function handleGenerateConcepts() {
    setError(null);
    startTransition(async () => {
      const result = await generateConcepts(promptText);
      if (result.error) {
        setError(result.error);
        return;
      }
      setConcepts(result.concepts!);
      setStep("concepts");
    });
  }

  function handleSelectConcept(concept: ConceptCard) {
    setError(null);
    setStep("generating");
    startTransition(async () => {
      const result = await generateFullRecipe(concept);
      if (result.error) {
        setError(result.error);
        setStep("concepts");
        return;
      }
      setOpen(false);
      onRecipeGenerated(recipeToDefaults(result.recipe!));
    });
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={handleOpen} className="gap-2">
        <Sparkles className="h-4 w-4" />
        Generate with AI
      </Button>

      <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">

          {/* ── Step: prompt ── */}
          {step === "prompt" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                  AI recipe concierge
                </DialogTitle>
                <DialogDescription>
                  Describe what you feel like cooking and we&apos;ll suggest 5 ideas.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 pt-2">
                <Textarea
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  placeholder="e.g. Something quick and vegetarian, maybe Asian-inspired, for 2 people on a weeknight…"
                  rows={4}
                  className="resize-none"
                  disabled={isPending}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleGenerateConcepts();
                    }
                  }}
                />

                {error && <ErrorBanner message={error} />}

                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={handleClose} disabled={isPending}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleGenerateConcepts}
                    disabled={isPending || !promptText.trim()}
                    className="gap-2"
                  >
                    {isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Thinking…
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        Suggest ideas
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* ── Step: concepts ── */}
          {step === "concepts" && (
            <>
              <DialogHeader>
                <DialogTitle>Pick a recipe idea</DialogTitle>
                <DialogDescription>
                  Choose one and we&apos;ll generate the full recipe for you to review.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 pt-2">
                {error && <ErrorBanner message={error} />}

                {concepts.map((concept, i) => (
                  <ConceptCardItem
                    key={i}
                    concept={concept}
                    onSelect={() => handleSelectConcept(concept)}
                    disabled={isPending}
                  />
                ))}

                <div className="flex justify-between pt-1">
                  <Button
                    variant="ghost"
                    onClick={() => setStep("prompt")}
                    disabled={isPending}
                  >
                    ← Back
                  </Button>
                  <Button variant="ghost" onClick={handleClose} disabled={isPending}>
                    Cancel
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* ── Step: generating full recipe ── */}
          {step === "generating" && (
            <>
              <DialogHeader>
                <DialogTitle>Generating your recipe…</DialogTitle>
                <DialogDescription>
                  Writing out ingredients and steps. This usually takes 10–20 seconds.
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col items-center gap-4 py-8">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">
                  Hang tight, the chef is at work.
                </p>
              </div>
            </>
          )}

        </DialogContent>
      </Dialog>
    </>
  );
}
