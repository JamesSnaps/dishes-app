"use client";

// What the app shows while the AI works, instead of a spinner and a line of
// text (DESIGN.md → AI at work). Food is the colourful part: the household's
// own recipe photos spin in reels, empty plates steam, a photo develops. Every
// line of text is true — a fact the server sent, or what the person asked for.
// All motion stops under prefers-reduced-motion.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Check, Sparkles } from "lucide-react";
import { Plate, cn } from "@dishes/ui";
import type { MealPlanSlot } from "@/app/actions/ai";
import type { RecipeProgress } from "@/lib/ai/job-types";

const still = "motion-reduce:animate-none";

// ── Plate spinner: the busy state of an AI button ─────────────────────────────

/** Four foods, twice over, so the belt loops without a seam. */
const MINI_FOODS = ["bg-primary", "bg-warning", "bg-success", "bg-plate"];

/** A tiny conveyor of plates. Takes the place of `Loader2` in AI buttons. */
export function PlateSpinner({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("inline-flex h-3 w-10 shrink-0 overflow-hidden", className)}>
      <span className={cn("flex w-max gap-1 pr-1 animate-plate-belt", still)}>
        {[...MINI_FOODS, ...MINI_FOODS].map((food, i) => (
          <span key={i} className="flex size-3 shrink-0 items-center justify-center rounded-full bg-card">
            <span className={cn("size-2 rounded-full", food)} />
          </span>
        ))}
      </span>
    </span>
  );
}

/** Three plates hopping: the AI is writing a reply. */
export function TypingPlates({ className }: { className?: string }) {
  return (
    <span role="status" aria-label="Thinking" className={cn("inline-flex items-center gap-1.5", className)}>
      {MINI_FOODS.slice(0, 3).map((food, i) => (
        <span
          key={food}
          className={cn("flex size-4 items-center justify-center rounded-full bg-muted animate-plate-hop", still)}
          style={{ animationDelay: `${i * 0.15}s` }}
        >
          <span className={cn("size-2.5 rounded-full", food)} />
        </span>
      ))}
    </span>
  );
}

// ── Facts: what the AI is weighing, one line at a time ────────────────────────

/**
 * Cycles through `facts` (the server's, all true). Until they arrive it shows
 * `fallback`, which must be true as well ("Looking through your recipes").
 * The full list is there for screen readers; the cycling line is not.
 */
export function FactTicker({
  facts,
  fallback,
  interval = 3200,
  className,
}: {
  facts: string[];
  fallback: string;
  interval?: number;
  className?: string;
}) {
  const lines = facts.length ? facts : [fallback];
  const [index, setIndex] = useState(0);
  const signature = lines.join("|");
  useEffect(() => {
    setIndex(0);
    if (lines.length < 2) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % lines.length), interval);
    return () => clearInterval(t);
    // `signature` stands for `lines`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, interval]);
  const line = lines[index % lines.length]!;
  return (
    <div className={cn("min-h-5 text-sm text-muted-foreground", className)}>
      <p key={line} aria-hidden="true" className={cn("animate-rise-in", still)}>
        {line}
      </p>
      <ul className="sr-only">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </div>
  );
}

// ── Plates ────────────────────────────────────────────────────────────────────

/** A dish's photo on a round plate; a new idea (no photo yet) gets the sparkle. */
export function DishPlate({
  src,
  alt,
  isNew,
  className,
}: {
  src?: string | null;
  alt: string;
  isNew?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("relative shrink-0", className)}>
      <Plate src={src} alt={alt} className="size-full rounded-full shadow-[0_6px_14px_rgb(70_45_20/0.14)]" />
      {isNew && !src && (
        <Sparkles aria-hidden="true" className="absolute inset-0 m-auto size-[30%] text-foreground" strokeWidth={2} />
      )}
    </div>
  );
}

/**
 * A slot-machine reel of the household's photos inside a round window.
 * `offset` starts each reel on a different photo and phase. With too few
 * photos the gaps are empty plates; with none, a dashed plate breathes.
 */
