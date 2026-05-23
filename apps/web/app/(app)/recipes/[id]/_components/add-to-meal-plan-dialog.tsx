"use client";

import { useState, useTransition, useRef } from "react";
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
  const dateInputRef = useRef<HTMLInputElement>(null);

  function openDatePicker() {
    try {
      dateInputRef.current?.showPicker();
    } catch {
      dateInputRef.current?.focus();
    }
  }
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
      <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
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
          <div className="flex flex-col gap-4 py-1">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Date</label>
              {/* showPicker() pattern: a styled button triggers the native date
                  picker programmatically on both iOS and desktop. The actual input
                  is a tiny hidden element (not display:none, which breaks showPicker)
                  that holds the value and fires onChange. */}
              <div className="relative">
                <button
                  type="button"
                  onClick={openDatePicker}
                  className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 text-sm text-left transition-colors hover:bg-accent/50"
                >
                  {date
                    ? new Date(date + "T00:00:00").toLocaleDateString("en-GB", {
                        weekday: "short",
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })
                    : "Select a date"}
                </button>
                <input
                  ref={dateInputRef}
                  type="date"
                  value={date}
                  min={todayIso()}
                  onChange={(e) => setDate(e.target.value)}
                  tabIndex={-1}
                  className="absolute left-0 top-0 h-px w-px opacity-0"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Meal</label>
              <Select value={mealType} onValueChange={(v) => setMealType(v as MealType)}>
                <SelectTrigger>
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
