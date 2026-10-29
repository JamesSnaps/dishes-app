"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { AlarmClock, ArrowRight, BookOpen, ChefHat, Clock, ListOrdered, Soup, UtensilsCrossed } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@dishes/ui";
import {
  mealCues,
  useCookSession,
  type CookCue,
  type CookMeal,
} from "@/components/providers/cook-session-provider";
import { alsoNow, anchorOf, dueLabel, indexOfPosition, stepsOf } from "@/lib/meal-sequence";
import type { MealCookDish } from "@/lib/services/meal-plan";
import type { DishData } from "../page";
import { CookingMode } from "./cooking-mode";
import { MealDebrief } from "./meal-debrief";
import { clockOf, useNow } from "./meal-cook-bar";

/**
 * Cooking a planned meal. Every dish is loaded up front, and when the meal has
 * a cooking schedule it's cooked as ONE sequence: the schedule's steps across
 * all the dishes, in time order, walked with Next and Back — each screen the
 * step of whichever dish it belongs to, with when it's due. The schedule is
 * frozen when the cook starts (server and device), so nothing moves under you.
 *
 * "View a dish" opens one dish's whole recipe (the escape hatch for reading
 * ahead); "Back to the meal" returns to your place. A meal with no schedule is
 * cooked dish by dish with tabs, as before. Either way it ends with one review
 * of the whole meal (MealDebrief).
 */

type Common = {
  householdMembers: { id: string; displayName: string }[];
  ownName: string | null;
  storageAvailable: boolean;
  onShoppingList: string[];
};

type Dish = DishData & { initialServings?: number };

export interface MealCookValue {
  groupId: string;
  title: string;
  dishes: { id: string; title: string; steps: { instruction: string }[] }[];
  /** Set while the scheduled meal is being walked as one sequence. */
  sequence: { cues: CookCue[]; index: number; cue: CookCue } | null;
  /** The meal has a schedule (whether or not it's the view right now). */
  scheduled: boolean;
  goTo: (index: number) => void;
  /** One dish's whole recipe — from the sequence, or a tab with no schedule. */
  showDish: (recipeId: string, stepIndex?: number | null) => void;
  backToMeal: () => void;
  finishMeal: () => void;
}

const MealCookContext = createContext<MealCookValue | null>(null);

export function useMealCook(): MealCookValue | null {
  return useContext(MealCookContext);
}

