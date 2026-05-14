"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  Loader2,
  AlertCircle,
  RefreshCw,
  Zap,
  Leaf,
  Users,
  PiggyBank,
} from "lucide-react";
import { Button, Textarea, cn } from "@dishes/ui";
import {
  generateConcepts,
  generateFullRecipe,
  type ConceptCard,
  type GeneratedRecipe,
} from "@/app/actions/ai";
import type { RecipeFormDefaults } from "../../recipes/_components/recipe-form";

// ── Static data ────────────────────────────────────────────────────────────────

const PREFERENCES = [
  { label: "Vegetarian", icon: Leaf },
  { label: "Quick", icon: Zap },
  { label: "Family Friendly", icon: Users },
  { label: "Budget", icon: PiggyBank },
] as const;

const QUICK_PROMPTS = [
  {
    label: "Quick dinner",
    description: "Under 30 minutes",
    prompt: "Quick weeknight dinner in under 30 minutes",
  },
  {
    label: "Healthy",
    description: "High protein",
    prompt: "Healthy high-protein meal",
  },
  {
    label: "Comfort food",
    description: "For cosy nights",
    prompt: "Comfort food for a cosy night in",
  },
  {
    label: "Use what I have",
    description: "Pantry staples",
    prompt: "Something easy using common pantry staples",
  },
] as const;

