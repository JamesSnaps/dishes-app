# Dishes

A self-hosted, family-oriented recipe management and meal planning app. Mobile-first, AI-assisted, and designed to run as a Docker Compose stack alongside existing home server infrastructure.

![Mobile recipe view](setup_guide/mobile-recipe-example.png)

---

## Features

- **Recipe library** — create, edit, search, and filter recipes by cuisine, tag, difficulty, and favourites
- **Structured ingredients** — ingredients stored as structured data (name, amount, unit, preparation) enabling smart scaling, consolidation, and AI reasoning
- **Cooking mode** — fullscreen step-by-step view with large text, embedded countdown timers, ingredient highlighting, and wake lock (prevents screen sleep)
- **Recipe scaling** — change serving count and all ingredient amounts recalculate with smart fraction and unit handling
- **Shopping lists** — auto-generated from recipes or meal plans, with ingredient consolidation, category grouping, and manual additions
- **Meal planner** — weekly view with day/meal-type slots; navigate between weeks and generate shopping lists from the whole plan. Slots already added to the shopping list show an "On list" badge. The AI weekly planner respects each recipe's **suitable meals** so breakfast slots get breakfast food, not reheated dinners
- **Meal-type tagging** — every recipe can be marked as suiting one or more meals (breakfast/lunch/dinner/dessert/snack); the AI sets this automatically when generating, editing, or scanning a recipe, and an admin "Tag recipes by meal type" maintenance action backfills the existing library
- **AI recipe concierge** — describe what you want, get 5 concept cards, pick one, and the app generates a complete structured recipe. Suggestions adapt to who's eating, so picking a young child yields simple, mild, age-appropriate ideas rather than full dinners
- **Recipe photos** — upload images to MinIO/S3; shown on recipe cards and detail pages
- **Household model** — multi-member households with role-based permissions (admin / adult / child); all data is household-scoped
- **Pantry** — staples list (always-available ingredients excluded from shopping lists) and current stock tracking; automatically updated when cooking is completed or a shopping list is archived
- **Cook history & ratings** — log every cook with a 0–5 star rating (half-star precision), duration, notes, occasion, and a dish photo; the app learns your actual pace over time
- **Taste profiling** — builds a per-household preference model from accumulated cook history; scores cuisines, ingredients, and tags by recency-weighted average rating and uses it to personalise AI generation and surface recipe suggestions on the home screen
- **Nutrition** — per-serving calorie and macro breakdown (protein, carbs, fat, fibre, sugar, sodium) on every recipe, scaling with serving size. The AI fills it in automatically when generating or editing a recipe, an on-demand "Estimate nutrition" button backfills existing recipes, and values can be entered manually. The concierge accepts a per-serving calorie target and the meal planner accepts a max-calories-per-meal cap
- **Household push notifications** — opt-in Web Push alerts when someone in the household makes a shared change: pulling a recipe onto the shopping list, generating the week's shopping list, or adding an AI meal plan. The person who made the change isn't notified on their own device
- **Integrations API** — JSON API with bearer token auth for n8n, Home Assistant, dashboards, and other automation tools
- **PWA & offline** — installable on mobile; a service worker (Serwist) precaches the app shell and caches pages as you visit them, so the app launches and switches between sections even on poor or no signal instead of hanging. The shopping list works fully offline — changes queue locally and sync automatically when you reconnect. Shopping and meal plan refresh on resume (reopening the app re-fetches when online), and the shopping cache also refreshes via Periodic Background Sync where the browser supports it (Chrome/Android & desktop; iOS has no PWA background execution). A global offline indicator shows when you lose signal, opening an unvisited route offline lands on a friendly offline page instead of hanging, and the app auto-recovers from stale-chunk errors after a redeploy. Home-screen shortcuts jump straight to Shopping, Meal Plan, or the AI concierge, and recipe photos are cached for ~30 days so recipes stay readable (with images) offline

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS + shadcn/ui |
| ORM | Drizzle ORM |
| Database | PostgreSQL 16 |
| Cache / Rate limiting | Redis 7 |
| AI | OpenAI SDK (server-side only) |
| Auth | Authelia at reverse proxy — no in-app auth |
| Storage | S3-compatible (MinIO or Cloudflare R2) |
| Deployment | Docker Compose |