export function PlateReel({ photos, offset = 0, className }: { photos: string[]; offset?: number; className?: string }) {
  if (!photos.length) {
    return (
      <div
        aria-hidden="true"
        className={cn("rounded-full border-2 border-dashed border-input bg-highlight animate-plate-breathe", still, className)}
        style={{ animationDelay: `${offset * 0.3}s` }}
      />
    );
  }
  const reel: (string | null)[] = [];
  for (let i = 0; i < Math.max(6, Math.min(photos.length, 8)); i++) {
    // Up to 8 per reel; short libraries alternate a photo with an empty plate.
    reel.push(photos.length >= 4 || i % 2 === 0 ? photos[(i + offset * 3) % photos.length]! : null);
  }
  return (
    <div aria-hidden="true" className={cn("relative overflow-hidden rounded-full bg-plate", className)}>
      <div
        className={cn("flex flex-col animate-plate-reel", still)}
        style={{ animationDuration: `${(reel.length * 0.16 + offset * 0.07).toFixed(2)}s`, animationDelay: `-${(offset * 0.21).toFixed(2)}s` }}
      >
        {[...reel, ...reel].map((src, i) =>
          src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={src} alt="" loading="lazy" className="aspect-square w-full shrink-0 object-cover" />
          ) : (
            <Plate key={i} alt="" className="aspect-square w-full shrink-0" />
          )
        )}
      </div>
    </div>
  );
}

/** An empty plate with steam rising: something's cooking that has no photo yet. */
export function SteamPlate({ delay = 0, className }: { delay?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cn("relative shrink-0 rounded-full border-2 border-dashed border-input bg-highlight", className)}>
      <div className="absolute inset-x-0 top-[18%] flex justify-center gap-[6%] text-muted-foreground">
        {[0, 0.7, 1.4].map((d) => (
          <svg
            key={d}
            viewBox="0 0 10 26"
            className={cn("h-[42%] w-auto opacity-0 animate-steam", "motion-reduce:animate-none motion-reduce:opacity-60")}
            style={{ animationDelay: `${(delay + d).toFixed(2)}s` }}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
          >
            <path d="M5 24c-3-4 3-6 0-10s3-6 0-10" />
          </svg>
        ))}
      </div>
    </div>
  );
}

/**
 * A photo being made: the recipe's current photo (or an empty plate) blurs
 * in and out of focus like a print developing.
 */
export function DevelopingPhoto({ src, className }: { src?: string | null; className?: string }) {
  return (
    <div aria-hidden="true" className={cn("relative overflow-hidden bg-plate", className)}>
      <div className={cn("absolute inset-0 animate-develop", "motion-reduce:animate-none motion-reduce:blur-md")}>
        <Plate src={src} alt="" className="size-full" />
      </div>
    </div>
  );
}

/**
 * Laid over a photo that's being replaced (`absolute inset-0` in its frame):
 * the current photo blurs in and out of focus until the new one arrives.
 */
export function DevelopingVeil({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 animate-develop-veil", "motion-reduce:animate-none motion-reduce:backdrop-blur-md", className)}
    />
  );
}

/** A recipe page being read in: its address, dots travelling to a plate that fills. */
export function ReadingLink({ url, className }: { url: string; className?: string }) {
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    // not a full URL yet; show it as typed
  }
  return (
    <div className={cn("flex items-center justify-center gap-2.5", className)} aria-hidden="true">
      <span className="max-w-[12rem] truncate rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground">{host}</span>
      <span className="relative h-2.5 w-11 shrink-0">
        {[0, 0.5, 1].map((d) => (
          <span
            key={d}
            className={cn("absolute left-0 top-0.5 size-1.5 rounded-full bg-foreground opacity-0 animate-dot-travel", "motion-reduce:hidden")}
            style={{ animationDelay: `${d}s` }}
          />
        ))}
      </span>
      <span className="relative size-16 shrink-0 rounded-full bg-card shadow-[0_6px_14px_rgb(70_45_20/0.14)]">
        <span className={cn("absolute inset-[7px] rounded-full bg-plate animate-plate-fill", "motion-reduce:animate-none")} />
      </span>
    </div>
  );
}

/** Two muted lines where text is about to be. */
function Skeleton({ delay = 0 }: { delay?: number }) {
  return (
    <div className={cn("space-y-2 animate-soft-pulse", still)} style={{ animationDelay: `${delay}s` }} aria-hidden="true">
      <div className="h-3 w-3/4 rounded-full bg-border" />
      <div className="h-2.5 w-1/2 rounded-full bg-border" />
    </div>
  );
}

// ── Plan the week: reels that land ────────────────────────────────────────────

const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export type ReelRow = { dayOfWeek: number; mealType: string };
const slotKey = (s: { dayOfWeek: number; mealType: string }) => `${s.dayOfWeek}:${s.mealType}`;

/**
 * Remembers when each item first arrived, so a batch that lands together
 * (one poll's worth) comes down one after another rather than all at once.
 */
