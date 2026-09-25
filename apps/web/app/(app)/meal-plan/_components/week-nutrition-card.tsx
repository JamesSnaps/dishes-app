"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  HeartPulse,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  Lightbulb,
  ArrowRight,
  Sparkles,
  Star,
  Loader2,
  ShoppingBag,
  Repeat2,
} from "lucide-react";
import { Button, cn } from "@dishes/ui";
import {
  PROTEIN_LABELS,
  WEEKLY_PROTEIN_TARGETS,
  meetsTarget,
  type MealSummary,
  type ProteinKind,
} from "@/lib/meal-stats";
import type { SwapRecipe, SwapSuggestion } from "@/lib/meal-swaps";
import type { ConceptCard } from "@/lib/ai/recipe-generation";
import { generateConcepts, generateFullRecipe } from "@/app/actions/ai";
import { saveGeneratedRecipe } from "@/app/actions/recipes";
import { swapMealEntryRecipe } from "@/app/actions/meal-plan";
import { useSync } from "@/components/providers/sync-provider";
import { useToast } from "@/hooks/use-toast";
import type { MealPlanMutations, TopIngredient } from "./week-planner";

const TARGET_KINDS = Object.keys(WEEKLY_PROTEIN_TARGETS) as ProteinKind[];
const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// What to ask the AI for when the library has nothing that closes a gap.
const AI_ASK: Record<ProteinKind, string> = {
  oilyFish: "built around oily fish (salmon, mackerel, sardines or trout)",
  otherFish: "built around white fish or seafood",
  poultry: "built around chicken or turkey",
  pulses: "built around beans, lentils, chickpeas or tofu",
  redMeat: "with no red meat",
  processedMeat: "with no processed meat (no bacon, ham, sausages or chorizo)",
};

function targetText(kind: ProteinKind): string {
  const t = WEEKLY_PROTEIN_TARGETS[kind]!;
  if (t.min !== undefined) return `aim ${t.min}+`;
  return t.max === 0 ? "aim none" : `max ${t.max}`;
}

function targetShort(kind: ProteinKind, count: number): string {
  const t = WEEKLY_PROTEIN_TARGETS[kind]!;
  return t.min !== undefined ? `${count}/${t.min}` : `${count}, max ${t.max}`;
}

/**
 * This week's plan in nutrition terms, as a full-width strip that expands.
 *
 * Collapsed: a one-line summary — heart-healthy share, missed targets and how
 * many swaps are suggested. Expanded: the stat tiles, weekly protein targets
 * (when someone is on a cholesterol-lowering diet), swap suggestions and the
 * week's top ingredients.
 *
 * Computed from the entries on screen, so it moves with drag, add and delete.
 */
