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

## Infrastructure / DevX
- [x] `.env.local` validation on startup (zod, fail fast)
- [x] Error boundary + 404/500 pages
- [x] `README.md` — local dev setup, Docker deploy instructions
