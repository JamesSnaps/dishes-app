import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { householdClock } from "@/lib/integration-meal-times";
import { chooseFromMenu } from "@/lib/services/menu-picks";
import { OutsideMealValidationError } from "@/lib/services/outside-meals";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const files = (form: FormData, name: string) =>
  form.getAll(name).filter((v): v is File => v instanceof File && v.size > 0);

/**
 * "Help me choose": suggestions from a menu for each person eating, from the
 * diner brief. multipart/form-data, any of: `photo` (up to 4), `pdf`, `url`,
 * `text` — plus `member` (repeat for each person eating; none means
 * everyone) and `date` (YYYY-MM-DD, default today). Waits for the AI (10–30 s)
 * and answers the picks; nothing is saved. The web reaches it as
 * /api/web/outside-meals/menu-picks.
 */
export const POST = withApiErrors(async (req: NextRequest) => {
  const session = await requireSession();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new OutsideMealValidationError("Send the menu as multipart/form-data.");
  }

  const dateField = form.get("date");
  const date = typeof dateField === "string" && dateField ? dateField : (await householdClock(session.householdId)).today;
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(date))) {
    throw new OutsideMealValidationError("date must be YYYY-MM-DD");
  }

  const text = (name: string) => {
    const v = form.get(name);
    return typeof v === "string" && v.trim() ? v : null;
  };
  const [pdf] = files(form, "pdf");
  const photos = await Promise.all(
    files(form, "photo").map(async (f) => ({ body: Buffer.from(await f.arrayBuffer()), type: f.type }))
  );

  const picks = await chooseFromMenu(session.householdId, {
    date,
    diners: form.getAll("member").filter((v): v is string => typeof v === "string"),
    sources: {
      photos,
      pdf: pdf ? Buffer.from(await pdf.arrayBuffer()) : null,
      url: text("url"),
      text: text("text"),
    },
  });
  return NextResponse.json(picks);
});
