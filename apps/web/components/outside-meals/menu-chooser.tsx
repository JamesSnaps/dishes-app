"use client";

/**
 * "Help me choose", inside the log-a-meal-out sheet. Give it the menu
 * (photos, a PDF, a link or pasted text), who's eating, the courses they want
 * and the mood they're in, and the household's AI suggests dishes for each
 * person and course from the diner brief — dietary requirements, tastes,
 * this week's heart-health targets.
 *
 * The answer streams (`Accept: application/x-ndjson`): what the brief says
 * it's weighing, each dish as the menu is read, then each pick as it's made,
 * so the wait shows the work. The best option in each course is chosen as it
 * arrives. "Something else" asks for different options for one course
 * (sending back the menu already read, so it's quick); "See the whole menu"
 * lets you choose any dish yourself. "Use these" hands the chosen dishes to
 * the sheet, which fills in what was eaten. Nothing is saved until the sheet is.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Check, ChevronRight, FileText, ImagePlus, Link2, RefreshCw, TriangleAlert, X } from "lucide-react";
import { AiButton, Button, Input, SectionLabel, Textarea, cn } from "@dishes/ui";
import { OUTSIDE_MEAL_COURSE_LABELS, OUTSIDE_MEAL_COURSES, type OutsideMealCourseType } from "@dishes/shared";
import {
  courseOfSection,
  MENU_MOOD_LABELS,
  MENU_MOODS,
  SWAP_REASONS,
  type MenuAvoid,
  type MenuMood,
  type MenuPick,
  type MenuPickEvent,
  type ReadMenu,
} from "@/lib/menu-choice";
import { PlateSpinner } from "@/components/ai-wait";

const MAX_PHOTOS = 4;
const ENDPOINT = "/api/web/outside-meals/menu-picks";

/** A chosen dish, with whose it was. */
export type ChosenPick = MenuPick;

export type MenuChoice = {
  picks: ChosenPick[];
  restaurant: ReadMenu["restaurant"];
  /** The first menu photo, to keep with the meal for its estimate. */
  menuPhoto: File | null;
};

const chip = (active: boolean) =>
  cn(
    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
    active
      ? "border-primary bg-primary text-primary-foreground"
      : "border-transparent bg-highlight text-primary hover:border-input"
  );

const slotKey = (diner: string, course: OutsideMealCourseType) => `${diner}|${course}`;
const byCourse = (a: OutsideMealCourseType, b: OutsideMealCourseType) =>
  OUTSIDE_MEAL_COURSES.indexOf(a) - OUTSIDE_MEAL_COURSES.indexOf(b);

function kcalText(p: MenuPick): string | null {
  if (p.menuKcal) return `${p.menuKcal} kcal on the menu`;
  if (p.estimatedKcal) return `about ${p.estimatedKcal} kcal (estimate)`;
  return null;
}

