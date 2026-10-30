# Dishes — Build Checklist

Tracks remaining work for Phase 1. Update this file as tasks are completed or added.

**v1.0.0** — every Phase 1 goal is shipped, along with collections, notes,
nutrition, taste profiles, cook history, shared libraries, the integrations
API, the offline PWA and the `/api/v1` surface the native app builds on. The
items still open below are optional extras or Phase 2 / mobile groundwork.

---

## Foundation
- [x] pnpm monorepo workspace (apps/web, packages/db, ui, api, shared)
- [x] Docker Compose stack (Postgres 16, Redis 7, MinIO, Next.js)
- [x] Drizzle schema (households, recipes, shopping, meal plans, integrations, AI config)
- [x] Authelia middleware + `lib/auth.ts` dev fallback
- [x] Generate + commit initial Drizzle migration
- [x] shadcn/ui component stubs in `@dishes/ui` (Button, Card, Input, Dialog, etc.)
- [x] App shell: mobile-first nav layout (bottom tab bar on mobile, sidebar on desktop)
- [x] Household bootstrap: first-run flow to create a household and add the Authelia user as admin
- [x] `next.config.ts` standalone output mode (required for Docker Dockerfile)
- [x] PWA `manifest.json`
- [x] `lib/env.ts` env validation on startup (zod)

## Recipe CRUD
- [x] Recipe list page (`/recipes`) — card grid, search, filter by cuisine/tag
- [x] Recipe detail page (`/recipes/[id]`) — full view with ingredients and steps
- [x] Create recipe form (`/recipes/new`) — structured ingredient rows, step builder
- [x] Edit recipe form (`/recipes/[id]/edit`)
- [x] Delete recipe (with confirmation)
- [x] Recipe image upload (to MinIO/S3)
- [x] AI image generation custom instructions — optional free-text prompt additions on top of the selected style (v0.47.0)
- [x] Ingredient & step sections — group ingredients/steps into named sub-recipes in the editor with drag-and-drop reordering/moving between sections; rendered across view/cook/print/share/export; AI generation uses them for multi-component recipes (v0.44.0)
- [x] Editor polish — drag preview overlay while reordering, draggable sections, emptying a section no longer deletes it, sticky save/cancel bar with the recipe name (v0.53.0)
- [x] "Ask AI" menu on the recipe page — free-form questions about the whole recipe (sides, timings, make-ahead) alongside Tweak and Find Similar (v0.54.0)
- [x] Edit or delete individual cook-history entries from the History tab (v0.54.0)
- [x] Clear AI conversation history — per-recipe "Clear all" in the ask sheet, plus an admin bulk purge in Settings by scope and age (v0.57.0)
- [x] Ask-AI answers render markdown (shared `MarkdownContent`, also used by cooking mode) and conversations are saved per recipe with a reopen/delete history list (v0.56.0, migration 0024)
- [x] `cook_history.source` — separates a logged cook from a bare rating so ratings no longer inflate the cook count; "Rating only" badge in the History tab (v0.55.0, migration 0023)
- [x] Favourite toggle
- [x] Cuisine and tag filtering

## Cooking Mode
- [x] Cooking mode page (`/recipes/[id]/cook`) — fullscreen, large text
- [x] Step-by-step navigation (prev/next)
- [x] Embedded countdown timers (per step, with label)
- [x] Timer completion alerts — audible chime (repeats until acknowledged), vibration, alert card with step preview + jump-to-step
- [x] Ingredient highlighting: active step cross-references ingredient IDs
- [x] Wake lock API (prevents screen sleep on mobile)
- [x] Recipe scaling UI (change serving count → recalculate all amounts)
- [x] Minimise cooking mode — persistent mini bar keeps the cook (step, servings, ticked ingredients, timers) alive while you use the rest of the app; timer alerts follow you app-wide
- [x] Deadline-based timers — accurate through backgrounded tabs and page reloads; sessions restore from localStorage and expire after 12 hours
- [x] Multiple concurrent cooks — sessions keyed by recipe with a fast switcher in the cooking-mode header; timers and alerts run across all of them (v0.58.0)
- [x] Cooking-mode ingredient lists and in-step highlighting follow the current step's section (v0.57.1)
- [x] In-cook AI quick-ask sees the whole recipe (all ingredients scaled to current servings, all steps, current step marked) rather than the current step alone (v0.53.0)

## Shopping Lists
- [x] Shopping list page (`/shopping`) — active list with check-off items
- [x] Generate list from recipe(s) — consolidates duplicate ingredients
- [x] Manual item addition
- [x] Add-field autocomplete on the web and in the iOS app — past list items (most bought, recently, first; picking one brings back its aisle) and recipe ingredient names, from the local store so it works offline; arrow keys + Enter on the web (`lib/shopping-suggestions.ts`, `DishesCore/Models/ShoppingSuggestions.swift`) (v1.50.0)
- [x] Check/uncheck items
- [x] Clear checked items
- [x] Archive/complete a list
- [x] Category grouping (produce, dairy, etc.)
- [x] "Search on Sainsbury's" link per item — opens Sainsbury's search results in new tab
- [x] Offline-first shopping list (IndexedDB via Dexie, optimistic mutations, Background Sync, SW page-shell cache)
- [x] App-shell offline via Serwist (`@serwist/next`): precaches build assets + caches RSC navigations (`cacheOnNavigation`), so section-switching works offline instead of hanging; push/notification/Background-Sync handlers folded into the generated worker (v0.37.0)
- [x] Refresh-on-resume for shopping + meal plan (foreground re-sync when online) and Periodic Background Sync of the shopping cache where supported (Chrome/Android & desktop; no-ops on iOS) (v0.38.0)
- [x] Offline hardening: precached offline fallback page for unvisited routes, global offline indicator, ChunkLoadError auto-reload after redeploys, flush-before-periodic-refresh, dropped `reloadOnOnline` (v0.39.0)
- [x] Push-on-change: household Web Push when a recipe is pulled onto the shopping list, the week's shopping list is generated, or an AI meal plan is added (actor excluded via `autheliaUser`); manifest polish (app shortcuts, `id`, categories); recipe images cached ~30 days for offline cook mode (v0.40.0)

