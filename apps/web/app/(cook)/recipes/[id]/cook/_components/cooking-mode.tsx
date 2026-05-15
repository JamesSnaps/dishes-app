"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  RotateCcw,
  Timer,
  Minus,
  Plus,
  CheckCircle2,
  PackageCheck,
} from "lucide-react";
import { Button } from "@dishes/ui";
import { deductRecipeIngredients } from "@/app/actions/pantry";
import type { recipes, recipeIngredients, recipeSteps } from "@dishes/db/schema";

type Recipe = typeof recipes.$inferSelect;
type Ingredient = typeof recipeIngredients.$inferSelect;
type Step = typeof recipeSteps.$inferSelect;

interface Props {
  recipe: Recipe;
  ingredients: Ingredient[];
  steps: Step[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FRACTION_SYMBOLS: Record<string, string> = {
  "0.25": "¼",
  "0.5": "½",
  "0.75": "¾",
  "0.33": "⅓",
  "0.67": "⅔",
  "0.2": "⅕",
  "0.4": "⅖",
  "0.6": "⅗",
  "0.8": "⅘",
  "0.125": "⅛",
  "0.375": "⅜",
  "0.625": "⅝",
  "0.875": "⅞",
};

function formatAmount(amount: string | null, scale: number): string {
  if (!amount) return "";
  const raw = parseFloat(amount);
  if (isNaN(raw)) return amount;
  const scaled = raw * scale;
  const whole = Math.floor(scaled);
  const frac = Math.round((scaled - whole) * 1000) / 1000;
  const fracSymbol = FRACTION_SYMBOLS[frac.toFixed(2)] ?? FRACTION_SYMBOLS[frac.toFixed(3)] ?? null;
  if (frac < 0.01) return String(whole || "");
  if (whole === 0) return fracSymbol ?? parseFloat(scaled.toFixed(2)).toString();
  return fracSymbol ? `${whole}${fracSymbol}` : parseFloat(scaled.toFixed(2)).toString();
}

function formatIngredientAmount(ing: Ingredient, scale: number): string {
  const parts: string[] = [];
  if (ing.amount) {
    const amt = formatAmount(ing.amount, scale);
    if (amt) parts.push(amt);
  }
  if (ing.unit) parts.push(ing.unit);
  return parts.join(" ");
}

function formatTimer(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ─── Ingredient chip (inline in step text) ───────────────────────────────────

interface IngredientChipProps {
  name: string;
  label: string;
  amount: string;
  isOpen: boolean;
  onToggle: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

function IngredientChip({ name, label, amount, isOpen, onToggle, onMouseEnter, onMouseLeave }: IngredientChipProps) {
  return (
    <span className="relative inline-block">
      <span
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onToggle(); }}
        className="cursor-pointer font-semibold text-orange-600 dark:text-orange-400 underline decoration-dotted underline-offset-2 hover:text-orange-700 dark:hover:text-orange-300 transition-colors"
        aria-label={`${name}: ${amount || label}`}
      >
        {label}
      </span>
      {isOpen && amount && (
        <span
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 whitespace-nowrap rounded-lg bg-gray-900 dark:bg-gray-100 px-2.5 py-1.5 text-xs font-medium text-white dark:text-gray-900 shadow-lg pointer-events-none"
          role="tooltip"
        >
          {amount}
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900 dark:border-t-gray-100" />
        </span>
      )}
    </span>
  );
}

// ─── Step text with ingredient highlighting ───────────────────────────────────

interface StepTextProps {
  instruction: string;
  ingredients: Ingredient[];
  scale: number;
}

function StepText({ instruction, ingredients, scale }: StepTextProps) {
  const [openId, setOpenId] = useState<string | null>(null);

  // Build a sorted list: longest names first to avoid partial matches
  const namedIngredients = ingredients
    .filter((ing) => ing.ingredientName)
    .sort((a, b) => b.ingredientName.length - a.ingredientName.length);

  if (namedIngredients.length === 0) {
    return <p className="text-xl lg:text-3xl leading-relaxed">{instruction}</p>;
  }

  // Build regex from all ingredient names (escape special chars, word-boundary aware)
  const escaped = namedIngredients.map((ing) =>
    ing.ingredientName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  const pattern = new RegExp(`(${escaped.join("|")})`, "gi");

  const parts = instruction.split(pattern);

  const ingByNameLower = new Map(namedIngredients.map((ing) => [ing.ingredientName.toLowerCase(), ing]));

  return (
    <p className="text-xl lg:text-3xl leading-relaxed">
      {parts.map((part, i) => {
        const ing = ingByNameLower.get(part.toLowerCase());
        if (!ing) return part;

        const amount = formatIngredientAmount(ing, scale);
        const tooltipKey = `${ing.id}-${i}`;
        const isOpen = openId === tooltipKey;

        return (
          <IngredientChip
            key={tooltipKey}
            name={ing.ingredientName}
            label={part}
            amount={amount}
            isOpen={isOpen}
            onToggle={() => setOpenId(isOpen ? null : tooltipKey)}
            onMouseEnter={() => setOpenId(tooltipKey)}
            onMouseLeave={() => setOpenId(null)}
          />
        );
      })}
    </p>
  );
}

// ─── Timer sub-component ──────────────────────────────────────────────────────

interface StepTimerProps {
  durationMinutes: number;
  label?: string | null;
}

function StepTimer({ durationMinutes, label }: StepTimerProps) {
  const totalSeconds = durationMinutes * 60;
  const [remaining, setRemaining] = useState(totalSeconds);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setRemaining(totalSeconds);
    setRunning(false);
    setDone(false);
  }, [totalSeconds]);

  useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          setRunning(false);
          setDone(true);
          if (typeof navigator !== "undefined" && "vibrate" in navigator) {
            navigator.vibrate([300, 100, 300]);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running]);