---

## Architecture Overview

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

Authentication is handled entirely by **Authelia at the reverse proxy layer**. The app receives pre-authenticated requests and reads the user identity from Authelia headers — there is no in-app login, OAuth flow, or session management.

Every recipe, meal plan, shopping list, and setting belongs to a **household**. All queries are scoped to household membership; isolation is enforced at the query layer.

AI keys are stored encrypted server-side, scoped per household. They are never sent to the browser.

---

## Prerequisites

- Docker and Docker Compose v2
- pnpm (local development only)
- Node.js 20+ (local development only)
- An **Authelia** (or compatible) reverse proxy that forwards `Remote-User`, `Remote-Name`, and `Remote-Groups` headers — or use the dev fallback (see below)

---

## Local Development

### 1. Clone the repo

```bash
git clone <repo-url>
cd dishes-app
pnpm install
```

### 2. Start infrastructure

The dev compose override starts only the database, Redis, and MinIO — Next.js runs locally for fast iteration.

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

This exposes (host ports are offset from the defaults so the stack can run alongside other local Postgres/Redis/MinIO instances without clashing):
- PostgreSQL on `localhost:5433`
- Redis on `localhost:6380`
- MinIO on `localhost:9002` (API) / `localhost:9003` (console)

### 3. Configure environment variables

Copy the example file — its defaults already match the offset ports above:

```bash
cp apps/web/.env.example apps/web/.env.local
```

The only required values are `DATABASE_URL` and `ENCRYPTION_KEY` (any stable 32+ char string for local dev). See [`apps/web/.env.example`](apps/web/.env.example) for the full annotated list.

> The app uses a dev auth fallback when not behind Authelia: with `NODE_ENV=development` and no `Remote-User` header it logs in as a "Dev User" and bootstraps a household automatically. No Authelia setup required.

### 4. Sync the database schema

For local dev, push the schema straight from the Drizzle definitions (the migration journal is only applied in production deploys):

```bash
cd packages/db
DATABASE_URL=postgresql://dishes:dishes@localhost:5433/dishes pnpm drizzle-kit push
```

### 5. Start the dev server

```bash
cd ../..
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) (Next.js picks the next free port, e.g. 3001, if 3000 is taken). On first run, the dev auth fallback bootstraps a "Dev User" household automatically — no Authelia required.

> **Dummy content (dev only):** when `NODE_ENV=development`, a freshly-bootstrapped household is auto-seeded with sample content — ~12 recipes (incl. ingredients, cooking-mode steps and tags), collections, a meal plan for the current week, an active shopping list, and a few notes. Seeding is idempotent: it only runs when the household has no recipes, so it won't overwrite anything. To start fresh, clear the household's data (or drop the dev database) and reload. Seeding never runs in production.

---

## Production Deployment (Docker Compose)

### 1. Create your `.env` file

At the root of the repo, create a `.env` file (never commit this):

```env
# PostgreSQL
POSTGRES_PASSWORD=<strong-password>

# Application
DATABASE_URL=postgresql://dishes:<POSTGRES_PASSWORD>@db:5432/dishes
ENCRYPTION_KEY=<random 32+ character string — keep this secret and stable>
REDIS_URL=redis://redis:6379
NEXT_PUBLIC_APP_URL=https://dishes.yourdomain.com

