# Dishes — Build Checklist

Tracks remaining work for Phase 1. Update this file as tasks are completed or added.

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
- [x] Favourite toggle
- [x] Cuisine and tag filtering

## Cooking Mode
- [x] Cooking mode page (`/recipes/[id]/cook`) — fullscreen, large text
- [x] Step-by-step navigation (prev/next)
- [x] Embedded countdown timers (per step, with label)
- [x] Ingredient highlighting: active step cross-references ingredient IDs
- [x] Wake lock API (prevents screen sleep on mobile)
- [x] Recipe scaling UI (change serving count → recalculate all amounts)

## Shopping Lists
- [x] Shopping list page (`/shopping`) — active list with check-off items
- [x] Generate list from recipe(s) — consolidates duplicate ingredients
- [x] Manual item addition
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

## AI — Recipe Generation (Concierge Flow)
- [x] AI config settings page (`/settings/ai`) — store encrypted API key per household
- [x] Concierge step 1: user describes preferences → AI returns 5 concept cards
- [x] Concierge step 2: user picks a concept
- [x] Concierge step 3: AI generates full structured recipe (ingredients + steps)
- [x] Save generated recipe to the library
- [x] Handle OpenAI errors gracefully (quota, key invalid, timeout)

## AI — Photo Recipe Import
- [x] Scan a recipe photo (camera or gallery) from the New Recipe page
- [x] Client-side image resize before sending (≤ 1600 px JPEG)
- [x] AI vision extracts full structured recipe (title, cuisine, ingredients, steps, times)
- [x] Pre-fills the recipe form for review before saving

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

## Pantry
- [x] `pantry_staples` table — household-scoped list of always-available ingredients
- [x] `pantry_stock` table — tracked items with optional quantity and unit
- [x] `/pantry` page — staples section (chip list + add form) and stock section (table + add form)
- [x] Shopping list generation skips staples and fully-stocked ingredients
- [x] Cooking mode "Mark ingredients as used" button — deducts recipe ingredients from stock after cooking
- [x] Shopping list "Complete & add to pantry" — adds checked items to stock when archiving a list

## Personal / Library Features
- [x] Favourites page (`/favourites`) — filtered grid of favourited recipes
- [x] Collections (`/collections`) — create named collections, add recipes via actions menu or search dialog on collection page; collections strip on recipe list
- [x] My Notes (`/notes`) — standalone notes or linked to a specific recipe; linked notes appear on recipe detail page
- [x] Nutrition — per-serving calories + macros (protein/carbs/fat/fibre/sugar/sodium) on recipes; AI auto-fills on generate/edit, on-demand "Estimate nutrition" backfill, manual entry; calorie target in concierge + max-calories-per-meal in planner; calories exposed on integrations `today`/`week` and `meal-plan/generate`
- [x] Recipe meal-type tagging (`recipes.meal_types`) — AI fills it on generate/edit/scan, editable in the recipe form, admin AI backfill for the existing library; the weekly planner matches library recipes to slots by meal type (and hard-rejects mismatches) so breakfast slots stop getting dinner dishes

## Infrastructure / DevX
- [x] `.env.local` validation on startup (zod, fail fast)
- [x] Error boundary + 404/500 pages
- [x] `README.md` — local dev setup, Docker deploy instructions

---

## Future — Mobile App (Expo / React Native)

Pre-work required before starting `/apps/mobile`:

- [ ] **Auth for native**: `getAutheliaUser()` reads reverse-proxy headers — won't work for a native app hitting the server directly. Design a mobile auth flow, likely extending the existing household-scoped integration token system (see `lib/integration-auth.ts`). Authelia OIDC is an option too.
- [ ] **Complete the shopping REST API**: `clearChecked`, `archiveList`, and `generateFromRecipe` are still server actions with no JSON endpoint. A native app needs these as proper REST routes alongside the existing `/api/shopping/*` routes added in v0.21.0.
- [ ] **Native offline layer**: The web offline stack (Dexie, service worker, Background Sync) is browser-only. Native equivalent would be MMKV or expo-sqlite for local storage, and Expo Background Fetch for background sync.
- [x] **Push notifications (PWA)**: Web Push API implemented — VAPID keys, `push_subscriptions` table, service worker handlers, subscribe/unsubscribe API routes, `sendPushToHousehold` helper, settings UI toggle. (v0.27.0)
- [ ] **Push notifications (native)**: APNs integration still needed for the future Expo app — design once for both targets.
