"use client";

import { useState, useTransition, useEffect, useMemo } from "react";
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
  Lightbulb,
  BookOpen,
  Target,
  CheckCircle2,
} from "lucide-react";
import { Button, Textarea, cn } from "@dishes/ui";
import {
  generateConcepts,
  generateFullRecipe,
  generateMealPlanConcepts,
  type ConceptCard,
  type GeneratedRecipe,
  type MealPlanSlot,
} from "@/app/actions/ai";
import { addAiGeneratedMealPlan, getWeekMealSlots } from "@/app/actions/meal-plan";
import { saveGeneratedRecipe } from "@/app/actions/recipes";
import type { RecipeFormDefaults } from "../../recipes/_components/recipe-form";

// ── Static data ────────────────────────────────────────────────────────────────

const PREFERENCES = [
  {
    label: "Vegetarian",
    icon: Leaf,
    activeClass: "border-emerald-400 bg-emerald-500 text-white",
    inactiveClass: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-400 dark:hover:border-emerald-700",
  },
  {
    label: "Quick",
    icon: Zap,
    activeClass: "border-orange-400 bg-orange-500 text-white",
    inactiveClass: "border-orange-200 bg-orange-50 text-orange-700 hover:border-orange-300 dark:border-orange-800 dark:bg-orange-950/50 dark:text-orange-400 dark:hover:border-orange-700",
  },
  {
    label: "Family Friendly",
    icon: Users,
    activeClass: "border-blue-400 bg-blue-500 text-white",
    inactiveClass: "border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-300 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-400 dark:hover:border-blue-700",
  },
  {
    label: "Budget",
    icon: PiggyBank,
    activeClass: "border-violet-400 bg-violet-500 text-white",
    inactiveClass: "border-violet-200 bg-violet-50 text-violet-700 hover:border-violet-300 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-400 dark:hover:border-violet-700",
  },
] as const;