## Meal Planner
- [x] Meal plan week view (`/meal-plan`) — day tabs + meal list per day
- [x] Add recipe to a meal slot
- [x] Remove/swap recipe in a slot
- [x] Generate shopping list from current week's meal plan
- [x] Navigate between weeks
- [x] Move a meal into another week — "Move to… → Next/Previous week" in the entry menu, and drop onto the week arrows while dragging (next Monday / previous Sunday) (v1.14.0)
- [x] Dinner reminders — opt-in push saying when to start cooking tonight's dinner, timed from the household's real cook-mode durations (median of recent cooks, else recipe time × household pace factor); household + per-weekday dinner times in Settings → Dinner reminders, one-off per-date time / "no reminder" on the planner day header, "Push back 30 min" notification button; in-process scheduler started from `instrumentation.ts`, Redis-deduped (v1.12.0)
- [ ] Move the dinner reminder loop into the worker container when Phase 2's worker lands
- [x] Grocery deliveries — weekly delivery days + order deadline, holidays, one-off/skip/ordered per date, next-order card and day markers on the planner, opt-in deadline-day push of what's outstanding with "Mark as ordered", post-order "added since you ordered" nudge (v1.21.0, migration 0039)
- [x] Deliveries step 2 — `POST /api/integrations/deliveries/email` (AI reads forwarded order emails: placed/amended/moved/cancelled/delivered, by order number), `POST …/deliveries/order` for pre-parsed details, `GET …/deliveries`, `read:deliveries`/`write:deliveries` scopes, order pushes (v1.22.0)
- [x] Deliveries step 3 — Stats → Grocery spend; `nextDelivery` on `GET /api/integrations/today` (v1.22.0)
- [x] "Book your delivery" reminder N days before (default 3) when no order is logged, with its own notification switch; holidays shown on the meal planner (web + iOS) (v1.65.0, migration 0046)
- [x] Edit an order's slot, total and order number by hand — planner card "Edit order", day chip menu, Settings → Grocery deliveries "Details"; saving marks the delivery ordered (v1.22.1)

## Combined Meals (e.g. Sunday roast)
- [x] Recipe roles (Main, Side, Sauce, Extra), role badges and library filters; AI accompaniment suggestions using selected dishes and optional context in saved meal editing and the planner; exclude accompaniments from automatic standalone meal selection (v1.20.0)
- [x] Mark a dish as a side (or main, sauce, extra) from the recipe page, generate a new side from a recipe, a combined meal, or the AI concierge, and filter the meal picker’s recipes by meal type, favourites and dish role (v1.23.0)
- [x] Step 1 — planned meal groups (`meal_plan_groups`, `group_id`/`meal_role` on entries) and saved meals (`meals`, `meal_components`); group card on the planner with swap/add/role/servings/move/split/remove, whole-meal shopping add, "Make into a meal…", Saved meals tab in the picker, save/update saved meal, `/meals` page; groups synced offline; `mealGroup` on integrations `today`/`week` (v1.15.0)
- [x] Saved meal options — dishes become slots with several recipe options (pick one / pick several), a chooser when adding that remembers last time's picks, one-tap swap chips on the planned meal (`meal_slots`, `meal_slot_options` replace `meal_components`) (v1.16.0)
- [x] Step 2 — meal cooking mode: "Cook this meal" starts every dish together, a tab per dish in cooking mode, and a whole-meal timers panel (v1.17.0)
- [x] Timer-end push notifications — running timers are handed to the server while the app is hidden (per device, Redis-backed, re-armed on restart, to-the-second `setTimeout`) and taken back on return; hint in cooking mode when the device has no push subscription (v1.19.0)
- [x] Step 3 — meal cooking schedule: ready-by time per meal (default: day's dinner time), simple back-to-back schedule with oven-clash warnings, "Plan with AI" (stored, invalidated when dishes change), a push per cue plus heads-up, next-cue times and timeline in cooking mode (v1.18.0)
- [x] "When did you start?" as a scheduled meal's cook begins (web and iOS): start now or earlier, then move dinner by the difference (serve time / day's dinner time, cues, pushes, Live Activity, planner chip) or keep the serve time; started early opens the first dish on the step it should be on; "Started at a different time…" mid-cook (v1.42.0)
- [ ] Optional step fields "hands-off" and oven temperature (editor, import and AI generation) to sharpen the simple schedule — the AI currently infers both from step text
- [ ] Saved meals in the native app (browse + add); groups already sync
- [ ] AI meal planner proposing combined meals

