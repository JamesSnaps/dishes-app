"use client";

import Link from "next/link";
import { HeartPulse, CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@dishes/ui";
import {
  PROTEIN_LABELS,
  WEEKLY_PROTEIN_TARGETS,
  meetsTarget,
  summariseMeals,
  type ProteinKind,
} from "@/lib/meal-stats";
import type { Entry, Recipe } from "./week-planner";

const TARGET_KINDS = Object.keys(WEEKLY_PROTEIN_TARGETS) as ProteinKind[];

function targetText(kind: ProteinKind): string {
  const t = WEEKLY_PROTEIN_TARGETS[kind]!;
  if (t.min !== undefined) return `aim ${t.min}+`;
  return t.max === 0 ? "aim none" : `max ${t.max}`;
}

/**
 * This week's plan in nutrition terms: how many meals are heart-healthy, the
 * average saturated fat and fibre, and — when someone in the household is on a
 * cholesterol-lowering diet — the weekly protein targets.
 *
 * Computed from the entries on screen, so it moves with drag, add and delete.
 */
export function WeekNutritionCard({
  entries,
  recipes,
  heartFocus,
}: {
  entries: Entry[];
  recipes: Recipe[];
  heartFocus: boolean;
}) {
  if (entries.length === 0) return null;

  const byId = new Map(recipes.map((r) => [r.id, r]));
  const summary = summariseMeals(
    entries.map((e) => {
      const r = byId.get(e.recipe.id);
      return {
        recipeId: e.recipe.id,
        calories: r?.calories ?? null,
        saturatedFatG: r?.saturatedFatG ?? null,
        fiberG: r?.fiberG ?? null,
        ingredientNames: r?.ingredientNames ?? [],
      };
    })
  );

  const missing = summary.meals - summary.withNutrition;

  return (
    <div className="rounded-xl border border-rose-200/60 bg-gradient-to-br from-rose-50 to-pink-50 p-4 shadow-sm dark:border-rose-900/40 dark:from-rose-950/30 dark:to-pink-950/20">
      <div className="mb-3 flex items-center gap-2">
        <HeartPulse className="h-4 w-4 text-rose-500" />
        <h3 className="text-sm font-semibold">This week&rsquo;s nutrition</h3>
      </div>

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
        <ul className="mt-3 space-y-1.5">
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
                  <span className={cn("font-semibold", ok ? "text-foreground" : "text-amber-700 dark:text-amber-400")}>
                    {count}
                  </span>{" "}
                  · {targetText(kind)}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {missing > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {missing} meal{missing === 1 ? " has" : "s have"} no saturated fat / fibre figures yet.
        </p>
      )}
      <Link href="/stats" className="mt-2 inline-block text-xs font-medium text-rose-700 hover:underline dark:text-rose-300">
        See all stats →
      </Link>
    </div>
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
