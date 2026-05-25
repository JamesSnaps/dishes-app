"use client";

import { useState, useTransition } from "react";
import { Sparkles, ChevronRight, Loader2, AlertCircle, Target } from "lucide-react";
import { cn } from "@dishes/ui";
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

const MEAL_TYPES = [
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
  { value: "dessert", label: "Dessert" },
  { value: "snack", label: "Snack" },
] as const;

export function AiConcierge({ onRecipeGenerated }: AiConciergeProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"inspire" | "direct">("inspire");
  const [step, setStep] = useState<Step>("prompt");
  const [promptText, setPromptText] = useState("");
  const [mealType, setMealType] = useState<string>("");
  const [concepts, setConcepts] = useState<ConceptCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleOpen() {
    setOpen(true);
    setMode("inspire");
    setStep("prompt");
    setPromptText("");
    setMealType("");
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
      const result = await generateConcepts(promptText, undefined, mealType || undefined);
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
      const result = await generateFullRecipe(concept, undefined, mealType || undefined);
      if (result.error) {
        setError(result.error);
        setStep("concepts");
        return;
      }
      setOpen(false);
      onRecipeGenerated(recipeToDefaults(result.recipe!));
    });
  }

  function handleDirectGenerate() {
    const title = promptText.trim();
    if (!title) return;
    setError(null);
    setStep("generating");
    const directConcept: ConceptCard = {
      title,
      description: title,
      cuisine: "",
      tags: [],
      difficulty: "medium",
    };
    startTransition(async () => {
      const result = await generateFullRecipe(directConcept, undefined, mealType || undefined);
      if (result.error) {
        setError(result.error);
        setStep("prompt");
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
                  {mode === "inspire"
                    ? "Describe what you feel like cooking and we'll suggest 5 ideas."
                    : "Name the recipe you want and we'll build it for you."}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 pt-2">
                {/* Mode toggle */}
                <div className="flex gap-1 rounded-xl border bg-muted/40 p-1 w-fit">
                  <button
                    type="button"
                    onClick={() => setMode("inspire")}
                    disabled={isPending}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all disabled:pointer-events-none",
                      mode === "inspire" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Inspire me
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("direct")}
                    disabled={isPending}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all disabled:pointer-events-none",
                      mode === "direct" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Target className="h-3.5 w-3.5" />
                    I know what I want
                  </button>
                </div>

                {/* Meal type selector */}
                <div>
                  <p className="mb-1.5 text-sm font-medium text-muted-foreground">Meal type</p>
                  <div className="flex flex-wrap gap-1.5">
                    {MEAL_TYPES.map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        disabled={isPending}
                        onClick={() => setMealType((prev) => (prev === value ? "" : value))}
                        className={cn(
                          "capitalize rounded-full border px-3 py-1 text-xs font-medium transition-all disabled:pointer-events-none",
                          mealType === value
                            ? "border-orange-400 bg-orange-500 text-white"
                            : "border-orange-200 bg-orange-50 text-orange-700 hover:border-orange-300 dark:border-orange-800 dark:bg-orange-950/50 dark:text-orange-400 dark:hover:border-orange-700"
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <Textarea
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  placeholder={
                    mode === "inspire"
                      ? "e.g. Something quick and vegetarian, maybe Asian-inspired, for 2 people on a weeknight…"
                      : "e.g. Chicken tikka masala, beef bourguignon, pad thai…"
                  }
                  rows={4}
                  className="resize-none"
                  disabled={isPending}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      if (mode === "inspire") { handleGenerateConcepts(); } else { handleDirectGenerate(); }
                    }
                  }}
                />

                {error && <ErrorBanner message={error} />}

                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={handleClose} disabled={isPending}>
                    Cancel
                  </Button>
                  <Button
                    onClick={mode === "inspire" ? handleGenerateConcepts : handleDirectGenerate}
                    disabled={isPending || !promptText.trim()}
                    className="gap-2"
                  >
                    {isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {mode === "inspire" ? "Thinking…" : "Writing recipe…"}
                      </>
                    ) : mode === "inspire" ? (
                      <>
                        <Sparkles className="h-4 w-4" />
                        Suggest ideas
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        Create recipe
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
