"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChefHat, Minus, Plus, Users } from "lucide-react";
import { Button } from "@dishes/ui";

interface Props {
  recipeId: string;
  servings: string | null;
  servingsUnit: string | null;
}

export function StartCookingButton({ recipeId, servings, servingsUnit }: Props) {
  const router = useRouter();
  const defaultServings = servings ? parseFloat(servings) : null;
  const [current, setCurrent] = useState(defaultServings ?? 4);

  const step = current >= 10 ? 2 : 1;
  const changed = defaultServings !== null && current !== defaultServings;

  function start() {
    const qs = defaultServings !== null ? `?servings=${current}` : "";
    router.push(`/recipes/${recipeId}/cook${qs}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {defaultServings !== null && (
        <div className="flex items-center gap-0.5 rounded-lg border bg-background h-11 px-1">
          <Users className="h-3.5 w-3.5 text-muted-foreground ml-2 mr-1 shrink-0" />
          <button
            onClick={() => setCurrent((v) => Math.max(0.5, v - step))}
            className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted"
            aria-label="Fewer servings"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-[3.5rem] text-center text-sm font-semibold tabular-nums">
            {current % 1 === 0 ? current : current.toFixed(1)}
            {" "}
            {servingsUnit ?? "servings"}
          </span>
          <button
            onClick={() => setCurrent((v) => v + step)}
            className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted"
            aria-label="More servings"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          {changed && (
            <button
              onClick={() => setCurrent(defaultServings)}
              className="pr-2 pl-1 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
            >
              reset
            </button>
          )}
        </div>
      )}

      <Button size="lg" onClick={start} className="w-full sm:w-auto">
        <ChefHat className="mr-2 h-5 w-5" />
        Start Cooking
      </Button>
    </div>
  );
}
