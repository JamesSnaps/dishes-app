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
- [ ] Recipe list page (`/recipes`) — card grid, search, filter by cuisine/tag
- [ ] Recipe detail page (`/recipes/[id]`) — full view with ingredients and steps
- [ ] Create recipe form (`/recipes/new`) — structured ingredient rows, step builder
- [ ] Edit recipe form (`/recipes/[id]/edit`)
- [ ] Delete recipe (with confirmation)
- [ ] Recipe image upload (to MinIO/S3)
- [ ] Favourite toggle
- [ ] Cuisine and tag filtering

## Cooking Mode
- [ ] Cooking mode page (`/recipes/[id]/cook`) — fullscreen, large text
- [ ] Step-by-step navigation (prev/next)
- [ ] Embedded countdown timers (per step, with label)
- [ ] Ingredient highlighting: active step cross-references ingredient IDs
- [ ] Wake lock API (prevents screen sleep on mobile)
- [ ] Recipe scaling UI (change serving count → recalculate all amounts)

## Shopping Lists
- [ ] Shopping list page (`/shopping`) — active list with check-off items
- [ ] Generate list from recipe(s) — consolidates duplicate ingredients
- [ ] Manual item addition
- [ ] Check/uncheck items
- [ ] Clear checked items
- [ ] Archive/complete a list
- [ ] Category grouping (produce, dairy, etc.)

## Meal Planner
- [ ] Meal plan week view (`/meal-plan`) — 7-day grid, meal slots
- [ ] Add recipe to a meal slot
- [ ] Remove/swap recipe in a slot
- [ ] Generate shopping list from current week's meal plan
- [ ] Navigate between weeks

## AI — Recipe Generation (Concierge Flow)
- [ ] AI config settings page (`/settings/ai`) — store encrypted API key per household
- [ ] Concierge step 1: user describes preferences → AI returns 5 concept cards
- [ ] Concierge step 2: user picks a concept
- [ ] Concierge step 3: AI generates full structured recipe (ingredients + steps)
- [ ] Save generated recipe to the library
- [ ] Handle OpenAI errors gracefully (quota, key invalid, timeout)

## Household & Settings
- [ ] Household settings page (`/settings`) — name, members
- [ ] Invite / add member (links Authelia username to household)
- [ ] Member role management (admin/adult/child)
- [ ] Remove member

## Integration API
- [ ] `GET /api/integrations/today` — today's meals
- [ ] `GET /api/integrations/meal-plan/week` — full week plan
- [ ] `GET /api/integrations/shopping-list` — active list
- [ ] `POST /api/integrations/shopping-list/items` — add item
- [ ] `POST /api/integrations/meal-plan/generate` — trigger AI generation
- [ ] Token management UI (`/settings/integrations`) — create/revoke tokens with scopes
- [ ] Redis rate limiting middleware for integration routes

## Infrastructure / DevX
- [x] `.env.local` validation on startup (zod, fail fast)
- [ ] Error boundary + 404/500 pages
- [ ] `README.md` — local dev setup, Docker deploy instructions
