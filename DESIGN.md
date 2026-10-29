# Dishes — Design System ("Cookbook")

Status: **adopted 29 Oct 2026; migration complete (v1.72.0). Every screen,
web and iOS, is on the tokens, the planner picks its layout by width, and the
colour check's baseline is zero.** The checklist lives in
`TODO.md` → *Design refresh (Cookbook)*. Mockups (phone, iPad landscape, iPad
portrait, planner by width): <https://claude.ai/artifact/1P1nVaCQ4yLGWuxSmkGBzy>,
row B.

The idea: the app should feel like a well-made cookbook. Food is the colourful
part; everything around it is calm, warm and quiet. Every colour has one job.

---

## Why we're changing

An audit of `apps/web` (Oct 2026) found:

- ~2,400 hard-coded Tailwind palette classes (`bg-orange-500`, `text-violet-600`…)
  across 20 hue families, against ~1,900 uses of theme tokens
- `orange-500` written out 643 times even though `--primary` is already orange
- 247 gradients in 72 different combinations
- 103 `bg-white`, which ignore the theme and break in dark mode

The old CLAUDE.md rule ("no wireframe UI — use gradients, tints, shadows") made
screens feel alive but said nothing about *which* colours, so every feature
invented its own. This document is that missing half.

---

## The rules

1. **No raw palette classes in app code.** Use the tokens below
   (`bg-primary`, `text-muted-foreground`, `bg-success-tint`…). No
   `bg-orange-500`, no `bg-white`, no hex in `className`. Exceptions are listed
   at the end.
2. **No gradients** except the image scrim on photos and the plate placeholder.
3. **Colour means something:**
   | Colour | Means |
   |---|---|
   | Terracotta (`primary`) | The main action, the brand, *today*, *selected* |
   | Ink (`ink`) | AI, and strong neutral actions |
   | Herb green (`success`) | Healthy, done, on track |
   | Ochre (`warning`) | Needs attention ("no oily fish yet") |
   | Red (`destructive`) | Delete, error |
   | Everything else | Cream, warm greys, hairlines |
4. **AI has no colour of its own.** AI actions are ink buttons with the sparkle
   icon (`Sparkles` from lucide). Violet is gone.
5. **Meal types are labelled, not colour-coded.** Breakfast/Lunch/Dinner appear
   as small-caps section labels. (The old amber/violet/indigo/pink coding goes.)
6. **One terracotta button per area.** If two things compete, one becomes
   `secondary`.
7. **Boxes are earned.** Lists are hairline-separated, not stacks of bordered
   cards. Tinted panels group related things. Raised white cards are only for
   things that float: dialogs, sheets, popovers, the cooking mini-bar.
8. **Clickable must look clickable** (this survives from the old rule): buttons
   are filled pills; links in lists are whole rows with a chevron or thumbnail;
   never bare text for a primary action.

---

## Tokens

All colours are CSS variables in `apps/web/app/globals.css` (HSL triples, the
shadcn convention) with matching entries in `apps/ios/Dishes/Design/Theme.swift`.
Contrast figures are against the surface the token is used on; all pass WCAG AA
(4.5:1) for body text.

| Token | Light | Dark | Used for |
|---|---|---|---|
| `background` | `#FBF7F0` | `#1A1714` | Page |
| `foreground` | `#2A2420` | `#F3EDE4` | Body text |
| `card` | `#FFFDF8` | `#24201C` | Floating surfaces only (dialogs, sheets, popovers) |
| `muted` | `#F1EADF` | `#2E2924` | Tinted panels, search fields |
| `muted-foreground` | `#6E6259` (5.5:1) | `#B3A79A` (7.6:1) | Secondary text, labels |
| `secondary` | `#EDE3D3` | `#38312B` | Secondary buttons, chips |
| `primary` | `#B5462B` (white text 5.4:1) | `#E07A5F` (dark text 6.1:1) | Main action, brand, today, selected |
| `primary-foreground` | `#FFFFFF` | `#1A1714` | Text on primary |
| `ink` | `#2A2420` | `#F3EDE4` | AI buttons, strong neutral buttons |
| `ink-foreground` | `#FBF7F0` | `#1A1714` | Text on ink |
| `success` | `#3D6B4F` | `#8FBF9F` | Healthy, done (text and icons) |
| `success-tint` | `#E3EDE4` | `#22322A` | Healthy panels, "Heart healthy" badge |
| `warning` | `#8A5A0B` | `#E0B45C` | Needs attention (text and icons) |
| `warning-tint` | `#F6E7C1` | `#3A2E16` | Warning panels |
| `destructive` | `#B42318` | `#F07A6A` | Delete, errors |
| `highlight` | `#F6EEE3` | `#3A2C24` | Today's column/row, the open day |
| `plate` | `#E6D8C2` | `#3A322A` | Behind food images and placeholders |
| `border` | `#E8DFD1` | `#3A332D` | Hairlines |
| `input` | `#DCCFBC` | `#4A4139` | Input borders, dashed "add" outlines |
| `ring` | = `primary` | = `primary` | Focus ring |

