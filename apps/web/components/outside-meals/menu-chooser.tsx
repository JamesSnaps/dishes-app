"use client";

/**
 * "Help me choose", inside the log-a-meal-out sheet: give it the menu (photos,
 * a PDF, a link or pasted text), say who's eating, and the household's AI
 * suggests dishes for each of them from the diner brief — their dietary
 * requirements, tastes and this week's heart-health targets. Ticking the ones
 * ordered hands them back to the sheet, which fills in what was eaten with
 * each dish's menu line and printed calories, ready for the estimate.
 *
 * Calls POST /api/web/outside-meals/menu-picks and waits (10–30 s). Nothing is
 * saved until the sheet is.
 */

import { useState } from "react";
import { Check, FileText, ImagePlus, Link2, Loader2, Sparkles, TriangleAlert, X } from "lucide-react";
import { Button, Input, Textarea, cn } from "@dishes/ui";
import { OUTSIDE_MEAL_COURSE_LABELS } from "@dishes/shared";
import type { MenuPick, MenuPicks } from "@/lib/ai/menu-picks";

const MAX_PHOTOS = 4;

/** The picks ticked, each with whose it was. */
export type ChosenPick = MenuPick & { diner: string };

export type MenuChoice = {
  picks: ChosenPick[];
  restaurant: MenuPicks["restaurant"];
  /** The first menu photo, to keep with the meal for its estimate. */
  menuPhoto: File | null;
};

const chip = (active: boolean) =>
  cn(
    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
    active
      ? "border-primary bg-primary text-primary-foreground shadow-sm"
      : "border-transparent bg-highlight text-primary hover:border-input"
  );

function kcalText(p: MenuPick): string | null {
  if (p.menuKcal) return `${p.menuKcal} kcal on the menu`;
  if (p.estimatedKcal) return `about ${p.estimatedKcal} kcal (estimate)`;
  return null;
}