# MinIO / S3
S3_ENDPOINT=http://minio:9000
S3_ACCESS_KEY=<access-key>
S3_SECRET_KEY=<strong-secret-key>
S3_BUCKET=dishes
```

> **Keep `ENCRYPTION_KEY` stable.** It is used to encrypt household AI API keys stored in the database. Changing it will invalidate all stored keys.

### 2. Build and start

```bash
docker compose up -d --build
```

### 3. Run migrations

```bash
docker compose exec web pnpm --filter @dishes/db drizzle-kit migrate
```

### 4. Configure your reverse proxy

Route your domain (e.g. `dishes.yourdomain.com`) to the `web` container on port `3000` and ensure Authelia forwards the following headers:

| Header | Description |
|---|---|
| `Remote-User` | Authelia username |
| `Remote-Name` | Display name |
| `Remote-Groups` | Comma-separated group list |

#### Traefik + Authelia (collardserver setup)

The dishes container must include the `auth@file` middleware in its Traefik labels — this is what triggers Authelia to verify the request and inject the headers above. `securityHeaders` alone is not enough.

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.dishes.rule=Host(`dishes.collardserver.co.uk`)"
  - "traefik.http.routers.dishes.middlewares=auth@file"
  - "traefik.http.routers.dishes.tls.certResolver=letsencrypt"
  - "traefik.http.services.dishes.loadbalancer.server.port=3000"
```

#### Authelia access control

The wildcard bypass rule for local networks prevents Authelia from injecting user headers even when the `auth` middleware is applied, because bypass skips authentication entirely. Add a dishes-specific rule **before** the wildcard bypass so that auth (and header injection) always runs:

```yaml
access_control:
  rules:
    # Dishes: require auth regardless of source network so Remote-User is always injected
    - domain: "dishes.collardserver.co.uk"
      subject:
        - "group:admins"
      policy: one_factor

    # Existing wildcard bypass for local networks (unchanged below)
    - domain: "*.collardserver.co.uk"
      policy: bypass
      networks:
        - 10.0.10.0/24
        ...
```

Without this, local-network requests reach the app without `Remote-User` and the app returns 401.

### 5. First run — create a household

On first visit the app will prompt you to create a household and will register the Authelia-authenticated user as the admin.

### 6. Configure AI (optional)

Go to **Settings → AI**, enter your OpenAI API key, and enable AI features for the household. The key is stored encrypted and never leaves the server.

### 7. Create integration tokens (optional)

Go to **Settings → Integrations** to create bearer tokens with granular scopes for n8n, Home Assistant, or other automation tools.

### 8. Taste profile (builds automatically)

The taste profile requires no setup. After you log ratings on cooked recipes, the profile is refreshed automatically in the background. Once you have at least 2 rated cooks, a **Suggested for you** section appears on the home screen. At 10+ rated cooks, the profile is also injected into AI generation prompts to skew concepts and recipes towards your household's preferences. View the profile at **Settings → Taste profile**; admins can reset it if it has drifted.

---

## MinIO Setup

If using the bundled MinIO container, create the storage bucket after first start.