`accent` and `popover` map to `muted` and `card` so shadcn components keep working.

Ready to paste into `globals.css`:

```css
:root {
  --background: 38 58% 96%;
  --foreground: 24 14% 15%;
  --card: 43 100% 99%;
  --card-foreground: 24 14% 15%;
  --popover: 43 100% 99%;
  --popover-foreground: 24 14% 15%;
  --primary: 12 62% 44%;
  --primary-foreground: 0 0% 100%;
  --secondary: 37 42% 88%;
  --secondary-foreground: 24 14% 15%;
  --muted: 37 39% 91%;
  --muted-foreground: 26 11% 39%;
  --accent: 37 39% 91%;
  --accent-foreground: 24 14% 15%;
  --ink: 24 14% 15%;
  --ink-foreground: 38 58% 96%;
  --success: 143 27% 33%;
  --success-tint: 126 22% 91%;
  --warning: 37 85% 29%;
  --warning-tint: 43 75% 86%;
  --destructive: 4 76% 40%;
  --destructive-foreground: 0 0% 100%;
  --highlight: 35 51% 93%;
  --plate: 37 42% 83%;
  --border: 37 33% 86%;
  --input: 36 31% 80%;
  --ring: 12 62% 44%;
  --radius: 1rem;
}

.dark {
  --background: 30 13% 9%;
  --foreground: 36 38% 92%;
  --card: 30 13% 13%;
  --card-foreground: 36 38% 92%;
  --popover: 30 13% 13%;
  --popover-foreground: 36 38% 92%;
  --primary: 13 68% 63%;
  --primary-foreground: 30 13% 9%;
  --secondary: 28 13% 19%;
  --secondary-foreground: 36 38% 92%;
  --muted: 30 12% 16%;
  --muted-foreground: 31 14% 65%;
  --accent: 30 12% 16%;
  --accent-foreground: 36 38% 92%;
  --ink: 36 38% 92%;
  --ink-foreground: 30 13% 9%;
  --success: 140 27% 65%;
  --success-tint: 150 19% 16%;
  --warning: 40 68% 62%;
  --warning-tint: 40 45% 16%;
  --destructive: 7 82% 68%;
  --destructive-foreground: 30 13% 9%;
  --highlight: 22 23% 18%;
  --plate: 30 16% 20%;
  --border: 28 13% 20%;
  --input: 28 13% 26%;
  --ring: 13 68% 63%;
}
```

`tailwind.config.ts` gains `ink`, `success`, `warning`, `highlight` and `plate`
under `theme.extend.colors` (same `hsl(var(--x))` pattern as the existing
tokens, with `DEFAULT`/`foreground`/`tint` keys).

### Charts

Stats charts need several distinguishable colours, so they get their own
`--chart-1` … `--chart-5` tokens: terracotta, herb, ochre, a slate blue
(`#4A6A8A`) and plum (`#7A4A6E`), each with a dark-mode value. Charts use those
and nothing else.

---

## Type

| Role | Font | Size / weight |
|---|---|---|
| Page title | Fraunces | 34–38px, 600 |
| Section / day heading | Fraunces | 22–30px, 600 |
| Recipe title (cards, lists) | Fraunces | 15–18px, 600 |
| Notes, descriptions, "eating out" | Fraunces italic | 14–16px, 500 |
| Overline / slot label | System sans | 11–12px, 700, uppercase, `tracking-[.08em]` |
| Body, buttons, forms, numbers | System sans (SF Pro) | 13–17px |

- **Web:** load Fraunces with `next/font/google` (the app already does this for
  Caveat), which self-hosts it at build time, so there are no requests to
  Google at runtime. Expose it as `--font-serif` and Tailwind `font-serif`.
- **iOS:** bundle the Fraunces variable font (SIL Open Font License) in the app
  and the widget extension; fall back to the system serif (`.serif` design,
  i.e. New York) if it fails to load.
- Cooking mode keeps its large sans text. Serif is for reading and browsing,
  not for reading steps from across the kitchen.

---

## Shape and depth

- Radius: pills (`rounded-full`) for buttons and chips; `rounded-2xl` (16–20px)
  for panels and images; `rounded-xl` (12–14px) for thumbnails.
- Shadows: only on floating things (`shadow-lg` on dialogs and sheets, a soft
  shadow under plate placeholders). Panels and list rows have none.
- Hairlines: `border-border`, 1px, between list rows and sections.
- Touch targets: 44px minimum (`h-11`); the main action on a screen is 52–54px.

---

## Components (`packages/ui`)

