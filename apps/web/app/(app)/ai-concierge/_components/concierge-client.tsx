"use client";

import { useState, useTransition } from "react";
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
import { addAiGeneratedMealPlan } from "@/app/actions/meal-plan";
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
      className={cn(
        "flex flex-col rounded-xl border bg-card overflow-hidden transition-shadow hover:shadow-md",
        disabled && !isGenerating && "opacity-60 pointer-events-none"
      )}
    >
      <div className="flex h-28 items-center justify-center bg-gradient-to-br from-violet-50 via-orange-50 to-amber-50 dark:from-violet-950/60 dark:via-orange-950/40 dark:to-amber-950/50 text-5xl select-none">
        {emoji}
      </div>
      <div className="flex flex-col flex-1 gap-2 p-4">
        <h3 className="font-semibold leading-snug">{concept.title}</h3>
        <p className="text-xs text-muted-foreground line-clamp-2 flex-1">
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
          className="w-full gap-1.5 mt-1 bg-gradient-to-r from-violet-600 to-orange-500 hover:from-violet-700 hover:to-orange-600 border-0 text-white"
          onClick={onSelect}
          disabled={disabled}
        >
          {isGenerating ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" />Creating recipe…</>
          ) : (
            <><Sparkles className="h-3.5 w-3.5" />Create recipe</>
          )}
        </Button>
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

// ── Plan My Week tab ───────────────────────────────────────────────────────────