function useArrivalDelays(keys: string[], step = 0.25) {
  const delays = useRef(new Map<string, number>());
  let fresh = 0;
  for (const k of keys) if (!delays.current.has(k)) delays.current.set(k, fresh++ * step);
  return (k: string) => delays.current.get(k) ?? 0;
}

/**
 * The week being drafted: a row per slot asked for, each with a reel of the
 * household's photos spinning until the AI writes that meal, when it lands —
 * the library dish's own photo, or an empty plate with the sparkle for a new
 * idea. `slots` are the meals written so far (the job's progress).
 */
export function PlanReels({
  rows,
  photos,
  slots,
  facts,
  className,
}: {
  rows: ReelRow[];
  photos: string[];
  slots: MealPlanSlot[];
  facts: string[];
  className?: string;
}) {
  const landed = new Map(slots.map((s) => [slotKey(s), s]));
  const delayOf = useArrivalDelays(slots.map(slotKey));
  const multiPerDay = new Set(rows.map((r) => r.dayOfWeek)).size < rows.length;
  const done = rows.filter((r) => landed.has(slotKey(r))).length;
  return (
    <section aria-label="Planning your week" className={cn("space-y-3", className)}>
      <div>
        <h3 role="status" className="font-serif text-xl font-semibold">
          {done === 0 ? "Planning your week…" : done < rows.length ? `${done} of ${rows.length} planned…` : "Your week is planned"}
        </h3>
        <FactTicker facts={facts} fallback="Looking through your recipes" className="mt-1" />
      </div>
      <ul className="divide-y divide-border">
        {rows.map((row, i) => {
          const slot = landed.get(slotKey(row));
          const delay = slot ? delayOf(slotKey(row)) : 0;
          return (
            <li key={slotKey(row)} className="flex items-center gap-3 py-3">
              <div className="w-10 shrink-0">
                <p className="text-[13px] font-bold text-primary">{DAY_SHORT[row.dayOfWeek]}</p>
                {multiPerDay && <p className="text-[10px] font-semibold uppercase tracking-[.08em] text-muted-foreground">{row.mealType}</p>}
              </div>
              <div className="relative size-14 shrink-0">
                {slot ? (
                  <div className={cn("animate-plate-land", still)} style={{ animationDelay: `${delay}s` }}>
                    <DishPlate src={slot.imageUrl} alt={slot.title} isNew={!slot.recipeId} className="size-14" />
                  </div>
                ) : (
                  <PlateReel photos={photos} offset={i} className="size-14" />
                )}
              </div>
              <div className="w-0 min-w-0 flex-1">
                {slot ? (
                  <div className={cn("animate-rise-in", still)} style={{ animationDelay: `${delay + 0.08}s` }}>
                    <p className="truncate font-serif text-base font-semibold">{slot.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{slot.description}</p>
                    <span
                      className={cn(
                        "mt-1 inline-block rounded-full px-2 py-0.5 text-[11px]",
                        slot.recipeId ? "border border-border text-muted-foreground" : "bg-secondary"
                      )}
                    >
                      {slot.recipeId ? "From your recipes" : "New idea"}
                    </span>
                  </div>
                ) : (
                  <Skeleton delay={i * 0.2} />
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">Usually 15–30 seconds. Each day lands as soon as it’s chosen.</p>
    </section>
  );
}

// ── Ideas: empty plates that fill as each idea is written ─────────────────────

/**
 * Places for ideas, steaming until they come. Where the server streams them
 * (`ideas` filling up), each takes its place the moment it's written.
 */
export function IdeaPlaces({
  ideas,
  count = 5,
  title = "Thinking up ideas…",
  asked,
  note = "Usually 10–20 seconds.",
  className,
}: {
  ideas: { title: string; description: string; cuisine?: string }[];
  count?: number;
  title?: string;
  /** What the person asked for, shown back to them. */
  asked?: string[];
  /** The line underneath; say ideas arrive one by one only where they do. */
  note?: string;
  className?: string;
}) {
  const delayOf = useArrivalDelays(ideas.map((c) => c.title), 0.2);
  return (
    <section aria-label={title} className={cn("space-y-3", className)}>
      <div>
        <h3 role="status" className="font-serif text-xl font-semibold">
          {ideas.length === 0 ? title : `${Math.min(ideas.length, count)} of ${count} ideas…`}
        </h3>
        {asked && asked.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {asked.map((a) => (
              <span key={a} className="rounded-full bg-secondary px-2.5 py-1 text-xs">{a}</span>
            ))}
          </div>
        )}
      </div>
      <ul className="divide-y divide-border">
        {Array.from({ length: count }, (_, i) => {
          const idea = ideas[i];
          return (
            <li key={i} className="flex items-center gap-3 py-3">
              {idea ? (
                <div className={cn("size-14 animate-plate-land", still)} style={{ animationDelay: `${delayOf(idea.title)}s` }}>
                  <DishPlate alt={idea.title} isNew className="size-14" />
                </div>
              ) : (
                <SteamPlate delay={i * 0.45} className="size-14" />
              )}
              <div className="w-0 min-w-0 flex-1">
                {idea ? (
                  <div className={cn("animate-rise-in", still)} style={{ animationDelay: `${delayOf(idea.title) + 0.08}s` }}>
                    <p className="truncate font-serif text-base font-semibold">{idea.title}</p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{idea.description}</p>
                  </div>
                ) : (
                  <Skeleton delay={i * 0.2} />
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">{note}</p>
    </section>
  );
}

// ── Writing a recipe ──────────────────────────────────────────────────────────

const STAGE_ORDER: RecipeProgress["stage"][] = ["grounding", "ingredients", "method", "nutrition"];

/** How far through a recipe the writing is, 0–1, from the stage it's on. */
export function recipeFraction(p?: RecipeProgress | null): number {
  if (!p) return 0.05;
  switch (p.stage) {
    case "grounding":
      return 0.1;
    case "ingredients":
      return 0.15 + Math.min(p.ingredients.length, 12) * 0.015;
    case "method":
      return 0.4 + Math.min(p.steps, 10) * 0.04;
    case "nutrition":
      return 0.9;
  }
}

/** Where a recipe being written has got, in a few words ("Method · step 3"). */
export function recipeStageLabel(p?: RecipeProgress | null): string {
  if (!p) return "Starting on the ingredients";
  const label =
    p.stage === "grounding"
      ? "Reading real recipes for reference"
      : p.stage === "ingredients"
        ? p.ingredients.length
          ? `Ingredients · ${p.ingredients.length} so far`
          : "Starting on the ingredients"
        : p.stage === "method"
          ? p.steps > 0 ? `Method · step ${p.steps}` : "Starting on the method"
          : "Working out the nutrition";
  return p.revising ? `${label} (second pass, for heart-healthy)` : label;
}

/** A ring round a plate that fills as the recipe is written. */
export function WritingRing({ progress, className }: { progress?: RecipeProgress | null; className?: string }) {
  const c = 2 * Math.PI * 28;
  return (
    <div className={cn("relative size-16 shrink-0", className)} aria-hidden="true">
      <div className="absolute inset-1.5 rounded-full bg-plate" />
      <svg viewBox="0 0 64 64" className="absolute inset-0 -rotate-90">
        <circle cx="32" cy="32" r="28" fill="none" className="stroke-border" strokeWidth="3" />
        <circle
          cx="32"
          cy="32"
          r="28"
          fill="none"
          className="stroke-foreground transition-[stroke-dashoffset] duration-700 ease-out"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - recipeFraction(progress))}
        />
      </svg>
    </div>
  );
}

/** One line of the checklist: done, in progress, or still to come. */
function StageRow({ state, label, children }: { state: "done" | "now" | "later"; label: string; children?: ReactNode }) {
  return (
    <li className="flex gap-3 py-3">
      {state === "done" ? (
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-success-tint text-success">
          <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
        </span>
      ) : state === "now" ? (
        <span className={cn("size-6 shrink-0 rounded-full border-2 border-foreground animate-soft-pulse", still)} aria-hidden="true" />
      ) : (
        <span className="size-6 shrink-0 rounded-full border-2 border-dashed border-input" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1 space-y-2">
        <p className={cn("text-[15px] font-semibold", state === "later" && "text-muted-foreground")}>
          {label}
          <span className="sr-only">{state === "done" ? " (done)" : state === "now" ? " (writing now)" : ""}</span>
        </p>
        {children}
      </div>
    </li>
  );
}

/**
 * A recipe being written: the dish it will be, then ingredients → method →
 * nutrition, ticked off as the AI actually reaches each part (the server
 * streams where it's got to). Ingredients appear by name as they're written.
 */
export function RecipeWriting({
  title,
  description,
  progress,
  className,
}: {
  title: string;
  description?: string;
  progress?: RecipeProgress | null;
  className?: string;
}) {
  const at = progress ? STAGE_ORDER.indexOf(progress.stage) : -1;
  const state = (stage: RecipeProgress["stage"]): "done" | "now" | "later" => {
    const i = STAGE_ORDER.indexOf(stage);
    // Before the first word arrives it's on the ingredients.
    const current = at < 0 ? 1 : at;
    return i < current ? "done" : i === current ? "now" : "later";
  };
  const names = progress?.ingredients ?? [];
  const shown = names.slice(-6);
  return (
    <section aria-label={`Writing ${title}`} className={cn("space-y-4", className)}>
      <div className="flex items-center gap-4">
        <SteamPlate className="size-24" />
        <div className="min-w-0 space-y-1">
          <p className="text-[11px] font-bold uppercase tracking-[.08em] text-muted-foreground">Writing</p>
          <h3 role="status" className="font-serif text-2xl font-semibold leading-tight">{title}</h3>
          {description && <p className="font-serif text-sm italic text-muted-foreground line-clamp-2">{description}</p>}
        </div>
      </div>
      <ul className="divide-y divide-border">
        {progress?.stage === "grounding" && <StageRow state="now" label="Reading real recipes for reference" />}
        <StageRow state={state("ingredients")} label="Ingredients">
          {names.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {shown.map((n, i) => (
                <span key={`${n}-${i}`} className={cn("rounded-full bg-secondary px-2.5 py-1 text-xs animate-rise-in", still)}>
                  {n}
                </span>
              ))}
              {names.length > shown.length && (
                <span className="rounded-full bg-secondary px-2.5 py-1 text-xs">+ {names.length - shown.length}</span>
              )}
            </div>
          )}
        </StageRow>
        <StageRow state={state("method")} label={progress?.stage === "method" && progress.steps > 0 ? `Method · step ${progress.steps}` : "Method"}>
          {progress?.stage === "method" && (
            <div className={cn("space-y-2 animate-soft-pulse", still)} aria-hidden="true">
              <div className="h-2.5 w-11/12 rounded-full bg-input" />
              <div className="h-2.5 w-3/4 rounded-full bg-input" />
            </div>
          )}
        </StageRow>
        <StageRow state={state("nutrition")} label="Nutrition" />
      </ul>
      {progress?.revising && (
        <p className="rounded-xl bg-warning-tint px-3 py-2 text-sm text-warning">
          Second pass: the first draft missed the heart-healthy targets, so it’s being revised.
        </p>
      )}
      <p className="text-xs text-muted-foreground">Usually about a minute.</p>
    </section>
  );
}

// ── Several recipes, written one after another ────────────────────────────────

export type WritingItem = {
  title: string;
  status: "pending" | "generating" | "done" | "error";
  progress?: RecipeProgress;
  collectionName?: string;
  error?: string;
};

/**
 * A batch being written (the job's own per-recipe status): the one in hand
 * has a ring that fills as it reaches each part, the rest wait on an empty
 * plate, and finished ones are ticked.
 */
export function BatchWriting({ items, className }: { items: WritingItem[]; className?: string }) {
  return (
    <ul className={cn("divide-y divide-border", className)}>
      {items.map((item, i) => (
        <li key={i} className="flex items-center gap-3 py-2">
          {item.status === "generating" ? (
            <WritingRing progress={item.progress} />
          ) : item.status === "pending" ? (
            <div className="flex size-16 shrink-0 items-center justify-center" aria-hidden="true">
              <div className="size-[52px] rounded-full border-2 border-dashed border-input" />
            </div>
          ) : (
            <div className="relative flex size-16 shrink-0 items-center justify-center" aria-hidden="true">
              <div className="size-[52px] rounded-full bg-plate" />
              <span
                className={cn(
                  "absolute bottom-1 right-1 flex size-[22px] items-center justify-center rounded-full border-2 border-card text-card",
                  item.status === "done" ? "bg-success" : "bg-destructive"
                )}
              >
                {item.status === "done" ? <Check className="size-3" strokeWidth={3.5} /> : <AlertCircle className="size-3" />}
              </span>
            </div>
          )}
          <div className="w-0 min-w-0 flex-1">
            <p className="font-serif text-[15px] font-semibold leading-tight">{item.title}</p>
            <p className={cn("text-xs", item.status === "error" ? "text-destructive" : "text-muted-foreground")}>
              {item.status === "pending"
                ? "Next"
                : item.status === "generating"
                  ? recipeStageLabel(item.progress)
                  : item.status === "error"
                    ? item.error
                    : item.collectionName
                      ? `Filed in ${item.collectionName}`
                      : "Saved to your recipes"}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