export function MealCooking({
  dishes,
  initialRecipeId,
  meal,
  ...common
}: Common & {
  dishes: Dish[];
  initialRecipeId: string;
  meal: {
    groupId: string;
    title: string;
    dishes: MealCookDish[];
    schedule?: { serveAt: number; cues: CookCue[] };
  };
}) {
  const { sessions, updateMeal, setStepIndex, activateSession, endCook } = useCookSession();
  const [dishId, setDishId] = useState(initialRecipeId);
  const [reviewing, setReviewing] = useState(false);
  // Saved: cooking mode is gone, so its start effect can't revive the cook it ends.
  const [ended, setEnded] = useState(false);

  // The meal as this cook holds it (frozen at the start); before the cook has
  // started, the schedule the page brought.
  const tag: CookMeal | undefined = useMemo(
    () =>
      sessions.find((s) => s.meal?.groupId === meal.groupId)?.meal ??
      (meal.schedule
        ? { groupId: meal.groupId, title: meal.title, order: [], serveAt: meal.schedule.serveAt, cues: meal.schedule.cues }
        : undefined),
    [sessions, meal]
  );
  const cues = useMemo(() => mealCues(tag), [tag]);
  const scheduled = cues.length > 0;
  const inSequence = scheduled && tag?.view !== "dish";
  const index = indexOfPosition(cues, tag?.position);
  const cue = cues[index];

  const currentId = (inSequence ? anchorOf(cues, index) : null) ?? dishId;
  const dish = dishes.find((d) => d.recipe.id === currentId) ?? dishes[0]!;

  const placeUrl = useCallback(
    (recipeId: string) =>
      window.history.replaceState(window.history.state, "", `/recipes/${recipeId}/cook?meal=${meal.groupId}`),
    [meal.groupId]
  );

  const goTo = useCallback(
    (i: number) => {
      const target = cues[i];
      if (!target) return;
      updateMeal(meal.groupId, (m) => ({ ...m, position: target.id, view: "meal" }));
      for (const s of stepsOf(target)) setStepIndex(s.stepIndex, s.recipeId);
      const anchor = anchorOf(cues, i);
      if (anchor) {
        activateSession(anchor);
        placeUrl(anchor);
      }
    },
    [cues, meal.groupId, updateMeal, setStepIndex, activateSession, placeUrl]
  );

  const showDish = useCallback(
    (recipeId: string, stepIndex?: number | null) => {
      if (scheduled) updateMeal(meal.groupId, (m) => ({ ...m, view: "dish" }));
      if (stepIndex != null) setStepIndex(stepIndex, recipeId);
      setDishId(recipeId);
      activateSession(recipeId);
      placeUrl(recipeId);
    },
    [scheduled, meal.groupId, updateMeal, setStepIndex, activateSession, placeUrl]
  );

  const backToMeal = useCallback(() => goTo(index), [goTo, index]);

  const value: MealCookValue = {
    groupId: meal.groupId,
    title: meal.title,
    dishes: dishes.map((d) => ({ id: d.recipe.id, title: d.recipe.title, steps: d.steps })),
    sequence: inSequence && cue ? { cues, index, cue } : null,
    scheduled,
    goTo,
    showDish,
    backToMeal,
    finishMeal: () => setReviewing(true),
  };

  const startedAt = Math.min(
    ...sessions.filter((s) => s.meal?.groupId === meal.groupId).map((s) => s.startedAt),
    Date.now()
  );

  return (
    <MealCookContext.Provider value={value}>
      {!ended && <CookingMode
        key={dish.recipe.id}
        {...common}
        recipe={dish.recipe}
        ingredients={dish.ingredients}
        steps={dish.steps}
        avgDuration={dish.avgDuration}
        initialServings={dish.initialServings}
        initialAssistThreads={dish.assistThreads}
        meal={meal}
      />}
      {reviewing && (
        <MealDebrief
          groupId={meal.groupId}
          title={meal.title}
          dishes={dishes.map((d) => ({ id: d.recipe.id, title: d.recipe.title, imageUrl: d.recipe.imageUrl }))}
          elapsedMinutes={Math.max(1, Math.round((Date.now() - startedAt) / 60_000))}
          householdMembers={common.householdMembers}
          ownName={common.ownName}
          storageAvailable={common.storageAvailable}
          onCancel={() => setReviewing(false)}
          onDone={() => {
            setEnded(true);
            endCook(dish.recipe.id);
          }}
        />
      )}
    </MealCookContext.Provider>
  );
}

// ─── Pieces CookingMode shows in sequence mode ───────────────────────────────

/** "Lamb · step 3 of 6", "Prep for 2 dishes", "Note", "Serve" — what the cue is. */
export function cueLabel(ctx: MealCookValue, cue: CookCue): string {
  if (cue.id === "serve") return "Serve";
  if (cue.covers?.length) return `Prep for ${new Set(cue.covers.map((c) => c.recipeId)).size} dishes`;
  const dish = ctx.dishes.find((d) => d.id === cue.recipeId);
  if (dish && cue.stepIndex !== null) return `${dish.title} · step ${cue.stepIndex + 1} of ${dish.steps.length}`;
  return dish ? `${dish.title} · note` : "Note";
}

const TONE = {
  ahead: "bg-card/80 text-primary dark:bg-black/30",
  now: "bg-primary text-primary-foreground",
  late: "bg-highlight text-primary",
} as const;

/**
 * Above the step: when it's due, anything else due at the same time, and
 * what's next — so you can see what's coming without opening anything.
 */