**Via the web console** — open `http://localhost:9001` (or your server's port 9001) and log in with your `S3_ACCESS_KEY` / `S3_SECRET_KEY`. Create a bucket named `dishes` and set its access policy to **Public** if you want image URLs to be directly accessible.

**Via `mc` (MinIO client):**

```bash
mc alias set dishes http://localhost:9000 <S3_ACCESS_KEY> <S3_SECRET_KEY>
mc mb dishes/dishes
mc anonymous set download dishes/dishes   # for public image URLs
```

> Port 9000 is the MinIO S3 API; port 9001 is the web console. In production, expose 9000 via your reverse proxy (or keep it internal and set `S3_PUBLIC_URL` to a publicly-routable URL for images).

---

## Environment Variable Reference

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection URL |
| `ENCRYPTION_KEY` | Yes | 32+ char secret for encrypting AI keys. Keep stable. |
| `REDIS_URL` | No | Redis connection URL. Rate limiting is skipped if absent. |
| `NEXT_PUBLIC_APP_URL` | No | Public URL of the app (used for absolute links) |
| `AUTHELIA_USER_HEADER` | No | Header name for username. Default: `Remote-User` |
| `AUTHELIA_NAME_HEADER` | No | Header name for display name. Default: `Remote-Name` |
| `AUTHELIA_GROUPS_HEADER` | No | Header name for groups. Default: `Remote-Groups` |
| `NEXT_PUBLIC_AUTHELIA_URL` | No | Authelia portal URL (e.g. `https://auth.example.com`). Enables the Log out option in the sidebar. Leave blank to hide it. |
| `POSTGRES_PASSWORD` | Compose only | PostgreSQL password (used by Docker Compose) |
| `S3_ENDPOINT` | No | S3-compatible storage endpoint |
| `S3_ACCESS_KEY` | No | S3 access key |
| `S3_SECRET_KEY` | No | S3 secret key |
| `S3_BUCKET` | No | S3 bucket name. Default: `dishes` |
| `S3_PUBLIC_URL` | No | Public base URL for serving images (e.g. `https://media.yourdomain.com`). Falls back to `S3_ENDPOINT` if absent. |
| `VAPID_SUBJECT` | No | Contact URI for push notifications (e.g. `mailto:you@example.com`). Required to enable push. |
| `VAPID_PUBLIC_KEY` | No | VAPID public key for Web Push. Generate with `npx web-push generate-vapid-keys`. |
| `VAPID_PRIVATE_KEY` | No | VAPID private key for Web Push. Keep secret and stable — rotating this invalidates all existing subscriptions. |

---

## Integrations API

The app exposes a JSON API for external tools. Full documentation: [API.md](API.md).

Tokens are created at **Settings → Integrations** (admin only). Each token carries granular scopes and is rate-limited at 100 requests/minute via Redis.

| Scope | Description |
|---|---|
| `read:meal_plan` | Read meal plan and recipe data |
| `write:meal_plan` | Create meal plan entries, trigger AI generation |
| `read:shopping_list` | Read the active shopping list |
| `write:shopping_list` | Add items to the active shopping list |

### Quick examples

```bash
# Today's meals
curl -H "Authorization: Bearer <token>" https://dishes.yourdomain.com/api/integrations/today

# Add a shopping list item
curl -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"items":[{"ingredientName":"Milk","amount":"2","unit":"litres","category":"dairy"}]}' \
  https://dishes.yourdomain.com/api/integrations/shopping-list/items
```

---

## Household Roles

| Role | Permissions |
|---|---|
| **Admin** | Full access: manage members, recipes, meal plans, shopping, household settings, AI config, integration tokens |
| **Adult** | Create/edit recipes, use AI, manage shopping lists and meal plans |
| **Child** | View recipes and meal plans, tick shopping list items, favourite and rate recipes |

---

## Roadmap

### Phase 1 ✓ complete
- Recipe CRUD with structured ingredients, cooking mode, and photo upload
- Shopping lists with ingredient consolidation
- Meal planner (weekly view, manual)
- AI recipe concierge (OpenAI)
- Household model with role-based permissions
- Integrations API for n8n / Home Assistant

### Phase 3 — personalisation (in progress)
- Cook history and 0–5 star rating system
- Post-cooking debrief flow (duration, notes, occasion, dish photo)
- Family member profiles with role, age (birth year), dietary flags, dislikes, and preferences
- Cooking time learning (household average vs. recipe estimate)
- AI food memory (notable occasions and cook notes surfaced in AI prompts)
- **Taste profiling** ✓ — recency-weighted preference model; personalises AI and home screen suggestions
- External recipe sharing (public links and email)

### Phase 2 (planned)
- Family profile picker with PIN-based switching
- Worker container + Redis queue architecture
- Scheduled meal plan automation (weekly, draft approval, notifications)
- Push / email / in-app notifications
- Pantry system
- Offline writes for all sections (recipes/meal-plan currently cache read-only offline; only shopping syncs offline edits today)

---

## Contributing

This is a personal self-hosted project. Issues and PRs welcome if you find it useful.