export function WeekNutritionPanel({
  summary,
  heartFocus,
  suggestions,
  topIngredients,
  open,
  onOpenChange,
  weekStartDate,
  mutations,
  onSelectDay,
}: {
  summary: MealSummary;
  heartFocus: boolean;
  suggestions: SwapSuggestion[];
  topIngredients: TopIngredient[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  weekStartDate: string;
  mutations?: MealPlanMutations;
  onSelectDay: (day: number) => void;
}) {
  if (summary.meals === 0) return null;

  const missing = summary.meals - summary.withNutrition;
  const offTargets = heartFocus
    ? TARGET_KINDS.filter((k) => meetsTarget(k, summary.proteins[k]) === false)
    : [];

  return (
    <section
      id="week-nutrition"
      className="mb-6 scroll-mt-4 rounded-xl border border-rose-200/60 bg-gradient-to-br from-rose-50 to-pink-50 shadow-sm dark:border-rose-900/40 dark:from-rose-950/30 dark:to-pink-950/20"
    >
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        <HeartPulse className="h-4 w-4 shrink-0 text-rose-500" />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="text-sm font-semibold">
            {summary.withNutrition
              ? `${summary.heartHealthy}/${summary.withNutrition} heart-healthy`
              : "This week’s nutrition"}
          </span>
          {offTargets.map((k) => (
            <span
              key={k}
              className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
            >
              <AlertTriangle className="h-3 w-3" />
              {PROTEIN_LABELS[k]} {targetShort(k, summary.proteins[k])}
            </span>
          ))}
          {heartFocus && offTargets.length === 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
              <CheckCircle2 className="h-3 w-3" />
              All targets met
            </span>
          )}
          {suggestions.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-violet-600 to-orange-500 px-2 py-0.5 text-xs font-semibold text-white shadow-sm">
              <Lightbulb className="h-3 w-3" />
              {suggestions.length} swap{suggestions.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="space-y-5 border-t border-rose-200/60 px-4 pb-4 pt-4 dark:border-rose-900/40">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid grid-cols-3 gap-2">
              <Stat
                value={summary.withNutrition ? `${summary.heartHealthy}/${summary.withNutrition}` : "—"}
                label="Heart-healthy"
              />
              <Stat
                value={summary.avgSaturatedFatG != null ? `${summary.avgSaturatedFatG}g` : "—"}
                label="Sat. fat / meal"
              />
              <Stat
                value={summary.avgFiberG != null ? `${summary.avgFiberG}g` : "—"}
                label="Fibre / meal"
              />
            </div>

            {heartFocus && (
              <ul className="space-y-1.5 self-center">
                {TARGET_KINDS.map((kind) => {
                  const count = summary.proteins[kind];
                  const ok = meetsTarget(kind, count);
                  return (
                    <li key={kind} className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex items-center gap-1.5">
                        {ok ? (
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-label="On target" />
                        ) : (
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-label="Off target" />
                        )}
                        {PROTEIN_LABELS[kind]}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        <span
                          className={cn("font-semibold", ok ? "text-foreground" : "text-amber-700 dark:text-amber-400")}
                        >
                          {count}
                        </span>{" "}
                        · {targetText(kind)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {suggestions.length > 0 && (
            <div>
              <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                <Lightbulb className="h-4 w-4 text-orange-500" />
                Suggested swaps
              </h4>
              <ul className="space-y-2">
                {suggestions.map((s) => (
                  <SuggestionRow
                    key={s.entryId}
                    suggestion={s}
                    weekShortOf={offTargets.filter((k) => WEEKLY_PROTEIN_TARGETS[k]?.min !== undefined)}
                    weekStartDate={weekStartDate}
                    mutations={mutations}
                    onSelectDay={onSelectDay}
                  />
                ))}
              </ul>
            </div>
          )}

          {topIngredients.length > 0 && (
            <div>
              <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                <ShoppingBag className="h-4 w-4 text-muted-foreground" />
                Top ingredients
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {topIngredients.map(({ name, count }) => (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2.5 py-1 text-xs capitalize shadow-sm dark:bg-white/5"
                  >
                    {name}
                    {count > 1 && <span className="font-semibold text-amber-700 dark:text-amber-400">×{count}</span>}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            {missing > 0 ? (
              <p className="text-xs text-muted-foreground">
                {missing} meal{missing === 1 ? " has" : "s have"} no saturated fat / fibre figures yet.
              </p>
            ) : (
              <span />
            )}
            <Link href="/stats" className="text-xs font-medium text-rose-700 hover:underline dark:text-rose-300">
              See all stats →
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg bg-white/70 px-2 py-2 text-center shadow-sm dark:bg-white/5">
      <div className="text-base font-semibold">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

// ─── One suggestion ──────────────────────────────────────────────────────────

type AiState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; concepts: ConceptCard[] }
  | { status: "creating"; concepts: ConceptCard[]; index: number }
  | { status: "error"; message: string };

function SuggestionRow({
  suggestion: s,
  weekShortOf,
  weekStartDate,
  mutations,
  onSelectDay,
}: {
  suggestion: SwapSuggestion;
  /** "Add" targets the week is still missing, so a "cut" swap can help those too. */
  weekShortOf: ProteinKind[];
  weekStartDate: string;
  mutations?: MealPlanMutations;
  onSelectDay: (day: number) => void;
}) {
  const router = useRouter();
  const sync = useSync();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [ai, setAi] = useState<AiState>({ status: "idle" });
  const [pending, startTransition] = useTransition();
  const mealType = s.mealType as Parameters<MealPlanMutations["addEntry"]>[3];

  function swapTo(recipe: SwapRecipe) {
    if (mutations) {
      mutations.addEntry(weekStartDate, recipe.id, s.dayOfWeek, mealType);
      mutations.deleteEntry(s.entryId);
    } else {
      startTransition(() =>
        swapMealEntryRecipe(s.entryId, weekStartDate, s.dayOfWeek, mealType, recipe.id)
      );
    }
    toast({ title: "Meal swapped", description: `${s.fromTitle} → ${recipe.title}` });
  }

  async function askAi() {
    setExpanded(true);
    setAi({ status: "loading" });
    // Lead with this swap's own gap; mention the week's other shortfalls so a
    // "no red meat" swap can land on oily fish or lentils where it fits.
    const others = weekShortOf.filter((k) => k !== s.gap.kind);
    const alsoLine = others.length
      ? ` The week is also short on ${others.map((k) => PROTEIN_LABELS[k].toLowerCase()).join(" and ")}, so ${
          s.gap.direction === "cut" ? "build it around" : "it's a bonus if it includes"
        } ${others.length === 1 ? "that" : "one of those"} where it suits the dish.`
      : "";
    const prompt = `A heart-healthy ${s.mealType} ${AI_ASK[s.gap.kind]}, to replace "${s.fromTitle}" in our week.${alsoLine} Keep a similar level of effort and comfort to the dish it replaces.`;
    const result = await generateConcepts(prompt, undefined, s.mealType, undefined, { heartHealthy: true });
    if (result.error || !result.concepts) {
      setAi({ status: "error", message: result.error ?? "No ideas came back." });
      return;
    }
    setAi({ status: "ready", concepts: result.concepts.slice(0, 3) });
  }

  async function createFromConcept(concepts: ConceptCard[], index: number) {
    setAi({ status: "creating", concepts, index });
    const gen = await generateFullRecipe(concepts[index]!, undefined, s.mealType, undefined, { heartHealthy: true });
    if (gen.error || !gen.recipe) {
      setAi({ status: "error", message: gen.error ?? "Couldn't write that recipe." });
      return;
    }
    const saved = await saveGeneratedRecipe(gen.recipe);
    if (saved.error || !saved.recipeId) {
      setAi({ status: "error", message: saved.error ?? "Couldn't save that recipe." });
      return;
    }
    // Server-side swap: the new recipe isn't in the local store yet, so a
    // queued sync mutation would point at a recipe the planner can't show.
    await swapMealEntryRecipe(s.entryId, weekStartDate, s.dayOfWeek, mealType, saved.recipeId);
    sync?.sync();
    router.refresh();
    toast({ title: "New recipe added and swapped in", description: `${s.fromTitle} → ${gen.recipe.title}` });
    setAi({ status: "idle" });
  }

  const busy = pending || ai.status === "creating";

  return (
    <li className="rounded-lg bg-white/80 p-3 shadow-sm dark:bg-white/5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onSelectDay(s.dayOfWeek)}
            className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
          >
            {DAY_SHORT[s.dayOfWeek]} · {s.mealType}
          </button>
          <p className="flex flex-wrap items-center gap-x-1.5 text-sm">
            <span className="text-muted-foreground line-through decoration-muted-foreground/40">{s.fromTitle}</span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-orange-500" />
            {s.toRecipe ? (
              <span className="font-semibold">
                {s.toRecipe.title}
                {s.toRecipe.avgRating != null && (
                  <span className="ml-1 inline-flex items-center gap-0.5 text-xs font-medium text-amber-600">
                    <Star className="h-3 w-3 fill-current" />
                    {s.toRecipe.avgRating.toFixed(1)}
                  </span>
                )}
              </span>
            ) : (
              <span className="italic text-muted-foreground">nothing in your library fits</span>
            )}
          </p>
          <span className="mt-1 inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
            {s.reason}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {s.toRecipe ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => swapTo(s.toRecipe!)}
              className="gap-1.5 border-0 bg-gradient-to-r from-orange-500 to-rose-500 text-white hover:from-orange-600 hover:to-rose-600"
            >
              <Repeat2 className="h-3.5 w-3.5" />
              Swap
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={busy || ai.status === "loading"}
              onClick={askAi}
              className="gap-1.5 border-0 bg-gradient-to-r from-violet-600 to-orange-500 text-white hover:from-violet-700 hover:to-orange-600"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Ask AI
            </Button>
          )}
          {(s.toRecipe || s.alternatives.length > 0) && (
            <Button size="sm" variant="outline" onClick={() => setExpanded((v) => !v)} className="gap-1">
              Other ideas
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
            </Button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-2 border-t pt-3">
          {s.alternatives.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">
                {r.title}
                {r.avgRating != null && (
                  <span className="ml-1 text-xs text-amber-600">★{r.avgRating.toFixed(1)}</span>
                )}
              </span>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => swapTo(r)} className="h-7 shrink-0">
                Swap
              </Button>
            </div>
          ))}

          {ai.status === "idle" && (
            <Button
              size="sm"
              variant="outline"
              onClick={askAi}
              className="w-full gap-1.5 border-violet-300 text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-950/30"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Ask AI for something new
            </Button>
          )}

          {ai.status === "loading" && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Thinking up ideas…
            </p>
          )}

          {ai.status === "error" && (
            <div className="flex items-center justify-between gap-2 text-sm text-destructive">
              <span>{ai.message}</span>
              <Button size="sm" variant="outline" onClick={askAi} className="h-7 shrink-0">
                Try again
              </Button>
            </div>
          )}

          {(ai.status === "ready" || ai.status === "creating") && (
            <ul className="space-y-2">
              {ai.concepts.map((c, i) => {
                const creatingThis = ai.status === "creating" && ai.index === i;
                return (
                  <li
                    key={c.title}
                    className="flex items-start justify-between gap-3 rounded-lg bg-gradient-to-br from-violet-50 to-orange-50 p-2.5 dark:from-violet-950/30 dark:to-orange-950/20"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{c.title}</p>
                      <p className="text-xs text-muted-foreground">{c.description}</p>
                    </div>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => createFromConcept(ai.concepts, i)}
                      className="h-7 shrink-0 gap-1 border-0 bg-gradient-to-r from-violet-600 to-orange-500 text-white"
                    >
                      {creatingThis ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Writing…
                        </>
                      ) : (
                        "Create & swap"
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
