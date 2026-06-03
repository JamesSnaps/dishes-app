"use client";

import { useState, useEffect, useCallback } from "react";
import { Caveat } from "next/font/google";
import { Shuffle, X, ExternalLink } from "lucide-react";
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
  const [columnCount, setColumnCount] = useState(2);

  useEffect(() => {
    setItems(shuffle(photos));
  }, [photos]);

  // Responsive column count — drives the masonry layout below.
  useEffect(() => {
    const update = () => setColumnCount(window.innerWidth >= 640 ? 3 : 2);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

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
      <div className="flex items-end justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold font-[family-name:var(--font-caveat)] text-zinc-800 dark:text-zinc-100">
            Memories
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
            {items.length} photo{items.length !== 1 ? "s" : ""} — tap to relive
          </p>
        </div>
        <button
          type="button"
          onClick={doShuffle}
          disabled={fading}
          className="flex shrink-0 items-center gap-2 rounded-full bg-zinc-800 dark:bg-zinc-100 px-4 py-2 text-sm font-medium text-white dark:text-zinc-900 shadow-md active:scale-95 transition-transform disabled:opacity-60"
        >
          <Shuffle className="h-4 w-4" />
          Shuffle
        </button>
      </div>

      {/* Masonry wall — flex columns so rotated polaroids never get clipped by
          CSS-column boxes. Each card gets padding to give the tilt room. */}
      <div
        className="flex items-start gap-1 transition-all duration-200"
        style={{ opacity: fading ? 0 : 1, transform: fading ? "scale(0.97)" : "scale(1)" }}
      >
        {columns.map((column, colIndex) => (
          <div key={colIndex} className="flex flex-1 flex-col">
            {column.map((photo, i) => (
              <div key={photo.id} className="px-3 py-2">
                <button
                  type="button"
                  className="w-full text-left focus:outline-none"
                  onClick={() => setActive(photo)}
                  style={{
                    transform: `rotate(${getTilt(photo.id, colIndex * 7 + i)}deg)`,
                    transformOrigin: "center 30%",
                    display: "block",
                  }}
                >
                  <div
                    className="bg-white dark:bg-zinc-100 rounded-sm hover:scale-[1.03] transition-transform duration-150"
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
                    <div className="px-2 pt-1.5 pb-3 font-[family-name:var(--font-caveat)] text-zinc-800">
                      <div className="text-[14px] font-semibold leading-tight truncate">{photo.recipeName}</div>
                      <div className="text-[12px] text-zinc-500 leading-tight">{relDate(photo.cookedAt)}</div>
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

      {/* Lightbox */}
      {active && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.85)" }}
          onClick={() => setActive(null)}
        >
          <div
            className={`${caveat.variable} relative bg-white dark:bg-zinc-100 rounded-sm w-full max-w-sm mx-auto`}
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
              className="absolute -top-3 -right-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-lg text-zinc-600 hover:text-zinc-900 transition-colors"
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
                  className="w-full rounded-sm"
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