/** POSTs the form and hands on each streamed event; a refusal before streaming throws its message. */
async function streamMenuPicks(form: FormData, onEvent: (e: MenuPickEvent) => void): Promise<void> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    body: form,
    // application/json too, so a lapsed Authelia session answers 401, not its login page.
    headers: { Accept: "application/x-ndjson, application/json" },
  });
  if (!res.ok || !res.body || !(res.headers.get("content-type") ?? "").includes("ndjson")) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? "Couldn't read the menu — please try again.");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as MenuPickEvent);
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as MenuPickEvent);
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
  // What to read, and what they're after.
  const [photos, setPhotos] = useState<{ file: File; preview: string }[]>([]);
  const [pdf, setPdf] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [diners, setDiners] = useState<string[]>(initialDiners.length ? initialDiners : names);
  const [courses, setCourses] = useState<OutsideMealCourseType[]>(["main"]);
  const [moods, setMoods] = useState<MenuMood[]>([]);
  const [note, setNote] = useState("");

  // The answer, as it streams.
  const [phase, setPhase] = useState<"input" | "working" | "done">("input");
  const [stage, setStage] = useState<string | null>(null);
  const [facts, setFacts] = useState<string[]>([]);
  const [dishes, setDishes] = useState<string[]>([]);
  const [menu, setMenu] = useState<ReadMenu | null>(null);
  const [options, setOptions] = useState<Record<string, MenuPick[]>>({});
  const [chosen, setChosen] = useState<Record<string, number | null>>({});
  const [avoid, setAvoid] = useState<MenuAvoid[]>([]);
  const [answerNote, setAnswerNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Swaps and the whole menu.
  const [swapOpen, setSwapOpen] = useState<string | null>(null);
  const [swapReasons, setSwapReasons] = useState<string[]>([]);
  const [swapText, setSwapText] = useState("");
  const [swapping, setSwapping] = useState<string | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [activeDiner, setActiveDiner] = useState<string>(diners[0] ?? names[0] ?? "");

  const askedFor = diners.length ? diners : names;
  const hasMenu = photos.length > 0 || !!pdf || !!url.trim() || !!text.trim();
  // Set on every mount: Strict Mode mounts twice in development.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

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

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  /** A pick arriving: added to its course; the first in a course is chosen. */
  function addPick(p: MenuPick) {
    const key = slotKey(p.diner, p.course);
    setOptions((o) => ({ ...o, [key]: [...(o[key] ?? []), p] }));
    setChosen((c) => (c[key] === undefined ? { ...c, [key]: p.item } : c));
  }

  function baseForm(): FormData {
    const form = new FormData();
    form.append("date", date);
    // Everyone ticked is the same as nobody: the whole household.
    if (diners.length && diners.length < names.length) for (const d of diners) form.append("member", d);
    return form;
  }

  async function suggest() {
    setError(null);
    setPhase("working");
    setStage("Getting started");
    setFacts([]);
    setDishes([]);
    setMenu(null);
    setOptions({});
    setChosen({});
    setAvoid([]);
    setAnswerNote(null);
    setShowMenu(false);
    setActiveDiner(askedFor[0] ?? "");

    const form = baseForm();
    for (const c of courses) form.append("course", c);
    for (const m of moods) form.append("mood", m);
    if (note.trim()) form.append("note", note.trim());
    for (const p of photos) form.append("photo", p.file);
    if (pdf) form.append("pdf", pdf);
    if (url.trim()) form.append("url", url.trim());
    if (text.trim()) form.append("text", text);

    try {
      await streamMenuPicks(form, (e) => {
        if (!mounted.current) return;
        switch (e.type) {
          case "stage": return setStage(e.text);
          case "fact": return setFacts((f) => [...f, e.text]);
          case "dish": return setDishes((d) => [...d, e.name]);
          case "menu": return setMenu(e.menu);
          case "pick": return addPick(e.pick);
          case "avoid": return setAvoid((a) => [...a, e.avoid]);
          case "done":
            setAnswerNote(e.note);
            return setPhase("done");
          case "error":
            setError(e.message);
            return setPhase("input");
        }
      });
      // A stream that ends without "done" or "error" still finishes.
      if (mounted.current) setPhase((p) => (p === "working" ? "done" : p));
    } catch (err) {
      if (!mounted.current) return;
      setError((err as Error).message || "Couldn't read the menu — please try again.");
      setPhase("input");
    }
  }

  async function swap(diner: string, course: OutsideMealCourseType) {
    if (!menu) return;
    const key = slotKey(diner, course);
    const hint = [...swapReasons, swapText.trim()].filter(Boolean).join("; ");
    const form = baseForm();
    form.append("menu", JSON.stringify(menu));
    form.append("swapDiner", diner);
    form.append("swapCourse", course);
    for (const p of options[key] ?? []) form.append("exclude", String(p.item));
    if (hint) form.append("hint", hint);

    setSwapping(key);
    setSwapOpen(null);
    setError(null);
    const fresh: MenuPick[] = [];
    let failed = false;
    try {
      await streamMenuPicks(form, (e) => {
        if (!mounted.current) return;
        if (e.type === "pick") {
          fresh.push(e.pick);
          // The new options replace the old as they arrive; the first is chosen.
          setOptions((o) => ({ ...o, [key]: [...fresh] }));
          if (fresh.length === 1) setChosen((c) => ({ ...c, [key]: e.pick.item }));
        }
        if (e.type === "error") {
          failed = true;
          setError(e.message);
        }
      });
      if (!fresh.length && !failed && mounted.current) setError("Nothing else on the menu suits — the options above are the best fit.");
    } catch (err) {
      if (mounted.current) setError((err as Error).message);
    } finally {
      if (mounted.current) {
        setSwapping(null);
        setSwapReasons([]);
        setSwapText("");
      }
    }
  }

  /** A dish picked from the whole menu, for the person whose tab is open. */
  function pickFromMenu(itemId: number) {
    const item = menu?.items.find((i) => i.id === itemId);
    if (!item) return;
    const course = courseOfSection(item.section);
    const key = slotKey(activeDiner, course);
    const pick: MenuPick = {
      item: item.id,
      diner: activeDiner,
      course,
      dish: item.name,
      menuLine: item.line,
      menuKcal: item.kcal,
      estimatedKcal: null,
      why: "",
      lighterTweak: null,
    };
    setOptions((o) => {
      const rest = (o[key] ?? []).filter((p) => p.item !== item.id);
      return { ...o, [key]: [pick, ...rest] };
    });
    setChosen((c) => ({ ...c, [key]: item.id }));
    setShowMenu(false);
  }

  const chosenPicks = useMemo(
    () =>
      Object.entries(chosen).flatMap(([key, item]) =>
        item == null ? [] : (options[key] ?? []).filter((p) => p.item === item).slice(0, 1)
      ),
    [chosen, options]
  );

  function use() {
    if (!chosenPicks.length) return;
    onUse({ picks: chosenPicks, restaurant: menu?.restaurant ?? { name: null, cuisine: null }, menuPhoto: photos[0]?.file ?? null });
  }

  // ── The answer ────────────────────────────────────────────────────────────

  if (phase !== "input") {
    const dinerCourses = (diner: string) =>
      [...new Set([...courses, ...Object.keys(options).filter((k) => k.startsWith(`${diner}|`)).map((k) => k.split("|")[1] as OutsideMealCourseType)])].sort(byCourse);
    const working = phase === "working";

    return (
      <div className="space-y-5">
        {/* What it's doing: the brief, the menu as it's read, the stage. */}
        <div className="space-y-3 rounded-2xl bg-muted p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            {working ? <PlateSpinner /> : <Check className="h-4 w-4 text-success" />}
            {working ? `${stage ?? "Working"}…` : `Read ${menu?.items.length ?? dishes.length} dishes${menu?.restaurant.name ? ` from ${menu.restaurant.name}` : ""}`}
          </div>
          {facts.length > 0 && (
            <ul className="space-y-1">
              {facts.map((f) => (
                <li key={f} className="flex animate-rise-in items-start gap-2 text-xs text-muted-foreground">
                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-success" />
                  {f}
                </li>
              ))}
            </ul>
          )}
          {working && dishes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {dishes.slice(-14).map((d, i) => (
                <span key={`${d}-${i}`} className="animate-rise-in rounded-full bg-card px-2.5 py-1 text-xs text-muted-foreground">
                  {d}
                </span>
              ))}
              {dishes.length > 14 && <span className="px-1 py-1 text-xs text-muted-foreground">+{dishes.length - 14} more</span>}
            </div>
          )}
          {menu && !working && (
            <Button variant="secondary" size="sm" className="w-full" onClick={() => setShowMenu((s) => !s)}>
              <BookOpen className="mr-2 h-4 w-4" />
              {showMenu ? "Back to the suggestions" : "See the whole menu"}
            </Button>
          )}
        </div>

        {askedFor.length > 1 && (
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Whose choices">
            {askedFor.map((d) => (
              <button key={d} type="button" role="tab" aria-selected={activeDiner === d} onClick={() => setActiveDiner(d)} className={chip(activeDiner === d)}>
                {d}
              </button>
            ))}
          </div>
        )}

        {showMenu && menu ? (
          <WholeMenu menu={menu} chosenItems={new Set(chosenPicks.filter((p) => p.diner === activeDiner).map((p) => p.item))} onPick={pickFromMenu} forName={askedFor.length > 1 ? activeDiner : null} />
        ) : (
          <div className="space-y-5">
            {dinerCourses(activeDiner).map((course) => {
              const key = slotKey(activeDiner, course);
              const list = options[key] ?? [];
              const busy = swapping === key;
              return (
                <section key={key} className="space-y-2">
                  <SectionLabel>{OUTSIDE_MEAL_COURSE_LABELS[course]}</SectionLabel>
                  {list.length === 0 && (
                    <p className="text-xs italic text-muted-foreground">
                      {working || busy ? "Choosing…" : "Nothing on this menu suits — try another course, or see the whole menu."}
                    </p>
                  )}
                  <div className={cn("divide-y divide-border overflow-hidden rounded-2xl bg-muted", busy && "opacity-60")}>
                    {list.map((p) => {
                      const on = chosen[key] === p.item;
                      const kcal = kcalText(p);
                      return (
                        <button
                          key={p.item}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setChosen((c) => ({ ...c, [key]: on ? null : p.item }))}
                          className={cn("flex w-full animate-rise-in gap-3 p-3 text-left transition-colors", on ? "bg-highlight" : "hover:bg-card")}
                        >
                          <span
                            className={cn(
                              "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                              on ? "border-primary bg-primary text-primary-foreground" : "border-input"
                            )}
                          >
                            {on && <Check className="h-3 w-3" />}
                          </span>
                          <span className="min-w-0 flex-1 space-y-1">
                            <span className="block font-semibold">{p.dish}</span>
                            {p.why ? <span className="block text-sm">{p.why}</span> : <span className="block text-sm italic text-muted-foreground">Your pick from the menu</span>}
                            {p.lighterTweak && <span className="block text-xs text-success">Ask for: {p.lighterTweak}</span>}
                            {kcal && <span className="block text-xs text-muted-foreground">{kcal}</span>}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {!working && menu && (
                    swapOpen === key ? (
                      <div className="space-y-2 rounded-2xl bg-muted p-3">
                        <div className="flex flex-wrap gap-2">
                          {SWAP_REASONS.map((r) => (
                            <button key={r} type="button" onClick={() => setSwapReasons((rs) => toggle(rs, r))} className={chip(swapReasons.includes(r))}>
                              {r}
                            </button>
                          ))}
                        </div>
                        <Input placeholder="Or say what you'd like instead" value={swapText} onChange={(e) => setSwapText(e.target.value)} maxLength={200} />
                        <div className="flex gap-2">
                          <Button variant="secondary" size="sm" className="flex-1" onClick={() => setSwapOpen(null)}>
                            Cancel
                          </Button>
                          <AiButton size="sm" className="flex-[2]" onClick={() => swap(activeDiner, course)}>
                            Find another {OUTSIDE_MEAL_COURSE_LABELS[course].toLowerCase()}
                          </AiButton>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={!!swapping}
                        onClick={() => {
                          setSwapOpen(key);
                          setSwapReasons([]);
                          setSwapText("");
                        }}
                        className="flex h-9 items-center gap-1.5 rounded-full bg-secondary px-3 text-xs font-medium text-secondary-foreground disabled:opacity-50"
                      >
                        {busy ? <PlateSpinner /> : <RefreshCw className="h-3.5 w-3.5" />}
                        {busy ? "Finding another…" : "Something else"}
                      </button>
                    )
                  )}
                </section>
              );
            })}

            {avoid.filter((a) => a.diner === activeDiner).length > 0 && (
              <div className="space-y-0.5 text-xs text-muted-foreground">
                {avoid
                  .filter((a) => a.diner === activeDiner)
                  .map((a) => (
                    <p key={a.item}>
                      <span className="font-medium text-foreground">Maybe not {a.dish}</span> — {a.why}
                    </p>
                  ))}
              </div>
            )}
          </div>
        )}

        {answerNote && (
          <p className="flex gap-2 rounded-2xl bg-warning-tint px-3 py-2 text-xs text-warning">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {answerNote}
          </p>
        )}
        {error && <p className="text-center text-sm text-destructive">{error}</p>}

        <p className="text-xs text-muted-foreground">Calories are estimates unless the menu prints them.</p>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setPhase("input")} disabled={working}>
            Change
          </Button>
          <Button className="flex-[2]" onClick={use} disabled={working || !chosenPicks.length}>
            {chosenPicks.length > 1 ? `Use these ${chosenPicks.length}` : "Use this"}
          </Button>
        </div>
      </div>
    );
  }

  // ── The ask ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <SectionLabel>The menu</SectionLabel>
        <div className="grid grid-cols-4 gap-2">
          {photos.map((p, i) => (
            <div key={p.preview} className="relative aspect-[3/4] overflow-hidden rounded-xl bg-plate">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.preview} alt={`Menu photo ${i + 1}`} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => removePhoto(i)}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-ink text-ink-foreground"
                aria-label={`Remove menu photo ${i + 1}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {photos.length < MAX_PHOTOS && (
            <label className="flex aspect-[3/4] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl bg-highlight text-center text-xs font-medium text-primary">
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
          <Input type="url" inputMode="url" placeholder="Or a link to the menu (web page or PDF)" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>

        {pdf ? (
          <div className="flex items-center gap-2 rounded-2xl bg-muted px-3 py-2 text-sm">
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
            <input type="file" accept="application/pdf" className="sr-only" onChange={(e) => setPdf(e.target.files?.[0] ?? null)} />
          </label>
        )}

        <Textarea placeholder="Or paste the menu" value={text} onChange={(e) => setText(e.target.value)} rows={3} className="resize-none" />
      </div>

      {names.length > 1 && (
        <div className="space-y-2">
          <SectionLabel>Who&rsquo;s eating?</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {names.map((name) => (
              <button key={name} type="button" onClick={() => setDiners((ds) => toggle(ds, name))} className={chip(diners.includes(name))}>
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <SectionLabel>Courses</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {OUTSIDE_MEAL_COURSES.map((c) => (
            <button key={c} type="button" onClick={() => setCourses((cs) => toggle(cs, c).sort(byCourse))} className={chip(courses.includes(c))}>
              {OUTSIDE_MEAL_COURSE_LABELS[c]}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <SectionLabel>In the mood for</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {MENU_MOODS.map((m) => (
            <button key={m} type="button" onClick={() => setMoods((ms) => toggle(ms, m))} className={chip(moods.includes(m))}>
              {MENU_MOOD_LABELS[m]}
            </button>
          ))}
        </div>
        <Input placeholder="Anything else? Sharing plates, no fish tonight…" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
      </div>

      {error && <p className="text-center text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onCancel}>
          Back
        </Button>
        <AiButton className="flex-[2]" onClick={suggest} disabled={!hasMenu || diners.length === 0 || courses.length === 0}>
          Suggest dishes
        </AiButton>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Uses what Dishes knows about who&rsquo;s eating: dietary needs, tastes and this week&rsquo;s meals.
      </p>
    </div>
  );
}

/** Every dish the AI read, by section; tapping one chooses it for its course. */
function WholeMenu({
  menu,
  chosenItems,
  onPick,
  forName,
}: {
  menu: ReadMenu;
  chosenItems: Set<number>;
  onPick: (item: number) => void;
  forName: string | null;
}) {
  const sections: { title: string | null; items: ReadMenu["items"] }[] = [];
  for (const it of menu.items) {
    const last = sections.at(-1);
    if (last && last.title === it.section) last.items.push(it);
    else sections.push({ title: it.section, items: [it] });
  }
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Tap a dish to choose it{forName ? ` for ${forName}` : ""} — it goes in as its course.</p>
      {sections.map((s, i) => (
        <section key={`${s.title}-${i}`} className="space-y-1.5">
          {s.title && <SectionLabel>{s.title}</SectionLabel>}
          <div className="divide-y divide-border overflow-hidden rounded-2xl bg-muted">
            {s.items.map((it) => {
              const on = chosenItems.has(it.id);
              return (
                <button key={it.id} type="button" onClick={() => onPick(it.id)} className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-left", on ? "bg-highlight" : "hover:bg-card")}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">{it.line}</span>
                    {it.kcal && <span className="block text-xs text-muted-foreground">{it.kcal} kcal on the menu</span>}
                  </span>
                  {on ? <Check className="h-4 w-4 shrink-0 text-primary" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