## AI — Recipe Generation (Concierge Flow)
- [x] AI config settings page (`/settings/ai`) — store encrypted API key per household
- [x] Concierge step 1: user describes preferences → AI returns 5 concept cards
- [x] Concierge step 2: user picks a concept
- [x] Concierge step 3: AI generates full structured recipe (ingredients + steps)
- [x] Save generated recipe to the library
- [x] Handle OpenAI errors gracefully (quota, key invalid, timeout)
- [x] Generation survives leaving the page — concept ideas, single recipes and multi-recipe batches run as server-side AI jobs (`lib/ai-jobs.ts`, polled at `/api/ai-jobs/{id}`), with an app-wide tray offering the result; long AI waits no longer run inside `startTransition`, which held navigation until the AI answered (v1.48.0)
- [x] Same for Plan My Week's draft plan — a `meal-plan` AI job (`startMealPlanJob`) for both a fresh plan and redoing slots; the tray's View plan brings back the plan tab with its inputs and the draft (v1.48.1)
- [ ] iOS: check whether leaving Create with AI mid-generation loses the result; if so, add `/api/v1` routes over the AI jobs and use them
- [x] Waiting on the AI shows real progress, not a spinner (DESIGN.md → Waiting on the AI): the week planner streams its facts, library photos and each meal as it's written (reels that land); ideas, recipes and adding a plan stream too (jobs' progress on the web, NDJSON for the app); steaming plates, a recipe checklist, rings, a developing photo, hopping plates and a plate spinner everywhere AI works, web and iOS (v1.74.0)
- [ ] Web "Add to plan" writes new ideas through a server action, so it can only show them steaming; move it to a job (or the streamed v1 route) to give it the per-recipe rings the app has
- [x] "New photo" on a recipe page that already has an image (on the hero image and under Ask AI) (v1.48.0)
- [x] Recipe page declutter: dish role as a badge that opens a dialog, nutrition collapsed to its calories line, and a two-column layout on wide screens (web ≥1280 px, iOS ≥1000 pt) with ingredients and method tabbed on the right (v1.49.0)

## Heart-healthy (cholesterol-lowering) diet
- [x] Saturated fat per serving (column, AI estimate, form, nutrition panel, share page, API)
- [x] Settings → Maintenance backfill for saturated fat on existing recipes
- [x] Heart-healthy filter + card badge (≤ 4 g sat fat, ≥ 3 g fibre per serving) — server, on-device and `/api/v1/recipes`
- [x] Concierge "Heart-healthy" option with nutrition check and one revision pass
- [x] "Make it heart-healthy" AI rewrite on the recipe page (save as copy or update original)
- [x] Meal planner "Heart-healthy week" quick-select (oily fish ×2, pulses ×3, red meat ≤1; filters high-sat-fat library recipes; new recipes go through the check pass)
- [x] "Cholesterol-lowering" member dietary toggle — AI guidance when they're eating, pre-selects heart-healthy in concierge + planner
- [x] Weekly nutrition card on the meal plan view (heart-healthy count, sat fat, fibre, protein targets)
- [x] Meal plan layout: action row replaces stats bar, sidebar removed, nutrition becomes a collapsible full-width strip
- [x] Nutrition swap suggestions (library matches + AI fallback that creates and swaps in a new recipe)
- [x] Heart-healthy status badges in the AI meal plan preview
- [x] AI meal plan preview modal (tap a meal for details, swap or remove it) (v1.11.0)
- [x] Crouton `.crumb` import moved from the recipes header to Settings → Import (v1.11.0)
- [x] Shopping list heart-healthy swap hints (only for households with a cholesterol-lowering member)

## Stats
- [x] Stats page (`/stats`): totals, heart health by week/month, protein mix vs targets, most eaten, cuisines, per person, "worth a look"
- [x] Stats: per-person view and "Download PDF" (print-to-PDF snapshot)
- [x] Dishes Wrapped (`/wrapped`): year-in-food story slides with shareable PNG cards
- [x] Per-person ratings on cooks; Wrapped favourites, disagreement and critics slides
- [x] Wrapped: photo collage, photo of the year, review quote, AI recap from review notes
- [x] Household ratings: each cook averages everyone's voices; per-person breakdown on recipes; planner avoids dishes an eater rated ≤2★
- [x] Edit a history entry with the full review form (duration, who ate, ratings, photo)
- [ ] Record who ate planned meals (not just logged cooks), so per-person stats don't have to assume everyone

