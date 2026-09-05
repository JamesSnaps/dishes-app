"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Caveat } from "next/font/google";
import { Shuffle, X, ExternalLink, LayoutGrid, Images } from "lucide-react";
import Link from "next/link";

const caveat = Caveat({ subsets: ["latin"], variable: "--font-caveat", display: "swap" });

export interface MemoryPhoto {
  id: string;
  photoUrl: string;
  recipeName: string;
  recipeId: string;
  cookedAt: string;
  rating: number | null;
  notes: string | null;
  occasion: string | null;
  cookedFor: string[] | null;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function getTilt(id: string, index: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  h ^= index * 2654435761;
  // Range ≈ ±3.5° — enough tilt to feel hand-placed without throwing the
  // corners of a tall polaroid card past the page edge.
  return ((Math.abs(h) % 111) - 55) * 0.064;
}

function relDate(iso: string): string {
  const d = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d} days ago`;
  if (d < 14) return "Last week";
  if (d < 30) return `${Math.floor(d / 7)} weeks ago`;
  if (d < 365) return `${Math.floor(d / 30)} months ago`;
  return new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

function fullDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

function stars(rating: number): string {
  const n = Math.round(rating / 2);
  return "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));
}

interface Props {
  photos: MemoryPhoto[];
}

export function MemoryWall({ photos }: Props) {
  const [items, setItems] = useState<MemoryPhoto[]>([]);
  const [fading, setFading] = useState(false);
  const [active, setActive] = useState<MemoryPhoto | null>(null);
  const [columnCount, setColumnCount] = useState(3);
  const [view, setView] = useState<"wall" | "grid">("wall");

  useEffect(() => {
    setItems(shuffle(photos));
  }, [photos]);

  // Remember the chosen view between visits.
  useEffect(() => {
    const saved = window.localStorage.getItem("memories:view");
    if (saved === "wall" || saved === "grid") setView(saved);
  }, []);

  const chooseView = useCallback((v: "wall" | "grid") => {
    setView(v);
    window.localStorage.setItem("memories:view", v);
  }, []);

  // Column count for the sm+ polaroid masonry. Below 640px the wall is swapped
  // for a full-bleed feed via CSS (see below), so this only covers sm and up —
  // two columns of polaroid on a phone leaves each photo about 150px wide, and
  // the frame, caption block and tilt padding eat most of that.
  useEffect(() => {
    const update = () => {
      setColumnCount(window.innerWidth >= 1280 ? 4 : 3);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Each photo's width/height, measured once by preloading it. The wall can't
  // lay out rows without knowing the shapes, and knowing them also means every
  // photo's box is the right size before the image arrives, so nothing jumps.
  const [ratios, setRatios] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      photos.map(
        p =>
          new Promise<[string, number]>(resolve => {
            const img = new window.Image();
            img.onload = () =>
              resolve([p.id, img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1]);
            // A broken photo still needs a box, or the row maths skips it.
            img.onerror = () => resolve([p.id, 1]);
            img.src = p.photoUrl;
          })
      )
    ).then(pairs => {
      if (!cancelled) setRatios(Object.fromEntries(pairs));
    });
    return () => { cancelled = true; };
  }, [photos]);

  // The wall needs its own width to do the row maths; columns-of-fixed-width
  // would put us back to cropping.
  const wallRef = useRef<HTMLDivElement>(null);
  const [wallWidth, setWallWidth] = useState(0);
  // Keyed on items.length, not []: the component early-returns an empty state
  // on the first render, so the wrapper this observes doesn't exist yet and a
  // run-once effect would attach to nothing and never retry.
  useEffect(() => {
    const el = wallRef.current;
    if (!el) return;
    // Seed synchronously so the first paint with photos already has a width.
    setWallWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w) setWallWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [items.length]);

  // Justified rows, the way a photo wall is normally built: fill a row with
  // photos at their own aspect ratios until they exceed the target height,
  // then scale the row to fit the width exactly. Every row is flush on both
  // edges and no photo is cropped — the two things a square grid can't do at
  // once. Only the last row is left short, which reads as deliberate.
  const WALL_GAP = 4;
  const targetRowHeight = wallWidth < 640 ? 150 : wallWidth < 1024 ? 200 : 240;
  // A run of portraits fills a row's width very slowly, so the target height
  // alone would happily line up seven slivers. The cap closes the row early;
  // because a shorter row is always a taller one, it only makes photos bigger.
  const maxPerRow = wallWidth < 640 ? 3 : wallWidth < 1024 ? 4 : 5;
  const wallRows: { photos: MemoryPhoto[]; height: number }[] = [];
  if (wallWidth > 0) {
    const rowHeight = (count: number, sum: number) =>
      (wallWidth - WALL_GAP * (count - 1)) / sum;

    let row: MemoryPhoto[] = [];
    let ratioSum = 0;
    for (const photo of items) {
      const ratio = ratios[photo.id] ?? 0.8;
      const heightBefore = row.length ? rowHeight(row.length, ratioSum) : Infinity;
      row.push(photo);
      ratioSum += ratio;
      const heightAfter = rowHeight(row.length, ratioSum);

      if (heightAfter > targetRowHeight && row.length < maxPerRow) continue;

      // Row is full on count alone — keep every photo and let it run tall.
      if (heightAfter > targetRowHeight) {
        wallRows.push({ photos: row, height: heightAfter });
        row = [];
        ratioSum = 0;
        continue;
      }

      // Adding this photo took the row under the target. Whichever side of the
      // target is closer wins — always taking the photo makes rows of six
      // squeezed thumbnails where four generous ones were the better fit.
      if (row.length > 1 && heightBefore - targetRowHeight < targetRowHeight - heightAfter) {
        row.pop();
        wallRows.push({ photos: row, height: heightBefore });
        row = [photo];
        ratioSum = ratio;
      } else {
        wallRows.push({ photos: row, height: heightAfter });
        row = [];
        ratioSum = 0;
      }
    }
    if (row.length) {
      const available = wallWidth - WALL_GAP * (row.length - 1);
      // Don't stretch a lonely last photo across the whole width.
      wallRows.push({ photos: row, height: Math.min(targetRowHeight, available / ratioSum) });
    }
  }

  // Distribute items round-robin into balanced columns. Photos are square,
  // so columns stay roughly level and the wall reads as a clean grid while
  // the per-photo tilt keeps it feeling alive.
  const columns: MemoryPhoto[][] = Array.from({ length: columnCount }, () => []);
  items.forEach((photo, i) => {
    columns[i % columnCount]!.push(photo);
  });

  // Close lightbox on Escape
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setActive(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  const doShuffle = useCallback(() => {
    setFading(true);
    setTimeout(() => {
      setItems(s => shuffle(s));
      setFading(false);
    }, 220);
  }, []);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center gap-3">
        <span className="text-5xl">📸</span>
        <p className="text-muted-foreground text-sm">No photos yet — snap one next time you cook!</p>
      </div>
    );
  }

  return (
    <div className={caveat.variable}>
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between mb-6 gap-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold font-[family-name:var(--font-caveat)] text-zinc-800 dark:text-zinc-100">
            Memories
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
            {items.length} photo{items.length !== 1 ? "s" : ""} — tap to relive
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center rounded-full bg-white/70 dark:bg-zinc-800 p-1 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
            {/* The stored keys predate the labels: "wall" is the polaroid
                scatter, "grid" is now the borderless wall. Renaming the keys
                would reset everyone's saved preference, so they stay. */}
            {([
              { key: "wall" as const, label: "Polaroid", smLabel: "Polaroid", Icon: Images },
              { key: "grid" as const, label: "Wall", smLabel: "Wall", Icon: LayoutGrid },
            ]).map(({ key, label, smLabel, Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => chooseView(key)}
                aria-pressed={view === key}
                aria-label={`${smLabel} view`}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                  view === key
                    ? "bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow"
                    : "text-zinc-600 dark:text-zinc-300"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="sm:hidden">{label}</span>
                <span className="hidden sm:inline">{smLabel}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={doShuffle}
            disabled={fading}
            aria-label="Shuffle photos"
            className="flex shrink-0 items-center gap-2 rounded-full bg-zinc-800 dark:bg-zinc-100 px-4 py-2 text-sm font-medium text-white dark:text-zinc-900 shadow-md active:scale-95 transition-transform disabled:opacity-60"
          >
            <Shuffle className="h-4 w-4" />
            <span className="hidden sm:inline">Shuffle</span>
          </button>
        </div>
      </div>

      {/* Photo wall / grid. Every flex or grid track carries min-w-0: without
          it the nowrap caption sets the track's intrinsic minimum and pushes
          the cards past the viewport on narrow screens. */}
      <div
        ref={wallRef}
        className="transition-all duration-200"
        style={{ opacity: fading ? 0 : 1, transform: fading ? "scale(0.97)" : "scale(1)" }}
      >
        {view === "wall" ? (
          <>
          {/* Mobile feed — full-bleed photos, no polaroid chrome, caption laid
              over the bottom of the image so the photo keeps the whole width.
              The feed/wall swap is CSS-only so neither flashes on first paint. */}
          <div className="flex flex-col gap-4 sm:hidden">
            {items.map(photo => (
              <button
                key={photo.id}
                type="button"
                onClick={() => setActive(photo)}
                className="group relative block w-full min-w-0 overflow-hidden rounded-2xl bg-zinc-200 dark:bg-zinc-800 text-left shadow-lg ring-1 ring-black/5 active:scale-[0.98] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.photoUrl}
                  alt={photo.recipeName}
                  className="w-full aspect-[4/5] object-cover"
                  loading="lazy"
                />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-4 pb-4 pt-14">
                  <div className="font-[family-name:var(--font-caveat)] text-[24px] font-semibold leading-tight text-white">
                    {photo.recipeName}
                  </div>
                  <div className="flex items-center gap-2 font-[family-name:var(--font-caveat)] text-[17px] leading-tight text-white/80">
                    <span>{relDate(photo.cookedAt)}</span>
                    {photo.rating != null && (
                      <span className="text-amber-300">{stars(photo.rating)}</span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
          <div className="hidden items-start gap-1 sm:flex">
            {columns.map((column, colIndex) => (
              <div key={colIndex} className="flex min-w-0 flex-1 flex-col">
                {column.map((photo, i) => (
                  <div key={photo.id} className="min-w-0 px-2 py-2 sm:px-3">
                    <button
                      type="button"
                      className="block w-full min-w-0 text-left focus:outline-none"
                      onClick={() => setActive(photo)}
                      style={{
                        transform: `rotate(${getTilt(photo.id, colIndex * 7 + i)}deg)`,
                        transformOrigin: "center 30%",
                      }}
                    >
                      <div
                        className="min-w-0 bg-white dark:bg-zinc-100 rounded-sm hover:scale-[1.03] transition-transform duration-150"
                        style={{ boxShadow: "0 3px 10px rgba(0,0,0,0.14), 0 0 0 1px rgba(0,0,0,0.04)" }}
                      >
                        {/* Photo */}
                        <div className="p-2 pb-0">
                          <div className="overflow-hidden">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={photo.photoUrl}
                              alt={photo.recipeName}
                              className="w-full aspect-square object-cover"
                              style={{ filter: "sepia(0.2) saturate(1.2) brightness(1.02)" }}
                              loading="lazy"
                            />
                          </div>
                        </div>
                        {/* Caption */}
                        <div className="min-w-0 px-2 pt-1.5 pb-3 font-[family-name:var(--font-caveat)] text-zinc-800">
                          <div className="text-[14px] font-semibold leading-tight truncate">{photo.recipeName}</div>
                          <div className="text-[12px] text-zinc-500 leading-tight truncate">{relDate(photo.cookedAt)}</div>
                          {photo.rating != null && (
                            <div className="text-[11px] text-amber-500 leading-tight">{stars(photo.rating)}</div>
                          )}
                        </div>
                      </div>
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
          </>
        ) : (
          /* Wall — a masonry of photos at their own aspect ratio. Square
             thumbnails cropped the heart out of a tall plated shot or a wide
             table scene, so nothing is cropped here: CSS columns let each
             photo keep its shape and the wall closes up around them. No
             frames, no rings, no permanent caption — just the pictures, with
             the details surfacing on hover. */
          <div className="flex flex-col" style={{ gap: WALL_GAP }}>
            {wallRows.map((row, rowIndex) => (
              <div key={rowIndex} className="flex" style={{ gap: WALL_GAP }}>
                {row.photos.map(photo => (
                  <button
                    key={photo.id}
                    type="button"
                    onClick={() => setActive(photo)}
                    aria-label={`${photo.recipeName}, ${relDate(photo.cookedAt)}`}
                    className="group relative block min-w-0 shrink-0 overflow-hidden bg-zinc-200 text-left dark:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                    style={{
                      height: row.height,
                      width: (ratios[photo.id] ?? 0.8) * row.height,
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.photoUrl}
                      alt={photo.recipeName}
                      className="block h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                      loading="lazy"
                    />
                    {/* Details on hover only. Touch devices never fire hover, but
                        a tap opens the lightbox, which shows all of this and more. */}
                    <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/80 via-black/20 to-transparent p-2.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
                      <div className="truncate font-[family-name:var(--font-caveat)] text-[19px] font-semibold leading-tight text-white">
                        {photo.recipeName}
                      </div>
                      {photo.rating != null && (
                        <div className="font-[family-name:var(--font-caveat)] text-[16px] leading-tight text-amber-300">
                          {stars(photo.rating)}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {active && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: "rgba(0,0,0,0.85)" }}
          onClick={() => setActive(null)}
        >
          <div
            className={`${caveat.variable} relative bg-white dark:bg-zinc-100 rounded-sm w-full max-w-sm mx-auto max-h-[88vh] overflow-y-auto`}
            style={{
              boxShadow: "0 25px 60px rgba(0,0,0,0.5)",
              transform: `rotate(${getTilt(active.id, 99)}deg)`,
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Close */}
            <button
              type="button"
              onClick={() => setActive(null)}
              aria-label="Close"
              className="absolute top-1.5 right-1.5 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 backdrop-blur shadow-lg text-zinc-600 hover:text-zinc-900 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>

            {/* Photo — tap to open full size */}
            <div className="p-3 pb-0">
              <a href={active.photoUrl} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={active.photoUrl}
                  alt={active.recipeName}
                  className="w-full max-h-[55vh] rounded-sm object-contain"
                />
              </a>
            </div>

            {/* Caption */}
            <div className="px-4 pt-3 pb-5 font-[family-name:var(--font-caveat)] text-zinc-800 space-y-0.5">
              <div className="flex items-start justify-between gap-2">
                <Link
                  href={`/recipes/${active.recipeId}`}
                  onClick={() => setActive(null)}
                  className="text-[20px] font-semibold leading-tight hover:underline flex items-center gap-1"
                >
                  {active.recipeName}
                  <ExternalLink className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                </Link>
                {active.rating != null && (
                  <span className="text-amber-500 text-[18px] shrink-0">{stars(active.rating)}</span>
                )}
              </div>
              <div className="text-[15px] text-zinc-500">{fullDate(active.cookedAt)}</div>
              {active.occasion && (
                <div className="text-[15px] text-zinc-600">{active.occasion}</div>
              )}
              {active.cookedFor && active.cookedFor.length > 0 && (
                <div className="text-[14px] text-zinc-500">with {active.cookedFor.join(", ")}</div>
              )}
              {active.notes && (
                <p className="text-[14px] text-zinc-600 italic pt-1 leading-snug">
                  &ldquo;{active.notes}&rdquo;
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