const QUICK_PROMPTS = [
  {
    label: "Quick dinner",
    description: "Under 30 minutes",
    prompt: "Quick weeknight dinner in under 30 minutes",
    icon: Clock,
    iconBg: "bg-orange-100 text-orange-600 dark:bg-orange-950/60 dark:text-orange-400",
  },
  {
    label: "Healthy meal",
    description: "High protein",
    prompt: "Healthy high-protein meal",
    icon: Heart,
    iconBg: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400",
  },
  {
    label: "Comfort food",
    description: "For cosy nights",
    prompt: "Comfort food for a cosy night in",
    icon: Coffee,
    iconBg: "bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400",
  },
  {
    label: "Use what I have",
    description: "Pantry staples",
    prompt: "Something easy using common pantry staples",
    icon: Package,
    iconBg: "bg-blue-100 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400",
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
  if (d === "easy") return "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800";
  if (d === "hard") return "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/60 dark:text-red-400 dark:border-red-800";
  return "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-400 dark:border-amber-800";
}

function recipeToDefaults(r: GeneratedRecipe): RecipeFormDefaults {
  return {
    title: r.title, description: r.description, cuisine: r.cuisine,
    difficulty: r.difficulty, prepTimeMinutes: r.prepTimeMinutes,
    cookTimeMinutes: r.cookTimeMinutes, servings: r.servings,
    servingsUnit: r.servingsUnit, tags: r.tags, notes: r.notes,
    ingredients: r.ingredients, steps: r.steps,
  };
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
            <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs text-violet-700 dark:border-violet-800 dark:bg-violet-950/60 dark:text-violet-400">
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
            <Loader2 className="h-3 w-3 animate-spin" />
            Creating recipe…
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

type Member = { id: string; displayName: string };

type BatchItem = {
  concept: ConceptCard;
  status: "pending" | "generating" | "done" | "error";
  recipeId?: string;
  error?: string;
};

// ── Plan My Week tab ───────────────────────────────────────────────────────────

type PlanMyWeekProps = {
  availableCuisines: string[];
  availableTags: string[];
  members?: Member[];
};

type FrequencyMode = "favourites" | "new" | "mix" | null;

const FREQUENCY_MODES: { mode: FrequencyMode; label: string; icon: React.ElementType; hint: string; activeClass: string; inactiveClass: string }[] = [
  {
    mode: "favourites",
    label: "From our favourites",
    icon: Star,
    hint: "Prefer recipes from our library that we cook often and already love",
    activeClass: "border-amber-400 bg-amber-500 text-white",
    inactiveClass: "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-400 dark:hover:border-amber-700",
  },
  {
    mode: "new",
    label: "Try something new",
    icon: Lightbulb,
    hint: "Prioritise recipes from our library we haven't tried, or suggest fresh ideas we've never cooked",
    activeClass: "border-violet-400 bg-violet-500 text-white",
    inactiveClass: "border-violet-200 bg-violet-50 text-violet-700 hover:border-violet-300 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-400 dark:hover:border-violet-700",
  },
  {
    mode: "mix",
    label: "Mix it up",
    icon: Shuffle,
    hint: "Balance familiar library favourites with some new suggestions we haven't tried recently",
    activeClass: "border-emerald-400 bg-emerald-500 text-white",
    inactiveClass: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-400 dark:hover:border-emerald-700",
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
                          className="rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40 h-12 sm:h-14 flex flex-col items-center justify-center gap-0.5 px-1 select-none"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                          <span className="hidden sm:block text-[9px] text-emerald-700 dark:text-emerald-400 text-center leading-tight line-clamp-2 font-medium w-full px-0.5">
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
                          className="w-full rounded-lg border-2 border-violet-400 bg-violet-50 dark:bg-violet-950/40 h-12 sm:h-14 flex flex-col items-center justify-center gap-0.5 px-1 hover:bg-violet-100 dark:hover:bg-violet-950/60 transition-colors disabled:pointer-events-none disabled:opacity-50"
                        >
                          <Sparkles className="h-3 w-3 text-violet-500" />
                          <span className="hidden sm:block text-[9px] text-violet-600 dark:text-violet-400 font-semibold leading-none">generate</span>
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
                        className="w-full rounded-lg border border-dashed border-muted-foreground/20 bg-transparent h-12 sm:h-14 flex items-center justify-center text-muted-foreground/30 hover:border-violet-300/60 hover:bg-violet-50/50 dark:hover:bg-violet-950/20 hover:text-violet-400 transition-colors disabled:pointer-events-none text-xl leading-none"
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
            <span className="font-semibold text-violet-600 dark:text-violet-400">
              {selectedCount} slot{selectedCount !== 1 ? "s" : ""} to generate
            </span>
          ) : (
            <span>Tap any slot to select it</span>
          )}
          {coveredCount > 0 && (
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-emerald-500" />
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

function PlanMyWeekTab({ availableCuisines, availableTags, members = [] }: PlanMyWeekProps) {
  const router = useRouter();

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
  const [unusedOnly, setUnusedOnly] = useState(false);
  const [ratedOnly, setRatedOnly] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [generatedSlots, setGeneratedSlots] = useState<MealPlanSlot[] | null>(null);
  const [rejectedSlots, setRejectedSlots] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, startGenTransition] = useTransition();
  const [isAdding, startAddTransition] = useTransition();
  const [added, setAdded] = useState(false);
  const [debugInfo, setDebugInfo] = useState<Record<string, unknown> | null>(null);

  // Load coverage for the chosen week; auto-remove newly-covered slots from selection
  useEffect(() => {
    const weekStart = getMondayOf(weekOffset);
    getWeekMealSlots(weekStart)
      .then((coverage) => {
        setExistingCoverage(coverage);
        const coveredKeys = new Set(coverage.map((s) => `${s.dayOfWeek}:${s.mealType}`));
        setSelectedSlots((prev) => {
          const next = new Set(prev);
          for (const k of coveredKeys) next.delete(k);
          return next;
        });
      })
      .catch(() => setExistingCoverage([]));
  }, [weekOffset]);

  function buildFullPreferences(): string {
    const parts: string[] = [];
    const freq = FREQUENCY_MODES.find((f) => f.mode === frequencyMode);
    if (freq) parts.push(freq.hint);
    if (preferences.trim()) parts.push(preferences.trim());
    return parts.join(". ");
  }

  function handleClearLibraryFilters() {
    setCuisineFilter("");
    setTagFilter("");
    setUnusedOnly(false);
    setRatedOnly(false);
  }

  function togglePlanMember(id: string) {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleGenerate() {
    setError(null);
    setGeneratedSlots(null);
    setRejectedSlots(new Set());
    setAdded(false);
    const slots = Array.from(selectedSlots).map((key) => {
      const colon = key.indexOf(":");
      return { dayOfWeek: parseInt(key.slice(0, colon), 10), mealType: key.slice(colon + 1) };
    });
    startGenTransition(async () => {
      const result = await generateMealPlanConcepts({
        slots,
        preferences: buildFullPreferences(),
        cuisineFilter: cuisineFilter || undefined,
        tagFilter: tagFilter || undefined,
        unusedOnly: unusedOnly || undefined,
        ratedOnly: ratedOnly || undefined,
        memberIds: selectedMemberIds.size > 0 ? Array.from(selectedMemberIds) : undefined,
      });
      if (result.error) { setError(result.error); return; }
      setGeneratedSlots(result.slots!);
    });
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
    const slotsToAdd = generatedSlots.filter((_, idx) => !rejectedSlots.has(idx));
    if (!slotsToAdd.length) return;
    const weekStart = getMondayOf(weekOffset);
    startAddTransition(async () => {
      const result = await addAiGeneratedMealPlan(weekStart, slotsToAdd);
      if (result.debug) setDebugInfo(result.debug);
      if (result.error) { setError(result.error); return; }
      setAdded(true);
      setTimeout(() => router.push(`/meal-plan?week=${weekStart}`), 3000);
    });
  }

  const canGenerate = selectedSlots.size > 0;
  const weekLabel = weekOffset === 0 ? "This week" : weekOffset === 1 ? "Next week" : "Week after";
  const includedCount = generatedSlots ? generatedSlots.length - rejectedSlots.size : 0;

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
                    ? "border-blue-400 bg-blue-500 text-white"
                    : "border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-300 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-400 dark:hover:border-blue-700"
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
            {FREQUENCY_MODES.map(({ mode, label, icon: Icon, activeClass, inactiveClass }) => (
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
              </button>
            ))}
          </div>
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
              onClick={() => setUnusedOnly((v) => !v)}
              disabled={isGenerating || isAdding}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50",
                unusedOnly
                  ? "border-teal-400 bg-teal-500 text-white"
                  : "border-teal-200 bg-teal-50 text-teal-700 hover:border-teal-300 dark:border-teal-800 dark:bg-teal-950/50 dark:text-teal-400 dark:hover:border-teal-700"
              )}
            >
              <BookOpen className="h-3.5 w-3.5" />
              Not yet tried
            </button>
            <button
              type="button"
              onClick={() => setRatedOnly((v) => !v)}
              disabled={isGenerating || isAdding}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50",
                ratedOnly
                  ? "border-amber-400 bg-amber-500 text-white"
                  : "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-400 dark:hover:border-amber-700"
              )}
            >
              <Star className="h-3.5 w-3.5" />
              Rated only
            </button>
          </div>
          {(cuisineFilter || tagFilter || unusedOnly || ratedOnly) && (
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
                      ? "border-blue-400 bg-blue-500 text-white"
                      : "border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-300 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-400 dark:hover:border-blue-700"
                  )}
                >
                  <Users className="h-3.5 w-3.5" />
                  {m.displayName}
                </button>
              ))}
            </div>
            {selectedMemberIds.size > 0 && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                AI will respect their dietary needs when suggesting meals
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
          className="w-full gap-2 bg-gradient-to-r from-violet-600 to-orange-500 hover:from-violet-700 hover:to-orange-600 border-0 text-white"
          size="lg"
        >
          {isGenerating ? (
            <><Loader2 className="h-4 w-4 animate-spin" />Planning your week…</>
          ) : (
            <><CalendarDays className="h-4 w-4" />Generate Meal Plan</>
          )}
        </Button>
      </div>

      {/* Generated plan preview */}
      {generatedSlots && (
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="bg-gradient-to-r from-violet-50 to-orange-50 border-b px-5 py-3 flex items-center justify-between dark:from-violet-950/60 dark:to-orange-950/40">
            <div>
              <h3 className="font-semibold text-sm">Your meal plan for {weekLabel}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {rejectedSlots.size === 0
                  ? `${generatedSlots.length} meals — tap any to remove`
                  : `${includedCount} of ${generatedSlots.length} selected`}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={handleGenerate} disabled={isGenerating || isAdding} className="gap-1.5 text-muted-foreground">
              <RefreshCw className="h-3.5 w-3.5" />Redo
            </Button>
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
                      return (
                        <button
                          key={globalIdx}
                          type="button"
                          onClick={() => toggleRejection(globalIdx)}
                          disabled={isAdding}
                          className={cn(
                            "w-full flex items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-all",
                            rejected
                              ? "opacity-40 bg-muted/30 line-through-children"
                              : "hover:bg-muted/40"
                          )}
                        >
                          {/* Toggle indicator */}
                          <span
                            className={cn(
                              "mt-0.5 flex-shrink-0 h-5 w-5 rounded-full border-2 flex items-center justify-center transition-all",
                              rejected
                                ? "border-muted-foreground/30 bg-transparent"
                                : "border-emerald-400 bg-emerald-500"
                            )}
                          >
                            {!rejected && <Check className="h-3 w-3 text-white" />}
                          </span>

                          <span className="text-lg shrink-0 leading-none mt-0.5">{cuisineEmoji(slot.cuisine)}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className={cn("text-sm font-medium truncate", rejected && "line-through text-muted-foreground")}>
                                {slot.title}
                              </p>
                              <span className={cn("inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] capitalize", difficultyClass(slot.difficulty))}>
                                {slot.difficulty}
                              </span>
                              <span className="inline-flex items-center rounded-full border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[10px] capitalize text-orange-700 dark:border-orange-800 dark:bg-orange-950/50 dark:text-orange-400">
                                {slot.mealType}
                              </span>
                              {slot.recipeId ? (
                                <span className="inline-flex items-center gap-0.5 rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-400">
                                  <BookOpen className="h-2.5 w-2.5" />
                                  From your library
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-0.5 rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-700 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-400">
                                  <Sparkles className="h-2.5 w-2.5" />
                                  New recipe
                                </span>
                              )}
                            </div>
                            {!rejected && (
                              <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{slot.description}</p>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="px-5 py-4 border-t bg-muted/30 space-y-3">
            {added ? (
              <div className="flex items-center gap-2 text-emerald-700 text-sm font-medium">
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
                  <><Loader2 className="h-4 w-4 animate-spin" />Adding to planner…</>
                ) : (
                  <><CalendarDays className="h-4 w-4" />Add {includedCount} meal{includedCount !== 1 ? "s" : ""} to Meal Plan</>
                )}
              </Button>
            )}
            {debugInfo && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground font-medium">Debug info</summary>
                <pre className="mt-2 p-3 rounded bg-muted overflow-auto max-h-64 text-left">
                  {JSON.stringify(debugInfo, null, 2)}
                </pre>
              </details>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Find a Recipe tab ─────────────────────────────────────────────────────────

function FindRecipeTab({ members }: { members: Member[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"inspire" | "direct">("inspire");
  const [promptText, setPromptText] = useState("");
  const [mealType, setMealType] = useState<string>("");
  const [selectedPrefs, setSelectedPrefs] = useState<Set<string>>(new Set());
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());
  const [concepts, setConcepts] = useState<ConceptCard[] | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [batchItems, setBatchItems] = useState<BatchItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatingIdx, setGeneratingIdx] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

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

  function buildPrompt(basePrompt?: string) {
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
    return lines.join("\n");
  }

  function runGenerate(overridePrompt?: string) {
    const full = buildPrompt(overridePrompt);
    if (!full) return;
    setError(null);
    setConcepts(null);
    setGeneratingIdx(null);
    setSelectedIndices(new Set());
    setBatchItems(null);
    startTransition(async () => {
      const result = await generateConcepts(full, Array.from(selectedMemberIds), mealType || undefined);
      if (result.error) { setError(result.error); return; }
      setConcepts(result.concepts!);
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
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  }

  function toggleMember(id: string) {
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
      startTransition(async () => {
        const result = await generateFullRecipe(concept, Array.from(selectedMemberIds), mealType || undefined);
        if (result.error) { setError(result.error); setGeneratingIdx(null); return; }
        const defaults = recipeToDefaults(result.recipe!);
        sessionStorage.setItem("ai_draft", JSON.stringify(defaults));
        router.push("/recipes/new");
      });
    } else {
      const items: BatchItem[] = chosen.map(({ concept }) => ({ concept, status: "pending" }));
      setBatchItems(items);
      void (async () => {
        const updated = [...items];
        for (let i = 0; i < updated.length; i++) {
          updated[i] = { ...updated[i]!, status: "generating" };
          setBatchItems([...updated]);
          const genResult = await generateFullRecipe(updated[i]!.concept, Array.from(selectedMemberIds), mealType || undefined);
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
    startTransition(async () => {
      const result = await generateFullRecipe(directConcept, Array.from(selectedMemberIds), mealType || undefined);
      if (result.error) { setError(result.error); setGeneratingIdx(null); return; }
      const defaults = recipeToDefaults(result.recipe!);
      sessionStorage.setItem("ai_draft", JSON.stringify(defaults));
      router.push("/recipes/new");
    });
  }

  const hasFilter = !!(cuisine || dietary || cookTime || spiceLevel || budget || servings);
  const canGenerate = promptText.trim().length > 0 || selectedPrefs.size > 0 || hasFilter;
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
          {QUICK_PROMPTS.map(({ label, description, prompt, icon: Icon, iconBg }) => (
            <button
              key={label}
              type="button"
              onClick={() => handleQuickPrompt(prompt)}
              disabled={isPending}
              className="flex-shrink-0 flex items-center gap-2 rounded-xl border bg-card px-3 py-2.5 text-left disabled:opacity-50"
            >
              <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", iconBg)}>
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-medium whitespace-nowrap">{label}</div>
                <div className="text-xs text-muted-foreground whitespace-nowrap">{description}</div>
              </div>
            </button>
          ))}
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
                          ? "border-orange-400 bg-orange-500 text-white"
                          : "border-orange-200 bg-orange-50 text-orange-700 hover:border-orange-300 dark:border-orange-800 dark:bg-orange-950/50 dark:text-orange-400 dark:hover:border-orange-700"
                      )}
                    >
                      {type}
                    </button>
                  ))}
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
                            ? "border-blue-400 bg-blue-500 text-white"
                            : "border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-300 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-400 dark:hover:border-blue-700"
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
                className="gap-2 w-full bg-gradient-to-r from-violet-600 to-orange-500 hover:from-violet-700 hover:to-orange-600 border-0 text-white"
                size="lg"
              >
                {isConceptLoading ? (
                  <><Loader2 className="h-4 w-4 animate-spin" />Thinking…</>
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
                            ? "border-blue-400 bg-blue-500 text-white"
                            : "border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-300 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-400 dark:hover:border-blue-700"
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
                          ? "border-orange-400 bg-orange-500 text-white"
                          : "border-orange-200 bg-orange-50 text-orange-700 hover:border-orange-300 dark:border-orange-800 dark:bg-orange-950/50 dark:text-orange-400 dark:hover:border-orange-700"
                      )}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              {error && <ErrorBanner message={error} />}

              <Button
                onClick={handleDirectGenerate}
                disabled={isPending || !promptText.trim()}
                className="gap-2 w-full bg-gradient-to-r from-violet-600 to-orange-500 hover:from-violet-700 hover:to-orange-600 border-0 text-white"
                size="lg"
              >
                {isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin" />Writing your recipe…</>
                ) : (
                  <><Sparkles className="h-4 w-4" />Create Recipe</>
                )}
              </Button>
            </>
          )}
        </div>

        {/* Recipe generation overlay banner (inspire mode) */}
        {mode === "inspire" && isRecipeLoading && (
          <div className="flex items-center gap-3 rounded-xl border bg-violet-50 border-violet-200 px-4 py-3 dark:bg-violet-950/40 dark:border-violet-800">
            <Loader2 className="h-5 w-5 animate-spin text-violet-600 shrink-0" />
            <div>
              <p className="text-sm font-medium">Writing your recipe…</p>
              <p className="text-xs text-muted-foreground">
                Building out ingredients and steps. Usually takes 10–20 seconds.
              </p>
            </div>
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
                  className="gap-2 bg-gradient-to-r from-violet-600 to-orange-500 hover:from-violet-700 hover:to-orange-600 border-0 text-white"
                >
                  {isPending ? (
                    <><Loader2 className="h-4 w-4 animate-spin" />Generating…</>
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
                  : "Generating each recipe in turn — this may take a minute."}
              </p>
            </div>
            <div className="space-y-3">
              {batchItems.map((item, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div
                    className={cn(
                      "h-6 w-6 shrink-0 rounded-full flex items-center justify-center text-xs font-medium",
                      item.status === "done" && "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
                      item.status === "generating" && "bg-primary/10 text-primary",
                      item.status === "error" && "bg-destructive/10 text-destructive",
                      item.status === "pending" && "bg-muted text-muted-foreground"
                    )}
                  >
                    {item.status === "done" && <Check className="h-3.5 w-3.5" />}
                    {item.status === "generating" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {item.status === "error" && <AlertCircle className="h-3.5 w-3.5" />}
                    {item.status === "pending" && <span>{i + 1}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-tight">{item.concept.title}</p>
                    {item.status === "generating" && (
                      <p className="text-xs text-muted-foreground">Writing ingredients and steps…</p>
                    )}
                    {item.status === "error" && (
                      <p className="text-xs text-destructive">{item.error}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {batchDone && (
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={() => setBatchItems(null)}>
                  Back to results
                </Button>
                <Button
                  size="sm"
                  onClick={() => router.push("/recipes")}
                  className="bg-gradient-to-r from-violet-600 to-orange-500 hover:from-violet-700 hover:to-orange-600 border-0 text-white"
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
          {QUICK_PROMPTS.map(({ label, description, prompt, icon, iconBg }) => (
            <QuickPromptButton
              key={label}
              label={label}
              description={description}
              icon={icon}
              iconBg={iconBg}
              onClick={() => handleQuickPrompt(prompt)}
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

export function ConciergeClient({ availableCuisines, availableTags, members }: PlanMyWeekProps & { members: Member[] }) {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") === "plan" ? "plan" : "recipe";
  const [activeTab, setActiveTab] = useState<"recipe" | "plan">(initialTab);

  return (
    <div className="p-4 lg:p-8 max-w-screen-xl mx-auto">
      {/* Hero banner */}
      <div className="relative mb-6 rounded-2xl overflow-hidden bg-gradient-to-br from-violet-100 via-orange-50 to-amber-100 border border-violet-200/60 p-6 lg:p-8 dark:from-violet-950/80 dark:via-orange-950/40 dark:to-amber-950/60 dark:border-violet-800/40">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 via-transparent to-orange-500/5 pointer-events-none" />
        <div className="relative flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-orange-400 shadow-md">
            <Sparkles className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">What shall we cook?</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Tell me what you&apos;re craving and I&apos;ll suggest something delicious — or let me plan your whole week.
            </p>
            {/* Sample preference tags for visual appeal */}
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400">
                <Leaf className="h-3 w-3" />Vegetarian
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-100 px-2.5 py-1 text-xs font-medium text-orange-700 dark:border-orange-800 dark:bg-orange-950/60 dark:text-orange-400">
                <Zap className="h-3 w-3" />Quick meals
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-400">
                <Users className="h-3 w-3" />Family friendly
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-700 dark:border-violet-800 dark:bg-violet-950/60 dark:text-violet-400">
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
          onClick={() => setActiveTab("recipe")}
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
          onClick={() => setActiveTab("plan")}
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

      {activeTab === "recipe" ? <FindRecipeTab members={members} /> : <PlanMyWeekTab availableCuisines={availableCuisines} availableTags={availableTags} members={members} />}
    </div>
  );
}