export function MenuChooser({
  date,
  names,
  initialDiners,
  onUse,
  onCancel,
}: {
  date: string;
  /** Everyone who could be eating, by display name. */
  names: string[];
  /** Who's eating so far (the sheet's "Who ate?"); empty means everyone. */
  initialDiners: string[];
  onUse: (choice: MenuChoice) => void;
  onCancel: () => void;
}) {
  const [photos, setPhotos] = useState<{ file: File; preview: string }[]>([]);
  const [pdf, setPdf] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [diners, setDiners] = useState<string[]>(initialDiners.length ? initialDiners : names);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MenuPicks | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  const hasMenu = photos.length > 0 || !!pdf || !!url.trim() || !!text.trim();
  const key = (diner: string, i: number) => `${diner}#${i}`;

  function addPhotos(files: FileList | null) {
    if (!files) return;
    const room = MAX_PHOTOS - photos.length;
    const added = [...files].slice(0, room).map((file) => ({ file, preview: URL.createObjectURL(file) }));
    setPhotos((p) => [...p, ...added]);
  }

  function removePhoto(i: number) {
    setPhotos((p) => {
      URL.revokeObjectURL(p[i]!.preview);
      return p.filter((_, j) => j !== i);
    });
  }

  async function suggest() {
    setError(null);
    setLoading(true);
    const form = new FormData();
    form.append("date", date);
    for (const p of photos) form.append("photo", p.file);
    if (pdf) form.append("pdf", pdf);
    if (url.trim()) form.append("url", url.trim());
    if (text.trim()) form.append("text", text);
    // Everyone ticked is the same as nobody: the whole household.
    if (diners.length && diners.length < names.length) for (const d of diners) form.append("member", d);
    try {
      const res = await fetch("/api/web/outside-meals/menu-picks", {
        method: "POST",
        body: form,
        headers: { Accept: "application/json" },
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? "Couldn't read the menu — please try again.");
      setResult(body as MenuPicks);
      setChosen(new Set());
    } catch (e) {
      setError((e as Error).message || "Couldn't read the menu — please try again.");
    } finally {
      setLoading(false);
    }
  }

  function use() {
    if (!result) return;
    const picks = result.diners.flatMap((d) =>
      d.picks.flatMap((p, i) => (chosen.has(key(d.name, i)) ? [{ ...p, diner: d.name }] : []))
    );
    onUse({ picks, restaurant: result.restaurant, menuPhoto: photos[0]?.file ?? null });
  }

  if (result) {
    return (
      <div className="space-y-4">
        {(result.restaurant.name || result.restaurant.cuisine) && (
          <p className="text-sm font-semibold">
            {[result.restaurant.name, result.restaurant.cuisine].filter(Boolean).join(" · ")}
          </p>
        )}
        {result.note && (
          <p className="flex gap-2 rounded-lg bg-warning-tint px-3 py-2 text-xs text-warning">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {result.note}
          </p>
        )}

        {result.diners.map((d) => (
          <div
            key={d.name}
            className="space-y-2 rounded-xl bg-success-tint p-3 shadow-sm"
          >
            {result.diners.length > 1 && <p className="text-sm font-semibold">{d.name}</p>}
            {d.picks.length === 0 && <p className="text-xs text-muted-foreground">No suggestions.</p>}
            {d.picks.map((p, i) => {
              const k = key(d.name, i);
              const on = chosen.has(k);
              const kcal = kcalText(p);
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setChosen((s) => {
                      const next = new Set(s);
                      if (on) next.delete(k);
                      else next.add(k);
                      return next;
                    })
                  }
                  className={cn(
                    "flex w-full gap-3 rounded-lg border-2 bg-background/90 p-3 text-left shadow-sm transition-all",
                    on ? "border-input ring-2 ring-ring" : "border-transparent hover:border-input"
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                      on ? "border-transparent bg-success text-card" : "border-input"
                    )}
                  >
                    {on && <Check className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-semibold">{p.dish}</span>
                      {p.course !== "main" && (
                        <span className="text-xs text-muted-foreground">{OUTSIDE_MEAL_COURSE_LABELS[p.course]}</span>
                      )}
                    </span>
                    <span className="block text-sm">{p.why}</span>
                    {p.lighterTweak && (
                      <span className="block text-xs text-success">Ask for: {p.lighterTweak}</span>
                    )}
                    {kcal && <span className="block text-xs text-muted-foreground">{kcal}</span>}
                  </span>
                </button>
              );
            })}
            {d.avoid.length > 0 && (
              <div className="space-y-0.5 pt-1 text-xs text-muted-foreground">
                {d.avoid.map((a) => (
                  <p key={a.dish}>
                    <span className="font-medium text-foreground/80">Maybe not {a.dish}</span> — {a.why}
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}

        <p className="text-xs text-muted-foreground">
          Calories are estimates unless the menu prints them. Tick what you ordered to fill in the log.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => setResult(null)}>
            Change the menu
          </Button>
          <Button
            className="flex-1 bg-success text-card shadow-md"
            onClick={use}
            disabled={chosen.size === 0}
          >
            {chosen.size > 1 ? `Use these ${chosen.size}` : "Use this"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <label className="text-sm font-medium">The menu</label>
        <div className="grid grid-cols-4 gap-2">
          {photos.map((p, i) => (
            <div key={p.preview} className="relative aspect-[3/4] overflow-hidden rounded-lg shadow-md">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.preview} alt={`Menu photo ${i + 1}`} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => removePhoto(i)}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"
                aria-label={`Remove menu photo ${i + 1}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {photos.length < MAX_PHOTOS && (
            <label className="flex aspect-[3/4] cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-transparent bg-highlight text-center text-xs font-medium text-primary hover:bg-highlight">
              <ImagePlus className="h-5 w-5" />
              {photos.length ? "Another page" : "Photo"}
              <input
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={(e) => {
                  addPhotos(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            type="url"
            inputMode="url"
            placeholder="Or a link to the menu (web page or PDF)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>

        {pdf ? (
          <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm">
            <FileText className="h-4 w-4 shrink-0 text-foreground" />
            <span className="min-w-0 flex-1 truncate">{pdf.name}</span>
            <button type="button" onClick={() => setPdf(null)} aria-label="Remove the PDF" className="text-muted-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-foreground">
            <FileText className="h-4 w-4" />
            <span className="underline underline-offset-2">Or choose a PDF</span>
            <input
              type="file"
              accept="application/pdf"
              className="sr-only"
              onChange={(e) => setPdf(e.target.files?.[0] ?? null)}
            />
          </label>
        )}

        <Textarea
          placeholder="Or paste the menu"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          className="resize-none"
        />
      </div>

      {names.length > 1 && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Who&rsquo;s eating?</label>
          <div className="flex flex-wrap gap-2">
            {names.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() =>
                  setDiners((ds) => (ds.includes(name) ? ds.filter((n) => n !== name) : [...ds, name]))
                }
                className={chip(diners.includes(name))}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-center text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onCancel} disabled={loading}>
          Back
        </Button>
        <Button
          className="flex-[2] bg-success text-card shadow-md"
          onClick={suggest}
          disabled={!hasMenu || diners.length === 0 || loading}
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Reading the menu…
            </>
          ) : (
            <>
              <Sparkles className="mr-2 h-4 w-4" />
              Suggest dishes
            </>
          )}
        </Button>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Uses what Dishes knows about who&rsquo;s eating: dietary needs, tastes and this week&rsquo;s meals.
      </p>
    </div>
  );
}