## Meals Eaten Out
Meals not cooked from the library (restaurant, takeaway, at friends', skipped) are a gap in the
health picture: a steak out never counts towards the red-meat target, a takeaway's sat fat and
salt never reach the weekly averages, and Apple Health misses whole meals. Nutrition is the point
of this feature — without it, it's only a planner nicety.

Scope decisions (27 Oct 2026):
- A separate `outside_meals` table, household-scoped — **not** a nullable `recipe_id` on
  `meal_plan_entries`/`cook_history` (shopping, reminders, the integrations API and sync all assume
  a recipe) and **not** a placeholder "Eating out" recipe (would pool every restaurant's ratings
  and pollute the library and cuisine stats). A future date is a plan, a past date is a log
- Inputs, any combination: a typed description (the minimum), the **menu** (photo → Vision text
  on the device, or pasted text) and a **photo of the plate**. The menu line names the components
  ("8oz ribeye, triple-cooked chips, peppercorn sauce") and the plate photo shows portion size and
  what actually came; together they give the best estimate. A kcal figure printed on the menu
  (larger chains in England must show one) is taken as given and the other nutrients are scaled to it
- Device first for reading, server for numbers. On iOS 27 the on-device model turns the inputs
  into structured "what was eaten": components, main ingredients, cuisine, portion (lighter /
  typical / indulgent) — offline and instant. Main ingredients go through `proteinsOf()`, so
  heart-focus protein targets update before any numbers exist. The 8 nutrients are then estimated
  on the server with the household key, in the background (like scanned recipes), arriving on the
  next sync. iOS 27 has nothing usable for this: the Health app's camera rating is qualitative,
  never reaches HealthKit and has no API; label scanning only covers packaged food
- Estimates are labelled as estimates everywhere they show (restaurant food is rougher than a
  recipe: hidden butter/oil, unknown portions)

Steps:
- [x] Step 1 — schema + migration: `outside_meals` (`household_id`, `date`, `meal_type`, `kind`
  eat_out/takeaway/at_friends/skipped, `title`, `place`, `cuisine`, `components` jsonb,
  `main_ingredients` text[], `portion`, the 8 nutrient columns + `nutrition_source`
  (+ `menu_kcal`), `cooked_for`, `rating`, `member_ratings`, `notes`, `photo_url`,
  `menu_photo_url`). Same rating shapes as `cook_history` so the review UI is reused (v1.66.0, migration 0047)
- [x] Step 2 — server: CRUD actions + `/api/v1` routes; restaurant-portion nutrition estimator,
  a sibling of `estimateNutritionFor` in `app/actions/ai.ts` (same output schema; a one-portion,
  restaurant-aware prompt, menu kcal as an anchor, the plate photo when given); runs after save —
  `lib/ai/outside-meal-nutrition.ts`, `lib/services/outside-meals.ts` (v1.66.0)
- [x] Step 3 — planner: a "Not cooking" chip on a day (kind + place), which turns off that day's
  dinner reminder and stops AI planning and Plan My Week from filling the slot; a recipe still
  planned in the slot is marked as not counted (v1.66.0)
- [x] Step 4 — "Log a meal out" sheet (web): description, menu photo/text, plate photo, kind,
  place, who ate, rating; also reachable from the "Not cooking" chip once the day has passed
  (v1.66.0; own rating only — per-person ratings are stored but the sheet doesn't ask for them yet)
- [x] Step 5 — health: include in `summariseMeals()` for the week nutrition card and Stats heart
  health, and in `meal-history.ts` (Stats, Wrapped, taste profile, recent-meal variety for the
  AI planner). Rated meals out feed the taste profile; the red-meat words now include cuts and
  dishes (ribeye, burger, kofta…) so a meal out counts before the AI reads it (v1.66.0)
- [x] Step 6 — sync: new entity through the sync layer (web `sync-store`, `packages/client`,
  `DishesCore/Sync`, wire fixtures) — the biggest single cost. *Server, `packages/client` and the
  web store in v1.66.0 (Dexie v4 resnapshot); DishesCore in v1.67.0 (store migration
  `v2-outside-meals` resnapshots). The recorded wire fixture predates it and isn't re-recorded*
- [x] Step 7 — iOS (v1.67.0, **written without a Swift toolchain — build and test it first**, see
  `apps/ios/RUNBOOK.md`): plan-day chip, cards, + menu, log sheet; the menu photo read by Vision on
  the device (no on-device model job — that waits for an evaluation); `HealthLog` takes nutrient
  values and writes a meal out from the device that logged it once the estimate arrives by sync;
  Tonight card, widgets and Siri skip a slot taken by a meal out; plan generation starts with nights
  out unticked. Server: `?estimate=false` on the v1 writes so the app asks for one estimate itself
- [x] Integrations API: outside meals on `today`/`week` (`API.md`, `integrations-catalog.ts`); `dinner.notCooking`;
  `meal-plan/generate` skips not-cooking days and lists them (v1.66.0)
- [x] Courses (v1.68.0): a sitting can hold several courses (`outside_meals.courses`, migration 0048) —
  starter, main, side, dessert, drink, each with its words, menu kcal and photo, estimated on its own;
  the nutrition columns stay the sitting's total. Web and iOS sheets, cards and the integrations API
- [ ] Later: "Make it at home" (send the meal to the concierge), Memories wall photos, meals out in Wrapped
  (planned recipes they replaced already drop out of it)
- Not planned: cost/budget tracking, restaurant lookup or maps

## Choosing From a Menu
Two ways to get help picking what to eat out, both built on what the app already knows: who's
eating and their dietary flags, the taste profile and ratings, and how this week's heart-health
targets stand. Claude and ChatGPT are already good at reading a menu, but they don't know any of
that, and nothing they decide gets back into the app.

- **Part A: Claude or ChatGPT.** The app hands them a brief about the diners and they log the
  choice back to it. Small, and most of the code already exists
- **Part B: "Help me choose" in the app.** Give it a menu photo, text or a link (including a PDF)
  and get picks for each person. The pick fills in the log sheet

Scope decisions (28 Oct 2026):
- **One "diner brief", shared by both parts.** `getDinerBrief(householdId, { date, memberIds? })`
  in `lib/services/diner-brief.ts` returns:
  - each diner's dietary flags, dislikes, preferences and age band (from `getAiContext`)
  - the taste profile summary (`summariseTasteProfile`): what they rate well and badly
  - the week's protein targets so far, counting meals out and the rest of the week's plan
    (`getWeekNutrition`)
  - the last 7 days' meals, so suggestions vary
  - a plain-text `promptText` rendering of all of it

  Part A serves it over the API and Part B puts it in its own prompt, so both suggest the same way
- **Integration tokens carry no member, but a meal out needs one.** `createOutsideMeal` records
  `createdById`, and the saver's own rating is filed under their name. So a token can be bound to
  a member when it's created (`integration_tokens.member_id`, nullable): writes act as that
  member, and the new write scope can only be granted to a bound token. Existing tokens are
  unchanged. Claude's hosted connectors may come through Authelia OIDC instead, which carries
  the member already (`getBearerUser()`, see A6)
- **New scopes:**
  - `read:preferences`: dietary flags and dislikes are personal, so a Home Assistant dashboard
    token with `read:meal_plan` shouldn't get them
  - `write:outside_meals`
- **Logging fills the day's existing slot.** If the day already has a "Not cooking" chip (an
  `outside_meals` row with no dish yet), a POST for that date and meal type fills that row in
  rather than adding a second one
- **Photos are optional and text is the reliable path.** Claude can't pass an image from the chat
  into a tool call. ChatGPT Actions can pass chat files as download links (`openaiFileIdRefs`,
  to be verified), which the server would fetch with `safeFetch`. The menu's words and its
  printed kcal are enough for a good estimate; the plate photo can be added in the app later
- **Part B runs on the server with the household key, as an AI job** (`/api/ai-jobs`), like
  recipe generation. Reading a menu with vision takes 10–20 s and the corner job card already
  handles leaving the screen. On iOS, Vision reads the menu photo into text on the device first
  (as the log sheet already does), which is cheaper and faster. The photo is only sent as well
  when the OCR came back thin. Choosing needs the diner brief and real judgement, so it isn't an
  on-device model job; revisit after the on-device evaluation (`TODO_MOBILE.md` Phase D)
- **Picks are suggestions, not stored.** The menu text is kept on the meal out (`menuText`) once
  one is picked. Estimates are labelled as estimates, as elsewhere for meals out

### Part A — Claude and ChatGPT
- [x] A1 — Diner brief service + `GET /api/integrations/preferences` (`read:preferences`;
  `?date=`, `?members=`): JSON plus `promptText`. Add it to `integrations-catalog.ts`, `API.md`
  and the OpenAPI spec. Shared with Part B. *`lib/diner-brief.ts` (pure, `check:diner-brief`) and
  `lib/services/diner-brief.ts` (v1.69.0)*
- [x] A2 — Bind a token to a member:
  - migration adding `integration_tokens.member_id` (FK to `household_members`, `ON DELETE SET
    NULL`, after which the write scope stops working)
  - "Acts as" picker on `/settings/integrations`, required when `write:outside_meals` is ticked
  - `IntegrationContext.memberId`

  *Migration 0049; a member who's removed or deactivated stops the token's writes (v1.70.0)*
- [x] A3 — `/api/integrations/outside-meals`, using the `createOutsideMealSchema` the `/api/v1`
  routes use. The nutrition estimate runs after the reply with `estimateInBackground`, and
  devices get the meal on their next sync.
  - `GET`: a date range (`read:meal_plan`)
  - `POST`: log a meal out, filling the day's chip if there is one
  - `PATCH /{id}`: rate it later, add courses, fix the place
  - every response includes the meal's URL in the app

  *Also `GET /{id}` to pick up the estimate. Its own wire schema rather than v1's: ratings are 1–5 stars,
  like the brief, course ids are optional, and names are checked against the members (v1.70.0)*
- [x] A4 — ChatGPT custom GPT:
  - `openapi.json?ops=meals-out` serves only the brief and meal-out operations, so the GPT
    isn't offered shopping and deliveries
  - a ready-made instructions block with a copy button on Settings → Integrations: "fetch the
    brief first, read the menu, suggest, log the pick when the user says what they ordered"
  - a README section on API-key auth

  *`OPERATION_SETS` in the catalog with a ≤300-char `shortDescription` per operation (ChatGPT Actions'
  limit, held by `check:integrations-spec`); instructions in `lib/menu-assistant.ts`, shown on Settings →
  Integrations. Not yet tried in ChatGPT itself (v1.70.0)*
- [x] A5 — MCP endpoint for Claude at `/api/integrations/mcp` (streamable HTTP, stateless):
  - tools `getDinerBrief`, `listOutsideMeals`, `getOutsideMeal`, `logOutsideMeal` and
    `updateOutsideMeal`, wrapping the same services
  - token auth with the same scopes
  - a Claude Desktop config snippet with the bearer header in the README

  *`@modelcontextprotocol/sdk` 1.32.1's web-standard transport, one server per request
  (`lib/mcp/dishes-mcp.ts`). Tools take the operation ids as names so `MENU_ASSISTANT_INSTRUCTIONS` serve
  both assistants; the POST/PATCH logic moved to `logMealOut`/`editMealOut` for both. Tested with the SDK's
  own client; not yet from Claude Desktop (v1.70.0)*
- [ ] A6 — Spike: a claude.ai custom connector through Authelia OIDC. It needs OAuth
  protected-resource metadata on the MCP route and a static Authelia client, since Authelia has
  no dynamic client registration; check that claude.ai accepts a client ID and secret. The route
  would accept OIDC bearers as well as tokens, and those carry the member. If it doesn't work,
  Claude Desktop (A5) is the Claude path

  *Server side done: the MCP route takes Authelia access tokens as well (acting as whoever signed in), its
  401 points at `/.well-known/oauth-protected-resource/api/integrations/mcp`, which names the issuer.
  Claude takes a static client ID and secret when there's no DCR (Advanced settings; callback
  `https://claude.ai/api/mcp/auth_callback`). The `dishes-claude` client and bypass rule are live on
  vm-core (docker repo PR #16). Authelia refused Claude's `resource` parameter (`invalid_target`) until the
  MCP URL was added as the client's `audience`. Left: sign in from claude.ai; if the token exchange is
  `invalid_client`, switch to `client_secret_basic`*
- [ ] A7 — Optional: photos by URL on the POST and PATCH (plate, menu, course), fetched with
  `safeFetch`. Images only, with a size cap, into the existing photo slots. Only if A4 shows
  ChatGPT really passes chat files

### Part B — "Help me choose" in the app
- [x] B1 — Menu sources, `lib/ai/menu-sources.ts`: photos (up to 4), a PDF, a link or pasted text →
  model content. *Simpler than planned: PDFs go to the model as they are (OpenAI reads the text layer and
  the page images), so no PDF library and scanned menus just work. Links go through `safeFetch`; a page
  with too little text says so rather than letting the model guess (v1.70.0)*
- [x] B2 — Chooser, `lib/ai/menu-picks.ts`: menu + diner brief → for each diner, up to 3 picks and 3 to
  avoid.
  - each pick says why in the brief's terms, carries its menu line word for word and the printed kcal
    (or a labelled estimate), and a lighter tweak
  - dietary flags are hard rules; the weekly targets and tastes steer
  - *One call does the reading and the choosing (they're at the table). `tidyPicks` holds the answer to
    the brief (`check:menu-picks`)*
- [x] B3 — `POST /api/v1/outside-meals/menu-picks` (multipart), the web through `/api/web`. *Changed
  from the plan: synchronous, not an AI job. One route serves web and iOS, the result only makes sense
  inside the sheet so the corner tray has nothing to offer, and it answers in 10–30 s*
- [x] B4 — Web: a "Help me choose" step in `outside-meal-sheet.tsx` (`menu-chooser.tsx`), for today or a
  future day.
  - menu input; who's choosing (defaults to who's eating)
  - pick cards; ticking and "Use these" fills in the dish, menu line and `menuKcal`, or courses for
    several; who it was for becomes "Who ate?", the restaurant fills an empty "where", and the first
    menu photo is kept for the estimate
  - a plan keeps only the names
- [x] B5 — iOS: `MenuChooserView`, pushed from the sheet. Vision reads the photos on the device; the
  text goes up when it read enough, the photos only when it didn't. The PDF comes from Files.
  *`MenuPicks.apply` in DishesCore mirrors the web's `applyChoice`, with tests*
- [x] More control and a better wait (29 Oct 2026, James on the iOS app): course chips (starter, main,
  side, dessert, drink) and mood chips plus a note; streamed progress (`application/x-ndjson`): the
  brief's facts, each dish as the menu is read, each pick as it's made; results by person and course,
  the best chosen; "Something else" per course with reason chips; "See the whole menu" to choose any
  dish. Two AI calls now, read then choose by item number (`lib/ai/menu-reader.ts`, `menu-picks.ts`),
  so a swap only re-runs the second, from the menu already read. Web and iOS (v1.73.0)
- Not planned: storing past picks, comparing what was ordered with what was suggested, exposing
  the in-app chooser over the integrations API (Claude and ChatGPT do their own choosing in Part A)

Suggested order: A1–A4 (ChatGPT working end to end, about a day), then B1–B4, then A5–A6 and B5.
A1 is the base for both parts. *All but A7 built on `feat/diner-brief` (PR #75); A6 and the AI calls
themselves still to try on the real server.*

## AI — Photo Recipe Import
- [x] Scan a recipe photo (camera or gallery) from the New Recipe page
- [x] Client-side image resize before sending (≤ 1600 px JPEG)
- [x] AI vision extracts full structured recipe (title, cuisine, ingredients, steps, times)
- [x] Pre-fills the recipe form for review before saving

## Recipe Import from the Web
- [x] "Import from web" on the New Recipe page — fetch a recipe page server-side and pre-fill the form (v1.52.0)
- [x] Read schema.org `Recipe` JSON-LD (`@graph`, HowToSection groups, ISO durations, yields, nutrition, framework app state) without AI
- [x] Copy the recipe photo into our own storage (AVIF/oversized images converted to JPEG)
- [x] Find the photo on pages without og:image or a recipe image (itemprop/image_src, lazy `<img>` srcsets), send the page as Referer for hotlink-protected image hosts, skip pixels/thumbnails, and say when there's no photo (v1.54.1)
- [x] With an AI key: tidy-up pass (ingredient splitting, timers, cuisine, meal types) and full extraction for pages without recipe data
- [x] SSRF guard — public http(s) only, every redirect re-checked, size and time limits
- [x] `?importUrl=` deep link (bookmarklet / iOS Shortcut) and PWA share target
- [x] Import from web in the iOS app — New Recipe → From a website…, `POST /api/v1/recipes/import-url`, `dishes://import?url=` for a Safari share-sheet Shortcut (v1.52.0)
- [x] iOS share extension (`DishesShare`): Dishes on the share sheet imports the shared page, signed in through a shared Keychain group (v1.53.0)
- [ ] Re-import / refresh a recipe from its source link

## Household & Settings
- [x] Household settings page (`/settings`) — name, members
- [x] Invite / add member (links Authelia username to household)
- [x] Member role management (admin/adult/child)
- [x] Remove member

## Integration API
- [x] `GET /api/integrations/today` — today's meals
- [x] `GET /api/integrations/meal-plan/week` — full week plan
- [x] `GET /api/integrations/shopping-list` — active list
- [x] `POST /api/integrations/shopping-list/items` — add item
- [x] `POST /api/integrations/meal-plan/generate` — trigger AI generation
- [x] Token management UI (`/settings/integrations`) — create/revoke tokens with scopes
- [x] Redis rate limiting middleware for integration routes (100 req/min per token, gracefully skipped if Redis unavailable)
- [x] `GET /api/integrations/recipes/{id}` — full recipe (ingredients, steps, nutrition) for AI assistants (v1.13.0)
- [x] `GET /api/integrations/openapi.json` — public OpenAPI 3.1 spec generated from `lib/integrations-catalog.ts` (v1.13.0)
- [x] API reference page at Settings → Integrations — per-endpoint docs with example bodies/responses, curl for your domain, Try-it console, AI-assistant setup guide (v1.13.0)
- [x] Home Assistant upgrade — `GET /api/integrations/token` (a token's own scopes), `GET /api/integrations/cooking` + `read:cooking` scope (who's cooking, step, timers); `PATCH`/`DELETE /api/integrations/shopping-list/items/{id}` for a two-way HA to-do list; `serveAt` per meal, `timezone`, and `today.dinner` (serve + start-cooking times); `today`/`week` use the household's timezone instead of UTC (v1.54.0)
- [ ] Push cook changes to Home Assistant (webhook from `lib/cooking-sessions.ts` notify) instead of HA polling every 30s

## Pantry
- [x] `pantry_staples` table — household-scoped list of always-available ingredients
- [x] `pantry_stock` table — tracked items with optional quantity and unit
- [x] `/pantry` page — staples section (chip list + add form) and stock section (table + add form)
- [x] Pantry page overhaul — search, multi-column stock grid on wide screens, quick-add forms at the top, inline stock editing (name/amount/unit), multi-select bulk delete across staples and stock (v0.47.0); sticky toolbar + A–Z / recently-added sort toggle for stock (v0.47.1); per-section select-all/deselect-all buttons replacing the global select-all (v0.47.2)
- [x] Share page redesign — magazine-style split hero, sticky ingredients card, method step cards, nutrition chips, branded footer, OG/Twitter unfurl metadata (v0.48.0)
- [x] Pantry sidebar badge (stock count) + self-refreshing shopping badge — `/api/shopping/count` endpoint, badge re-fetches on navigation/focus/`dishes-shopping-changed` event so recipe-to-list and meal-plan additions update it immediately (v0.47.3)
- [x] Shopping list generation skips staples and fully-stocked ingredients
- [x] Fix: meal-planner paths (`generateShoppingFromWeek`, `addMealEntryToShoppingList`) now apply the same pantry staple/stock exclusions as `generateFromRecipe`, via shared `lib/pantry-exclusions.ts` (v0.48.1)
- [x] Multi-recipe item sources — `shopping_list_item_recipes` junction table records every recipe that contributed to a merged item; list shows "from X +N more" with the full list on hover (v0.49.0)
- [x] Fix: "Generate shopping list" on the meal planner re-added meals already on the list, doubling quantities — now only processes entries with no `added_to_shopping_list_at`, and the button disables with "All meals on list" when nothing is pending (v0.48.2)
- [x] Fix: meal planner slots for brand-new dishes saved as empty recipe stubs (title only, no ingredients or steps) — the full recipe is now generated and saved before the plan is written (v0.87.1)
- [x] `gpt-image-2.5-flare` added to the image model picker in Settings → AI (v0.87.2)
- [x] Fix: `POST /api/integrations/meal-plan/generate` had the same empty-stub problem — n8n/Home Assistant plans now write each meal up as a complete recipe (and respect the household's measurement system, default prompt and equipment); response gains `complete` (v0.87.1)
- [x] Cooking mode "Mark ingredients as used" button — deducts recipe ingredients from stock after cooking
- [x] Shopping list "Complete & add to pantry" — adds checked items to stock when archiving a list

## Personal / Library Features
- [x] Favourites page (`/favourites`) — filtered grid of favourited recipes
- [x] Collections (`/collections`) — create named collections, add recipes via actions menu or search dialog on collection page; collections strip on recipe list
- [x] Bulk "add to collection" from the recipes grid — multi-select recipes, pick or create a collection, optional "Move here" to clear other collections first (v0.50.0)
- [x] AI auto-filing — generated recipes are placed into an existing collection when one clearly fits (`suggestCollectionForRecipe`); shown in the batch results and as a dismissible suggestion on the recipe form (v0.50.0)
- [x] Fix: mobile recipe filter sheet overflowed the viewport with a large tag list — sheet is now capped at 85dvh with a scrollable body, sticky apply bar, and a tag search box (v0.50.0)
- [x] My Notes (`/notes`) — standalone notes or linked to a specific recipe; linked notes appear on recipe detail page
- [x] Nutrition — per-serving calories + macros (protein/carbs/fat/fibre/sugar/sodium) on recipes; AI auto-fills on generate/edit, on-demand "Estimate nutrition" backfill, manual entry; calorie target in concierge + max-calories-per-meal in planner; calories exposed on integrations `today`/`week` and `meal-plan/generate`
- [x] Recipe meal-type tagging (`recipes.meal_types`) — AI fills it on generate/edit/scan, editable in the recipe form, admin AI backfill for the existing library; the weekly planner matches library recipes to slots by meal type (and hard-rejects mismatches) so breakfast slots stop getting dinner dishes
- [x] Home folded into Recipes: browse mode (tonight's meal, quick chips, shelves for Favourites, Cook again, Suggested for you, Recently added and top cuisines; "See all" opens the filtered grid), a "Recently cooked" sort, `/` and `/home` redirect to `/recipes`; phone nav is Recipes · Planner · AI · Shopping · Settings, and Settings links to the side nav's other pages on a phone — on the web and iOS (v1.39.0)

## Memories
- [x] Memory wall — borderless masonry that preserves each photo's aspect ratio instead of cropping to squares, with the name and rating revealed on hover (v0.81.2)

## Sharing & Onboarding
- [x] "Add to my Dishes" — `/import/<token>` deep-copies a shared recipe (ingredients, steps, tags, nutrition, image) into the viewer's own household, with `imported_from_recipe_id` / `imported_from_name` attribution, duplicate detection, and a CTA on the public share page (v0.81.0)
- [x] Web-grounded recipe generation — optional household toggle (`ai_configurations.web_grounding`); full-recipe generation first runs an OpenAI web search for published versions of the dish and credits them on the recipe (v1.10.0)
- [x] Welcome wizard — first-run tour (features → optional OpenAI key → PWA install), tracked per member via `household_members.onboarding_completed_at`, replayable from Settings (v0.81.0)
- [x] Shared libraries — household-to-household grants with a scope model (all / collections / tags, plus exclude-tags), one-time invitation codes, read-only browsing, and single or multi-select import into a "From <household>" collection (v0.82.0)
- [x] Scope drift guard — `pnpm --filter @dishes/web check:share-scope` asserts that what browse shows is exactly what import authorises, across every scope permutation (v0.82.0)
- [ ] Optional: let an importer re-pull an updated original (needs the source still in scope)
- [ ] Optional: notify the owner when someone copies from their library

## Infrastructure / DevX
- [x] `.env.local` validation on startup (zod, fail fast)
- [x] Error boundary + 404/500 pages
- [x] `README.md` — local dev setup, Docker deploy instructions
- [x] Client crash diagnostics — reports persisted to `client_errors` and readable in-app at Settings → Crash reports (v1.1.0)
- [x] Fix iOS PWA crash — unbounded stale-paint refresh loop tripping Safari's `history.replaceState()` rate limit (v1.1.1)
- [x] Fix `NEXT_REDIRECT` re-thrown into a floating promise on every recipe save, reported as a crash (v1.1.1)
- [x] Add ingredients to the shopping list from cooking mode's checklist (v1.2.0)
- [x] Cook-mode shopping adds top up existing rows and flag what's already listed, instead of duplicating (v1.2.0)
- [x] Fix ticked-off shopping items reverting on resume — server snapshots overwrote unconfirmed local changes on every `visibilitychange`/`focus` (v1.2.1)
- [x] Fix a finished shop reappearing when a meal is added — ticked and amount-less rows were excluded from merge matching and re-added as new lines (v1.2.1)
- [x] Resolve the active shopping list deterministically everywhere — five queries used `LIMIT 1` with no `ORDER BY` (v1.2.1)

## Design refresh (Cookbook)
Adopted 29 Oct 2026. Rules, tokens and the full plan: [DESIGN.md](DESIGN.md). Each phase is one PR covering web and the matching iOS screens, checked in light and dark mode at phone, iPad portrait and iPad landscape widths.
- [x] Audit colour usage and choose a direction (mockups linked in DESIGN.md)
- [x] Phase 0 — Guardrail: `check:colours` (per-file baseline in `apps/web/colour-baseline.json`, can only go down) run by the `Checks` workflow on every PR; CLAUDE.md rule
- [x] Phase 1 — Foundations: light/dark tokens, Tailwind config, Fraunces, `Button`/`Card`/`Badge` variants, `SectionLabel`/`Plate`/`AiButton`; iOS `Theme.swift` + bundled Fraunces, accent and launch colours (v1.71.0)
- [x] Phase 2 — App shell: bottom nav, side nav, page titles in Fraunces, AI button in ink, cooking mini-bar, offline/sync indicators, AI jobs tray; iOS page headers, cooking bar, Cook tonight pill (v1.71.0)
- [x] Phase 3 — Recipes: list, card, filters, detail, form, imports, shared libraries; iOS card, browse, detail, nutrition, role sheet, AI tools, editor, web import (v1.71.1)
- [x] Phase 4 — Cooking mode (colours only; keeps large sans type) (v1.72.0)
- [x] Phase 5 — Planner: layouts by width (fold-up < 700pt, list + day 700–1100pt, week grid ≥ 1100pt); drop meal-type colours; web and iOS (v1.72.0)
- [x] Phase 6 — AI concierge: violet → ink (v1.72.0; not checked with a live AI key)
- [x] Phase 7 — Settings (v1.72.0)
- [x] Phase 8 — The rest: meals eaten out, meals, stats (chart tokens), memories, deliveries, shopping, cook review, onboarding, shared, pantry (v1.72.0)
- [x] Phase 9 — Clean-up: remove legacy colours/gradients from `Theme.swift`, colour check to zero, watch app and widgets (v1.72.0)

---

## Mobile App

Superseded by `TODO_MOBILE.md`, which tracks the native app (SwiftUI, in
`apps/ios`, started 16 Oct 2026). The items below are the original pre-work
list, kept for history:

- [ ] **Auth for native**: `getAutheliaUser()` reads reverse-proxy headers — won't work for a native app hitting the server directly. Design a mobile auth flow, likely extending the existing household-scoped integration token system (see `lib/integration-auth.ts`). Authelia OIDC is an option too.
- [ ] **Complete the shopping REST API**: `clearChecked`, `archiveList`, and `generateFromRecipe` are still server actions with no JSON endpoint. A native app needs these as proper REST routes alongside the existing `/api/shopping/*` routes added in v0.21.0.
- [ ] **Native offline layer**: The web offline stack (Dexie, service worker, Background Sync) is browser-only. Native equivalent would be MMKV or expo-sqlite for local storage, and Expo Background Fetch for background sync.
- [x] **Push notifications (PWA)**: Web Push API implemented — VAPID keys, `push_subscriptions` table, service worker handlers, subscribe/unsubscribe API routes, `sendPushToHousehold` helper, settings UI toggle. (v0.27.0)
- [x] **Push notifications (native)**: APNs for the SwiftUI app (`lib/apns.ts`, `/api/v1/push/devices`), one fan-out with web push; per-member choice of each notification kind in Settings → Notifications on web and iOS (v1.32.0)
