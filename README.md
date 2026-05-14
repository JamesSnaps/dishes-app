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
- **Meal planner** — weekly view with day/meal-type slots; navigate between weeks and generate shopping lists from the whole plan
- **AI recipe concierge** — describe what you want, get 5 concept cards, pick one, and the app generates a complete structured recipe
- **Recipe photos** — upload images to MinIO/S3; shown on recipe cards and detail pages
- **Household model** — multi-member households with role-based permissions (admin / adult / child); all data is household-scoped
- **Integrations API** — JSON API with bearer token auth for n8n, Home Assistant, dashboards, and other automation tools
- **PWA** — installable on mobile via browser

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

This exposes:
- PostgreSQL on `localhost:5432`
- Redis on `localhost:6379`
- MinIO on `localhost:9000` (API) / `localhost:9001` (console)

### 3. Configure environment variables

Create `apps/web/.env.local`:

```env
# Required
DATABASE_URL=postgresql://dishes:dishes@localhost:5432/dishes
ENCRYPTION_KEY=<random 32+ character string>

# Optional — Redis (rate limiting, future queues)
REDIS_URL=redis://localhost:6379

# Optional — local app URL
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Dev auth fallback — sets the Authelia user headers for local development
# Remove these when running behind a real Authelia instance
AUTHELIA_USER_HEADER=Remote-User
AUTHELIA_NAME_HEADER=Remote-Name
AUTHELIA_GROUPS_HEADER=Remote-Groups
```

> The app uses a dev auth fallback when not behind Authelia. It will bootstrap a user from the headers above (or sensible defaults). Remove this when deploying to production.

### 4. Run migrations

```bash
cd packages/db
pnpm drizzle-kit migrate
```

### 5. Start the dev server

```bash
cd ../..
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). On first run you will be prompted to create a household.

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
| `POSTGRES_PASSWORD` | Compose only | PostgreSQL password (used by Docker Compose) |
| `S3_ENDPOINT` | No | S3-compatible storage endpoint |
| `S3_ACCESS_KEY` | No | S3 access key |
| `S3_SECRET_KEY` | No | S3 secret key |
| `S3_BUCKET` | No | S3 bucket name. Default: `dishes` |
| `S3_PUBLIC_URL` | No | Public base URL for serving images (e.g. `https://media.yourdomain.com`). Falls back to `S3_ENDPOINT` if absent. |

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

### Phase 2 (planned)
- Family profile picker with PIN-based switching
- Worker container + Redis queue architecture
- Scheduled meal plan automation (weekly, draft approval, notifications)
- Push / email / in-app notifications
- Pantry system
- Offline sync (PWA service worker)

---

## Contributing

This is a personal self-hosted project. Issues and PRs welcome if you find it useful.
