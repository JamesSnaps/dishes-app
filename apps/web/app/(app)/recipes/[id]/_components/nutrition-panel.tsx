"use client";

import { useState, useTransition } from "react";
import { Flame, Sparkles, Loader2 } from "lucide-react";
import { estimateNutrition } from "@/app/actions/ai";

type Nutrition = {
  calories: number | null;
  proteinG: string | null;
  carbsG: string | null;
  fatG: string | null;
  fiberG: string | null;
  sugarG: string | null;
  sodiumMg: string | null;
  source: "none" | "ai" | "manual";
};

type Props = {
  recipeId: string;
  nutrition: Nutrition;
  /** Multiply per-serving values by this factor when the user scales the recipe. */
  scaleFactor?: number;
};

const fmt = (v: string | number | null, factor: number, decimals = 0): string | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  if (!Number.isFinite(n)) return null;
  return (n * factor).toFixed(decimals);
};

export function NutritionPanel({ recipeId, nutrition, scaleFactor = 1 }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Nutrition>(nutrition);

  const hasData =
    data.source !== "none" &&
    (data.calories != null ||
      data.proteinG != null ||
      data.carbsG != null ||
      data.fatG != null);

  function handleEstimate() {
    setError(null);
    startTransition(async () => {
      const res = await estimateNutrition(recipeId);
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.nutrition) {
        const n = res.nutrition;
        setData({
          calories: n.calories,
          proteinG: n.proteinG == null ? null : String(n.proteinG),
          carbsG: n.carbsG == null ? null : String(n.carbsG),
          fatG: n.fatG == null ? null : String(n.fatG),
          fiberG: n.fiberG == null ? null : String(n.fiberG),
          sugarG: n.sugarG == null ? null : String(n.sugarG),
          sodiumMg: n.sodiumMg == null ? null : String(n.sodiumMg),
          source: "ai",
        });
      }
    });
  }

  const macros: { label: string; value: string | null; unit: string }[] = [
    { label: "Protein", value: fmt(data.proteinG, scaleFactor, 1), unit: "g" },
    { label: "Carbs", value: fmt(data.carbsG, scaleFactor, 1), unit: "g" },
    { label: "Fat", value: fmt(data.fatG, scaleFactor, 1), unit: "g" },
    { label: "Fiber", value: fmt(data.fiberG, scaleFactor, 1), unit: "g" },
    { label: "Sugar", value: fmt(data.sugarG, scaleFactor, 1), unit: "g" },
    { label: "Sodium", value: fmt(data.sodiumMg, scaleFactor, 0), unit: "mg" },
  ];

  const calories = fmt(data.calories, scaleFactor, 0);

  if (!hasData) {
    return (
      <div className="rounded-xl border border-orange-200/60 bg-gradient-to-br from-orange-50 to-amber-50 p-4 dark:border-orange-900/40 dark:from-orange-950/30 dark:to-amber-950/20">
        <div className="flex items-center gap-2 text-sm font-medium text-orange-900 dark:text-orange-200">
          <Flame className="h-4 w-4" />
          Nutrition
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          No nutrition data yet. Let the AI estimate it from the ingredients.
        </p>
        <button
          type="button"
          onClick={handleEstimate}
          disabled={pending}
          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {pending ? "Estimating…" : "Estimate nutrition"}
        </button>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-orange-200/60 bg-gradient-to-br from-orange-50 to-amber-50 p-4 dark:border-orange-900/40 dark:from-orange-950/30 dark:to-amber-950/20">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-orange-900 dark:text-orange-200">
          <Flame className="h-4 w-4" />
          Nutrition
          <span className="text-xs font-normal text-muted-foreground">
            per serving{scaleFactor !== 1 ? " (scaled)" : ""}
          </span>
        </div>
        {data.source === "ai" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
            <Sparkles className="h-3 w-3" />
            AI estimate
          </span>
        )}
      </div>

      {calories != null && (
        <div className="mt-3 flex items-baseline gap-1">
          <span className="text-3xl font-bold text-orange-900 dark:text-orange-100">{calories}</span>
          <span className="text-sm text-muted-foreground">kcal</span>
        </div>
      )}

      <div className="mt-3 grid grid-cols-3 gap-2">
        {macros
          .filter((m) => m.value != null)
          .map((m) => (
            <div
              key={m.label}
              className="rounded-lg bg-white/70 px-3 py-2 text-center shadow-sm dark:bg-white/5"
            >
              <div className="text-base font-semibold text-foreground">
                {m.value}
                <span className="text-xs font-normal text-muted-foreground">{m.unit}</span>
              </div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{m.label}</div>
            </div>
          ))}
      </div>

      {data.source === "ai" && (
        <button
          type="button"
          onClick={handleEstimate}
          disabled={pending}
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-orange-700 hover:underline disabled:opacity-60 dark:text-orange-300"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          {pending ? "Re-estimating…" : "Re-estimate"}
        </button>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
