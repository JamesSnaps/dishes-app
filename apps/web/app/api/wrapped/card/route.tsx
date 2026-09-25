/**
 * Shareable Wrapped cards: a 1080×1920 PNG (story-sized, for Instagram /
 * WhatsApp status / messages) of one Wrapped slide. Rendered by next/og's
 * satori, which takes inline styles rather than Tailwind classes, and flex
 * layout only. Emoji are left out: satori would have to fetch them from a CDN.
 * Fonts are Inter (OFL), bundled in assets/fonts — satori's built-in font has
 * no bold weights.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import type { ReactElement, ReactNode } from "react";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { getWrappedReport, type WrappedReport } from "@/lib/services/wrapped";

export const runtime = "nodejs";

// cwd is apps/web in dev, but the repo root in the standalone Docker image.
const FONT_DIR = [join(process.cwd(), "assets/fonts"), join(process.cwd(), "apps/web/assets/fonts")].find((d) =>
  existsSync(d)
);

let fontsPromise: Promise<{ name: string; data: Buffer; weight: 600 | 800 | 900; style: "normal" }[]> | null = null;
function loadFonts() {
  if (!FONT_DIR) return Promise.resolve([]);
  fontsPromise ??= Promise.all(
    ([600, 800, 900] as const).map(async (weight) => ({
      name: "Inter",
      data: await readFile(join(FONT_DIR, `Inter-${weight}.ttf`)),
      weight,
      style: "normal" as const,
    }))
  );
  return fontsPromise;
}

const W = 1080;
const H = 1920;
const n = (v: number) => v.toLocaleString("en-GB");

function Frame({ bg, r, children }: { bg: string; r: WrappedReport; children: ReactNode }) {
  return (
    <div
      style={{
        width: W,
        height: H,
        display: "flex",
        flexDirection: "column",
        background: bg,
        color: "white",
        padding: 96,
        fontFamily: "Inter",
        fontWeight: 600,
        position: "relative",
      }}
    >
      <div style={{ position: "absolute", top: -200, left: -200, width: 700, height: 700, borderRadius: 700, background: "rgba(255,255,255,0.18)" }} />
      <div style={{ position: "absolute", bottom: -260, right: -220, width: 800, height: 800, borderRadius: 800, background: "rgba(0,0,0,0.18)" }} />
      <div style={{ display: "flex", fontSize: 40, fontWeight: 800, letterSpacing: 6, textTransform: "uppercase", opacity: 0.9 }}>
        Dishes Wrapped {r.year}
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>{children}</div>
      <div style={{ display: "flex", fontSize: 36, fontWeight: 700, opacity: 0.85 }}>{r.householdName}</div>
    </div>
  );
}

const kicker = { display: "flex", fontSize: 52, fontWeight: 700, opacity: 0.9 } as const;
const huge = { display: "flex", fontSize: 260, fontWeight: 900, lineHeight: 1, letterSpacing: -8 } as const;
const big = { display: "flex", fontSize: 120, fontWeight: 900, lineHeight: 1.05, letterSpacing: -3 } as const;

function List({ items }: { items: { name: string; sub: string }[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28, marginTop: 56 }}>
      {items.map((x, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 36, background: "rgba(255,255,255,0.15)", borderRadius: 36, padding: "32px 40px" }}>
          <div style={{ display: "flex", fontSize: 80, fontWeight: 900, width: 70 }}>{i + 1}</div>
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div style={{ display: "flex", fontSize: 54, fontWeight: 800 }}>{x.name.length > 32 ? x.name.slice(0, 31) + "…" : x.name}</div>
            <div style={{ display: "flex", fontSize: 36, opacity: 0.75 }}>{x.sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function times(c: number) {
  return `${n(c)} ${c === 1 ? "time" : "times"}`;
}

function card(kind: string, r: WrappedReport): ReactElement {
  const t = r.totals;
  const top = r.topRecipes[0];
  const ing = r.topIngredients[0];
  const cuisine = r.topCuisines[0];

  switch (kind) {
    case "meals":
      return (
        <Frame bg="linear-gradient(135deg, #10b981, #14b8a6 50%, #0891b2)" r={r}>
          <div style={kicker}>We sat down to</div>
          <div style={{ ...huge, marginTop: 40 }}>{n(t.meals)}</div>
          <div style={{ ...kicker, fontSize: 80, fontWeight: 900, opacity: 1 }}>meals</div>
          <div style={{ ...kicker, marginTop: 60 }}>{n(t.distinctRecipes)} recipes · {n(t.newRecipes)} brand new</div>
        </Frame>
      );
    case "top-meal":
      if (!top) break;
      return (
        <Frame bg="linear-gradient(135deg, #fbbf24, #f97316 50%, #dc2626)" r={r}>
          <div style={kicker}>Our top dish of {r.year}</div>
          <div style={{ ...big, marginTop: 48 }}>{top.title}</div>
          <div style={{ ...kicker, marginTop: 48 }}>On the menu {times(top.count)}</div>
        </Frame>
      );
    case "top-five":
      return (
        <Frame bg="linear-gradient(180deg, #18181b, #18181b 50%, #064e3b)" r={r}>
          <div style={kicker}>Our top dishes on repeat</div>
          <List items={r.topRecipes.map((x) => ({ name: x.title, sub: times(x.count) }))} />
        </Frame>
      );
    case "ingredient":
      if (!ing) break;
      return (
        <Frame bg="linear-gradient(135deg, #a3e635, #22c55e 50%, #047857)" r={r}>
          <div style={kicker}>Our MVP ingredient</div>
          <div style={{ ...big, fontSize: 150, marginTop: 48 }}>{ing.name}</div>
          <div style={{ ...kicker, marginTop: 40 }}>In {n(ing.count)} meals</div>
          <List items={r.topIngredients.slice(1, 5).map((x) => ({ name: x.name, sub: `${n(x.count)} meals` }))} />
        </Frame>
      );
    case "cuisine":
      if (!cuisine) break;
      return (
        <Frame bg="linear-gradient(135deg, #0ea5e9, #2563eb 50%, #4338ca)" r={r}>
          <div style={kicker}>We explored {t.cuisines} {t.cuisines === 1 ? "cuisine" : "cuisines"}</div>
          <div style={{ ...kicker, marginTop: 60 }}>but our heart belongs to</div>
          <div style={{ ...big, fontSize: 160, marginTop: 24 }}>{cuisine.name}</div>
          <div style={{ ...kicker, marginTop: 40 }}>{n(cuisine.count)} meals</div>
        </Frame>
      );
    case "personality":
      return (
        <Frame bg="linear-gradient(135deg, #f43f5e, #c026d3 50%, #6d28d9)" r={r}>
          <div style={kicker}>Our cooking personality</div>
          <div style={{ ...big, marginTop: 48 }}>{r.personality.title}</div>
          <div style={{ ...kicker, marginTop: 48, lineHeight: 1.3 }}>{r.personality.blurb}</div>
        </Frame>
      );
  }

  // summary (and the fallback for anything with no data)
  return (
    <Frame bg="linear-gradient(135deg, #c026d3, #f43f5e 50%, #fb923c)" r={r}>
      <div style={{ ...big, fontSize: 110 }}>Our {r.year} in Dishes</div>
      <div style={{ display: "flex", gap: 48, marginTop: 72 }}>
        {[
          { label: "Top dishes", items: r.topRecipes.map((x) => x.title) },
          { label: "Top ingredients", items: r.topIngredients.map((x) => x.name) },
        ].map((col) => (
          <div key={col.label} style={{ display: "flex", flexDirection: "column", flex: 1, gap: 14 }}>
            <div style={{ display: "flex", fontSize: 34, fontWeight: 800, textTransform: "uppercase", opacity: 0.8 }}>{col.label}</div>
            {col.items.slice(0, 5).map((x, i) => (
              <div key={i} style={{ display: "flex", fontSize: 42, fontWeight: 700 }}>
                {i + 1}. {x.length > 18 ? x.slice(0, 17) + "…" : x}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 28, marginTop: 72 }}>
        {[
          { label: "Meals", value: n(t.meals) },
          { label: "Recipes", value: n(t.distinctRecipes) },
          { label: "Cuisines", value: n(t.cuisines) },
        ].map((s) => (
          <div key={s.label} style={{ display: "flex", flexDirection: "column", flex: 1, background: "rgba(0,0,0,0.2)", borderRadius: 32, padding: 32 }}>
            <div style={{ display: "flex", fontSize: 96, fontWeight: 900 }}>{s.value}</div>
            <div style={{ display: "flex", fontSize: 32, fontWeight: 800, textTransform: "uppercase", opacity: 0.8 }}>{s.label}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", fontSize: 64, fontWeight: 900, marginTop: 72 }}>{r.personality.title}</div>
    </Frame>
  );
}

export async function GET(req: NextRequest) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);
  const year = Number(req.nextUrl.searchParams.get("year")) || undefined;
  const kind = req.nextUrl.searchParams.get("card") ?? "summary";
  const report = await getWrappedReport(householdId, year);
  return new ImageResponse(card(kind, report), {
    width: W,
    height: H,
    fonts: await loadFonts(),
    headers: { "Cache-Control": "private, no-store" },
  });
}
