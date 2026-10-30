"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Sparkles,
  Loader2,
  AlertCircle,
  RefreshCw,
  Zap,
  Leaf,
  Users,
  PiggyBank,
  Clock,
  Heart,
  Coffee,
  Package,
  ChevronDown,
  ChevronUp,
  Check,
  CalendarDays,
  Utensils,
  BadgeCheck,
  Globe,
  Flame,
  Tag,
  Star,
  Shuffle,
  Repeat,
  Lightbulb,
  BookOpen,
  Target,
  CheckCircle2,
  HeartPulse,
  ExternalLink,
  Trash2,
  Undo2,
  UtensilsCrossed,
  Salad,
} from "lucide-react";
import {
  Button,
  Textarea,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@dishes/ui";
import { startConceptsJob, startRecipeJob, startRecipeBatchJob, startMealPlanJob, type MealPlanSlot } from "@/app/actions/ai";
import { listTrackedAiJobs, useAiJobRunner, useAsyncBusy } from "@/lib/ai-jobs-client";
import type {
  BatchJobProgress,
  ConceptsJobProgress,
  ConceptsJobResult,
  MealPlanApplyEvent,
  MealPlanJobResult,
  MealPlanProgress,
  RecipeJobResult,
  RecipeProgress,
} from "@/lib/ai/job-types";
import { BatchWriting, DishPlate, IdeaPlaces, PlanReels, PlateReel, PlateSpinner, RecipeWriting, SteamPlate, WritingRing, recipeStageLabel } from "@/components/ai-wait";
import { recipeJobToDefaults, stashAiDraft } from "@/lib/ai/recipe-defaults";
import type { ConceptCard } from "@/lib/ai/recipe-generation";
import { MEAL_ROLES, MEAL_ROLE_LABELS, type MealRole } from "@dishes/shared";
import { getWeekMealSlots } from "@/app/actions/meal-plan";
import { postNdjson } from "@/lib/ndjson-client";
import type { StyleBreakdown, LibraryStyle } from "@/lib/services/recipe-library";
import { StarRating } from "@/app/(app)/recipes/[id]/_components/star-rating";
import { useSync } from "@/components/providers/sync-provider";
import { getRecipePreview, type RecipePreview } from "@/app/actions/recipes";

// ── Heart-healthy status in the plan preview ───────────────────────────────────

const HEART_STATUS_BADGES = {
  yes: {
    label: "Heart-healthy",
    title: "Meets the heart-healthy targets",
    className: "border-transparent bg-primary text-primary-foreground",
  },
  new: {
    label: "Will be heart-healthy",
    title: "A new recipe — written and checked against the heart-healthy targets",
    className: "border-transparent bg-highlight text-primary",
  },
  unknown: {
    label: "Heart status unknown",
    title: "No saturated fat / fibre figures yet — Settings → Maintenance can estimate them",
    className: "border-muted-foreground/20 bg-muted text-muted-foreground",
  },
  no: {
    label: "Over heart targets",
    title: "Higher in saturated fat or lower in fibre than the heart-healthy targets",
    className: "border-transparent bg-warning-tint text-warning",
  },
} as const;

function HeartStatusBadge({ status }: { status?: MealPlanSlot["heartStatus"] }) {
  if (!status) return null;
  const badge = HEART_STATUS_BADGES[status];
  return (
    <span
      title={badge.title}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
        badge.className
      )}
    >
      <HeartPulse className="h-2.5 w-2.5" />
      {badge.label}
    </span>
  );
}

// ── Static data ────────────────────────────────────────────────────────────────

const PREFERENCES = [
  {
    label: "Vegetarian",
    icon: Leaf,
    activeClass: "border-transparent bg-success text-card",
    inactiveClass: "border-transparent bg-success-tint text-success hover:border-input",
  },
  {
    label: "Quick",
    icon: Zap,
    activeClass: "border-transparent bg-primary text-primary-foreground",
    inactiveClass: "border-transparent bg-highlight text-primary hover:border-input",
  },
  {
    label: "Family Friendly",
    icon: Users,
    activeClass: "border-transparent bg-ink text-ink-foreground",
    inactiveClass: "border-transparent bg-muted text-foreground hover:border-input",
  },
  {
    label: "Budget",
    icon: PiggyBank,
    activeClass: "border-transparent bg-ink text-ink-foreground",
    inactiveClass: "border-transparent bg-muted text-foreground hover:border-input",
  },
  {
    // Not just prompt text: selecting this also switches on the nutrition
    // check-and-revise pass (see HEART_HEALTHY_PREF below).
    label: "Heart-healthy",
    icon: HeartPulse,
    activeClass: "border-transparent bg-primary text-primary-foreground",
    inactiveClass: "border-transparent bg-highlight text-primary hover:border-input",
  },
] as const;

const HEART_HEALTHY_PREF = "Heart-healthy";

const QUICK_PROMPTS = [
  {
    label: "Quick dinner",
    description: "Under 30 minutes",
    prompt: "Quick weeknight dinner in under 30 minutes",
    icon: Clock,
    iconBg: "bg-highlight text-primary",
  },
  {
    label: "Healthy meal",
    description: "High protein",
    prompt: "Healthy high-protein meal",
    icon: Heart,
    iconBg: "bg-success-tint text-success",
  },
  {
    label: "Comfort food",
    description: "For cosy nights",
    prompt: "Comfort food for a cosy night in",
    icon: Coffee,
    iconBg: "bg-warning-tint text-warning",
  },
  {
    label: "Use what I have",
    description: "Pantry staples",
    prompt: "Something easy using common pantry staples",
    icon: Package,
    iconBg: "bg-muted text-foreground",
  },
  {
    label: "Side dish",
    description: "Goes with a main",
    prompt: "A side dish to serve alongside dinner",
    icon: Salad,
    iconBg: "bg-success-tint text-success",
    mealRole: "side",
  },
] as const;

const CUISINE_OPTIONS = [
  { label: "Italian", value: "Italian" },
  { label: "Asian", value: "Asian" },
  { label: "Mexican", value: "Mexican" },
  { label: "Mediterranean", value: "Mediterranean" },
  { label: "Indian", value: "Indian" },
  { label: "French", value: "French" },
  { label: "American", value: "American" },
  { label: "Middle Eastern", value: "Middle Eastern" },
];

const DIETARY_OPTIONS = [
  { label: "Vegetarian", value: "vegetarian" },
  { label: "Vegan", value: "vegan" },
  { label: "Gluten-free", value: "gluten-free" },
  { label: "Dairy-free", value: "dairy-free" },
  { label: "Nut-free", value: "nut-free" },
];

const COOK_TIME_OPTIONS = [
  { label: "Under 15 min", value: "under 15 minutes" },
  { label: "Under 30 min", value: "under 30 minutes" },
  { label: "Under 1 hour", value: "under 1 hour" },
  { label: "Over 1 hour", value: "over 1 hour, slow-cooked" },
];

const SPICE_OPTIONS = [
  { label: "Mild", value: "mild, not spicy" },
  { label: "Medium", value: "medium spice" },
  { label: "Spicy", value: "spicy" },
];

const BUDGET_OPTIONS = [
  { label: "Low", value: "budget-friendly" },
  { label: "Medium", value: "moderate budget" },
  { label: "High", value: "premium ingredients" },
];

const SERVINGS_OPTIONS = [
  { label: "1", value: "serves 1" },
  { label: "2", value: "serves 2" },
  { label: "3–4", value: "serves 3-4" },
  { label: "5+", value: "serves 5 or more" },
];

const MEAL_TYPE_COLOR: Record<string, string> = {
  breakfast: "#f59e0b",
  lunch: "#8b5cf6",
  dinner: "#6366f1",
  dessert: "#ec4899",
  snack: "#94a3b8",
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const DAY_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const MEAL_TYPES = ["breakfast", "lunch", "dinner", "dessert", "snack"] as const;

function DishRolePicker({
  value,
  onChange,
  disabled,
}: {
  value: MealRole | null;
  onChange: (role: MealRole | null) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium">Kind of dish</p>
      <div className="flex flex-wrap gap-2">
        {MEAL_ROLES.map((role) => (
          <button
            key={role}
            type="button"
            onClick={() => onChange(value === role ? null : role)}
            disabled={disabled}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm font-medium transition-all disabled:pointer-events-none",
              value === role
                ? "border-transparent bg-success text-card shadow-sm"
                : "border-transparent bg-success-tint text-success hover:border-input"
            )}
          >
            {MEAL_ROLE_LABELS[role]}
          </button>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Choose Side, Sauce or Extra to generate that instead of a main. Asking for one in the box works too.
      </p>
    </div>
  );
}

const CUISINE_EMOJI: Record<string, string> = {
  italian: "🍝", pizza: "🍕", chinese: "🥢", japanese: "🍱",
  sushi: "🍣", mexican: "🌮", thai: "🍜", indian: "🍛",
  french: "🥐", american: "🍔", greek: "🥗", mediterranean: "🫒",
  korean: "🍲", british: "🥧", spanish: "🥘", middle: "🧆",
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
  if (d === "easy") return "bg-success-tint text-success border-transparent";
  if (d === "hard") return "bg-destructive/10 text-destructive border-transparent";
  return "bg-warning-tint text-warning border-transparent";
}

function getMondayOf(offset = 0): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff + offset * 7);
  return d.toISOString().slice(0, 10);
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
  isGenerating,
  disabled,
}: {
  concept: ConceptCard;
  selected: boolean;
  onToggle: () => void;
  isGenerating: boolean;
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasMore = concept.description.length > 120 || concept.tags.length > 3;

  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border bg-card overflow-hidden transition-shadow hover:shadow-sm",
        selected ? "border-primary bg-primary/5" : "",
        disabled && !isGenerating && "opacity-60 pointer-events-none"
      )}
    >
      <div className="flex flex-col flex-1 gap-2 p-4">
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

          <button
            type="button"
            onClick={onToggle}
            disabled={disabled}
            className="flex-1 text-left"
          >
            <h3 className={cn("font-semibold leading-snug", selected && "text-primary")}>
              {concept.title}
            </h3>
          </button>
        </div>

        <p className={cn("text-xs text-muted-foreground", !expanded && "line-clamp-2")}>
          {concept.description}
        </p>

        <div className="flex flex-wrap gap-1">
          {concept.cuisine && (
            <span className="inline-flex items-center rounded-full border border-transparent bg-muted px-2 py-0.5 text-xs text-foreground">
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
          {(expanded ? concept.tags : concept.tags.slice(0, 2)).map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>

        {hasMore && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
            className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
          >
            {expanded ? (
              <><ChevronUp className="h-3 w-3" />Less</>
            ) : (
              <><ChevronDown className="h-3 w-3" />More</>
            )}
          </button>
        )}

        {isGenerating && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
            <PlateSpinner />
            Writing the recipe…
          </div>
        )}
      </div>
    </div>
  );
}