const CUISINE_EMOJI: Record<string, string> = {
  italian: "🍝",
  pizza: "🍕",
  chinese: "🥢",
  japanese: "🍱",
  sushi: "🍣",
  mexican: "🌮",
  thai: "🍜",
  indian: "🍛",
  french: "🥐",
  american: "🍔",
  greek: "🥗",
  mediterranean: "🫒",
  korean: "🍲",
  british: "🥧",
  spanish: "🥘",
  middle: "🧆",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function cuisineEmoji(cuisine: string): string {
  const key = (cuisine ?? "").toLowerCase();
  for (const [k, v] of Object.entries(CUISINE_EMOJI)) {
    if (key.includes(k)) return v;
  }
  return "🍽️";
}

function difficultyClass(d: string) {
  if (d === "easy") return "bg-green-100 text-green-700 border-green-200";
  if (d === "hard") return "bg-red-100 text-red-700 border-red-200";
  return "bg-yellow-100 text-yellow-700 border-yellow-200";
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
  isGenerating,
  disabled,
}: {
  concept: ConceptCard;
  onSelect: () => void;
  isGenerating: boolean;
  disabled: boolean;
}) {
  const emoji = cuisineEmoji(concept.cuisine);
  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border bg-card overflow-hidden transition-shadow hover:shadow-md",
        disabled && !isGenerating && "opacity-60 pointer-events-none"
      )}
    >
      {/* Visual header — cuisine emoji on gradient */}
      <div className="flex h-28 items-center justify-center bg-gradient-to-br from-muted to-muted/30 text-5xl select-none">
        {emoji}
      </div>

      {/* Content */}
      <div className="flex flex-col flex-1 gap-2 p-4">
        <h3 className="font-semibold leading-snug">{concept.title}</h3>
        <p className="text-xs text-muted-foreground line-clamp-2 flex-1">
          {concept.description}
        </p>

        <div className="flex flex-wrap gap-1">
          {concept.cuisine && (
            <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">
              {concept.cuisine}
            </span>
          )}
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-xs capitalize",
              difficultyClass(concept.difficulty)
            )}
          >
            {concept.difficulty}
          </span>
          {concept.tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>

        <Button
          size="sm"
          className="w-full gap-1.5 mt-1"
          onClick={onSelect}
          disabled={disabled}
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Creating recipe…
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5" />
              Create recipe
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function QuickPromptButton({
  label,
  description,
  onClick,
  disabled,
}: {
  label: string;
  description: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted hover:border-primary/30 disabled:opacity-50 disabled:pointer-events-none"
    >
      <div className="text-sm font-medium">{label}</div>
      <div className="text-xs text-muted-foreground">{description}</div>
    </button>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function ConciergeClient() {
  const router = useRouter();
  const [promptText, setPromptText] = useState("");
  const [selectedPrefs, setSelectedPrefs] = useState<Set<string>>(new Set());
  const [concepts, setConcepts] = useState<ConceptCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatingIdx, setGeneratingIdx] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  function buildPrompt(basePrompt?: string) {
    const parts: string[] = [];
    if (selectedPrefs.size > 0) parts.push(Array.from(selectedPrefs).join(", "));
    const text = (basePrompt ?? promptText).trim();
    if (text) parts.push(text);
    return parts.join(". ");
  }

  function runGenerate(overridePrompt?: string) {
    const full = buildPrompt(overridePrompt);
    if (!full) return;
    setError(null);
    setConcepts(null);
    setGeneratingIdx(null);
    startTransition(async () => {
      const result = await generateConcepts(full);
      if (result.error) {
        setError(result.error);
        return;
      }
      setConcepts(result.concepts!);
      // Scroll to results on mobile
      setTimeout(() => {
        document.getElementById("concierge-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    });
  }

  function handleQuickPrompt(prompt: string) {
    setPromptText(prompt);
    runGenerate(prompt);
  }

  function togglePref(label: string) {
    setSelectedPrefs((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function handleSelectConcept(concept: ConceptCard, idx: number) {
    setError(null);
    setGeneratingIdx(idx);
    startTransition(async () => {
      const result = await generateFullRecipe(concept);
      if (result.error) {
        setError(result.error);
        setGeneratingIdx(null);
        return;
      }
      const defaults = recipeToDefaults(result.recipe!);
      sessionStorage.setItem("ai_draft", JSON.stringify(defaults));
      router.push("/recipes/new");
    });
  }

  const canGenerate = promptText.trim().length > 0 || selectedPrefs.size > 0;
  const isConceptLoading = isPending && generatingIdx === null;
  const isRecipeLoading = isPending && generatingIdx !== null;

  return (
    <div className="p-4 lg:p-8 max-w-screen-xl mx-auto">
      {/* Page header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">AI Concierge</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Tell me what you&apos;re craving and I&apos;ll suggest some delicious ideas.
        </p>
      </div>

      {/* Mobile: quick prompts horizontal scroll */}
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1 lg:hidden">
        {QUICK_PROMPTS.map(({ label, description, prompt }) => (
          <button
            key={label}
            type="button"
            onClick={() => handleQuickPrompt(prompt)}
            disabled={isPending}
            className="flex-shrink-0 rounded-lg border bg-card px-3 py-2 text-left disabled:opacity-50"
          >
            <div className="text-sm font-medium whitespace-nowrap">{label}</div>
            <div className="text-xs text-muted-foreground whitespace-nowrap">{description}</div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_240px]">
        {/* ── Main column ── */}
        <div className="space-y-6 min-w-0">
          {/* Input card */}
          <div className="rounded-xl border bg-card p-5 space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Describe what you&apos;re looking for
              </label>
              <Textarea
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                placeholder="e.g. Easy vegetarian dinner for 2, under 30 minutes, not too spicy"
                rows={3}
                className="resize-none"
                disabled={isPending}
                maxLength={300}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    runGenerate();
                  }
                }}
              />
              <div className="mt-1 text-right text-xs text-muted-foreground">
                {promptText.length}/300
              </div>
            </div>

            {/* Preference pills */}
            <div className="flex flex-wrap gap-2">
              {PREFERENCES.map(({ label, icon: Icon }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => togglePref(label)}
                  disabled={isPending}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors disabled:pointer-events-none",
                    selectedPrefs.has(label)
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-muted-foreground/20 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>

            {error && <ErrorBanner message={error} />}

            <div className="flex items-center justify-end">
              <Button
                onClick={() => runGenerate()}
                disabled={isPending || !canGenerate}
                className="gap-2 w-full sm:w-auto"
                size="lg"
              >
                {isConceptLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Thinking…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Generate Ideas
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Recipe generation overlay banner */}
          {isRecipeLoading && (
            <div className="flex items-center gap-3 rounded-xl border bg-primary/5 border-primary/20 px-4 py-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
              <div>
                <p className="text-sm font-medium">Writing your recipe…</p>
                <p className="text-xs text-muted-foreground">
                  Building out ingredients and steps. Usually takes 10–20 seconds.
                </p>
              </div>
            </div>
          )}

          {/* Concept results */}
          {concepts && (
            <div id="concierge-results">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="font-semibold">Here are 5 ideas for you</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Pick one and we&apos;ll build the full recipe.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => runGenerate()}
                  disabled={isPending}
                  className="gap-1.5 text-muted-foreground shrink-0"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Regenerate
                </Button>
              </div>

              <div className="mb-3 flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary/60" />
                These ideas are generated just for you. Your preferences help us suggest better recipes.
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {concepts.map((concept, i) => (
                  <ConceptCardItem
                    key={i}
                    concept={concept}
                    onSelect={() => handleSelectConcept(concept, i)}
                    isGenerating={generatingIdx === i}
                    disabled={isPending}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Desktop sidebar: quick prompts ── */}
        <div className="hidden lg:flex flex-col gap-3">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Quick prompts
          </h3>
          {QUICK_PROMPTS.map(({ label, description, prompt }) => (
            <QuickPromptButton
              key={label}
              label={label}
              description={description}
              onClick={() => handleQuickPrompt(prompt)}
              disabled={isPending}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
