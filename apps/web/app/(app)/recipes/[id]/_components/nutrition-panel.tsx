"use client";

import { useEffect, useState } from "react";
import { useAsyncBusy } from "@/lib/ai-jobs-client";
import { Flame, Sparkles, Loader2, ChevronDown, Heart } from "lucide-react";
import { cn } from "@dishes/ui";
import { isHeartHealthy } from "@/lib/heart-healthy";

/** Remembered per device: whether the macros are shown or just the calories. */
const OPEN_KEY = "dishes-nutrition-open";
import { estimateNutrition } from "@/app/actions/ai";

type Nutrition = {
  calories: number | null;
  proteinG: string | null;
  carbsG: string | null;
  fatG: string | null;
  saturatedFatG: string | null;
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
  // Not a transition, so leaving the page mid-estimate isn't held up.
  const [pending, startTransition] = useAsyncBusy();
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Nutrition>(nutrition);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setOpen(localStorage.getItem(OPEN_KEY) === "1");
    } catch {
      // storage blocked — stay collapsed
    }
  }, []);

  function toggle() {
    setOpen((was) => {
      try {
        localStorage.setItem(OPEN_KEY, was ? "0" : "1");
      } catch {
        // storage blocked — the toggle still works for this visit
      }
      return !was;
    });
  }

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
          saturatedFatG: n.saturatedFatG == null ? null : String(n.saturatedFatG),
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
    { label: "Sat. fat", value: fmt(data.saturatedFatG, scaleFactor, 1), unit: "g" },
    { label: "Fiber", value: fmt(data.fiberG, scaleFactor, 1), unit: "g" },
    { label: "Sugar", value: fmt(data.sugarG, scaleFactor, 1), unit: "g" },
    { label: "Sodium", value: fmt(data.sodiumMg, scaleFactor, 0), unit: "mg" },
  ];

  const calories = fmt(data.calories, scaleFactor, 0);

  if (!hasData) {
    return (
      <div className="rounded-2xl bg-muted px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Flame className="h-4 w-4" />
            Nutrition
            <span className="text-xs font-normal text-muted-foreground">not worked out yet</span>
          </div>
          <button
            type="button"
            onClick={handleEstimate}
            disabled={pending}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-ink px-3.5 text-xs font-semibold text-ink-foreground transition-colors hover:bg-ink/90 disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {pending ? "Estimating…" : "Estimate"}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-muted">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-2xl px-4 py-3 text-left transition-colors hover:bg-secondary/60"
      >
        <span className="flex items-center gap-2">
          <Flame className="h-4 w-4 shrink-0 text-primary" />
          <span className="flex flex-wrap items-baseline gap-x-1.5">
            {calories != null ? (
              <>
                <span className="font-serif text-xl font-semibold">{calories}</span>
                <span className="text-sm text-muted-foreground">kcal</span>
              </>
            ) : (
              <span className="text-sm font-medium">Nutrition</span>
            )}
            <span className="text-xs text-muted-foreground">
              per serving{scaleFactor !== 1 ? " (scaled)" : ""}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs font-medium text-muted-foreground">
          {data.source === "ai" && open && (
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
              <Sparkles className="h-3 w-3" />
              AI estimate
            </span>
          )}
          {isHeartHealthy(data) && (
            // Just the heart on a phone, where the line is short of room.
            <span
              title="Heart-healthy: low saturated fat, good fibre"
              aria-label="Heart-healthy"
              className="inline-flex h-6 min-w-6 items-center justify-center gap-1 rounded-full bg-success-tint px-1.5 text-[11px] font-semibold text-success sm:px-2.5"
            >
              <Heart className="h-3 w-3 fill-current" />
              <span className="hidden whitespace-nowrap sm:inline">Heart-healthy</span>
            </span>
          )}
          {!open && "Nutrition"}
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4">
          <div className="grid grid-cols-3 gap-2">
            {macros
              .filter((m) => m.value != null)
              .map((m) => (
                <div
                  key={m.label}
                  className="rounded-xl bg-card px-3 py-2 text-center"
                >
                  <div className="font-serif text-lg font-semibold text-foreground">
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
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-foreground hover:underline disabled:opacity-60"
            >
              {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {pending ? "Re-estimating…" : "Re-estimate"}
            </button>
          )}
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}
