"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2, Pause, Play, RefreshCw, Share2, Sparkles, X } from "lucide-react";
import { generateWrappedRecap } from "@/app/actions/ai";
import { cn } from "@dishes/ui";
import type { WrappedReport } from "@/lib/services/wrapped";

const SLIDE_MS = 7000;

type Slide = {
  id: string;
  /** Tailwind background for the slide. */
  bg: string;
  /** Colour of the two drifting blobs behind the content. */
  blobs: [string, string];
  /** Which share card (see /api/wrapped/card) this slide shares, if any. */
  card?: string;
  body: ReactNode;
};

const n = (v: number) => v.toLocaleString("en-GB");

/** Staggered entrance: each child rises in a beat after the last. */
function Rise({ i = 0, className, children }: { i?: number; className?: string; children: ReactNode }) {
  return (
    <div className={cn("animate-wrapped-rise", className)} style={{ animationDelay: `${150 + i * 350}ms` }}>
      {children}
    </div>
  );
}

function Kicker({ children }: { children: ReactNode }) {
  return <p className="text-lg font-semibold uppercase tracking-[0.2em] opacity-80">{children}</p>;
}

function Huge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("animate-wrapped-pop text-7xl font-black leading-none tracking-tight sm:text-8xl", className)} style={{ animationDelay: "500ms" }}>
      {children}
    </p>
  );
}

