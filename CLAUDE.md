# Dishes — Claude/Agent Context

## What This App Is

Dishes is a self-hosted, family-oriented recipe management and meal planning web app. It is mobile-first, AI-assisted, and designed to run as a Docker Compose stack on James's existing server infrastructure.

Full product spec: `setup_guide/recipe-app.md`
UI mockups: `setup_guide/*.png`
**Build checklist (keep updated):** `TODO.md`

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS + shadcn/ui |
| ORM | Drizzle ORM |
| Database | PostgreSQL |
| Cache / Queues | Redis |
| AI | OpenAI SDK (server-side only) |
| Auth | Authelia (reverse proxy) — no in-app auth |
| Storage | S3-compatible (MinIO or R2) |
| Deployment | Docker Compose |

---

## Monorepo Structure

```
/apps
  /web          Next.js web application
  /mobile       future — Expo / React Native

/packages
  /ui           shared shadcn/ui components
  /api          shared API types and client helpers
  /db           Drizzle schema, migrations, database client
  /shared       shared types, constants, utilities
```

---

## Architecture Principles

- **Household/workspace is the tenant boundary.** Every recipe, meal plan, shopping list, and pantry item belongs to a household. All queries must be scoped by household membership. Never rely on UI filtering alone — enforce at the query layer.
- **AI is server-side only.** AI keys are stored server-side (household-scoped, encrypted reference). Never expose them to the client.
- **Background/slow work goes to the worker.** The Next.js app should stay responsive. AI generation, recipe import, scheduled jobs, and notifications run in the worker container (Phase 2). In Phase 1, AI calls are triggered synchronously server-side but should be structured so they can move to a queue later.
- **Design for Phase 2 without building it.** The household model, data schema, and Docker Compose setup should accommodate profile picking, worker queues, and scheduled automations without restructuring. Don't implement them in Phase 1 — just don't block them.

---

## Authentication

Authentication is handled entirely by **Authelia at the reverse proxy layer**. The app receives pre-authenticated requests. There is no in-app login, OAuth flow, or session management.

The family profile picker (Phase 2) is a household-level UX feature — switching between family members within an already-authenticated session. It is not a security boundary.

---

## Phase 1 — MVP Scope

1. Recipe CRUD (create, edit, delete, view)
2. Structured ingredients (not plain text)
3. Cooking mode (large text, step nav, embedded timers, wake lock)
4. Recipe scaling (smart unit/fraction handling)
5. Shopping lists (auto-generated from recipes, manual additions, consolidation)
6. AI recipe generation (concierge flow: 5 concepts → user picks → full recipe)
7. Menu planner (manually triggered, week view)
8. Household/workspace model with role-based permissions
9. Household-scoped AI configuration
10. Docker Compose deployment foundation

**Not in Phase 1:** profile picker/PIN, worker container, scheduled automations, notifications, pantry, offline sync.

---

## Phase 2 Scope

1. Family profile picker + PIN-based household switching
2. Worker container + Redis queue architecture
3. Scheduled meal plan automation (cron, draft approval, notifications)
4. Push/email/in-app notifications
5. Pantry system
6. Offline sync (PWA service worker + sync)

---

## Key Data Model Notes

- `cuisine` is a first-class field on recipes (not just a tag)
- Ingredients are structured JSON (`ingredient_name`, `amount`, `unit`, `preparation`, `optional`) — not free text
- Recipe steps reference ingredient IDs for cooking-mode highlighting
- Household automation schedules use standard cron syntax (e.g. `0 9 * * 0`)
- PINs are hashed (bcrypt/argon2), never stored as plain text
- AI keys are stored as encrypted references, never raw

---

## Conventions

- TypeScript strict mode throughout
- Drizzle ORM for all database access — no raw SQL except in migration files
- shadcn/ui for all UI components — extend rather than replace
- Server Actions or API route handlers for all AI, import, and write operations — never client-side
- Tailwind for all styling — no CSS modules or styled-components
- All database queries scoped to household — this is not optional

## Keeping Docs Updated

Whenever you add, change, or remove something user-facing, update these files as part of the same task:

- **`README.md`** — update if you: add a new feature to the app, add or change environment variables, change deployment steps, or fix anything in the MinIO/S3 setup section. The env var reference table and the Features list must stay accurate.
- **`TODO.md`** — tick items off as they are completed. Add new items if scope expands.
- **`API.md`** — update if you add, change, or remove any integration API endpoints or token scopes.
- **Version number** — bump the patch version (`x.y.Z`) in `apps/web/package.json` whenever you make any user-facing change or deploy-relevant fix. Use minor (`x.Y.0`) for new features, patch (`x.y.Z`) for fixes and small changes.

Do not leave docs stale. A one-line feature entry or a new row in the env var table takes seconds and saves confusion later.

---

## Database Migrations

SQL migration files go in `packages/db/drizzle/` and are applied automatically on container start. However, **automatic migrations do not reliably run on deploy** — James must apply them manually.

**Whenever you write a migration file, you must also provide the equivalent `docker exec` commands in your response** so James can run them immediately. Use `IF NOT EXISTS` / `IF EXISTS` guards so commands are safe to re-run.

Format to follow:

```bash
docker exec -it dishes-db psql -U dishes -d dishes -c \
  "ALTER TABLE example ADD COLUMN IF NOT EXISTS new_col text;"
```

For multi-statement migrations, either chain multiple `-c` flags or use a heredoc:

```bash
docker exec -it dishes-db psql -U dishes -d dishes \
  -c "ALTER TABLE recipe_ingredients ALTER COLUMN amount TYPE text USING amount::text;" \
  -c "ALTER TABLE ai_configurations ADD COLUMN IF NOT EXISTS default_prompt text;" \
  -c "ALTER TABLE ai_configurations ADD COLUMN IF NOT EXISTS measurement_system varchar(20) NOT NULL DEFAULT 'metric';"
```

---

## Self-Hosting Context

- Runs alongside James's existing Docker Compose services
- Authelia handles SSO and access control at the reverse proxy
- MinIO or Cloudflare R2 for object storage
- No Vercel, no managed database — everything is containerised and self-hosted
- n8n and Home Assistant can call the integrations API using household-scoped bearer tokens

---

## Integrations API

The app exposes a JSON API for external tools (n8n, Home Assistant, dashboards).

Key endpoints:
```
GET  /api/integrations/today
GET  /api/integrations/meal-plan/week
GET  /api/integrations/shopping-list
POST /api/integrations/shopping-list/items
POST /api/integrations/meal-plan/generate
POST /api/integrations/automations/run
```

Tokens are household-scoped with granular scopes (`read:meal_plan`, `write:shopping_list`, etc.). Rate-limited via Redis. Admin/adult only to create tokens.