**Button**: always a pill.

| Variant | Look | Use |
|---|---|---|
| `default` | terracotta fill | The one main action ("Start cooking", "Save") |
| `secondary` | `secondary` fill | Everything else that matters ("Add to plan", "Shop") |
| `ink` *(new)* | ink fill | AI actions (with sparkle), strong neutral actions |
| `outline` | 1.5px `input` border | Rare: toggles, filters |
| `ghost` | none | Icon buttons in toolbars only |
| `destructive` | red fill | Delete confirmation |
| `link` | terracotta text | Inline links |

Sizes: `sm` h-9, `default` h-11, `lg` h-[52px], `icon` h-11 w-11.

**Card**: three variants replace "white box with a border":

- `plain`: no background, no border. Use it for content in lists.
- `panel`: `bg-muted`, `rounded-2xl`, no border. Groups related things.
- `raised`: `bg-card` with a shadow. Only for floating UI.

`<Card>` with no variant is `raised`, which is closest to the old bordered card
so existing uses don't change shape. In new code, always name the variant.

**Badge**: `neutral` (secondary fill), `success` (tint + success text),
`warning` (tint + warning text), `brand` (primary text on highlight).

**New primitives** (`packages/ui/src/components/cookbook.tsx`):

- `SectionLabel`: the small-caps overline ("BREAKFAST", "TONIGHT · 6:30PM").
  `tone="brand"` for terracotta.
- `Plate`: image with the `plate` background; when there's no photo it draws
  the placeholder plate rather than a grey box with an icon.
- `AiButton`: `Button variant="ink"` with the sparkle icon. The only way AI
  features are marked.