function RankList({ items, dark }: { items: { name: string; sub: string }[]; dark?: boolean }) {
  return (
    <ol className="space-y-3">
      {items.map((item, i) => (
        <Rise key={item.name + i} i={i + 1}>
          <li className={cn("flex items-center gap-4 rounded-2xl px-4 py-3 shadow-lg", dark ? "bg-black/25" : "bg-white/15")}>
            <span className="w-8 text-3xl font-black tabular-nums">{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-lg font-bold">{item.name}</span>
              <span className="block text-sm opacity-75">{item.sub}</span>
            </span>
          </li>
        </Rise>
      ))}
    </ol>
  );
}

type RecapState = {
  text: string | null;
  loading: boolean;
  error: string | null;
  available: boolean;
  generate: (regenerate?: boolean) => void;
};

function buildSlides(r: WrappedReport, recap: RecapState): Slide[] {
  const t = r.totals;
  const so = r.inProgress ? " so far" : "";
  const slides: Slide[] = [];

  slides.push({
    id: "intro",
    bg: "bg-gradient-to-br from-fuchsia-600 via-rose-500 to-orange-400",
    blobs: ["bg-yellow-300", "bg-purple-700"],
    card: "summary",
    body: (
      <>
        <Rise><Kicker>{r.householdName}</Kicker></Rise>
        <Rise i={1}>
          <h1 className="mt-4 text-6xl font-black leading-[0.95] tracking-tight sm:text-7xl">
            Your {r.year}
            <br />
            in Dishes
          </h1>
        </Rise>
        <Rise i={2}>
          <p className="mt-6 text-xl font-medium opacity-90">
            {r.inProgress ? "The year isn't over yet — here's the story so far." : "Grab a snack. Let's relive it."}
          </p>
        </Rise>
      </>
    ),
  });

  slides.push({
    id: "meals",
    bg: "bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-600",
    blobs: ["bg-lime-300", "bg-blue-700"],
    card: "meals",
    body: (
      <>
        <Rise><Kicker>This year{so} you sat down to</Kicker></Rise>
        <Huge className="mt-6">{n(t.meals)}</Huge>
        <Rise i={2}><p className="mt-3 text-3xl font-bold">meals</p></Rise>
        <Rise i={3}>
          <p className="mt-8 text-xl font-medium opacity-90">
            That&rsquo;s {n(t.daysCooked)} days with something good on the table.
          </p>
        </Rise>
      </>
    ),
  });

  slides.push({
    id: "variety",
    bg: "bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-800",
    blobs: ["bg-pink-400", "bg-sky-400"],
    body: (
      <>
        <Rise><Kicker>You cooked up</Kicker></Rise>
        <Huge className="mt-6">{n(t.distinctRecipes)}</Huge>
        <Rise i={2}><p className="mt-3 text-3xl font-bold">different recipes</p></Rise>
        {t.newRecipes > 0 && (
          <Rise i={3}>
            <p className="mt-8 inline-block rounded-full bg-yellow-300 px-5 py-2 text-xl font-black text-purple-900 shadow-xl">
              {n(t.newRecipes)} brand new to you ✨
            </p>
          </Rise>
        )}
      </>
    ),
  });

  const topMeal = r.topRecipes[0];
  if (topMeal) {
    slides.push({
      id: "top-meal",
      bg: "bg-gradient-to-br from-amber-400 via-orange-500 to-red-600",
      blobs: ["bg-yellow-200", "bg-rose-700"],
      card: "top-meal",
      body: (
        <>
          <Rise><Kicker>Your top dish of {r.year}</Kicker></Rise>
          {topMeal.imageUrl && (
            <div className="animate-wrapped-pop mx-auto mt-6 w-48 sm:w-56" style={{ animationDelay: "400ms" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={topMeal.imageUrl} alt="" className="aspect-square w-full rotate-[-3deg] rounded-3xl object-cover shadow-2xl ring-8 ring-white/30" />
            </div>
          )}
          <Rise i={2}>
            <h2 className="mt-6 text-5xl font-black leading-tight tracking-tight">{topMeal.title}</h2>
          </Rise>
          <Rise i={3}>
            <p className="mt-4 text-xl font-semibold opacity-90">
              On the menu {n(topMeal.count)} {topMeal.count === 1 ? "time" : "times"}. A true classic.
            </p>
          </Rise>
        </>
      ),
    });
  }

  if (r.topRecipes.length > 1) {
    slides.push({
      id: "top-five",
      bg: "bg-gradient-to-b from-zinc-900 via-zinc-900 to-emerald-900",
      blobs: ["bg-emerald-500", "bg-lime-400"],
      card: "top-five",
      body: (
        <>
          <Rise><Kicker>Your top {r.topRecipes.length} on repeat</Kicker></Rise>
          <div className="mt-6 text-left">
            <RankList items={r.topRecipes.map((x) => ({ name: x.title, sub: `${x.count} ${x.count === 1 ? "time" : "times"}` }))} />
          </div>
        </>
      ),
    });
  }

  const topIng = r.topIngredients[0];
  if (topIng) {
    slides.push({
      id: "ingredient",
      bg: "bg-gradient-to-br from-lime-400 via-green-500 to-emerald-700",
      blobs: ["bg-yellow-300", "bg-teal-800"],
      card: "ingredient",
      body: (
        <>
          <Rise><Kicker>Your MVP ingredient</Kicker></Rise>
          <Huge className="mt-6 break-words text-6xl sm:text-7xl">{topIng.name}</Huge>
          <Rise i={2}>
            <p className="mt-4 text-xl font-semibold">Showed up in {n(topIng.count)} meals.</p>
          </Rise>
          {r.topIngredients.length > 1 && (
            <Rise i={3}>
              <div className="mt-8 flex flex-wrap justify-center gap-2">
                {r.topIngredients.slice(1).map((x) => (
                  <span key={x.name} className="rounded-full bg-black/25 px-4 py-1.5 text-base font-bold shadow">
                    {x.name} · {x.count}
                  </span>
                ))}
              </div>
            </Rise>
          )}
        </>
      ),
    });
  }

  const topCuisine = r.topCuisines[0];
  if (topCuisine) {
    slides.push({
      id: "cuisine",
      bg: "bg-gradient-to-br from-sky-500 via-blue-600 to-indigo-700",
      blobs: ["bg-cyan-300", "bg-fuchsia-500"],
      card: "cuisine",
      body: (
        <>
          <Rise><Kicker>You travelled to {t.cuisines} {t.cuisines === 1 ? "cuisine" : "cuisines"}</Kicker></Rise>
          <Rise i={1}><p className="mt-8 text-2xl font-semibold opacity-90">but your heart belongs to</p></Rise>
          <Huge className="mt-4 break-words text-6xl sm:text-7xl">{topCuisine.name}</Huge>
          <Rise i={3}>
            <p className="mt-4 text-xl font-semibold">{n(topCuisine.count)} meals 🌍</p>
          </Rise>
        </>
      ),
    });
  }

  if (r.busiestMonth) {
    const max = Math.max(1, ...r.months);
    slides.push({
      id: "rhythm",
      bg: "bg-gradient-to-br from-pink-500 via-rose-500 to-fuchsia-700",
      blobs: ["bg-orange-300", "bg-violet-700"],
      body: (
        <>
          <Rise><Kicker>Your busiest month</Kicker></Rise>
          <Huge className="mt-4 text-6xl sm:text-7xl">{r.busiestMonth.name}</Huge>
          <Rise i={2}>
            <div className="mx-auto mt-8 flex h-32 max-w-sm items-end gap-1.5" aria-hidden>
              {r.months.map((v, i) => (
                <div key={i} className="flex h-full flex-1 flex-col items-center gap-1">
                  <div className="relative w-full flex-1">
                    <div
                      className={cn("absolute inset-x-0 bottom-0 rounded-t-md", v === r.busiestMonth!.count ? "bg-yellow-300" : "bg-white/40")}
                      style={{ height: `${Math.max(4, (v / max) * 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-bold opacity-80">{"JFMAMJJASOND"[i]}</span>
                </div>
              ))}
            </div>
          </Rise>
          <Rise i={3}>
            <div className="mt-8 grid grid-cols-2 gap-3 text-left">
              {r.favouriteDay && (
                <div className="rounded-2xl bg-black/20 p-4 shadow-lg">
                  <p className="text-sm font-semibold opacity-80">Favourite day</p>
                  <p className="text-2xl font-black">{r.favouriteDay.name}s</p>
                </div>
              )}
              <div className="rounded-2xl bg-black/20 p-4 shadow-lg">
                <p className="text-sm font-semibold opacity-80">Longest streak</p>
                <p className="text-2xl font-black">{r.longestStreak} days 🔥</p>
              </div>
            </div>
          </Rise>
        </>
      ),
    });
  }

  const kitchen: { label: string; value: string }[] = [];
  if (t.minutesCooking > 0) kitchen.push({ label: "Hours at the stove", value: n(Math.round(t.minutesCooking / 60)) });
  if (t.cooksLogged > 0) kitchen.push({ label: "Cooks logged", value: n(t.cooksLogged) });
  if (t.photos > 0) kitchen.push({ label: "Food photos", value: n(t.photos) });
  if (t.recipesAdded > 0) kitchen.push({ label: "Recipes added", value: n(t.recipesAdded) });
  if (t.aiRecipesAdded > 0) kitchen.push({ label: "Dreamt up with AI", value: n(t.aiRecipesAdded) });
  if (r.topProtein) kitchen.push({ label: `Top protein`, value: r.topProtein.name });
  if (kitchen.length >= 2 || r.highestRated) {
    slides.push({
      id: "kitchen",
      bg: "bg-gradient-to-br from-yellow-300 via-amber-400 to-orange-500",
      blobs: ["bg-white", "bg-red-500"],
      body: (
        <div className="text-zinc-900">
          <Rise><Kicker>Behind the scenes</Kicker></Rise>
          <div className="mt-6 grid grid-cols-2 gap-3 text-left">
            {kitchen.slice(0, 6).map((k, i) => (
              <Rise key={k.label} i={i + 1}>
                <div className="h-full rounded-2xl bg-white/50 p-4 shadow-lg">
                  <p className="text-sm font-semibold opacity-70">{k.label}</p>
                  <p className="break-words text-2xl font-black">{k.value}</p>
                </div>
              </Rise>
            ))}
          </div>
          {r.highestRated && (
            <Rise i={kitchen.length + 1}>
              <div className="mt-4 rounded-2xl bg-zinc-900 p-4 text-left text-white shadow-xl">
                <p className="text-sm font-semibold text-yellow-300">Highest rated ★ {r.highestRated.rating}</p>
                <p className="text-xl font-black">{r.highestRated.title}</p>
              </div>
            </Rise>
          )}
          {r.topContributor && (
            <Rise i={kitchen.length + 2}>
              <p className="mt-4 text-lg font-bold">
                👩‍🍳 {r.topContributor.name} added the most recipes ({r.topContributor.count})
              </p>
            </Rise>
          )}
        </div>
      ),
    });
  }

  const eaters = r.people.filter((p) => p.meals > 0 && p.topRecipe);
  if (eaters.length > 1) {
    slides.push({
      id: "people",
      bg: "bg-gradient-to-b from-indigo-900 via-purple-900 to-fuchsia-800",
      blobs: ["bg-fuchsia-500", "bg-cyan-400"],
      body: (
        <>
          <Rise><Kicker>Everyone&rsquo;s favourite</Kicker></Rise>
          <div className="mt-6 space-y-3 text-left">
            {eaters.slice(0, 6).map((p, i) => (
              <Rise key={p.name} i={i + 1}>
                <div className="rounded-2xl bg-white/10 px-4 py-3 shadow-lg">
                  <p className="text-sm font-bold uppercase tracking-wider text-fuchsia-300">{p.name}</p>
                  <p className="truncate text-xl font-black">{p.topRecipe}</p>
                  <p className="text-sm opacity-75">
                    {p.topRecipeBasis === "rated" ? `Their top rating · ★ ${p.topRecipeRating}` : "Their most eaten"}
                    {p.topCuisine && ` · mostly ${p.topCuisine}`}
                  </p>
                </div>
              </Rise>
            ))}
          </div>
        </>
      ),
    });
  }

  if (r.disagreement || r.critics) {
    const d = r.disagreement;
    slides.push({
      id: "disagreement",
      bg: "bg-gradient-to-br from-red-500 via-orange-500 to-yellow-400",
      blobs: ["bg-pink-500", "bg-yellow-200"],
      card: d ? "disagreement" : undefined,
      body: (
        <>
          {d && (
            <>
              <Rise><Kicker>Biggest disagreement</Kicker></Rise>
              <Rise i={1}><h2 className="mt-4 text-4xl font-black leading-tight tracking-tight">{d.recipe}</h2></Rise>
              <div className="mt-8 grid grid-cols-2 gap-3">
                <div className="animate-wrapped-pop rounded-3xl bg-white/25 p-4 shadow-xl" style={{ animationDelay: "700ms" }}>
                  <p className="text-5xl font-black">★{d.high.rating}</p>
                  <p className="mt-1 truncate text-lg font-bold">{d.high.name}</p>
                  <p className="text-sm opacity-80">loved it</p>
                </div>
                <div className="animate-wrapped-pop rounded-3xl bg-black/25 p-4 shadow-xl" style={{ animationDelay: "1000ms" }}>
                  <p className="text-5xl font-black">★{d.low.rating}</p>
                  <p className="mt-1 truncate text-lg font-bold">{d.low.name}</p>
                  <p className="text-sm opacity-80">…not so much</p>
                </div>
              </div>
            </>
          )}
          {r.critics && (
            <Rise i={4}>
              <div className={cn("space-y-2 text-left", d ? "mt-8" : "")}>
                {!d && <Kicker>The critics</Kicker>}
                <p className="rounded-2xl bg-black/20 px-4 py-3 text-lg font-bold shadow-lg">
                  🧐 Harshest critic: {r.critics.harshest.name} <span className="opacity-80">(avg ★{r.critics.harshest.avg})</span>
                </p>
                <p className="rounded-2xl bg-white/20 px-4 py-3 text-lg font-bold shadow-lg">
                  😋 Easiest to please: {r.critics.easiest.name} <span className="opacity-80">(avg ★{r.critics.easiest.avg})</span>
                </p>
              </div>
            </Rise>
          )}
        </>
      ),
    });
  }

  if (r.photos.length >= 4) {
    slides.push({
      id: "photos",
      bg: "bg-gradient-to-br from-zinc-900 via-rose-950 to-zinc-900",
      blobs: ["bg-rose-500", "bg-amber-400"],
      body: (
        <>
          <Rise><Kicker>{n(r.totals.photos)} food {r.totals.photos === 1 ? "photo" : "photos"} this year</Kicker></Rise>
          <div className="mt-6 grid grid-cols-3 gap-2">
            {r.photos.map((p, i) => (
              <div
                key={p.url}
                className="animate-wrapped-pop overflow-hidden rounded-xl shadow-xl ring-2 ring-white/20"
                style={{ animationDelay: `${300 + i * 120}ms`, transform: `rotate(${((i * 37) % 7) - 3}deg)` }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.recipe} className="aspect-square w-full object-cover" />
              </div>
            ))}
          </div>
        </>
      ),
    });
  }

  if (r.photoOfYear) {
    const p = r.photoOfYear;
    slides.push({
      id: "photo-of-year",
      bg: "bg-gradient-to-br from-amber-300 via-rose-400 to-fuchsia-600",
      blobs: ["bg-yellow-100", "bg-purple-700"],
      card: "photo",
      body: (
        <>
          <Rise><Kicker>Photo of the year 📸</Kicker></Rise>
          <div className="animate-wrapped-pop mx-auto mt-6 w-64 rotate-2 rounded-2xl bg-white p-3 pb-10 shadow-2xl sm:w-72" style={{ animationDelay: "400ms" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt={p.recipe} className="aspect-square w-full rounded-lg object-cover" />
            <p className="mt-3 truncate text-center text-lg font-black text-zinc-800">{p.recipe}</p>
          </div>
          {p.rating != null && (
            <Rise i={3}><p className="mt-6 text-xl font-bold">Rated ★ {p.rating} — looked as good as it tasted.</p></Rise>
          )}
        </>
      ),
    });
  }

  if (r.quote) {
    slides.push({
      id: "quote",
      bg: "bg-gradient-to-br from-teal-400 via-cyan-500 to-blue-600",
      blobs: ["bg-lime-200", "bg-indigo-700"],
      body: (
        <>
          <Rise><Kicker>In your own words</Kicker></Rise>
          <Rise i={1}>
            <blockquote className="mt-6 text-3xl font-black leading-snug tracking-tight sm:text-4xl">
              &ldquo;{r.quote.text}&rdquo;
            </blockquote>
          </Rise>
          <Rise i={2}><p className="mt-6 text-lg font-semibold opacity-90">— on {r.quote.recipe}</p></Rise>
        </>
      ),
    });
  }

  if (recap.available && (r.notesCount >= 3 || recap.text)) {
    slides.push({
      id: "recap",
      bg: "bg-gradient-to-br from-violet-700 via-fuchsia-600 to-pink-500",
      blobs: ["bg-cyan-300", "bg-yellow-300"],
      card: recap.text ? "recap" : undefined,
      body: (
        <>
          <Rise><Kicker>Your year, as told by your reviews</Kicker></Rise>
          {recap.text ? (
            <>
              {/* Above the tap zones, and scrolls on its own if it runs long */}
              <Rise i={1} className="relative z-20">
                <p className="mt-6 max-h-[50dvh] overflow-y-auto whitespace-pre-line rounded-3xl bg-black/20 p-5 text-left text-lg font-semibold leading-relaxed shadow-xl">
                  {recap.text}
                </p>
              </Rise>
              <Rise i={2} className="relative z-20">
                <button
                  type="button"
                  onClick={() => recap.generate(true)}
                  disabled={recap.loading}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-4 py-1.5 text-sm font-bold shadow"
                >
                  <RefreshCw className={cn("h-4 w-4", recap.loading && "animate-spin")} />
                  Rewrite it
                </button>
              </Rise>
            </>
          ) : (
            <>
              <Rise i={1}>
                <p className="mt-6 text-xl font-medium opacity-90">
                  You left {n(r.notesCount)} notes on your cooks this year. Want the AI to turn them into your story?
                </p>
              </Rise>
              <Rise i={2} className="relative z-20">
                <button
                  type="button"
                  onClick={() => recap.generate()}
                  disabled={recap.loading}
                  className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-lg font-black text-fuchsia-700 shadow-2xl transition-transform hover:scale-105 active:scale-95 disabled:opacity-80"
                >
                  {recap.loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
                  {recap.loading ? "Writing…" : "Write our story"}
                </button>
              </Rise>
            </>
          )}
          {recap.error && <p className="mt-3 text-sm font-semibold">{recap.error}</p>}
        </>
      ),
    });
  }

  slides.push({
    id: "personality",
    bg: "bg-gradient-to-br from-rose-500 via-fuchsia-600 to-violet-700",
    blobs: ["bg-yellow-300", "bg-sky-400"],
    card: "personality",
    body: (
      <>
        <Rise><Kicker>Your {r.year} cooking personality</Kicker></Rise>
        <p className="animate-wrapped-pop mt-8 text-8xl" style={{ animationDelay: "500ms" }}>{r.personality.emoji}</p>
        <Rise i={2}><h2 className="mt-4 text-5xl font-black tracking-tight">{r.personality.title}</h2></Rise>
        <Rise i={3}><p className="mt-4 text-xl font-medium opacity-90">{r.personality.blurb}</p></Rise>
      </>
    ),
  });

  slides.push({
    id: "summary",
    bg: "bg-zinc-950",
    blobs: ["bg-rose-500", "bg-emerald-500"],
    card: "summary",
    body: <SummaryCard r={r} />,
  });

  return slides;
}

function SummaryCard({ r }: { r: WrappedReport }) {
  const t = r.totals;
  return (
    <Rise>
      <div className="rounded-3xl bg-gradient-to-br from-fuchsia-600 via-rose-500 to-orange-400 p-6 text-left shadow-2xl">
        <p className="text-sm font-bold uppercase tracking-[0.2em] opacity-80">Dishes Wrapped</p>
        <p className="text-3xl font-black">
          {r.householdName} · {r.year}
        </p>
        <div className="mt-5 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-bold uppercase opacity-75">Top dishes</p>
            <ol className="mt-1 space-y-0.5 text-sm font-semibold">
              {r.topRecipes.slice(0, 5).map((x, i) => (
                <li key={x.id} className="truncate">{i + 1}. {x.title}</li>
              ))}
            </ol>
          </div>
          <div>
            <p className="text-xs font-bold uppercase opacity-75">Top ingredients</p>
            <ol className="mt-1 space-y-0.5 text-sm font-semibold">
              {r.topIngredients.slice(0, 5).map((x, i) => (
                <li key={x.name} className="truncate">{i + 1}. {x.name}</li>
              ))}
            </ol>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2">
          {[
            { label: "Meals", value: n(t.meals) },
            { label: "Recipes", value: n(t.distinctRecipes) },
            { label: "Cuisines", value: n(t.cuisines) },
          ].map((s) => (
            <div key={s.label} className="rounded-xl bg-black/20 px-3 py-2">
              <p className="text-2xl font-black">{s.value}</p>
              <p className="text-xs font-bold uppercase opacity-75">{s.label}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-lg font-black">
          {r.personality.emoji} {r.personality.title}
        </p>
      </div>
    </Rise>
  );
}

async function shareCard(year: number, card: string, householdName: string) {
  const res = await fetch(`/api/wrapped/card?year=${year}&card=${card}`);
  if (!res.ok) throw new Error("Couldn't make the image");
  const blob = await res.blob();
  const file = new File([blob], `dishes-wrapped-${year}-${card}.png`, { type: "image/png" });
  const text = `${householdName}'s ${year} in Dishes 🍽️`;
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Dishes Wrapped", text });
    } catch (e) {
      if ((e as Error).name !== "AbortError") throw e;
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(url);
}

export function WrappedStory({
  report,
  initialRecap,
  aiAvailable,
}: {
  report: WrappedReport;
  initialRecap: string | null;
  aiAvailable: boolean;
}) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);
  const [recapText, setRecapText] = useState(initialRecap);
  const [recapLoading, setRecapLoading] = useState(false);
  const [recapError, setRecapError] = useState<string | null>(null);
  const generateRecap = useCallback(
    async (regenerate = false) => {
      setPaused(true);
      setRecapLoading(true);
      setRecapError(null);
      const res = await generateWrappedRecap(report.year, regenerate);
      if (res.recap) setRecapText(res.recap);
      else setRecapError(res.error ?? "Couldn't write it this time.");
      setRecapLoading(false);
    },
    [report.year]
  );
  const slides = useMemo(
    () =>
      buildSlides(report, {
        text: recapText,
        loading: recapLoading,
        error: recapError,
        available: aiAvailable,
        generate: generateRecap,
      }),
    [report, recapText, recapLoading, recapError, aiAvailable, generateRecap]
  );
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const last = slides.length - 1;
  const slide = slides[index]!;
  const stopped = paused || held || index === last;

  const go = useCallback((delta: number) => setIndex((i) => Math.min(last, Math.max(0, i + delta))), [last]);

  // Time left on the current slide, so pausing and resuming picks up where the
  // (paused) progress bar left off rather than starting the clock again.
  const remaining = useRef(SLIDE_MS);
  useEffect(() => {
    remaining.current = SLIDE_MS;
  }, [index]);
  useEffect(() => {
    if (stopped) return;
    const started = Date.now();
    const timer = setTimeout(() => go(1), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [index, stopped, go]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === " ") {
        e.preventDefault();
        setPaused((p) => !p);
      } else if (e.key === "Escape") router.push("/stats");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, router]);

  async function onShare() {
    if (!slide.card) return;
    setSharing(true);
    setShareError(null);
    setPaused(true);
    try {
      await shareCard(report.year, slide.card, report.householdName);
    } catch (e) {
      setShareError((e as Error).message);
    } finally {
      setSharing(false);
    }
  }

  if (report.totals.meals === 0) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-gradient-to-br from-fuchsia-600 via-rose-500 to-orange-400 p-8 text-center text-white">
        <p className="text-6xl">🍽️</p>
        <h1 className="text-4xl font-black">No meals in {report.year} yet</h1>
        <p className="max-w-sm text-lg opacity-90">
          Plan some meals or log a cook, and your Wrapped will fill up as the year goes on.
        </p>
        <Link href="/meal-plan" className="rounded-full bg-white px-6 py-3 font-bold text-rose-600 shadow-xl">
          Go to the meal planner
        </Link>
      </div>
    );
  }

  return (
    <div className={cn("fixed inset-0 z-50 overflow-hidden text-white transition-colors duration-700", slide.bg)}>
      {/* Drifting colour blobs */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className={cn("animate-wrapped-blob absolute -left-24 top-10 h-80 w-80 rounded-full opacity-50 blur-3xl", slide.blobs[0])} />
        <div
          className={cn("animate-wrapped-blob absolute -bottom-24 -right-20 h-96 w-96 rounded-full opacity-40 blur-3xl", slide.blobs[1])}
          style={{ animationDelay: "-6s" }}
        />
      </div>

      <div className="relative mx-auto flex h-full max-w-md flex-col px-4 pb-6 pt-[max(env(safe-area-inset-top),0.75rem)]">
        {/* Progress bars */}
        <div className="flex gap-1">
          {slides.map((s, i) => (
            <div key={s.id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/30">
              {i < index && <div className="h-full w-full bg-white" />}
              {i === index && (
                <div
                  key={`${s.id}-${index}`}
                  className="animate-wrapped-progress h-full w-full origin-left bg-white"
                  style={{
                    animationDuration: `${SLIDE_MS}ms`,
                    animationPlayState: stopped ? "paused" : "running",
                    ...(i === last ? { animation: "none" } : {}),
                  }}
                />
              )}
            </div>
          ))}
        </div>

        {/* Top bar */}
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-black tracking-wide">Dishes Wrapped</span>
            {report.years.length > 1 && (
              <select
                value={report.year}
                onChange={(e) => router.push(`/wrapped?year=${e.target.value}`)}
                className="rounded-full bg-white/20 px-2 py-0.5 text-sm font-bold text-white outline-none [&>option]:text-black"
                aria-label="Year"
              >
                {report.years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              className="rounded-full p-2 hover:bg-white/15"
              aria-label={paused ? "Play" : "Pause"}
            >
              {paused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
            </button>
            <Link href="/stats" className="rounded-full p-2 hover:bg-white/15" aria-label="Close">
              <X className="h-5 w-5" />
            </Link>
          </div>
        </div>

        {/* Slide — tap left/right thirds to step, hold to pause */}
        <div
          className="relative flex flex-1 select-none flex-col justify-center text-center"
          onPointerDown={() => setHeld(true)}
          onPointerUp={() => setHeld(false)}
          onPointerLeave={() => setHeld(false)}
          onPointerCancel={() => setHeld(false)}
        >
          <div key={slide.id} className="relative">{slide.body}</div>
          <button type="button" aria-label="Previous" onClick={() => go(-1)} className="absolute inset-y-0 left-0 z-10 w-1/3" />
          <button type="button" aria-label="Next" onClick={() => go(1)} className="absolute inset-y-0 right-0 z-10 w-1/3" />
        </div>

        {/* Bottom actions */}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={index === 0}
            className="rounded-full bg-white/20 p-3 shadow-lg backdrop-blur disabled:opacity-30"
            aria-label="Previous slide"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          {slide.card ? (
            <button
              type="button"
              onClick={onShare}
              disabled={sharing}
              className="flex items-center gap-2 rounded-full bg-white px-6 py-3 font-black text-zinc-900 shadow-xl transition-transform hover:scale-105 active:scale-95 disabled:opacity-70"
            >
              {sharing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Share2 className="h-5 w-5" />}
              Share this
            </button>
          ) : index === last ? null : (
            <span />
          )}
          {index === last ? (
            <button
              type="button"
              onClick={() => setIndex(0)}
              className="rounded-full bg-white/20 px-4 py-3 text-sm font-bold shadow-lg backdrop-blur"
            >
              Replay
            </button>
          ) : (
            <button
              type="button"
              onClick={() => go(1)}
              className="rounded-full bg-white/20 p-3 shadow-lg backdrop-blur"
              aria-label="Next slide"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          )}
        </div>
        {shareError && <p className="mt-2 text-center text-sm font-semibold">{shareError}</p>}
      </div>
    </div>
  );
}