type PlanMyWeekProps = {
  availableCuisines: string[];
  availableTags: string[];
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

function PlanMyWeekTab({ availableCuisines, availableTags }: PlanMyWeekProps) {
  const router = useRouter();
  const [selectedDays, setSelectedDays] = useState<Set<number>>(new Set([0, 1, 2, 3, 4]));
  const [selectedMealTypes, setSelectedMealTypes] = useState<Set<string>>(new Set(["dinner"]));
  const [preferences, setPreferences] = useState("");
  const [frequencyMode, setFrequencyMode] = useState<FrequencyMode>(null);
  const [cuisineFilter, setCuisineFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [unusedOnly, setUnusedOnly] = useState(false);
  const [ratedOnly, setRatedOnly] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [slots, setSlots] = useState<MealPlanSlot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, startGenTransition] = useTransition();
  const [isAdding, startAddTransition] = useTransition();
  const [added, setAdded] = useState(false);

  function toggleDay(i: number) {
    setSelectedDays((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  function toggleMealType(t: string) {
    setSelectedMealTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  }

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

  function handleGenerate() {
    setError(null);
    setSlots(null);
    setAdded(false);
    startGenTransition(async () => {
      const result = await generateMealPlanConcepts({
        days: Array.from(selectedDays).sort(),
        mealTypes: Array.from(selectedMealTypes),
        preferences: buildFullPreferences(),
        cuisineFilter: cuisineFilter || undefined,
        tagFilter: tagFilter || undefined,
        unusedOnly: unusedOnly || undefined,
        ratedOnly: ratedOnly || undefined,
      });
      if (result.error) { setError(result.error); return; }
      setSlots(result.slots!);
    });
  }

  function handleAddToMealPlan() {
    if (!slots) return;
    const weekStart = getMondayOf(weekOffset);
    startAddTransition(async () => {
      const result = await addAiGeneratedMealPlan(weekStart, slots);
      if (result.error) { setError(result.error); return; }
      setAdded(true);
      setTimeout(() => router.push("/meal-plan"), 1500);
    });
  }

  const canGenerate = selectedDays.size > 0 && selectedMealTypes.size > 0;

  const weekLabel = weekOffset === 0
    ? "This week"
    : weekOffset === 1
    ? "Next week"
    : `Week +${weekOffset}`;

  return (
    <div className="space-y-5">
      {/* Day selector */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div>
          <p className="text-sm font-medium mb-2">Which days would you like planned?</p>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((day, i) => (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(i)}
                className={cn(
                  "flex flex-col items-center rounded-xl border px-3 py-2 text-xs font-semibold transition-all min-w-[3rem]",
                  selectedDays.has(i)
                    ? "border-violet-400 bg-violet-500 text-white shadow-sm"
                    : "border-muted bg-muted/30 text-muted-foreground hover:border-violet-300 hover:text-foreground"
                )}
              >
                {day}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSelectedDays(new Set([0, 1, 2, 3, 4, 5, 6]))}
              className="rounded-xl border border-dashed border-muted-foreground/30 px-3 py-2 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
            >
              All
            </button>
          </div>
        </div>

        <div>
          <p className="text-sm font-medium mb-2">Which meals?</p>
          <div className="flex flex-wrap gap-2">
            {MEAL_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => toggleMealType(type)}
                className={cn(
                  "capitalize rounded-full border px-3 py-1.5 text-sm font-medium transition-all",
                  selectedMealTypes.has(type)
                    ? "border-orange-400 bg-orange-500 text-white"
                    : "border-orange-200 bg-orange-50 text-orange-700 hover:border-orange-300 dark:border-orange-800 dark:bg-orange-950/50 dark:text-orange-400 dark:hover:border-orange-700"
                )}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

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

        {/* Week to plan */}
        <div>
          <p className="text-sm font-medium mb-2">Plan for…</p>
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
      {slots && (
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="bg-gradient-to-r from-violet-50 to-orange-50 border-b px-5 py-3 flex items-center justify-between dark:from-violet-950/60 dark:to-orange-950/40">
            <div>
              <h3 className="font-semibold text-sm">Your meal plan for {weekLabel}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{slots.length} meals planned — review and add to your planner</p>
            </div>
            <Button variant="ghost" size="sm" onClick={handleGenerate} disabled={isGenerating || isAdding} className="gap-1.5 text-muted-foreground">
              <RefreshCw className="h-3.5 w-3.5" />Redo
            </Button>
          </div>

          <div className="divide-y">
            {DAY_FULL.map((dayName, dayIdx) => {
              const daySlots = slots.filter((s) => s.dayOfWeek === dayIdx);
              if (!daySlots.length) return null;
              return (
                <div key={dayIdx} className="px-5 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{dayName}</p>
                  <div className="space-y-2">
                    {daySlots.map((slot, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <span className="text-lg shrink-0 mt-0.5">{cuisineEmoji(slot.cuisine)}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium truncate">{slot.title}</p>
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
                          <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{slot.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="px-5 py-4 border-t bg-muted/30">
            {added ? (
              <div className="flex items-center gap-2 text-emerald-700 text-sm font-medium">
                <BadgeCheck className="h-4 w-4" />
                Added! Redirecting to meal planner…
              </div>
            ) : (
              <Button
                onClick={handleAddToMealPlan}
                disabled={isAdding || isGenerating}
                className="w-full gap-2"
                size="lg"
              >
                {isAdding ? (
                  <><Loader2 className="h-4 w-4 animate-spin" />Adding to planner…</>
                ) : (
                  <><CalendarDays className="h-4 w-4" />Add to Meal Plan</>
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

function FindRecipeTab() {
  const router = useRouter();
  const [promptText, setPromptText] = useState("");
  const [selectedPrefs, setSelectedPrefs] = useState<Set<string>>(new Set());
  const [concepts, setConcepts] = useState<ConceptCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatingIdx, setGeneratingIdx] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  // Refine preferences state (filter chips)
  const [cuisine, setCuisine] = useState("");
  const [dietary, setDietary] = useState("");
  const [cookTime, setCookTime] = useState("");
  const [spiceLevel, setSpiceLevel] = useState("");
  const [budget, setBudget] = useState("");
  const [servings, setServings] = useState("");

  function buildPrompt(basePrompt?: string) {
    const parts: string[] = [];
    if (selectedPrefs.size > 0) parts.push(Array.from(selectedPrefs).join(", "));
    const text = (basePrompt ?? promptText).trim();
    if (text) parts.push(text);
    if (cuisine) parts.push(`${cuisine} cuisine`);
    if (dietary) parts.push(dietary);
    if (cookTime) parts.push(cookTime);
    if (spiceLevel) parts.push(spiceLevel);
    if (budget) parts.push(`${budget} budget`);
    if (servings) parts.push(servings);
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

  function handleSelectConcept(concept: ConceptCard, idx: number) {
    setError(null);
    setGeneratingIdx(idx);
    startTransition(async () => {
      const result = await generateFullRecipe(concept);
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

  return (
    <div>
      {/* Mobile: quick prompts horizontal scroll */}
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_256px]">
      {/* ── Main column ── */}
      <div className="space-y-5 min-w-0">
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
        </div>

        {/* Recipe generation overlay banner */}
        {isRecipeLoading && (
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
    </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function ConciergeClient({ availableCuisines, availableTags }: PlanMyWeekProps) {
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

      {activeTab === "recipe" ? <FindRecipeTab /> : <PlanMyWeekTab availableCuisines={availableCuisines} availableTags={availableTags} />}
    </div>
  );
}
