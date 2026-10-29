import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { OUTSIDE_MEAL_COURSES, type OutsideMealCourseType } from "@dishes/shared";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { householdClock } from "@/lib/integration-meal-times";
import { MENU_MOODS, type MenuMood } from "@/lib/menu-choice";
import { readMenuSchema } from "@/lib/ai/menu-reader";
import { collectMenuPicks, prepareMenuPicks, type MenuPickEvent } from "@/lib/services/menu-picks";
import { OutsideMealValidationError } from "@/lib/services/outside-meals";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const files = (form: FormData, name: string) =>
  form.getAll(name).filter((v): v is File => v instanceof File && v.size > 0);
const strings = (form: FormData, name: string) =>
  form.getAll(name).filter((v): v is string => typeof v === "string" && v.trim() !== "");
const isCourse = (v: string): v is OutsideMealCourseType => (OUTSIDE_MEAL_COURSES as readonly string[]).includes(v);
const isMood = (v: string): v is MenuMood => (MENU_MOODS as readonly string[]).includes(v);

/**
 * "Help me choose": suggestions from a menu for each person eating, from the
 * diner brief. multipart/form-data:
 * - the menu, any of `photo` (up to 4), `pdf`, `url`, `text` — or `menu`, the
 *   menu JSON a previous answer returned (no reading it again);
 * - `member` (repeat; none means everyone), `date` (default today);
 * - what they're after: `course` (repeat; default main), `mood` (repeat), `note`;
 * - for "something else": `swapDiner`, `swapCourse`, `exclude` (repeat, item
 *   numbers), `hint` — with `menu`.
 *
 * With `Accept: application/x-ndjson` the answer streams as one JSON event per
 * line (stage, fact, dish, menu, pick, avoid, done or error) as the AI works;
 * otherwise it waits and answers the whole thing as one JSON object. Nothing
 * is saved. The web reaches it as /api/web/outside-meals/menu-picks.
 */
export const POST = withApiErrors(async (req: NextRequest) => {
  const session = await requireSession();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new OutsideMealValidationError("Send the menu as multipart/form-data.");
  }

  const text = (name: string) => {
    const v = form.get(name);
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const date = text("date") ?? (await householdClock(session.householdId)).today;
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(date))) {
    throw new OutsideMealValidationError("date must be YYYY-MM-DD");
  }

  let menu = null;
  const menuField = text("menu");
  if (menuField) {
    try {
      menu = readMenuSchema.parse(JSON.parse(menuField));
    } catch (err) {
      throw new OutsideMealValidationError(
        err instanceof z.ZodError || err instanceof SyntaxError ? "menu isn't a menu this API returned." : "Bad menu."
      );
    }
  }

  const swapDiner = text("swapDiner");
  const swapCourse = text("swapCourse");
  let swap = null;
  if (swapDiner || swapCourse) {
    if (!swapDiner || !swapCourse || !isCourse(swapCourse)) {
      throw new OutsideMealValidationError("A swap needs swapDiner and a swapCourse (starter, main, side, dessert or drink).");
    }
    if (!menu) throw new OutsideMealValidationError("A swap needs the menu from the first answer.");
    swap = {
      diner: swapDiner,
      course: swapCourse,
      exclude: strings(form, "exclude").map(Number).filter(Number.isInteger),
      hint: text("hint")?.slice(0, 300) ?? null,
    };
  }

  const [pdf] = files(form, "pdf");
  const photos = await Promise.all(
    files(form, "photo").map(async (f) => ({ body: Buffer.from(await f.arrayBuffer()), type: f.type }))
  );

  const { names, run } = await prepareMenuPicks(session.householdId, {
    date,
    diners: strings(form, "member"),
    wants: {
      courses: [...new Set(strings(form, "course").filter(isCourse))],
      moods: [...new Set(strings(form, "mood").filter(isMood))],
      note: text("note")?.slice(0, 500) ?? null,
    },
    sources: {
      photos,
      pdf: pdf ? Buffer.from(await pdf.arrayBuffer()) : null,
      url: text("url"),
      text: text("text"),
    },
    menu,
    swap,
  });

  if (!(req.headers.get("accept") ?? "").includes("application/x-ndjson")) {
    const events: MenuPickEvent[] = [];
    await run((e) => events.push(e));
    return NextResponse.json(collectMenuPicks(events, names));
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      await run((e) => controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`)));
      controller.close();
    },
  });
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      // Through Traefik and Next untouched, a line at a time.
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
});