  const toggle = () => { if (!done) setRunning((r) => !r); };
  const reset = () => { setRunning(false); setDone(false); setRemaining(totalSeconds); };
  const progress = (totalSeconds - remaining) / totalSeconds;

  return (
    <div className="mt-6 rounded-xl border bg-muted/40 p-5">
      <div className="mb-4 flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Timer className="h-4 w-4" />
        {label ?? "Timer"}
      </div>

      <div className="mb-4 flex items-center justify-between">
        <span
          className={`font-mono text-4xl font-bold tabular-nums tracking-tight ${
            done ? "text-green-500" : remaining <= 30 && running ? "text-orange-500" : ""
          }`}
        >
          {done ? "Done!" : formatTimer(remaining)}
        </span>
        <div className="h-1.5 w-32 overflow-hidden rounded-full bg-border">
          <div
            className={`h-full rounded-full transition-all duration-1000 ${done ? "bg-green-500" : "bg-primary"}`}
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant={running ? "outline" : "default"} size="sm" onClick={toggle} disabled={done} className="flex-1">
          {running ? <><Pause className="mr-1.5 h-4 w-4" /> Pause</> : <><Play className="mr-1.5 h-4 w-4" /> {remaining < totalSeconds ? "Resume" : "Start"}</>}
        </Button>
        <Button variant="ghost" size="sm" onClick={reset} title="Reset timer">
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ─── Scaling control ──────────────────────────────────────────────────────────

interface ScalingControlProps {
  originalServings: string | null;
  servingsUnit: string | null;
  currentServings: number;
  onChange: (n: number) => void;
}

function ScalingControl({ originalServings, servingsUnit, currentServings, onChange }: ScalingControlProps) {
  const step = currentServings >= 10 ? 2 : 1;
  const min = 0.5;

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">Serves</span>
      <div className="flex items-center gap-1 rounded-lg border bg-background">
        <button
          onClick={() => onChange(Math.max(min, currentServings - step))}
          className="flex h-8 w-8 items-center justify-center rounded-l-lg transition-colors hover:bg-muted"
          aria-label="Decrease servings"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="min-w-[2.5rem] text-center text-sm font-semibold tabular-nums">
          {currentServings % 1 === 0 ? currentServings : currentServings.toFixed(1)}
        </span>
        <button
          onClick={() => onChange(currentServings + step)}
          className="flex h-8 w-8 items-center justify-center rounded-r-lg transition-colors hover:bg-muted"
          aria-label="Increase servings"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {servingsUnit && <span className="text-sm text-muted-foreground">{servingsUnit}</span>}
      {originalServings && parseFloat(originalServings) !== currentServings && (
        <button
          onClick={() => onChange(parseFloat(originalServings))}
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          reset
        </button>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CookingMode({ recipe, ingredients, steps }: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [checkedIngredients, setCheckedIngredients] = useState<Set<string>>(new Set());
  const [deducting, setDeducting] = useState(false);
  const [deducted, setDeducted] = useState(false);
  const originalServings = recipe.servings ? parseFloat(recipe.servings) : null;
  const [currentServings, setCurrentServings] = useState(originalServings ?? 4);

  const scale = originalServings && originalServings > 0 ? currentServings / originalServings : 1;
  const currentStep = steps[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;

  const activeIngredientIds = new Set((currentStep?.ingredientIds as string[] | null) ?? []);
  const stepIngredients = ingredients.filter((ing) => activeIngredientIds.has(ing.id));

  // Wake lock
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    (navigator.wakeLock as { request: (type: string) => Promise<WakeLockSentinel> })
      .request("screen")
      .then((l) => { lock = l; })
      .catch(() => {});
    return () => { lock?.release().catch(() => {}); };
  }, []);

  const goNext = useCallback(() => { if (!isLast) setStepIndex((i) => i + 1); }, [isLast]);
  const goPrev = useCallback(() => { if (!isFirst) setStepIndex((i) => i - 1); }, [isFirst]);

  async function handleDeductIngredients() {
    setDeducting(true);
    try {
      await deductRecipeIngredients(recipe.id, currentServings);
      setDeducted(true);
    } finally {
      setDeducting(false);
    }
  }

  const toggleIngredient = (id: string) => {
    setCheckedIngredients((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") goNext();
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") goPrev();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goNext, goPrev]);

  if (steps.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-muted-foreground">This recipe has no steps yet.</p>
        <Button asChild variant="outline">
          <Link href={`/recipes/${recipe.id}`}>Back to recipe</Link>
        </Button>
      </div>
    );
  }

  const NavButtons = ({ className }: { className?: string }) => (
    <div className={`flex gap-3 ${className ?? ""}`}>
      <Button variant="outline" size="lg" onClick={goPrev} disabled={isFirst} className="flex-1">
        <ChevronLeft className="mr-1.5 h-5 w-5" />
        Previous
      </Button>
      {isLast ? (
        <Button
          size="lg"
          onClick={() => setIsComplete(true)}
          className={`flex-1 ${isComplete ? "bg-green-600 hover:bg-green-700" : ""}`}
        >
          <CheckCircle2 className="mr-1.5 h-5 w-5" />
          {isComplete ? "Finished!" : "Done"}
        </Button>
      ) : (
        <Button size="lg" onClick={goNext} className="flex-1">
          Next
          <ChevronRight className="ml-1.5 h-5 w-5" />
        </Button>
      )}
    </div>
  );

  return (
    <div className="flex flex-col h-dvh overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="shrink-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-center gap-3 px-4 py-3">
          <Button asChild variant="ghost" size="sm" className="-ml-2 shrink-0">
            <Link href={`/recipes/${recipe.id}`}>
              <ChevronLeft className="mr-1 h-4 w-4" />
              <span className="hidden sm:inline">Exit Cooking Mode</span>
              <span className="sm:hidden">Exit</span>
            </Link>
          </Button>

          <div className="flex-1 min-w-0 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Cooking Mode
            </p>
            <h1 className="text-sm font-semibold truncate">{recipe.title}</h1>
          </div>

          <span className="shrink-0 text-sm font-semibold tabular-nums">
            {stepIndex + 1} / {steps.length}
          </span>
        </div>

        {/* Progress bar — tracks current step position */}
        <div className="h-1 bg-border">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
          />
        </div>
      </header>

      {/* ── Body ───────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Main column: scrollable content + pinned desktop nav ─── */}
        <div className="flex flex-col flex-1 min-h-0">

        {/* ── Main content ─────────────────────────────────────────── */}
        <main className="flex-1 min-h-0 overflow-y-auto">
          {/* Recipe image — small strip on mobile, wider banner on desktop */}
          {recipe.imageUrl && (
            <div className="h-20 sm:h-28 lg:h-auto lg:aspect-[21/8] w-full overflow-hidden bg-muted shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={recipe.imageUrl}
                alt={recipe.title}
                className="h-full w-full object-cover"
              />
            </div>
          )}

          <div className="px-4 py-6 lg:px-10 lg:py-10">
            {/* Step dot nav (mobile only) */}
            <div className="mb-8 flex justify-center gap-1 lg:hidden">
              {steps.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setStepIndex(i)}
                  className={`h-1.5 rounded-full transition-all ${
                    i === stepIndex ? "w-6 bg-primary" : "w-1.5 bg-border"
                  }`}
                  aria-label={`Go to step ${i + 1}`}
                />
              ))}
            </div>

            {/* Step number badge + instruction */}
            {currentStep && (
              <div className="flex gap-4 lg:gap-6 mb-6">
                <span className="flex h-10 w-10 lg:h-14 lg:w-14 shrink-0 items-center justify-center rounded-full bg-orange-500 text-white font-bold text-base lg:text-xl">
                  {stepIndex + 1}
                </span>
                <div className="flex-1 min-w-0 pt-1 lg:pt-2">
                  <StepText
                    instruction={currentStep.instruction}
                    ingredients={ingredients}
                    scale={scale}
                  />
                </div>
              </div>
            )}

            {/* Timer */}
            {currentStep?.durationMinutes ? (
              <StepTimer key={stepIndex} durationMinutes={currentStep.durationMinutes} label={currentStep.timerLabel} />
            ) : null}

            {/* Active ingredients — mobile only (sidebar handles desktop) */}
            {stepIngredients.length > 0 && (
              <div className="mt-6 rounded-xl border bg-orange-500/5 border-orange-500/20 p-4 lg:hidden">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-orange-600 dark:text-orange-400">
                  Used in this step
                </p>
                <ul className="space-y-1.5">
                  {stepIngredients.map((ing) => (
                    <li key={ing.id} className="flex items-baseline gap-2 text-sm">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500 mt-[5px]" />
                      <span>
                        {ing.amount && (
                          <span className="font-semibold">
                            {formatAmount(ing.amount, scale)}{ing.unit ? ` ${ing.unit}` : ""}{" "}
                          </span>
                        )}
                        {ing.ingredientName}
                        {ing.preparation && ing.preparation.toLowerCase() !== "none" && (
                          <span className="text-muted-foreground">, {ing.preparation}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* All ingredients collapsed — mobile only */}
            {ingredients.length > 0 && (
              <details className="mt-4 rounded-xl border lg:hidden">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium select-none hover:bg-muted/40 transition-colors">
                  All ingredients ({ingredients.length})
                  {scale !== 1 && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      scaled ×{parseFloat(scale.toFixed(2))}
                    </span>
                  )}
                </summary>
                <ul className="space-y-1.5 px-4 pb-4 pt-2">
                  {ingredients.map((ing) => {
                    const isActive = activeIngredientIds.has(ing.id);
                    return (
                      <li
                        key={ing.id}
                        className={`flex items-baseline gap-2 text-sm transition-colors ${
                          isActive ? "text-foreground font-medium" : "text-muted-foreground"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full mt-[5px] ${
                            isActive ? "bg-orange-500" : "bg-muted-foreground/40"
                          }`}
                        />
                        <span>
                          {ing.amount && (
                            <span className={isActive ? "font-semibold" : "font-medium"}>
                              {formatAmount(ing.amount, scale)}{ing.unit ? ` ${ing.unit}` : ""}{" "}
                            </span>
                          )}
                          {ing.ingredientName}
                          {ing.preparation && ing.preparation.toLowerCase() !== "none" && <span>, {ing.preparation}</span>}
                          {ing.isOptional && <span className="ml-1 text-xs">(optional)</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </details>
            )}

            {/* Done state */}
            {isLast && isComplete && (
              <div className="mt-8 rounded-xl border border-green-500/30 bg-green-500/10 p-6 text-center">
                <p className="text-lg font-semibold text-green-600 dark:text-green-400">
                  All done! Enjoy your meal.
                </p>
                {!deducted ? (
                  <Button
                    className="mt-4 w-full"
                    variant="outline"
                    onClick={handleDeductIngredients}
                    disabled={deducting}
                  >
                    <PackageCheck className="mr-1.5 h-4 w-4" />
                    {deducting ? "Updating pantry…" : "Mark ingredients as used"}
                  </Button>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Pantry stock updated.
                  </p>
                )}
                <Button asChild className="mt-2 w-full" variant="ghost">
                  <Link href={`/recipes/${recipe.id}`}>Back to recipe</Link>
                </Button>
              </div>
            )}

          </div>
        </main>

        {/* ── Desktop nav — pinned at bottom of content column ─────── */}
        <NavButtons className="hidden lg:flex shrink-0 px-10 py-4 border-t bg-background" />

        </div>{/* end main column */}

        {/* ── Sidebar (desktop only) ────────────────────────────────── */}
        <aside className="hidden lg:flex lg:w-[340px] xl:w-[380px] shrink-0 flex-col border-l h-full overflow-hidden">
          {/* Step progress */}
          <div className="shrink-0 px-6 py-5 border-b">
            <div className="flex items-center justify-between mb-2.5">
              <span className="font-semibold text-sm">Step {stepIndex + 1} of {steps.length}</span>
            </div>
            <div className="h-2 rounded-full bg-border overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
              />
            </div>
          </div>

          {/* Scaling */}
          {originalServings && (
            <div className="shrink-0 px-6 py-4 border-b">
              <ScalingControl
                originalServings={recipe.servings}
                servingsUnit={recipe.servingsUnit ?? null}
                currentServings={currentServings}
                onChange={setCurrentServings}
              />
            </div>
          )}

          {/* Ingredients checklist */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Ingredients
              {scale !== 1 && (
                <span className="ml-2 normal-case font-normal">
                  scaled ×{parseFloat(scale.toFixed(2))}
                </span>
              )}
            </p>
            <ul className="space-y-2.5">
              {ingredients.map((ing) => {
                const isActive = activeIngredientIds.has(ing.id);
                const isChecked = checkedIngredients.has(ing.id);
                return (
                  <li
                    key={ing.id}
                    className={`flex items-start gap-3 rounded-lg px-2 py-1.5 -mx-2 transition-colors ${
                      isActive && !isChecked ? "bg-orange-500/10" : ""
                    }`}
                  >
                    <button
                      onClick={() => toggleIngredient(ing.id)}
                      className={`mt-0.5 shrink-0 transition-colors ${
                        isChecked
                          ? "text-green-500"
                          : isActive
                          ? "text-orange-500"
                          : "text-muted-foreground/40 hover:text-muted-foreground"
                      }`}
                      aria-label={isChecked ? `Uncheck ${ing.ingredientName}` : `Check ${ing.ingredientName}`}
                    >
                      <CheckCircle2
                        className={`h-5 w-5 ${isChecked ? "fill-green-500/20" : isActive ? "fill-orange-500/10" : ""}`}
                      />
                    </button>
                    <span
                      className={`text-sm leading-relaxed transition-colors ${
                        isChecked
                          ? "text-muted-foreground/50 line-through"
                          : isActive
                          ? "text-foreground font-medium"
                          : "text-muted-foreground"
                      }`}
                    >
                      {ing.amount && (
                        <span className={isActive && !isChecked ? "font-bold" : "font-medium"}>
                          {formatAmount(ing.amount, scale)}{ing.unit ? ` ${ing.unit}` : ""}{" "}
                        </span>
                      )}
                      {ing.ingredientName}
                      {ing.preparation && ing.preparation.toLowerCase() !== "none" && <span className="font-normal">, {ing.preparation}</span>}
                      {ing.isOptional && <span className="ml-1 text-xs">(optional)</span>}
                    </span>
                    {isActive && !isChecked && (
                      <span className="ml-auto shrink-0 mt-0.5 h-1.5 w-1.5 rounded-full bg-orange-500" />
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Up Next */}
          {!isLast && steps[stepIndex + 1] && (
            <div className="shrink-0 px-6 py-5 border-t bg-muted/30">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Up Next
              </p>
              <p className="text-sm text-muted-foreground line-clamp-3">
                {steps[stepIndex + 1].instruction}
              </p>
              <button
                onClick={goNext}
                className="mt-2 text-xs text-primary hover:underline underline-offset-2"
              >
                Skip ahead →
              </button>
            </div>
          )}
        </aside>
      </div>

      {/* ── Mobile footer nav ───────────────────────────────────────── */}
      <footer className="lg:hidden shrink-0 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <NavButtons className="p-4" />
      </footer>
    </div>
  );
}