function QuickPromptButton({
  label, description, icon: Icon, iconBg, onClick, disabled,
}: {
  label: string;
  description: string;
  icon: React.ElementType;
  iconBg: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center gap-3 rounded-xl border p-3 text-left transition-all hover:bg-muted hover:border-primary/30 hover:shadow-sm disabled:opacity-50 disabled:pointer-events-none"
    >
      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", iconBg)}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
    </button>
  );
}

function FilterChip({
  icon: Icon,
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const display = options.find((o) => o.value === value)?.label ?? "Any";
  return (
    <div
      className={cn(
        "relative flex flex-col gap-0.5 rounded-xl border bg-background px-3 py-2 cursor-pointer min-w-[110px] transition-colors",
        value ? "border-primary/40 bg-primary/5" : "hover:border-muted-foreground/40",
        disabled && "opacity-50 pointer-events-none"
      )}
    >
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3 shrink-0" />
        {label}
      </div>
      <div className="flex items-center justify-between gap-1">
        <span className={cn("text-sm font-medium truncate", value ? "text-foreground" : "text-muted-foreground")}>
          {display}
        </span>
        <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
      </div>
      <select
        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

// ── Types ──────────────────────────────────────────────────────────────────────

type Member = {
  id: string;
  displayName: string;
  /** Their dietary notes mention cholesterol — ticking them pre-selects Heart-healthy. */
  cholesterolDiet?: boolean;
};

/** A new idea being written out as the draft is added (the apply stream's events). */
type WritingState =
  | { status: "writing"; progress: RecipeProgress | null }
  | { status: "written" }
  | { status: "failed" };

/** A new idea's plate while the draft is added: waiting, its ring filling, or done. */
function AddingPlate({ state, delay }: { state?: WritingState; delay: number }) {
  if (!state) return <SteamPlate delay={delay} className="size-10" />;
  if (state.status === "writing") return <WritingRing progress={state.progress} className="size-10" />;
  return (
    <div className="relative size-10 shrink-0" aria-hidden="true">
      <div className="absolute inset-0.5 rounded-full bg-plate" />
      <span
        className={cn(
          "absolute -bottom-0.5 -right-0.5 flex size-[18px] items-center justify-center rounded-full border-2 border-card text-card",
          state.status === "written" ? "bg-success" : "bg-destructive"
        )}
      >
        {state.status === "written" ? <Check className="size-2.5" strokeWidth={3.5} /> : <AlertCircle className="size-2.5" />}
      </span>
    </div>
  );
}

/** What a new idea's row says while the draft is added. */
function addingLine(state?: WritingState): string {
  if (!state) return "Waiting its turn";
  if (state.status === "writing") return recipeStageLabel(state.progress);
  return state.status === "written" ? "Written and saved" : "Couldn't write this one; it goes in as a title";
}

type BatchItem = {
  concept: ConceptCard;
  status: "pending" | "generating" | "done" | "error";
  progress?: RecipeProgress;
  recipeId?: string;
  collectionName?: string;
  error?: string;
};

// ── Plan draft: slot badges + preview dialog ───────────────────────────────────

function SlotBadges({ slot }: { slot: MealPlanSlot }) {
  return (
    <>
      <span className={cn("inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] capitalize", difficultyClass(slot.difficulty))}>
        {slot.difficulty}
      </span>
      <span className="inline-flex items-center rounded-full border border-transparent bg-highlight px-1.5 py-0.5 text-[10px] capitalize text-primary">
        {slot.mealType}
      </span>
      {slot.recipeId ? (
        <span className="inline-flex items-center gap-0.5 rounded-full border border-transparent bg-muted px-1.5 py-0.5 text-[10px] text-foreground">
          <BookOpen className="h-2.5 w-2.5" />
          From your library
        </span>
      ) : (
        <span className="inline-flex items-center gap-0.5 rounded-full border border-transparent bg-muted px-1.5 py-0.5 text-[10px] text-foreground">
          <Sparkles className="h-2.5 w-2.5" />
          New recipe
        </span>
      )}
      <HeartStatusBadge status={slot.heartStatus} />
      {slot.recipeId && slot.avgRating != null && (
        <span
          title="Your household's average rating"
          className="inline-flex items-center gap-1 rounded-full border border-transparent bg-warning-tint px-1.5 py-0.5 text-[10px] font-medium text-warning"
        >
          <StarRating value={slot.avgRating} readonly size="sm" />
          {slot.avgRating / 2}/5
        </span>
      )}
    </>
  );
}

function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

/**
 * A closer look at one suggestion in the draft, with the swap/remove controls
 * right there. Library picks load their real ingredients so you can judge the
 * dish; new recipes only exist as a concept until the plan is added.
 */
function PlanSlotPreviewDialog({
  slot,
  rejected,
  redoing,
  disabled,
  previewCache,
  onPreviewLoaded,
  onOpenChange,
  onToggleRejected,
  onSwap,
}: {
  slot: MealPlanSlot | null;
  rejected: boolean;
  redoing: boolean;
  disabled: boolean;
  previewCache: Map<string, RecipePreview>;
  onPreviewLoaded: (preview: RecipePreview) => void;
  onOpenChange: (open: boolean) => void;
  onToggleRejected: () => void;
  onSwap: () => void;
}) {
  const recipeId = slot?.recipeId ?? null;
  const preview = recipeId ? previewCache.get(recipeId) ?? null : null;
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setLoadError(null);
    if (!recipeId || previewCache.has(recipeId)) return;
    let cancelled = false;
    getRecipePreview(recipeId)
      .then((res) => {
        if (cancelled) return;
        if (res.recipe) onPreviewLoaded(res.recipe);
        else setLoadError(res.error ?? "Couldn't load this recipe.");
      })
      .catch(() => { if (!cancelled) setLoadError("Couldn't load this recipe."); });
    return () => { cancelled = true; };
    // previewCache/onPreviewLoaded change identity on every load; recipeId is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeId]);

  const totalMins = (preview?.prepTimeMinutes ?? 0) + (preview?.cookTimeMinutes ?? 0);

  return (
    <Dialog open={slot !== null} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[90vh] overflow-y-auto p-0 gap-0">
        {slot && (
          <div className={cn("min-w-0", redoing && "animate-pulse")}>
            {/* Hero */}
            {preview?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.imageUrl} alt={slot.title} className="h-44 w-full object-cover" />
            ) : (
              <div className="h-28 w-full bg-muted flex items-center justify-center text-5xl">
                {cuisineEmoji(slot.cuisine)}
              </div>
            )}

            <div className="p-5 space-y-4">
              <DialogHeader className="text-left">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {DAY_FULL[slot.dayOfWeek]} · <span className="capitalize">{slot.mealType}</span>
                </p>
                <DialogTitle className={cn("leading-snug pr-6", rejected && "line-through text-muted-foreground")}>
                  {slot.title}
                </DialogTitle>
                <DialogDescription className="sr-only">Preview of this meal plan suggestion</DialogDescription>
              </DialogHeader>

              <div className="flex items-center gap-1.5 flex-wrap">
                <SlotBadges slot={slot} />
              </div>

              <p className="text-sm text-foreground/80">{slot.description}</p>

              {recipeId ? (
                preview ? (
                  <div className="space-y-3">
                    {(totalMins > 0 || preview.servings || preview.calories) && (
                      <div className="flex flex-wrap gap-2 text-xs">
                        {totalMins > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-highlight px-2.5 py-1 font-medium text-primary">
                            <Clock className="h-3 w-3" />{formatMinutes(totalMins)}
                          </span>
                        )}
                        {preview.servings && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-medium text-foreground">
                            <Users className="h-3 w-3" />Serves {Number(preview.servings)}
                          </span>
                        )}
                        {preview.calories != null && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-highlight px-2.5 py-1 font-medium text-primary">
                            <Flame className="h-3 w-3" />{preview.calories} kcal
                          </span>
                        )}
                      </div>
                    )}
                    {preview.ingredients.length > 0 && (
                      <div className="rounded-xl bg-success-tint p-3">
                        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-success">
                          <UtensilsCrossed className="h-3.5 w-3.5" />
                          {preview.ingredients.length} ingredient{preview.ingredients.length === 1 ? "" : "s"}
                          {preview.stepCount > 0 && ` · ${preview.stepCount} step${preview.stepCount === 1 ? "" : "s"}`}
                        </p>
                        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-foreground/80">
                          {preview.ingredients.map((ing, i) => (
                            <li key={i} className="truncate">• {ing}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <a
                      href={`/recipes/${recipeId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />Open full recipe in a new tab
                    </a>
                  </div>
                ) : loadError ? (
                  <p className="text-xs text-destructive">{loadError}</p>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading recipe…
                  </div>
                )
              ) : (
                <div className="rounded-xl bg-muted p-3 text-xs text-foreground">
                  <Sparkles className="mr-1 inline h-3.5 w-3.5" />
                  A brand-new dish — the full recipe is written when you add the plan.
                </div>
              )}

              <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onToggleRejected}
                  disabled={disabled || redoing}
                  className={cn(
                    "flex-1 gap-1.5",
                    !rejected && "border-border text-primary hover:bg-highlight hover:text-primary"
                  )}
                >
                  {rejected ? <><Undo2 className="h-4 w-4" />Keep in plan</> : <><Trash2 className="h-4 w-4" />Remove from plan</>}
                </Button>
                <Button
                  type="button"
                  onClick={onSwap}
                  disabled={disabled || redoing}
                  className="flex-1 gap-1.5 bg-ink border-0 text-ink-foreground"
                >
                  <RefreshCw className={cn("h-4 w-4", redoing && "animate-spin")} />
                  {redoing ? "Finding another…" : "Swap for something else"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Plan My Week tab ───────────────────────────────────────────────────────────

type PlanMyWeekProps = {
  availableCuisines: string[];
  availableTags: string[];
  members?: Member[];
  styleBreakdown: StyleBreakdown;
};

type FrequencyMode = "favourites" | "regulars" | "new" | "mix" | null;

/**
 * The suggestion styles are real library filters, not prompt prose. They used
 * to append a sentence like "prefer recipes we cook often" to the preferences,
 * which contradicted the system prompt's instruction to treat every library
 * entry as an equally valid pick — and being in the user message, the prose
 * tended to win. `hint` now only carries what a filter genuinely cannot say.
 */
const FREQUENCY_MODES: {
  mode: Exclude<FrequencyMode, null>;
  label: string;
  icon: React.ElementType;
  hint: string | null;
  description: string;
  activeClass: string;
  inactiveClass: string;
}[] = [
  {
    mode: "favourites",
    label: "From our favourites",
    icon: Star,
    hint: null,
    description: "Only recipes we have starred as favourites",
    activeClass: "border-transparent bg-warning text-card",
    inactiveClass: "border-transparent bg-warning-tint text-warning hover:border-input",
  },
  {
    mode: "regulars",
    label: "Our regulars",
    icon: Repeat,
    hint: null,
    description: "Only dishes we have cooked or planned three or more times",
    activeClass: "border-transparent bg-primary text-primary-foreground",
    inactiveClass: "border-transparent bg-highlight text-primary hover:border-input",
  },
  {
    mode: "new",
    label: "Try something new",
    icon: Lightbulb,
    // The filter narrows the library to never-tried recipes; only the appetite
    // for inventing brand-new dishes needs saying in words.
    hint: "Lean towards suggesting brand-new recipes we have never cooked, rather than reusing the library, wherever a slot allows it",
    description: "Only library recipes we have never tried, plus fresh ideas",
    activeClass: "border-transparent bg-ink text-ink-foreground",
    inactiveClass: "border-transparent bg-muted text-foreground hover:border-input",
  },
  {
    mode: "mix",
    label: "Mix it up",
    icon: Shuffle,
    hint: "Balance reused library recipes with a couple of brand-new suggestions",
    description: "Anything in the library — every recipe gets an equal chance",
    activeClass: "border-transparent bg-success text-card",
    inactiveClass: "border-transparent bg-success-tint text-success hover:border-input",
  },
];

// ── Slot grid ─────────────────────────────────────────────────────────────────

const MEAL_TYPE_ABBR: Record<string, string> = {
  breakfast: "Bkfst",
  lunch: "Lunch",
  dinner: "Dinner",
  dessert: "Dessert",
  snack: "Snack",
};

function SlotGrid({
  selectedSlots,
  existingCoverage,
  disabled,
  onChange,
}: {
  selectedSlots: Set<string>;
  existingCoverage: { dayOfWeek: number; mealType: string; recipeTitle: string }[];
  disabled: boolean;
  onChange: (next: Set<string>) => void;
}) {
  const coveredMap = useMemo(
    () => new Map(existingCoverage.map((s) => [`${s.dayOfWeek}:${s.mealType}`, s.recipeTitle])),
    [existingCoverage]
  );

  function toggle(key: string) {
    if (coveredMap.has(key) || disabled) return;
    const next = new Set(selectedSlots);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  }

  function toggleRow(dayIndex: number) {
    if (disabled) return;
    const rowKeys = MEAL_TYPES.map((mt) => `${dayIndex}:${mt}`).filter((k) => !coveredMap.has(k));
    const allSel = rowKeys.every((k) => selectedSlots.has(k));
    const next = new Set(selectedSlots);
    rowKeys.forEach((k) => (allSel ? next.delete(k) : next.add(k)));
    onChange(next);
  }

  function toggleCol(mealType: string) {
    if (disabled) return;
    const colKeys = Array.from({ length: 7 }, (_, d) => `${d}:${mealType}`).filter((k) => !coveredMap.has(k));
    const allSel = colKeys.every((k) => selectedSlots.has(k));
    const next = new Set(selectedSlots);
    colKeys.forEach((k) => (allSel ? next.delete(k) : next.add(k)));
    onChange(next);
  }

  const selectedCount = selectedSlots.size;
  const coveredCount = existingCoverage.length;
  const totalAvailable = 7 * MEAL_TYPES.length - coveredCount;

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto -mx-1 px-1 pb-1">
        <table className="w-full border-collapse" style={{ minWidth: 380 }}>
          <thead>
            <tr>
              {/* Corner cell */}
              <th className="w-9 p-0.5" />
              {MEAL_TYPES.map((mt) => (
                <th key={mt} className="p-0.5">
                  <button
                    type="button"
                    onClick={() => toggleCol(mt)}
                    disabled={disabled}
                    title={`Toggle all ${mt}`}
                    className="w-full flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:pointer-events-none"
                  >
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: MEAL_TYPE_COLOR[mt] }} />
                    <span className="hidden sm:block leading-none">{MEAL_TYPE_ABBR[mt]}</span>
                    <span className="sm:hidden leading-none">{mt.slice(0, 1).toUpperCase()}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 7 }, (_, dayIndex) => (
              <tr key={dayIndex}>
                <td className="p-0.5 w-9">
                  <button
                    type="button"
                    onClick={() => toggleRow(dayIndex)}
                    disabled={disabled}
                    title={`Toggle all ${DAYS[dayIndex]}`}
                    className="w-full text-center text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg py-1.5 transition-colors disabled:pointer-events-none"
                  >
                    {DAYS[dayIndex]}
                  </button>
                </td>
                {MEAL_TYPES.map((mt) => {
                  const key = `${dayIndex}:${mt}`;
                  const covered = coveredMap.get(key);
                  const selected = selectedSlots.has(key);

                  if (covered) {
                    return (
                      <td key={mt} className="p-0.5">
                        <div
                          title={covered}
                          className="rounded-lg border border-transparent bg-success-tint h-12 sm:h-14 flex flex-col items-center justify-center gap-0.5 px-1 select-none"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                          <span className="hidden sm:block text-[9px] text-success text-center leading-tight line-clamp-2 font-medium w-full px-0.5">
                            {covered.length > 15 ? covered.slice(0, 14) + "…" : covered}
                          </span>
                        </div>
                      </td>
                    );
                  }

                  if (selected) {
                    return (
                      <td key={mt} className="p-0.5">
                        <button
                          type="button"
                          onClick={() => toggle(key)}
                          disabled={disabled}
                          className="w-full rounded-lg border-2 border-transparent bg-muted h-12 sm:h-14 flex flex-col items-center justify-center gap-0.5 px-1 hover:bg-muted transition-colors disabled:pointer-events-none disabled:opacity-50"
                        >
                          <Sparkles className="h-3 w-3 text-foreground" />
                          <span className="hidden sm:block text-[9px] text-foreground font-semibold leading-none">generate</span>
                        </button>
                      </td>
                    );
                  }

                  return (
                    <td key={mt} className="p-0.5">
                      <button
                        type="button"
                        onClick={() => toggle(key)}
                        disabled={disabled}
                        className="w-full rounded-lg border border-dashed border-muted-foreground/20 bg-transparent h-12 sm:h-14 flex items-center justify-center text-muted-foreground/30 hover:border-transparent hover:bg-muted hover:text-foreground transition-colors disabled:pointer-events-none text-xl leading-none"
                      >
                        +
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Summary + quick actions */}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-0.5">
        <div className="flex items-center gap-3">
          {selectedCount > 0 ? (
            <span className="font-semibold text-foreground">
              {selectedCount} slot{selectedCount !== 1 ? "s" : ""} to generate
            </span>
          ) : (
            <span>Tap any slot to select it</span>
          )}
          {coveredCount > 0 && (
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-success" />
              {coveredCount} already planned
            </span>
          )}
        </div>
        <div className="flex gap-3">
          {selectedCount > 0 && (
            <button
              type="button"
              onClick={() => onChange(new Set())}
              disabled={disabled}
              className="hover:text-foreground underline disabled:pointer-events-none"
            >
              Clear
            </button>
          )}
          {selectedCount < totalAvailable && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                const next = new Set<string>();
                for (let d = 0; d < 7; d++) {
                  for (const mt of MEAL_TYPES) {
                    const k = `${d}:${mt}`;
                    if (!coveredMap.has(k)) next.add(k);
                  }
                }
                onChange(next);
              }}
              className="hover:text-foreground underline disabled:pointer-events-none"
            >
              All missing
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Plan My Week tab ───────────────────────────────────────────────────────────

const PLAN_HREF = "/ai-concierge?tab=plan";

/** The form behind a meal-plan job — and, for a redo, the draft — so coming back restores it. */
type PlanContext = {
  weekStart: string;
  slots: string[];
  preferences: string;
  memberIds: string[];
  frequencyMode: FrequencyMode;
  cuisineFilter: string;
  tagFilter: string;
  ratedOnly: boolean;
  maxCaloriesPerMeal: string;
  heartHealthy: boolean;
  /** Redoing part of a draft: the draft as it stood and which of its slots are being replaced. */
  redo?: { draft: MealPlanSlot[]; rejected: number[]; indices: number[] };
};

/**
 * Puts redone suggestions back into the draft, matched to their slot by day +
 * meal type; falls back to order if the model shuffled the day or meal type.
 */
function mergeRedoneSlots(draft: MealPlanSlot[], indices: number[], replacements: MealPlanSlot[]): MealPlanSlot[] {
  const pool = [...replacements];
  const next = [...draft];
  for (const i of indices) {
    const orig = draft[i]!;
    const matchIdx = pool.findIndex((s) => s.dayOfWeek === orig.dayOfWeek && s.mealType === orig.mealType);
    const pick = matchIdx >= 0 ? pool.splice(matchIdx, 1)[0] : pool.shift();
    if (pick) next[i] = { ...pick, dayOfWeek: orig.dayOfWeek, mealType: orig.mealType };
  }
  return next;
}

function weekOffsetOf(weekStart: string): number {
  const ms = new Date(weekStart).getTime() - new Date(getMondayOf(0)).getTime();
  return Math.round(ms / (7 * 24 * 60 * 60 * 1000));
}

function PlanMyWeekTab({ availableCuisines, availableTags, members = [], styleBreakdown }: PlanMyWeekProps) {
  const router = useRouter();
  // The meal plan screen reads from the local store, so a plan written by this
  // server action is invisible there until the engine pulls it. See
  // handleAddToMealPlan.
  const sync = useSync();

  // Default: Mon–Fri dinners
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(
    () => new Set([0, 1, 2, 3, 4].map((d) => `${d}:dinner`))
  );
  const [existingCoverage, setExistingCoverage] = useState<{ dayOfWeek: number; mealType: string; recipeTitle: string }[]>([]);
  const [preferences, setPreferences] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());
  const [frequencyMode, setFrequencyMode] = useState<FrequencyMode>(null);
  const [cuisineFilter, setCuisineFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const activeStyle = FREQUENCY_MODES.find((f) => f.mode === frequencyMode) ?? null;
  // "Mix it up" draws on the whole library, so it has no bucket of its own.
  const breakdownKey: LibraryStyle | null =
    frequencyMode === "favourites" || frequencyMode === "regulars" || frequencyMode === "new"
      ? frequencyMode
      : null;
  const styleCount = breakdownKey ? styleBreakdown.counts[breakdownKey] : styleBreakdown.total;
  const previewTitles = breakdownKey ? styleBreakdown.samples[breakdownKey] : [];
  const previewTruncated = breakdownKey ? styleBreakdown.truncated[breakdownKey] : false;

  // Derived from the suggestion style so the two can never disagree.
  const unusedOnly = frequencyMode === "new";
  const favouritesOnly = frequencyMode === "favourites";
  const frequentsOnly = frequencyMode === "regulars";
  const [ratedOnly, setRatedOnly] = useState(false);
  const [maxCaloriesPerMeal, setMaxCaloriesPerMeal] = useState("");
  const [heartHealthy, setHeartHealthy] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [generatedSlots, setGeneratedSlots] = useState<MealPlanSlot[] | null>(null);
  const [rejectedSlots, setRejectedSlots] = useState<Set<number>>(new Set());
  const [redoingSlots, setRedoingSlots] = useState<Set<number>>(new Set());
  // Index into generatedSlots of the meal open in the preview modal. Swapping
  // replaces the slot in place, so the modal shows the new option straight away.
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [previewCache, setPreviewCache] = useState<Map<string, RecipePreview>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, startGenTransition] = useAsyncBusy();
  const { run, resume } = useAiJobRunner();
  // The week as it's being drafted: facts, photos and each meal as it's written.
  const [planProgress, setPlanProgress] = useState<MealPlanProgress | null>(null);
  // The photos from the last draft, for the reels on a slot being swapped.
  const [reelPhotos, setReelPhotos] = useState<string[]>([]);
  // Adding streams (POST /api/web/ai/meal-plan/apply): each new idea's writing, by draft index.
  const [isAdding, startAdding] = useAsyncBusy();
  const [writing, setWriting] = useState<Map<number, WritingState>>(() => new Map());
  const [added, setAdded] = useState(false);

  // Load coverage for the chosen week; auto-remove newly-covered slots from selection
  useEffect(() => {
    const weekStart = getMondayOf(weekOffset);
    let cancelled = false;
    getWeekMealSlots(weekStart)
      .then((coverage) => {
        // A restored plan can change the week before this week's answer lands.
        if (cancelled) return;
        setExistingCoverage(coverage);
        const coveredKeys = new Set(coverage.map((s) => `${s.dayOfWeek}:${s.mealType}`));
        setSelectedSlots((prev) => {
          const next = new Set(prev);
          for (const k of coveredKeys) next.delete(k);
          return next;
        });
      })
      .catch(() => { if (!cancelled) setExistingCoverage([]); });
    return () => { cancelled = true; };
  }, [weekOffset]);

  // A plan asked for before leaving the page: put the form (and any draft being
  // redone) back as it was and pick the job up again where it left off.
  useEffect(() => {
    const job = listTrackedAiJobs().find((j) => j.kind === "meal-plan" && j.href === PLAN_HREF);
    if (!job) return;
    const ctx = job.context as PlanContext | undefined;
    if (ctx) {
      setWeekOffset(weekOffsetOf(ctx.weekStart));
      setSelectedSlots(new Set(ctx.slots));
      setPreferences(ctx.preferences);
      setSelectedMemberIds(new Set(ctx.memberIds));
      setFrequencyMode(ctx.frequencyMode);
      setCuisineFilter(ctx.cuisineFilter);
      setTagFilter(ctx.tagFilter);
      setRatedOnly(ctx.ratedOnly);
      setMaxCaloriesPerMeal(ctx.maxCaloriesPerMeal);
      setHeartHealthy(ctx.heartHealthy);
      if (ctx.redo) {
        setGeneratedSlots(ctx.redo.draft);
        setRejectedSlots(new Set(ctx.redo.rejected));
        setRedoingSlots(new Set(ctx.redo.indices));
      }
    }
    const redo = ctx?.redo;
    if (!redo) setPlanProgress({ facts: [], photos: [], slots: [] });
    startGenTransition(async () => {
      const out = await resume<MealPlanJobResult, MealPlanProgress>(job.jobId, (p) => {
        if (!redo) setPlanProgress(p);
        if (p.photos.length) setReelPhotos(p.photos);
      });
      if (!out) return;
      setRedoingSlots(new Set());
      if ("error" in out) { setPlanProgress(null); setError(out.error); return; }
      if (!redo) { await landLastMeals(out.result.slots); setPlanProgress(null); setGeneratedSlots(out.result.slots); return; }
      setGeneratedSlots(mergeRedoneSlots(redo.draft, redo.indices, out.result.slots));
      setRejectedSlots(new Set(redo.rejected.filter((i) => !redo.indices.includes(i))));
    });
  }, [resume, startGenTransition]);

  function buildFullPreferences(): string {
    const parts: string[] = [];
    const freq = FREQUENCY_MODES.find((f) => f.mode === frequencyMode);
    if (freq?.hint) parts.push(freq.hint);
    if (preferences.trim()) parts.push(preferences.trim());
    return parts.join(". ");
  }

  function handleClearLibraryFilters() {
    setCuisineFilter("");
    setTagFilter("");
    setFrequencyMode(null);
    setRatedOnly(false);
    setMaxCaloriesPerMeal("");
    setHeartHealthy(false);
  }

  function togglePlanMember(id: string) {
    // Ticking someone on a cholesterol-lowering diet switches the preset on.
    // Only ever on, never off — the toggle stays the household's call.
    if (!selectedMemberIds.has(id) && members.find((m) => m.id === id)?.cholesterolDiet) {
      setHeartHealthy(true);
    }
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function buildContext(redo?: PlanContext["redo"]): PlanContext {
    return {
      weekStart: getMondayOf(weekOffset),
      slots: Array.from(selectedSlots),
      preferences,
      memberIds: Array.from(selectedMemberIds),
      frequencyMode,
      cuisineFilter,
      tagFilter,
      ratedOnly,
      maxCaloriesPerMeal,
      heartHealthy,
      redo,
    };
  }

  function buildGenerateParams() {
    return {
      weekStartDate: getMondayOf(weekOffset),
      preferences: buildFullPreferences(),
      cuisineFilter: cuisineFilter || undefined,
      tagFilter: tagFilter || undefined,
      unusedOnly: unusedOnly || undefined,
      favouritesOnly: favouritesOnly || undefined,
      frequentsOnly: frequentsOnly || undefined,
      ratedOnly: ratedOnly || undefined,
      memberIds: selectedMemberIds.size > 0 ? Array.from(selectedMemberIds) : undefined,
      maxCaloriesPerMeal: (() => {
        const n = parseInt(maxCaloriesPerMeal, 10);
        return Number.isFinite(n) && n > 0 ? n : undefined;
      })(),
      heartHealthy: heartHealthy || undefined,
    };
  }

  /**
   * Redo just some meals in the draft. Everything else stays put and goes to
   * the AI as context, so the replacements balance against the rest of the week.
   */
  function handleRedoSlots(indices: number[]) {
    if (!generatedSlots || !indices.length) return;
    const current = generatedSlots;
    const redo = new Set(indices);
    setError(null);
    setRedoingSlots(redo);
    const context = buildContext({ draft: current, rejected: Array.from(rejectedSlots), indices });
    startGenTransition(async () => {
      const out = await run<MealPlanJobResult, MealPlanProgress>(
        startMealPlanJob({
          ...buildGenerateParams(),
          slots: indices.map((i) => ({ dayOfWeek: current[i]!.dayOfWeek, mealType: current[i]!.mealType })),
          keptSlots: current
            .filter((_, i) => !redo.has(i) && !rejectedSlots.has(i))
            .map((s) => ({ dayOfWeek: s.dayOfWeek, mealType: s.mealType, title: s.title, cuisine: s.cuisine })),
          replacingTitles: indices.map((i) => current[i]!.title),
        }),
        { kind: "meal-plan", label: "Week plan", href: PLAN_HREF, context },
        (p) => { if (p.photos.length) setReelPhotos(p.photos); }
      );
      if (!out) return;
      setRedoingSlots(new Set());
      if ("error" in out) { setError(out.error); return; }
      setGeneratedSlots(mergeRedoneSlots(current, indices, out.result.slots));
      setRejectedSlots((prev) => {
        const n = new Set(prev);
        for (const i of indices) n.delete(i);
        return n;
      });
    });
  }

  function handleGenerate() {
    setError(null);
    setGeneratedSlots(null);
    setRejectedSlots(new Set());
    setPreviewIdx(null);
    setAdded(false);
    const slots = Array.from(selectedSlots).map((key) => {
      const colon = key.indexOf(":");
      return { dayOfWeek: parseInt(key.slice(0, colon), 10), mealType: key.slice(colon + 1) };
    });
    const context = buildContext();
    setPlanProgress({ facts: [], photos: [], slots: [] });
    setTimeout(() => {
      document.getElementById("plan-reels")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
    startGenTransition(async () => {
      const out = await run<MealPlanJobResult, MealPlanProgress>(
        startMealPlanJob({ ...buildGenerateParams(), slots }),
        { kind: "meal-plan", label: "Week plan", href: PLAN_HREF, context },
        (p) => {
          setPlanProgress(p);
          if (p.photos.length) setReelPhotos(p.photos);
        }
      );
      if (!out) return;
      if ("error" in out) { setPlanProgress(null); setError(out.error); return; }
      await landLastMeals(out.result.slots);
      setPlanProgress(null);
      setGeneratedSlots(out.result.slots);
    });
  }

  /**
   * Fill every reel with the finished draft (the last poll can bring the
   * final meals and the answer together) and give them a moment to land
   * before the draft list takes over.
   */
  async function landLastMeals(slots: MealPlanSlot[]) {
    setPlanProgress((p) => (p ? { ...p, slots } : p));
    await new Promise((r) => setTimeout(r, 900));
  }

  function toggleRejection(idx: number) {
    setRejectedSlots((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }

  function handleAddToMealPlan() {
    if (!generatedSlots) return;
    // Draft indices of the slots going in; the stream reports by position in this list.
    const adding = generatedSlots.map((_, idx) => idx).filter((idx) => !rejectedSlots.has(idx));
    if (!adding.length) return;
    const weekStart = getMondayOf(weekOffset);
    setError(null);
    setWriting(new Map());
    startAdding(async () => {
      const mark = (index: number, state: WritingState) =>
        setWriting((prev) => new Map(prev).set(adding[index]!, state));
      let finished = false;
      try {
        await postNdjson<MealPlanApplyEvent>(
          "/api/web/ai/meal-plan/apply",
          {
            weekStartDate: weekStart,
            slots: adding.map((idx) => {
              const s = generatedSlots[idx]!;
              // Held to the route's shapes: an AI draft can leave these loose.
              const difficulty = ["easy", "medium", "hard"].includes(s.difficulty?.toLowerCase?.() ?? "")
                ? s.difficulty.toLowerCase()
                : "medium";
              return {
                dayOfWeek: s.dayOfWeek,
                mealType: s.mealType,
                title: s.title,
                description: s.description ?? "",
                cuisine: s.cuisine ?? "",
                difficulty,
                recipeId: s.recipeId ?? null,
              };
            }),
            memberIds: selectedMemberIds.size > 0 ? Array.from(selectedMemberIds) : undefined,
            heartHealthy: heartHealthy || undefined,
          },
          (e) => {
            if (e.type === "writing") mark(e.index, { status: "writing", progress: e.progress });
            else if (e.type === "written") mark(e.index, { status: "written" });
            else if (e.type === "failed") mark(e.index, { status: "failed" });
            else if (e.type === "done") finished = true;
            else if (e.type === "error") throw new Error(e.message);
          }
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't add the plan.");
        return;
      }
      if (!finished) { setError("Adding stopped part way. Check the planner, then try again."); return; }

      // Pull before navigating. The route writes straight to the database,
      // and /meal-plan renders from the local store — without this the week
      // arrives empty and stays empty until something else triggers a sync.
      // Awaited, not fired-and-forgotten: the navigation must not win the race.
      try {
        await sync?.engine?.sync();
      } catch {
        // Offline: the store still catches up on the next sync trigger, and the
        // server render covers the navigation itself.
      }

      setAdded(true);
      setTimeout(() => router.push(`/meal-plan?week=${weekStart}`), 3000);
    });
  }

  const canGenerate = selectedSlots.size > 0;
  const weekLabel = weekOffset === 0 ? "This week" : weekOffset === 1 ? "Next week" : "Week after";
  const includedCount = generatedSlots ? generatedSlots.length - rejectedSlots.size : 0;
  // Slots with no recipeId are invented dishes — each one is written out as a
  // full recipe when the plan is added, which is the slow part of that step.
  const newRecipeCount = generatedSlots
    ? generatedSlots.filter((slot, idx) => !rejectedSlots.has(idx) && !slot.recipeId).length
    : 0;
  // Only recipes actually written count as done; ones that couldn't be are said separately.
  const writtenCount = Array.from(writing.values()).filter((w) => w.status === "written").length;
  const failedCount = Array.from(writing.values()).filter((w) => w.status === "failed").length;
  // The slots asked for, in week order, for the reels while it drafts.
  const reelRows = Array.from(selectedSlots)
    .map((key) => {
      const colon = key.indexOf(":");
      return { dayOfWeek: parseInt(key.slice(0, colon), 10), mealType: key.slice(colon + 1) };
    })
    .sort(
      (a, b) =>
        a.dayOfWeek - b.dayOfWeek ||
        MEAL_TYPES.indexOf(a.mealType as (typeof MEAL_TYPES)[number]) - MEAL_TYPES.indexOf(b.mealType as (typeof MEAL_TYPES)[number])
    );

  return (
    <div className="space-y-5">
      <div className="rounded-xl border bg-card p-5 space-y-5">

        {/* Week picker */}
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-medium shrink-0">Plan for…</p>
          <div className="flex gap-2">
            {[0, 1, 2].map((offset) => (
              <button
                key={offset}
                type="button"
                onClick={() => setWeekOffset(offset)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-sm transition-all",
                  weekOffset === offset
                    ? "border-transparent bg-ink text-ink-foreground"
                    : "border-transparent bg-muted text-foreground hover:border-input"
                )}
              >
                {offset === 0 ? "This week" : offset === 1 ? "Next week" : "Week after"}
              </button>
            ))}
          </div>
        </div>

        {/* Interactive slot grid */}
        <div>
          <p className="text-sm font-medium mb-3">Which slots would you like planned?</p>
          <SlotGrid
            selectedSlots={selectedSlots}
            existingCoverage={existingCoverage}
            disabled={isGenerating || isAdding}
            onChange={setSelectedSlots}
          />
        </div>

        {/* Suggestion style */}
        <div>
          <p className="text-sm font-medium mb-2">Suggestion style</p>
          <div className="flex flex-wrap gap-2">
            {FREQUENCY_MODES.map(({ mode, label, icon: Icon, activeClass, inactiveClass }) => {
              const bucket =
                mode === "favourites" || mode === "regulars" || mode === "new" ? mode : null;
              const available = bucket ? styleBreakdown.counts[bucket] : styleBreakdown.total;
              return (
              <button
                key={mode}
                type="button"
                onClick={() => setFrequencyMode((prev) => (prev === mode ? null : mode))}
                disabled={isGenerating || isAdding}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50",
                  frequencyMode === mode ? activeClass : inactiveClass
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none",
                    frequencyMode === mode ? "bg-card/25" : "bg-black/5"
                  )}
                >
                  {available}
                </span>
              </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {activeStyle
              ? `${activeStyle.description} — ${styleCount} of your ${styleBreakdown.total} recipes.`
              : `No style chosen — all ${styleBreakdown.total} of your recipes have an equal chance.`}
          </p>
          {activeStyle && previewTitles.length > 0 && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowPreview((v) => !v)}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                {showPreview ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {showPreview ? "Hide" : "Preview"} the {styleCount} recipe{styleCount === 1 ? "" : "s"} it can pick from
              </button>
              {showPreview && (
                <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border bg-muted/40 p-2.5">
                  <div className="flex flex-wrap gap-1.5">
                    {previewTitles.map((title) => (
                      <span
                        key={title}
                        className="rounded-full bg-background px-2 py-0.5 text-xs shadow-sm"
                      >
                        {title}
                      </span>
                    ))}
                  </div>
                  {previewTruncated && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      …and {styleCount - previewTitles.length} more.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          {activeStyle && styleCount === 0 && (
            <p className="mt-2 rounded-lg border border-transparent bg-warning-tint p-2.5 text-xs text-warning">
              No recipes match this style yet, so the planner will invent every meal
              from scratch. {frequencyMode === "favourites"
                ? "Star a few recipes to build this list up."
                : "Cook or plan a few more meals and this will fill out."}
            </p>
          )}
        </div>

        {/* Library filters */}
        <div>
          <p className="text-sm font-medium mb-1.5">Filter your recipe library</p>
          <div className="flex gap-2 flex-wrap">
            {availableCuisines.length > 0 && (
              <FilterChip
                icon={Globe}
                label="Cuisine"
                value={cuisineFilter}
                options={availableCuisines.map((c) => ({ label: c, value: c }))}
                onChange={setCuisineFilter}
                disabled={isGenerating || isAdding}
              />
            )}
            {availableTags.length > 0 && (
              <FilterChip
                icon={Tag}
                label="Tag"
                value={tagFilter}
                options={availableTags.map((t) => ({ label: t, value: t }))}
                onChange={setTagFilter}
                disabled={isGenerating || isAdding}
              />
            )}
            <button
              type="button"
              onClick={() => setRatedOnly((v) => !v)}
              disabled={isGenerating || isAdding}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50",
                ratedOnly
                  ? "border-transparent bg-warning text-card"
                  : "border-transparent bg-warning-tint text-warning hover:border-input"
              )}
            >
              <Star className="h-3.5 w-3.5" />
              Rated only
            </button>
            <button
              type="button"
              onClick={() => setHeartHealthy((v) => !v)}
              disabled={isGenerating || isAdding}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50",
                heartHealthy
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "border-transparent bg-highlight text-primary hover:border-input"
              )}
            >
              <HeartPulse className="h-3.5 w-3.5" />
              Heart-healthy week
            </button>
          </div>
          {heartHealthy && (
            <p className="mt-2 rounded-lg border border-transparent bg-highlight p-2.5 text-xs text-primary">
              Oily fish twice, pulses three times, red meat once at most (scaled to the slots you pick).
              Library recipes known to be high in saturated fat are left out, and new recipes are
              written and checked against the heart-healthy targets.
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <label htmlFor="max-cal-per-meal" className="text-sm font-medium text-muted-foreground">
              Max calories per meal
            </label>
            <input
              id="max-cal-per-meal"
              type="number"
              min="0"
              step="50"
              inputMode="numeric"
              value={maxCaloriesPerMeal}
              onChange={(e) => setMaxCaloriesPerMeal(e.target.value)}
              disabled={isGenerating || isAdding}
              placeholder="e.g. 700"
              className="w-28 rounded-md border border-input bg-background px-3 py-1.5 text-sm disabled:opacity-50"
            />
            <span className="text-xs text-muted-foreground">kcal / serving</span>
          </div>
          {(cuisineFilter || tagFilter || frequencyMode || ratedOnly || maxCaloriesPerMeal || heartHealthy) && (
            <button
              type="button"
              onClick={handleClearLibraryFilters}
              className="mt-1.5 text-xs text-muted-foreground hover:text-foreground underline"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Who's eating */}
        {members.length > 0 && (
          <div>
            <p className="text-sm font-medium mb-1.5">Who&apos;s eating?</p>
            <div className="flex flex-wrap gap-2">
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => togglePlanMember(m.id)}
                  disabled={isGenerating || isAdding}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50",
                    selectedMemberIds.has(m.id)
                      ? "border-transparent bg-ink text-ink-foreground"
                      : "border-transparent bg-muted text-foreground hover:border-input"
                  )}
                >
                  <Users className="h-3.5 w-3.5" />
                  {m.displayName}
                </button>
              ))}
            </div>
            {selectedMemberIds.size > 0 && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                AI will respect their dietary needs, and servings are scaled to
                who&apos;s eating (younger children count as less)
              </p>
            )}
          </div>
        )}

        {/* Preferences */}
        <div>
          <p className="text-sm font-medium mb-1.5">Any preferences?</p>
          <Textarea
            value={preferences}
            onChange={(e) => setPreferences(e.target.value)}
            placeholder="e.g. Easy meals, no fish, mostly Italian, vegetarian lunches…"
            rows={2}
            className="resize-none"
            disabled={isGenerating || isAdding}
          />
        </div>

        {error && <ErrorBanner message={error} />}

        <Button
          onClick={handleGenerate}
          disabled={!canGenerate || isGenerating || isAdding}
          className="w-full gap-2 bg-ink border-0 text-ink-foreground"
          size="lg"
        >
          {isGenerating ? (
            <><PlateSpinner />Planning your week…</>
          ) : (
            <><CalendarDays className="h-4 w-4" />Generate Meal Plan</>
          )}
        </Button>
      </div>

      {/* The draft arriving: a reel per slot, landing as each meal is written */}
      {planProgress && !generatedSlots && (
        <div id="plan-reels" className="scroll-mt-4 rounded-xl border bg-card p-5">
          <PlanReels rows={reelRows} photos={planProgress.photos} slots={planProgress.slots} facts={planProgress.facts} />
        </div>
      )}

      {/* Generated plan preview */}
      {generatedSlots && (
        <div className="rounded-xl border bg-card overflow-hidden">
          <PlanSlotPreviewDialog
            slot={previewIdx !== null ? generatedSlots[previewIdx] ?? null : null}
            rejected={previewIdx !== null && rejectedSlots.has(previewIdx)}
            redoing={previewIdx !== null && redoingSlots.has(previewIdx)}
            disabled={isGenerating || isAdding}
            previewCache={previewCache}
            onPreviewLoaded={(p) => setPreviewCache((prev) => new Map(prev).set(p.id, p))}
            onOpenChange={(open) => { if (!open) setPreviewIdx(null); }}
            onToggleRejected={() => { if (previewIdx !== null) toggleRejection(previewIdx); }}
            onSwap={() => { if (previewIdx !== null) handleRedoSlots([previewIdx]); }}
          />
          <div className="bg-muted border-b px-5 py-3 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-sm">Your meal plan for {weekLabel}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {rejectedSlots.size === 0
                  ? `${generatedSlots.length} meals — tap one to preview or swap it`
                  : `${includedCount} of ${generatedSlots.length} selected`}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {rejectedSlots.size > 0 && (
                <Button
                  size="sm"
                  onClick={() => handleRedoSlots(Array.from(rejectedSlots).sort((a, b) => a - b))}
                  disabled={isGenerating || isAdding}
                  className="gap-1.5 bg-ink border-0 text-ink-foreground"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", redoingSlots.size > 0 && "animate-spin")} />
                  Redo {rejectedSlots.size} unticked
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={handleGenerate} disabled={isGenerating || isAdding} className="gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" />Redo all
              </Button>
            </div>
          </div>

          <div className="divide-y">
            {DAY_FULL.map((dayName, dayIdx) => {
              const daySlots = generatedSlots
                .map((slot, globalIdx) => ({ slot, globalIdx }))
                .filter(({ slot }) => slot.dayOfWeek === dayIdx);
              if (!daySlots.length) return null;
              return (
                <div key={dayIdx} className="px-5 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{dayName}</p>
                  <div className="space-y-2">
                    {daySlots.map(({ slot, globalIdx }) => {
                      const rejected = rejectedSlots.has(globalIdx);
                      const redoing = redoingSlots.has(globalIdx);
                      return (
                        <div
                          key={globalIdx}
                          className={cn(
                            "flex items-start gap-2 rounded-xl px-2 py-1.5 transition-all",
                            rejected ? "opacity-40 bg-muted/30" : "hover:bg-muted/40",
                            redoing && "animate-pulse"
                          )}
                        >
                          {/* Keep / remove toggle */}
                          <button
                            type="button"
                            onClick={() => toggleRejection(globalIdx)}
                            disabled={isAdding || redoing}
                            aria-label={rejected ? `Keep ${slot.title}` : `Remove ${slot.title}`}
                            aria-pressed={!rejected}
                            className="mt-1 flex-shrink-0 p-1 -m-1"
                          >
                            <span
                              className={cn(
                                "h-5 w-5 rounded-full border-2 flex items-center justify-center transition-all",
                                rejected
                                  ? "border-muted-foreground/30 bg-transparent"
                                  : "border-transparent bg-success"
                              )}
                            >
                              {!rejected && <Check className="h-3 w-3 text-background" />}
                            </span>
                          </button>

                          {/* Tap for the preview modal */}
                          <button
                            type="button"
                            onClick={() => setPreviewIdx(globalIdx)}
                            disabled={isAdding}
                            className="flex-1 min-w-0 flex items-start gap-3 py-1 text-left"
                          >
                            {redoing ? (
                              <PlateReel photos={reelPhotos} offset={globalIdx} className="size-10 shrink-0" />
                            ) : isAdding && !slot.recipeId && !rejected ? (
                              // Being written out as a full recipe on the way in.
                              <AddingPlate state={writing.get(globalIdx)} delay={globalIdx * 0.4} />
                            ) : (
                              <DishPlate src={slot.imageUrl} alt="" isNew={!slot.recipeId} className="size-10" />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className={cn("text-sm font-medium truncate", rejected && "line-through text-muted-foreground")}>
                                  {slot.title}
                                </p>
                                <SlotBadges slot={slot} />
                              </div>
                              {!rejected && (
                                <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                                  {isAdding && !slot.recipeId ? addingLine(writing.get(globalIdx)) : slot.description}
                                </p>
                              )}
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRedoSlots([globalIdx])}
                            disabled={isGenerating || isAdding}
                            aria-label={`Swap ${slot.title} for something else`}
                            title="Swap for something else"
                            className="mt-0.5 shrink-0 h-8 w-8 rounded-full flex items-center justify-center bg-muted text-foreground shadow-sm hover:bg-muted disabled:opacity-50"
                          >
                            <RefreshCw className={cn("h-3.5 w-3.5", redoing && "animate-spin")} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="px-5 py-4 border-t bg-muted/30 space-y-3">
            {added ? (
              <div className="flex items-center gap-2 text-success text-sm font-medium">
                <BadgeCheck className="h-4 w-4" />
                Added! Redirecting to meal planner…
              </div>
            ) : (
              <Button
                onClick={handleAddToMealPlan}
                disabled={isAdding || isGenerating || includedCount === 0}
                className="w-full gap-2"
                size="lg"
              >
                {isAdding ? (
                  <>
                    <PlateSpinner />
                    {newRecipeCount > 0
                      ? `Writing ${newRecipeCount} new recipe${newRecipeCount !== 1 ? "s" : ""}… ${writtenCount} of ${newRecipeCount} done${
                          failedCount ? `, ${failedCount} couldn't be written` : ""
                        }`
                      : "Adding to planner…"}
                  </>
                ) : (
                  <><CalendarDays className="h-4 w-4" />Add {includedCount} meal{includedCount !== 1 ? "s" : ""} to Meal Plan</>
                )}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Find a Recipe tab ─────────────────────────────────────────────────────────

const CONCIERGE_HREF = "/ai-concierge";

/** The form behind a concepts job, so coming back to the page restores it. */
type ConciergeContext = {
  promptText: string;
  mealType: string;
  mealRole: MealRole | null;
  prefs: string[];
  memberIds: string[];
  cuisine: string;
  dietary: string;
  cookTime: string;
  spiceLevel: string;
  budget: string;
  servings: string;
};

function FindRecipeTab({ members }: { members: Member[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"inspire" | "direct">("inspire");
  const [promptText, setPromptText] = useState("");
  const [mealType, setMealType] = useState<string>("");
  const [mealRole, setMealRole] = useState<MealRole | null>(null);
  const [selectedPrefs, setSelectedPrefs] = useState<Set<string>>(new Set());
  const heartHealthy = selectedPrefs.has(HEART_HEALTHY_PREF);
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());
  const [concepts, setConcepts] = useState<ConceptCard[] | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [batchItems, setBatchItems] = useState<BatchItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatingIdx, setGeneratingIdx] = useState<number | null>(null);
  const [isPending, startTransition] = useAsyncBusy();
  const { run, resume } = useAiJobRunner();
  // Ideas as they're written, while the five are on their way.
  const [ideasSoFar, setIdeasSoFar] = useState<ConceptCard[] | null>(null);
  // The one recipe being written, and how far it's got.
  const [writing, setWriting] = useState<{ concept: ConceptCard; progress: RecipeProgress | null } | null>(null);

  function switchMode(next: "inspire" | "direct") {
    setMode(next);
    setConcepts(null);
    setError(null);
    setGeneratingIdx(null);
    setMealType("");
  }

  // Refine preferences state (filter chips)
  const [cuisine, setCuisine] = useState("");
  const [dietary, setDietary] = useState("");
  const [cookTime, setCookTime] = useState("");
  const [spiceLevel, setSpiceLevel] = useState("");
  const [budget, setBudget] = useState("");
  const [servings, setServings] = useState("");

  function buildPrompt(basePrompt?: string, role: MealRole | null = mealRole) {
    // Send labelled fields rather than one mashed-together sentence, so the
    // user's own words carry clear weight alongside the chips and filters.
    const lines: string[] = [];
    const text = (basePrompt ?? promptText).trim();
    if (text) lines.push(`What they'd like: ${text}`);
    if (selectedPrefs.size > 0) lines.push(`Preferences: ${Array.from(selectedPrefs).join(", ")}`);
    if (cuisine) lines.push(`Cuisine: ${cuisine}`);
    if (dietary) lines.push(`Dietary: ${dietary}`);
    if (cookTime) lines.push(`Max cook time: ${cookTime}`);
    if (spiceLevel) lines.push(`Spice level: ${spiceLevel}`);
    if (budget) lines.push(`Budget: ${budget}`);
    if (servings) lines.push(`Servings: ${servings}`);
    if (role) lines.push(`Kind of dish: ${MEAL_ROLE_LABELS[role].toLowerCase()}`);
    return lines.join("\n");
  }

  function recipeOptions(role: MealRole | null = mealRole) {
    return { heartHealthy, ...(role ? { mealRole: role } : {}) };
  }

  function showConcepts(next: ConceptCard[]) {
    setConcepts(next);
    setTimeout(() => {
      document.getElementById("concierge-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }

  // Ideas asked for before leaving the page: put the form back as it was and
  // pick the job up again (or its finished ideas) where it left off.
  useEffect(() => {
    const job = listTrackedAiJobs().find((j) => j.kind === "concepts" && j.href === CONCIERGE_HREF);
    if (!job) return;
    const ctx = job.context as ConciergeContext | undefined;
    if (ctx) {
      setPromptText(ctx.promptText);
      setMealType(ctx.mealType);
      setMealRole(ctx.mealRole);
      setSelectedPrefs(new Set(ctx.prefs));
      setSelectedMemberIds(new Set(ctx.memberIds));
      setCuisine(ctx.cuisine); setDietary(ctx.dietary); setCookTime(ctx.cookTime);
      setSpiceLevel(ctx.spiceLevel); setBudget(ctx.budget); setServings(ctx.servings);
    }
    setIdeasSoFar([]);
    startTransition(async () => {
      const out = await resume<ConceptsJobResult, ConceptsJobProgress>(job.jobId, (p) => setIdeasSoFar(p.concepts));
      if (!out) return;
      setIdeasSoFar(null);
      if ("error" in out) { setError(out.error); return; }
      showConcepts(out.result.concepts);
    });
  }, [resume, startTransition]);

  function runGenerate(overridePrompt?: string, roleOverride?: MealRole | null) {
    const role = roleOverride === undefined ? mealRole : roleOverride;
    const full = buildPrompt(overridePrompt, role);
    if (!full) return;
    setError(null);
    setConcepts(null);
    setGeneratingIdx(null);
    setSelectedIndices(new Set());
    setBatchItems(null);
    const context: ConciergeContext = {
      promptText: overridePrompt ?? promptText, mealType, mealRole: role,
      prefs: Array.from(selectedPrefs), memberIds: Array.from(selectedMemberIds),
      cuisine, dietary, cookTime, spiceLevel, budget, servings,
    };
    setIdeasSoFar([]);
    setTimeout(() => {
      document.getElementById("concierge-ideas")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
    startTransition(async () => {
      const out = await run<ConceptsJobResult, ConceptsJobProgress>(
        startConceptsJob(full, Array.from(selectedMemberIds), mealType || undefined, undefined, recipeOptions(role)),
        { kind: "concepts", label: "Recipe ideas", href: CONCIERGE_HREF, context },
        (p) => setIdeasSoFar(p.concepts)
      );
      if (!out) return;
      setIdeasSoFar(null);
      if ("error" in out) { setError(out.error); return; }
      showConcepts(out.result.concepts);
    });
  }

  /** Writes one recipe, then opens it in the editor to review and save. */
  function writeRecipe(concept: ConceptCard, onError: () => void) {
    setWriting({ concept, progress: null });
    setTimeout(() => {
      document.getElementById("concierge-writing")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
    startTransition(async () => {
      const out = await run<RecipeJobResult, RecipeProgress>(
        startRecipeJob(concept, Array.from(selectedMemberIds), mealType || undefined, undefined, { ...recipeOptions(), suggestCollection: true }),
        { kind: "recipe", label: concept.title },
        (progress) => setWriting({ concept, progress })
      );
      if (!out) return;
      setWriting(null);
      if ("error" in out) { setError(out.error); onError(); return; }
      stashAiDraft(recipeJobToDefaults(out.result));
      router.push("/recipes/new");
    });
  }

  function handleQuickPrompt(prompt: string, role?: MealRole | null) {
    const nextRole = role ?? null;
    setPromptText(prompt);
    setMealRole(nextRole);
    runGenerate(prompt, nextRole);
  }

  function togglePref(label: string) {
    setSelectedPrefs((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  }

  function toggleMember(id: string) {
    if (!selectedMemberIds.has(id) && members.find((m) => m.id === id)?.cholesterolDiet) {
      setSelectedPrefs((prev) => new Set(prev).add(HEART_HEALTHY_PREF));
    }
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleIndex(i: number) {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  function handleGenerate() {
    if (!concepts || selectedIndices.size === 0) return;
    const chosen = [...selectedIndices].sort((a, b) => a - b).map((i) => ({ idx: i, concept: concepts[i]! }));

    if (selectedIndices.size === 1) {
      const { idx, concept } = chosen[0]!;
      setError(null);
      setGeneratingIdx(idx);
      writeRecipe(concept, () => setGeneratingIdx(null));
    } else {
      // Written and saved server-side, so leaving the page doesn't stop it.
      const batchConcepts = chosen.map(({ concept }) => concept);
      const toItems = (p: BatchJobProgress): BatchItem[] =>
        p.items.map((item, i) => ({ ...item, concept: batchConcepts[i]! }));
      setBatchItems(batchConcepts.map((concept) => ({ concept, status: "pending" })));
      void (async () => {
        const out = await run<BatchJobProgress, BatchJobProgress>(
          startRecipeBatchJob(batchConcepts, Array.from(selectedMemberIds), mealType || undefined, undefined, recipeOptions()),
          { kind: "recipe-batch", label: `${batchConcepts.length} recipes` },
          (p) => setBatchItems(toItems(p))
        );
        if (!out) return;
        if ("error" in out) {
          setBatchItems(batchConcepts.map((concept) => ({ concept, status: "error", error: out.error })));
          return;
        }
        setBatchItems(toItems(out.result));
      })();
    }
  }

  function handleDirectGenerate() {
    const title = promptText.trim();
    if (!title) return;
    setError(null);
    setGeneratingIdx(0);
    const directConcept: ConceptCard = {
      title,
      description: title,
      cuisine: "",
      tags: [],
      difficulty: "medium",
    };
    writeRecipe(directConcept, () => setGeneratingIdx(null));
  }

  const hasFilter = !!(cuisine || dietary || cookTime || spiceLevel || budget || servings);
  // What was asked for, shown back while the ideas are written.
  const askedChips = [
    promptText.trim() ? `“${promptText.trim().length > 60 ? `${promptText.trim().slice(0, 57)}…` : promptText.trim()}”` : "",
    ...Array.from(selectedPrefs),
    cuisine, dietary, cookTime, spiceLevel, budget,
    mealRole ? MEAL_ROLE_LABELS[mealRole] : "",
  ].filter(Boolean);
  const canGenerate = promptText.trim().length > 0 || selectedPrefs.size > 0 || hasFilter || mealRole !== null;
  const isConceptLoading = isPending && generatingIdx === null;
  const isRecipeLoading = isPending && generatingIdx !== null;
  const isBatchRunning = batchItems !== null && batchItems.some((b) => b.status === "pending" || b.status === "generating");
  const batchDone = batchItems !== null && batchItems.every((b) => b.status === "done" || b.status === "error");
  const batchSuccessCount = batchItems?.filter((b) => b.status === "done").length ?? 0;

  return (
    <div>
      {/* Mobile: quick prompts horizontal scroll (inspire mode only) */}
      {mode === "inspire" && (
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1 lg:hidden">
          {QUICK_PROMPTS.map((item) => {
            const Icon = item.icon;
            return (
            <button
              key={item.label}
              type="button"
              onClick={() => handleQuickPrompt(item.prompt, "mealRole" in item ? item.mealRole : null)}
              disabled={isPending}
              className="flex-shrink-0 flex items-center gap-2 rounded-xl border bg-card px-3 py-2.5 text-left disabled:opacity-50"
            >
              <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", item.iconBg)}>
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-medium whitespace-nowrap">{item.label}</div>
                <div className="text-xs text-muted-foreground whitespace-nowrap">{item.description}</div>
              </div>
            </button>
            );
          })}
        </div>
      )}

      <div className={cn("grid grid-cols-1 gap-6", mode === "inspire" && "lg:grid-cols-[1fr_256px]")}>
      {/* ── Main column ── */}
      <div className="space-y-5 min-w-0">
        {/* Input card */}
        <div className="rounded-xl border bg-card p-5 space-y-4">

          {/* Mode toggle */}
          <div className="flex gap-1 rounded-xl border bg-muted/40 p-1 w-fit">
            <button
              type="button"
              onClick={() => switchMode("inspire")}
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
              onClick={() => switchMode("direct")}
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

          {mode === "inspire" ? (
            <>
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
                {PREFERENCES.map(({ label, icon: Icon, activeClass, inactiveClass }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => togglePref(label)}
                    disabled={isPending}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-all disabled:pointer-events-none",
                      selectedPrefs.has(label) ? activeClass : inactiveClass
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              {/* Meal type */}
              <div>
                <p className="text-sm font-medium mb-1.5">Meal type</p>
                <div className="flex flex-wrap gap-2">
                  {MEAL_TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setMealType((prev) => (prev === type ? "" : type))}
                      disabled={isPending}
                      className={cn(
                        "capitalize rounded-full border px-3 py-1.5 text-sm font-medium transition-all disabled:pointer-events-none",
                        mealType === type
                          ? "border-transparent bg-primary text-primary-foreground"
                          : "border-transparent bg-highlight text-primary hover:border-input"
                      )}
                    >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            <DishRolePicker value={mealRole} onChange={setMealRole} disabled={isPending} />

            {/* Who's eating? */}
            {members.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Who&apos;s eating?</p>
                  <div className="flex flex-wrap gap-2">
                    {members.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => toggleMember(m.id)}
                        disabled={isPending}
                        className={cn(
                          "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-all disabled:pointer-events-none",
                          selectedMemberIds.has(m.id)
                            ? "border-transparent bg-ink text-ink-foreground"
                            : "border-transparent bg-muted text-foreground hover:border-input"
                        )}
                      >
                        <Users className="h-3.5 w-3.5" />
                        {m.displayName}
                      </button>
                    ))}
                  </div>
                  {selectedMemberIds.size > 0 && (
                    <p className="text-xs text-muted-foreground">
                      AI will respect their dietary needs and preferences
                    </p>
                  )}
                </div>
              )}

              {/* Refine your preferences */}
              <div className="space-y-2 border-t pt-4">
                <div>
                  <p className="text-sm font-medium">Refine your preferences</p>
                  <p className="text-xs text-muted-foreground">The more details you add, the better I can tailor the suggestions.</p>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                  <FilterChip icon={Globe} label="Cuisine" value={cuisine} options={CUISINE_OPTIONS} onChange={setCuisine} disabled={isPending} />
                  <FilterChip icon={Leaf} label="Dietary" value={dietary} options={DIETARY_OPTIONS} onChange={setDietary} disabled={isPending} />
                  <FilterChip icon={Clock} label="Cook time" value={cookTime} options={COOK_TIME_OPTIONS} onChange={setCookTime} disabled={isPending} />
                  <FilterChip icon={Flame} label="Spice level" value={spiceLevel} options={SPICE_OPTIONS} onChange={setSpiceLevel} disabled={isPending} />
                  <FilterChip icon={Tag} label="Budget" value={budget} options={BUDGET_OPTIONS} onChange={setBudget} disabled={isPending} />
                  <FilterChip icon={Users} label="Servings" value={servings} options={SERVINGS_OPTIONS} onChange={setServings} disabled={isPending} />
                </div>
                {hasFilter && (
                  <button
                    type="button"
                    onClick={() => { setCuisine(""); setDietary(""); setCookTime(""); setSpiceLevel(""); setBudget(""); setServings(""); }}
                    className="text-xs text-muted-foreground hover:text-foreground underline"
                  >
                    Clear all filters
                  </button>
                )}
              </div>

              {error && <ErrorBanner message={error} />}

              <Button
                onClick={() => runGenerate()}
                disabled={isPending || !canGenerate}
                className="gap-2 w-full bg-ink border-0 text-ink-foreground"
                size="lg"
              >
                {isConceptLoading ? (
                  <><PlateSpinner />Thinking…</>
                ) : (
                  <><Sparkles className="h-4 w-4" />Generate Ideas</>
                )}
              </Button>
            </>
          ) : (
            <>
              <div>
                <label className="text-sm font-medium mb-1.5 block">
                  What do you want to make?
                </label>
                <Textarea
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  placeholder="e.g. Chicken tikka masala, beef bourguignon, pad thai…"
                  rows={3}
                  className="resize-none"
                  disabled={isPending}
                  maxLength={300}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleDirectGenerate();
                    }
                  }}
                />
                <div className="mt-1 text-right text-xs text-muted-foreground">
                  {promptText.length}/300
                </div>
              </div>

              {/* Who's eating? */}
              {members.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Who&apos;s eating?</p>
                  <div className="flex flex-wrap gap-2">
                    {members.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => toggleMember(m.id)}
                        disabled={isPending}
                        className={cn(
                          "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-all disabled:pointer-events-none",
                          selectedMemberIds.has(m.id)
                            ? "border-transparent bg-ink text-ink-foreground"
                            : "border-transparent bg-muted text-foreground hover:border-input"
                        )}
                      >
                        <Users className="h-3.5 w-3.5" />
                        {m.displayName}
                      </button>
                    ))}
                  </div>
                  {selectedMemberIds.size > 0 && (
                    <p className="text-xs text-muted-foreground">
                      AI will respect their dietary needs and preferences
                    </p>
                  )}
                </div>
              )}

              {/* Meal type */}
              <div>
                <p className="text-sm font-medium mb-1.5">Meal type</p>
                <div className="flex flex-wrap gap-2">
                  {MEAL_TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setMealType((prev) => (prev === type ? "" : type))}
                      disabled={isPending}
                      className={cn(
                        "capitalize rounded-full border px-3 py-1.5 text-sm font-medium transition-all disabled:pointer-events-none",
                        mealType === type
                          ? "border-transparent bg-primary text-primary-foreground"
                          : "border-transparent bg-highlight text-primary hover:border-input"
                      )}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              <DishRolePicker value={mealRole} onChange={setMealRole} disabled={isPending} />

              {/* Heart-healthy */}
              <div>
                <button
                  type="button"
                  onClick={() => togglePref(HEART_HEALTHY_PREF)}
                  disabled={isPending}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-all disabled:pointer-events-none",
                    heartHealthy
                      ? "border-transparent bg-primary text-primary-foreground"
                      : "border-transparent bg-highlight text-primary hover:border-input"
                  )}
                >
                  <HeartPulse className="h-3.5 w-3.5" />
                  Heart-healthy
                </button>
                <p className="mt-1 text-xs text-muted-foreground">
                  Low saturated fat, good fibre — the AI checks its numbers and revises if it misses.
                </p>
              </div>

              {error && <ErrorBanner message={error} />}

              <Button
                onClick={handleDirectGenerate}
                disabled={isPending || !promptText.trim()}
                className="gap-2 w-full bg-ink border-0 text-ink-foreground"
                size="lg"
              >
                {isPending ? (
                  <><PlateSpinner />Writing your recipe…</>
                ) : (
                  <><Sparkles className="h-4 w-4" />Create Recipe</>
                )}
              </Button>
            </>
          )}
        </div>

        {/* A recipe being written: ingredients → method → nutrition, as the AI gets there */}
        {isRecipeLoading && writing && (
          <div id="concierge-writing" className="scroll-mt-4 rounded-xl border bg-card p-5">
            <RecipeWriting
              title={writing.concept.title}
              description={writing.concept.description !== writing.concept.title ? writing.concept.description : undefined}
              progress={writing.progress}
            />
          </div>
        )}

        {/* Five ideas on their way, each taking its place as it's written */}
        {mode === "inspire" && isConceptLoading && ideasSoFar && (
          <div id="concierge-ideas" className="scroll-mt-4 rounded-xl border bg-card p-5">
            <IdeaPlaces
              ideas={ideasSoFar}
              asked={askedChips}
              note="Usually 10–20 seconds. Ideas drop into place as they’re written."
            />
          </div>
        )}

        {/* Concept results (inspire mode only) */}
        {mode === "inspire" && concepts && (
          <div id="concierge-results">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="font-semibold">Here are 5 ideas for you</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Select one or more — we&apos;ll build the recipes for you.
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => runGenerate()}
                disabled={isPending || isBatchRunning}
                className="gap-1.5 text-muted-foreground shrink-0"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Regenerate
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {concepts.map((concept, i) => (
                <ConceptCardItem
                  key={i}
                  concept={concept}
                  selected={selectedIndices.has(i)}
                  onToggle={() => toggleIndex(i)}
                  isGenerating={generatingIdx === i}
                  disabled={isPending || isBatchRunning}
                />
              ))}
            </div>

            {/* Select all + Generate button row */}
            <div className="mt-3 flex items-center justify-between">
              <button
                type="button"
                onClick={() =>
                  setSelectedIndices(
                    selectedIndices.size === concepts.length
                      ? new Set()
                      : new Set(concepts.map((_, i) => i))
                  )
                }
                disabled={isPending || isBatchRunning}
                className="text-xs text-muted-foreground hover:text-foreground disabled:pointer-events-none"
              >
                {selectedIndices.size === concepts.length ? "Deselect all" : "Select all"}
              </button>
              <div className="flex items-center gap-3">
                {selectedIndices.size > 0 && (
                  <span className="text-xs text-muted-foreground">{selectedIndices.size} selected</span>
                )}
                <Button
                  onClick={handleGenerate}
                  disabled={isPending || isBatchRunning || selectedIndices.size === 0}
                  className="gap-2 bg-ink border-0 text-ink-foreground"
                >
                  {isPending ? (
                    <><PlateSpinner />Generating…</>
                  ) : selectedIndices.size > 1 ? (
                    <><Sparkles className="h-4 w-4" />Generate {selectedIndices.size} recipes</>
                  ) : (
                    <><Sparkles className="h-4 w-4" />Generate recipe</>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Batch progress */}
        {batchItems && (
          <div className="rounded-xl border bg-card p-5 space-y-3">
            <div>
              <h3 className="font-semibold">
                {batchDone
                  ? `${batchSuccessCount} recipe${batchSuccessCount !== 1 ? "s" : ""} created`
                  : "Creating recipes…"}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {batchDone
                  ? "Head to your recipe library to view them."
                  : "Writing each recipe in turn, about a minute each."}
              </p>
            </div>
            <BatchWriting items={batchItems.map((item) => ({ ...item, title: item.concept.title }))} />
            {batchDone && (
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={() => setBatchItems(null)}>
                  Back to results
                </Button>
                <Button
                  size="sm"
                  onClick={() => router.push("/recipes")}
                  className="bg-ink border-0 text-ink-foreground"
                >
                  View recipes
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Desktop sidebar: quick prompts (inspire mode only) ── */}
      {mode === "inspire" && (
        <div className="hidden lg:flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Quick prompts
          </h3>
          {QUICK_PROMPTS.map((item) => (
            <QuickPromptButton
              key={item.label}
              label={item.label}
              description={item.description}
              icon={item.icon}
              iconBg={item.iconBg}
              onClick={() => handleQuickPrompt(item.prompt, "mealRole" in item ? item.mealRole : null)}
              disabled={isPending}
            />
          ))}
          <div className="mt-1 border-t pt-3">
            <p className="text-xs text-muted-foreground text-center">
              Or describe anything in the box — the AI handles the rest.
            </p>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function ConciergeClient({ availableCuisines, availableTags, members, styleBreakdown }: PlanMyWeekProps & { members: Member[] }) {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab") === "plan" ? "plan" : "recipe";
  const [activeTab, setActiveTab] = useState<"recipe" | "plan">(tabParam);
  // Follow the URL, so the AI tray's "View plan" / "View ideas" switch tabs
  // even when this page is already open on the other one.
  useEffect(() => setActiveTab(tabParam), [tabParam]);

  function selectTab(tab: "recipe" | "plan") {
    setActiveTab(tab);
    // Keep the URL in step, so a link to the tab already showing is a no-op
    // rather than one the effect above can't see.
    window.history.replaceState(null, "", tab === "plan" ? PLAN_HREF : CONCIERGE_HREF);
  }

  return (
    <div className="p-4 lg:p-8 max-w-screen-xl mx-auto">
      {/* Hero banner */}
      <div className="relative mb-6 rounded-2xl overflow-hidden bg-muted border border-transparent p-6 lg:p-8">
        <div className="absolute inset-0 bg-muted pointer-events-none" />
        <div className="relative flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-ink shadow-md">
            <Sparkles className="h-6 w-6 text-background" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">What shall we cook?</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Tell me what you&apos;re craving and I&apos;ll suggest something delicious — or let me plan your whole week.
            </p>
            {/* Sample preference tags for visual appeal */}
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1 rounded-full border border-transparent bg-success-tint px-2.5 py-1 text-xs font-medium text-success">
                <Leaf className="h-3 w-3" />Vegetarian
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-transparent bg-highlight px-2.5 py-1 text-xs font-medium text-primary">
                <Zap className="h-3 w-3" />Quick meals
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-transparent bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
                <Users className="h-3 w-3" />Family friendly
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-transparent bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
                <PiggyBank className="h-3 w-3" />Budget friendly
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Tab selector */}
      <div className="mb-6 flex gap-1 rounded-xl border bg-muted/40 p-1 w-fit">
        <button
          type="button"
          onClick={() => selectTab("recipe")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all",
            activeTab === "recipe"
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Utensils className="h-4 w-4" />
          Find a Recipe
        </button>
        <button
          type="button"
          onClick={() => selectTab("plan")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all",
            activeTab === "plan"
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <CalendarDays className="h-4 w-4" />
          Plan My Week
        </button>
      </div>

      {activeTab === "recipe" ? <FindRecipeTab members={members} /> : <PlanMyWeekTab availableCuisines={availableCuisines} availableTags={availableTags} members={members} styleBreakdown={styleBreakdown} />}
    </div>
  );
}