- The planner's pieces live with it, in
  `app/(app)/meal-plan/_components/planner-layouts.tsx`: `DayRow` (a folded
  day, also the open day's drop target), `WeekGrid`, `WeekGlance` and
  `usePlannerLayout`, which measures the planner and picks the layout.

**iOS** (`apps/ios/Dishes/Design/Theme.swift`) mirrors all of this:
`Theme.brand`, `.ink`, `.success`, `.highlight`, `.plate`…; `Theme.serif(size,
weight:, italic:)`; `.buttonStyle(.primary / .secondary / .ink)`;
`.card()` (raised) and `.panel()`; `BadgeView` styles; `SectionLabel`;
`PlateView`; `Theme.chart1`…`chart5` for Stats. The planner's layouts are in
`PlanScreen` (`foldView`, `splitView`, `weekGrid`, picked from the measured
width). The widgets, watch app and share extension can't see `Theme`, so they
copy the values they use (terracotta, herb, ink; dark-mode values on the watch).

---

## Patterns

**Recipe card**: square `Plate` image, serif title under it, one line of
muted meta ("45 min · Japanese"). No card box. Favourite heart sits on the
image.

**Recipe detail**: full-width image; overline (cuisine · role); serif title;
italic one-line description; stats as a hairline-divided row; terracotta
"Start cooking" pill; `secondary` Plan / Shop and `ink` Ask; serif text tabs
with a terracotta underline.

**Planner**: pick the layout by **window width**, not by device. In SwiftUI,
measure the width: size class alone can't tell a ⅔ split from full screen.

| Width | Layout | Covers |
|---|---|---|
| < 700pt | **Fold-up days.** Today is open; other days are one row (mini plates, the day's dinner, "+2 more · 3 meals"). Tapping a day opens it and closes the others. | Phone, Slide Over, ⅓ and ½ splits |
| 700–1100pt | **Day list + open day.** The same folded rows on the left (290px), the selected day in full on a `highlight` panel on the right, and a "Week at a glance" panel under the list. | iPad portrait, ⅔ split in landscape |
| ≥ 1100pt | **Week grid.** Days as columns, meal slots as rows, today's column tinted `highlight`. Empty slots show a faint "+"; a missing dinner shows "+ Add dinner" in terracotta. | iPad landscape, desktop |

Inside a day: slots in order (breakfast, lunch, dinner, snack, dessert), each
with a `SectionLabel`. A grouped meal shows its name in italic ("Katsu night"),
the main dish with a large thumbnail and time, and sides smaller beneath. Eating
out shows a fork-and-knife tile and an italic place name.

**AI at work** (Help me choose): a slow AI answer shows its work instead
of a spinner. A `muted` panel holds the stage ("Reading the menu…") with a
small spinner, a short list of what it's weighing (muted text, each with a
`success` tick), and the items it reads as small `card` pills, each arriving
with the `rise-in` animation (iOS: a scale-and-fade transition); the panel
settles into a one-line summary when it's done. Results arrive into their final
places as they come, not all at the end. The best option in a group is chosen
for you (terracotta tick on a `highlight` row), and the AI's own actions on
the results ("Find another main") are `ink`.

**Form options**: settings that sit beside a main input (meal, who's eating,
heart-healthy) are rows in one `muted` panel, hairline-divided: label left
(with a muted line of detail if needed), control right. A choice from a list
is a menu whose current value is a `card` pill with an up-down chevron
("Dinner ⌃⌄", "Alice & Louis ⌃⌄"), not a wrap of chips. Optional prompts such
as starter ideas go behind one small `secondary` pill ("Need an idea?").
(iOS `ConciergeSheet` first.)

**Empty states**: one italic serif sentence plus a dashed-outline "add"
button. Make it a suggestion where there's a reason ("No oily fish this week,
so it's a good night for it").

---

## Exceptions

- **Wrapped** (`app/(cook)/wrapped`): the year-in-review story is meant to
  be showy and may use its own palette and gradients, drawn from the brand
  colours where it can.
- **The iOS Book** (`apps/ios/Dishes/Book`): the aged-paper cookbook with
  handwriting and stains has its own `Paper` palette on purpose.
- **User content**: photos, and any colour a user picks themselves.
- **Charts**: `--chart-*` only (see above).
- **Third-party marks**: delivery service logos, etc.

---

## Keeping it tidy

`pnpm --filter @dishes/web check:colours` (`apps/web/scripts/check-colours.ts`)
counts, per file, raw palette classes (including `dark:` and `hover:` forms),
`bg-white`, arbitrary hex colours (`bg-[#…]`) and `bg-gradient-*`, outside the
exceptions, and compares them with `apps/web/colour-baseline.json` (2,610
across 103 files when it was created; zero since v1.72.0). A file may not go
above its baseline, and a file the baseline doesn't list may have none, so
with the baseline at zero any raw colour fails the check. The `Checks`
workflow runs it on every PR and push to `main`.

Photo overlays may use `bg-black/…` with white text (a scrim over a picture
isn't a theme colour); everything else uses tokens.

---

## Migration plan

Counts are hard-coded colour classes per area, measured Oct 2026. Each phase is
one PR: web and the matching iOS screens together, checked in light and dark
mode and at phone, iPad portrait and iPad landscape widths.

| Phase | What | Size | Notes |
|---|---|---|---|
| 0 | **Guardrail**: colour check + baseline, CLAUDE.md rule | small | Stops the count growing before anything else changes |
| 1 | **Foundations**: tokens (light + dark), Tailwind config, Fraunces, `Button`/`Card`/`Badge` variants, `SectionLabel`/`Plate`/`AiButton`; iOS `Theme.swift` tokens + bundled Fraunces | medium | Every token-based screen turns cream and terracotta at once; raw-class screens lag until their phase. Ship with phase 2 straight after so the frame changes together. Minor version bump. |
| 2 | **App shell**: bottom nav, side nav, page headers, AI concierge button, cooking mini-bar, offline/sync indicators | small (~60) | Done. Every page title in the app shell is Fraunces via `[&_h1]:font-serif` on `<main>`; screens refine their headers in their own phase. |
| 3 | **Recipes**: list, card, filters, detail, form, imports | 363 | Done. Also the shared libraries, which use the same card. Star ratings are terracotta (web and iOS); recipes without a photo show the `Plate` everywhere `RecipeImage` is used on iOS. The concierge (phase 6) and cooking mode (phase 4) are untouched. |
| 4 | **Cooking mode** (`app/(cook)/recipes`) | 238 | Done (v1.72.0). Keeps large sans type; colours only |
| 5 | **Planner**: new layouts by width, `DayRow`/`WeekGrid`, meal-type colours removed | 532 | Done. The open day names each slot with a `SectionLabel`; combined meals are italic with the main dish large; meals out are a plate tile and an italic place. The week grid's "+ Add dinner" opens the add dialog on that slot. iOS has the same three layouts. |
| 6 | **AI concierge**: violet → ink | 447 | Done (v1.72.0). Mostly mechanical |
| 7 | **Settings** | 423 | Done (v1.72.0). Mechanical |
| 8 | **The rest**: meals eaten out (139), meals (88), stats (79, chart tokens), memories (41), deliveries (44), shopping (34), cook review (30), onboarding (20), shared, pantry | ~500 | Done (v1.72.0). Can be split across several PRs |
| 9 | **Clean-up**: remove the legacy colours and gradients from `Theme.swift`, set the colour check to zero, watch app and widgets | small | Done (v1.72.0). |

Phases 3–8 don't depend on each other once 1 and 2 have landed, so they can run
in parallel.

## Open questions

- **Photos:** the Cookbook look leans on food photos. Recipes without one get
  the plate placeholder. Is it worth nudging people to add photos (or generating
  them) more actively?
- **Watch app:** keep it on the system look (black, with terracotta as the
  accent) rather than cream? Recommended: yes.