export function SequenceDue() {
  const ctx = useMealCook();
  const now = useNow();
  if (!ctx?.sequence) return null;
  const { cues, index, cue } = ctx.sequence;
  const due = dueLabel(cue.at, now);
  const others = alsoNow(cues, index);
  const next = cues[index + 1];

  return (
    <div className="mb-5 space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-highlight px-3 py-1 text-sm font-semibold text-primary shadow-sm">
          <AlarmClock className="h-4 w-4" />
          <span className="font-mono tabular-nums">{clockOf(cue.at)}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TONE[due.tone]}`}>{due.text}</span>
        </span>
        <span className="text-sm font-semibold text-primary">{cueLabel(ctx, cue)}</span>
      </div>
      {others.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Also now</span>
          {others.map(({ cue: o, index: i }) => (
            <button
              key={o.id}
              type="button"
              onClick={() => ctx.goTo(i)}
              className="rounded-full border border-input bg-card px-2.5 py-0.5 text-xs font-medium shadow-sm hover:border-input dark:bg-black/30"
            >
              {cueLabel(ctx, o)}
            </button>
          ))}
        </div>
      )}
      {next && (
        <button
          type="button"
          onClick={() => ctx.goTo(index + 1)}
          className="flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-lg bg-muted/50 px-3 py-1.5 text-left text-xs hover:bg-muted"
        >
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="shrink-0 font-semibold text-muted-foreground">Next</span>
          <span className="shrink-0 font-mono font-semibold tabular-nums">{clockOf(next.at)}</span>
          <span className="min-w-0 truncate text-muted-foreground">
            {next.id === "serve" ? "Serve" : `${dishOf(ctx, next)}${next.text}`}
          </span>
        </button>
      )}
    </div>
  );
}

function dishOf(ctx: MealCookValue, cue: CookCue): string {
  const d = ctx.dishes.find((x) => x.id === cue.recipeId);
  return d ? `${d.title}: ` : "";
}

/**
 * A cue that isn't one dish's step: a combined prep step (each dish's step it
 * does, in their own words), a coordinating note, or serving.
 */
export function CueCard() {
  const ctx = useMealCook();
  if (!ctx?.sequence) return null;
  const { cue } = ctx.sequence;
  const serve = cue.id === "serve";

  return (
    <div className="mb-6 rounded-2xl border border-transparent bg-highlight p-5 shadow-sm lg:p-8">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
          {serve ? <Soup className="h-5 w-5" /> : cue.covers?.length ? <ListOrdered className="h-5 w-5" /> : <UtensilsCrossed className="h-5 w-5" />}
        </span>
        <p className="pt-1 text-xl font-medium leading-relaxed lg:text-3xl">
          {serve ? "Everything should be ready — time to serve." : cue.text}
        </p>
      </div>
      {cue.covers?.length ? (
        <ul className="mt-5 space-y-2.5">
          {cue.covers.map((c) => {
            const d = ctx.dishes.find((x) => x.id === c.recipeId);
            return (
              <li key={`${c.recipeId}:${c.stepIndex}`} className="rounded-xl bg-card/80 p-3 shadow-sm dark:bg-black/30">
                <button
                  type="button"
                  onClick={() => ctx.showDish(c.recipeId, c.stepIndex)}
                  className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary hover:underline"
                >
                  {d?.title ?? "Dish"} · step {c.stepIndex + 1}
                </button>
                <p className="text-sm leading-relaxed lg:text-base">{d?.steps[c.stepIndex]?.instruction}</p>
              </li>
            );
          })}
        </ul>
      ) : null}
      {serve && (
        <Button
          size="lg"
          onClick={ctx.finishMeal}
          className="mt-5 w-full bg-primary text-primary-foreground shadow-md"
        >
          Finish and review the meal
        </Button>
      )}
    </div>
  );
}

/** Under the header: the meal, a way into one dish's recipe, and the start time. */
export function SequenceBar({ onChangeStart }: { onChangeStart: () => void }) {
  const ctx = useMealCook();
  if (!ctx?.sequence) return null;
  return (
    <div className="flex items-center gap-2 border-t bg-highlight px-3 py-2">
      <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-primary">
        <UtensilsCrossed className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{ctx.title}</span>
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1 rounded-lg border border-input bg-card/90 px-2 py-1 text-[11px] font-semibold text-primary shadow-sm hover:border-input dark:bg-black/30"
            >
              <BookOpen className="h-3 w-3" />
              View a dish
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Read one recipe in full — your place is kept
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {ctx.dishes.map((d) => (
              <DropdownMenuItem key={d.id} onSelect={() => ctx.showDish(d.id)}>
                <ChefHat className="mr-2 h-4 w-4" />
                {d.title}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          onClick={onChangeStart}
          className="flex items-center gap-1 rounded-lg border border-input bg-card/90 px-2 py-1 text-[11px] font-semibold text-primary shadow-sm hover:border-input dark:bg-black/30"
        >
          <Clock className="h-3 w-3" />
          <span className="hidden sm:inline">Started at a different time…</span>
          <span className="sm:hidden">Started…</span>
        </button>
      </div>
    </div>
  );
}

/** In one dish's recipe, from the sequence: back to where you were. */
export function BackToMealBar({ children }: { children?: ReactNode }) {
  const ctx = useMealCook();
  if (!ctx || !ctx.scheduled || ctx.sequence) return <>{children}</>;
  return (
    <div className="border-t">
      <button
        type="button"
        onClick={ctx.backToMeal}
        className="flex w-full items-center justify-center gap-2 bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow"
      >
        <ListOrdered className="h-4 w-4" />
        Back to the meal — your place is kept
      </button>
      {children}
    </div>
  );
}
