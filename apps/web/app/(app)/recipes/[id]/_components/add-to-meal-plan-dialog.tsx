"use client";

import { useState, useTransition } from "react";
import { CalendarDays, CheckCircle2 } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dishes/ui";
import { addMealEntry } from "@/app/actions/meal-plan";

interface Props {
  recipeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type MealType = "breakfast" | "lunch" | "dinner" | "dessert" | "snack";

const MEAL_TYPES: { value: MealType; label: string }[] = [
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
  { value: "dessert", label: "Dessert" },
  { value: "snack", label: "Snack" },
];

function todayIso(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

function toWeekStartAndDay(dateStr: string): { weekStartDate: string; dayOfWeek: number } {
  const [y, m, day] = dateStr.split("-").map(Number);
  const date = new Date(y!, m! - 1, day!);
  // getDay(): 0=Sun … 6=Sat  →  convert to 0=Mon … 6=Sun
  const dayOfWeek = (date.getDay() + 6) % 7;
  const monday = new Date(date);
  monday.setDate(date.getDate() - dayOfWeek);
  const weekStartDate = [
    monday.getFullYear(),
    String(monday.getMonth() + 1).padStart(2, "0"),
    String(monday.getDate()).padStart(2, "0"),
  ].join("-");
  return { weekStartDate, dayOfWeek };
}

export function AddToMealPlanDialog({ recipeId, open, onOpenChange }: Props) {
  const [date, setDate] = useState(todayIso);
  const [mealType, setMealType] = useState<MealType>("dinner");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    if (!next) {
      setTimeout(() => {
        setDate(todayIso());
        setMealType("dinner");
        setDone(false);
        setError(null);
      }, 200);
    }
    onOpenChange(next);
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        const { weekStartDate, dayOfWeek } = toWeekStartAndDay(date);
        await addMealEntry(weekStartDate, recipeId, dayOfWeek, mealType);
        setDone(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add to meal plan");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/* No max-w-sm — let the dialog fill naturally on mobile so content isn't cramped */}
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-lg" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            Add to meal plan
          </DialogTitle>
        </DialogHeader>

        {done ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="h-10 w-10 text-green-500" />
            <p className="text-sm font-medium">Added to your meal plan</p>
            <p className="text-xs text-muted-foreground">
              {new Date(date + "T00:00:00").toLocaleDateString("en-GB", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
              {" · "}
              {MEAL_TYPES.find((m) => m.value === mealType)?.label}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-1 min-w-0">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Date</label>
              {/* min-w-0 prevents iOS date inputs from overflowing the grid cell.
                  text-base stops iOS Safari zooming in on focus. h-11 gives a
                  comfortable tap target and proper vertical centering on iOS. */}
              <div className="min-w-0">
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  min={todayIso()}
                  className="h-11 w-full rounded-md border border-input bg-background px-3 text-base ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Meal</label>
              <Select value={mealType} onValueChange={(v) => setMealType(v as MealType)}>
                <SelectTrigger className="h-11 text-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEAL_TYPES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive px-1">{error}</p>
        )}

        {/* Custom footer — DialogFooter's flex-col-reverse has no gap, so we manage layout ourselves */}
        <div className="flex flex-col gap-3 pt-1">
          {done ? (
            <Button onClick={() => handleOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button disabled={pending || !date} onClick={handleSubmit}>
                {pending ? "Adding…" : "Add to plan"}
              </Button>
              <Button variant="ghost" disabled={pending} onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
