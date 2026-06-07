"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, AlertCircle, Target, Check, ChevronDown, ChevronUp } from "lucide-react";
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
import { saveGeneratedRecipe } from "@/app/actions/recipes";
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
    calories: r.nutrition?.calories ?? null,
    proteinG: r.nutrition?.proteinG == null ? null : String(r.nutrition.proteinG),
    carbsG: r.nutrition?.carbsG == null ? null : String(r.nutrition.carbsG),
    fatG: r.nutrition?.fatG == null ? null : String(r.nutrition.fatG),
    fiberG: r.nutrition?.fiberG == null ? null : String(r.nutrition.fiberG),
    sugarG: r.nutrition?.sugarG == null ? null : String(r.nutrition.sugarG),
    sodiumMg: r.nutrition?.sodiumMg == null ? null : String(r.nutrition.sodiumMg),
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
  selected,
  onToggle,
  disabled,
}: {
  concept: ConceptCard;
  selected: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasMore = concept.description.length > 120 || concept.tags.length > 3;

  return (
    <div
      className={cn(
        "rounded-lg border p-4 transition-colors",
        selected
          ? "border-primary bg-primary/5"
          : "bg-card hover:border-muted-foreground/30",
        disabled && "pointer-events-none opacity-50"
      )}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        <button
          type="button"
          onClick={onToggle}
          disabled={disabled}
          className={cn(
            "mt-0.5 h-5 w-5 shrink-0 rounded border-2 flex items-center justify-center transition-colors",
            selected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-muted-foreground/40 hover:border-primary"
          )}
          aria-label={selected ? "Deselect" : "Select"}
        >
          {selected && <Check className="h-3 w-3" />}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <button
            type="button"
            onClick={onToggle}
            disabled={disabled}
            className="w-full text-left"
          >
            <span className={cn("font-semibold leading-snug", selected && "text-primary")}>
              {concept.title}
            </span>
          </button>

          <p className={cn("mt-1 text-sm text-muted-foreground", !expanded && "line-clamp-2")}>
            {concept.description}
          </p>

          <div className="mt-2 flex flex-wrap gap-1">
            {concept.cuisine && (
              <Badge variant="outline" className="text-xs">
                {concept.cuisine}
              </Badge>
            )}
            <Badge variant={difficultyVariant(concept.difficulty)} className="text-xs">
              {difficultyLabel(concept.difficulty)}
            </Badge>
            {(expanded ? concept.tags : concept.tags.slice(0, 3)).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>

          {hasMore && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
              className="mt-1.5 flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {expanded ? (
                <><ChevronUp className="h-3 w-3" />Less</>
              ) : (
                <><ChevronDown className="h-3 w-3" />More</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface AiConciergeProps {
  onRecipeGenerated: (defaults: RecipeFormDefaults) => void;
}

type Step = "prompt" | "concepts" | "generating" | "batch-generating";

type BatchItem = {
  concept: ConceptCard;
  status: "pending" | "generating" | "done" | "error";
  recipeId?: string;
  error?: string;
};

const MEAL_TYPES = [
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
  { value: "dessert", label: "Dessert" },
  { value: "snack", label: "Snack" },
] as const;

export function AiConcierge({ onRecipeGenerated }: AiConciergeProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"inspire" | "direct">("inspire");
  const [step, setStep] = useState<Step>("prompt");
  const [promptText, setPromptText] = useState("");
  const [mealType, setMealType] = useState<string>("");
  const [targetCalories, setTargetCalories] = useState<string>("");
  const [concepts, setConcepts] = useState<ConceptCard[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const parsedTargetCalories = (() => {
    const n = parseInt(targetCalories, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  })();

  const batchDone =
    batchItems.length > 0 &&
    batchItems.every((b) => b.status === "done" || b.status === "error");
  const batchSuccessCount = batchItems.filter((b) => b.status === "done").length;

  function handleOpen() {
    setOpen(true);
    setMode("inspire");
    setStep("prompt");
    setPromptText("");
    setMealType("");
    setTargetCalories("");
    setConcepts([]);
    setSelected(new Set());
    setBatchItems([]);
    setError(null);
  }

  function handleClose() {
    if (isPending) return;
    if (step === "batch-generating" && !batchDone) return;
    setOpen(false);
  }

  function handleGenerateConcepts() {
    setError(null);
    startTransition(async () => {
      const result = await generateConcepts(promptText, undefined, mealType || undefined, parsedTargetCalories);
      if (result.error) {
        setError(result.error);
        return;
      }
      setConcepts(result.concepts!);
      setSelected(new Set());
      setStep("concepts");
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
      const result = await generateFullRecipe(directConcept, undefined, mealType || undefined, parsedTargetCalories);
      if (result.error) {
        setError(result.error);
        setStep("prompt");
        return;
      }
      setOpen(false);
      onRecipeGenerated(recipeToDefaults(result.recipe!));
    });
  }

  function toggleConcept(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function handleGenerate() {
    if (selected.size === 0) return;
    const chosenConcepts = [...selected].sort((a, b) => a - b).map((i) => concepts[i]!);

    if (selected.size === 1) {
      setError(null);
      setStep("generating");
      startTransition(async () => {
        const result = await generateFullRecipe(chosenConcepts[0]!, undefined, mealType || undefined, parsedTargetCalories);
        if (result.error) {
          setError(result.error);
          setStep("concepts");
          return;
        }
        setOpen(false);
        onRecipeGenerated(recipeToDefaults(result.recipe!));
      });
    } else {
      const items: BatchItem[] = chosenConcepts.map((c) => ({
        concept: c,
        status: "pending",
      }));
      setBatchItems(items);
      setStep("batch-generating");

      void (async () => {
        const updated = [...items];
        for (let i = 0; i < updated.length; i++) {
          updated[i] = { ...updated[i]!, status: "generating" };
          setBatchItems([...updated]);

          const genResult = await generateFullRecipe(
            updated[i]!.concept,
            undefined,
            mealType || undefined,
            parsedTargetCalories
          );
          if (genResult.error) {
            updated[i] = { ...updated[i]!, status: "error", error: genResult.error };
            setBatchItems([...updated]);
            continue;
          }

          const saveResult = await saveGeneratedRecipe(genResult.recipe!);
          if (saveResult.error) {
            updated[i] = { ...updated[i]!, status: "error", error: saveResult.error };
          } else {
            updated[i] = { ...updated[i]!, status: "done", recipeId: saveResult.recipeId };
          }
          setBatchItems([...updated]);
        }
      })();
    }
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
                      mode === "inspire"
                        ? "bg-background shadow-sm text-foreground"
                        : "text-muted-foreground hover:text-foreground"
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
                      mode === "direct"
                        ? "bg-background shadow-sm text-foreground"
                        : "text-muted-foreground hover:text-foreground"
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

                {/* Calorie target */}
                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                    <Target className="h-3.5 w-3.5" />
                    Calorie target <span className="font-normal">(per serving, optional)</span>
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      step="50"
                      inputMode="numeric"
                      value={targetCalories}
                      onChange={(e) => setTargetCalories(e.target.value)}
                      disabled={isPending}
                      placeholder="e.g. 600"
                      className="w-32 rounded-md border border-input bg-background px-3 py-1.5 text-sm disabled:opacity-50"
                    />
                    <span className="text-xs text-muted-foreground">kcal</span>
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
                      if (mode === "inspire") handleGenerateConcepts();
                      else handleDirectGenerate();
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
                <DialogTitle>Pick your ideas</DialogTitle>
                <DialogDescription>
                  Select one or more. A single selection opens the form for review; multiple are saved directly to your library.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2 pt-2">
                {error && <ErrorBanner message={error} />}

                <div className="flex items-center justify-between pb-1">
                  <button
                    type="button"
                    onClick={() =>
                      setSelected(
                        selected.size === concepts.length
                          ? new Set()
                          : new Set(concepts.map((_, i) => i))
                      )
                    }
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    {selected.size === concepts.length ? "Deselect all" : "Select all"}
                  </button>
                  {selected.size > 0 && (
                    <span className="text-xs text-muted-foreground">{selected.size} selected</span>
                  )}
                </div>

                {concepts.map((concept, i) => (
                  <ConceptCardItem
                    key={i}
                    concept={concept}
                    selected={selected.has(i)}
                    onToggle={() => toggleConcept(i)}
                    disabled={isPending}
                  />
                ))}

                <div className="flex justify-between pt-2">
                  <Button
                    variant="ghost"
                    onClick={() => setStep("prompt")}
                    disabled={isPending}
                  >
                    ← Back
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={handleClose} disabled={isPending}>
                      Cancel
                    </Button>
                    <Button
                      onClick={handleGenerate}
                      disabled={isPending || selected.size === 0}
                      className="gap-2"
                    >
                      {isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Generating…
                        </>
                      ) : selected.size > 1 ? (
                        <>
                          <Sparkles className="h-4 w-4" />
                          Generate {selected.size} recipes
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-4 w-4" />
                          Generate recipe
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ── Step: generating single ── */}
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
                <p className="text-sm text-muted-foreground">Hang tight, the chef is at work.</p>
              </div>
            </>
          )}

          {/* ── Step: batch generating ── */}
          {step === "batch-generating" && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {batchDone
                    ? `${batchSuccessCount} recipe${batchSuccessCount !== 1 ? "s" : ""} created`
                    : "Creating recipes…"}
                </DialogTitle>
                <DialogDescription>
                  {batchDone
                    ? "Head to your recipe library to view them."
                    : "Generating each recipe in turn — this may take a minute."}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 py-4">
                {batchItems.map((item, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div
                      className={cn(
                        "h-6 w-6 shrink-0 rounded-full flex items-center justify-center text-xs font-medium",
                        item.status === "done" &&
                          "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
                        item.status === "generating" && "bg-primary/10 text-primary",
                        item.status === "error" && "bg-destructive/10 text-destructive",
                        item.status === "pending" && "bg-muted text-muted-foreground"
                      )}
                    >
                      {item.status === "done" && <Check className="h-3.5 w-3.5" />}
                      {item.status === "generating" && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      )}
                      {item.status === "error" && <AlertCircle className="h-3.5 w-3.5" />}
                      {item.status === "pending" && <span>{i + 1}</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-tight">{item.concept.title}</p>
                      {item.status === "generating" && (
                        <p className="text-xs text-muted-foreground">
                          Writing ingredients and steps…
                        </p>
                      )}
                      {item.status === "error" && (
                        <p className="text-xs text-destructive">{item.error}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {batchDone && (
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setOpen(false)}>
                    Stay here
                  </Button>
                  <Button
                    onClick={() => {
                      setOpen(false);
                      router.push("/recipes");
                    }}
                  >
                    View recipes
                  </Button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
