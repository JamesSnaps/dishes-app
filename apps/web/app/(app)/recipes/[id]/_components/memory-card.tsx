"use client";

import { useState } from "react";
import { Caveat } from "next/font/google";
import { Wand2 } from "lucide-react";

const caveat = Caveat({ subsets: ["latin"], variable: "--font-caveat", display: "swap" });

// Deterministic tilt so cards don't shift on re-render
function getTilt(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return ((Math.abs(hash) % 11) - 5) * 0.55; // ~-2.75 to +2.75 deg
}

function starString(rating: number): string {
  const full = Math.round(rating / 2);
  return "★".repeat(full) + "☆".repeat(Math.max(0, 5 - full));
}

export interface MemoryEntry {
  id: string;
  photoUrl: string | null;
  relDate: string;
  fullDate: string;
  rating: number | null;
  notes: string | null;
  occasion: string | null;
  cookedFor: string[] | null;
  actualDuration: number | null;
}

interface MemoryCardProps {
  entry: MemoryEntry;
}

export function MemoryCard({ entry }: MemoryCardProps) {
  const [filterOn, setFilterOn] = useState(true);
  const tilt = getTilt(entry.id);

  return (
    <div
      className={`${caveat.variable} relative mx-auto w-full max-w-[260px]`}
      style={{ transform: `rotate(${tilt}deg)` }}
    >
      {/* Polaroid frame */}
      <div
        className="bg-white dark:bg-zinc-100 rounded-sm select-none"
        style={{
          boxShadow: "0 4px 6px -1px rgba(0,0,0,0.18), 0 2px 4px -2px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)",
        }}
      >
        {/* Photo area */}
        <div className="p-2.5 pb-0">
          {entry.photoUrl ? (
            <div className="relative aspect-square overflow-hidden bg-zinc-200">
              <a href={entry.photoUrl} target="_blank" rel="noopener noreferrer" className="block w-full h-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={entry.photoUrl}
                  alt="Dish photo"
                  className="w-full h-full object-cover transition-all duration-300"
                  style={
                    filterOn
                      ? { filter: "sepia(0.28) saturate(1.35) brightness(1.04) contrast(0.93) hue-rotate(-5deg)" }
                      : undefined
                  }
                />
              </a>
              {/* Filter toggle */}
              <button
                type="button"
                onClick={() => setFilterOn((v) => !v)}
                title={filterOn ? "Remove vintage filter" : "Apply vintage filter"}
                className={`absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full transition-all ${
                  filterOn
                    ? "bg-amber-400/80 text-amber-900 shadow"
                    : "bg-black/30 text-white/70"
                }`}
              >
                <Wand2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="aspect-square bg-zinc-100 flex items-center justify-center">
              <span className="text-5xl opacity-40">🍽️</span>
            </div>
          )}
        </div>

        {/* Caption strip */}
        <div className="px-3 pt-2.5 pb-4 font-[family-name:var(--font-caveat)] text-zinc-800 space-y-0.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[17px] leading-tight font-semibold" title={entry.fullDate}>
              {entry.relDate}
            </span>
            {entry.rating != null && (
              <span className="text-[13px] tracking-tight text-amber-500">
                {starString(entry.rating)}
              </span>
            )}
          </div>

          {entry.occasion && (
            <div className="text-[15px] text-zinc-600 leading-tight">{entry.occasion}</div>
          )}

          {entry.cookedFor && entry.cookedFor.length > 0 && (
            <div className="text-[14px] text-zinc-500 leading-tight">
              with {entry.cookedFor.join(", ")}
            </div>
          )}

          {entry.actualDuration && (
            <div className="text-[13px] text-zinc-400 leading-tight">{entry.actualDuration} min</div>
          )}

          {entry.notes && (
            <p className="text-[14px] text-zinc-600 leading-snug italic pt-1">
              &ldquo;{entry.notes}&rdquo;
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
