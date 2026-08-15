# Dishes

A self-hosted, family-oriented recipe management and meal planning app. Mobile-first, AI-assisted, and designed to run as a Docker Compose stack alongside existing home server infrastructure.

![Mobile recipe view](setup_guide/mobile-recipe-example.png)

---

## Features

- **Recipe library** — create, edit, search, and filter recipes by cuisine, tag, difficulty, and favourites. On mobile the filter sheet is height-capped with a sticky "Show Recipes" bar and a tag search box, so a large tag list stays scrollable and the apply button is always reachable. Multi-select mode supports bulk actions: add tags, remove tags, and add or move recipes into a collection (creating the collection inline if needed)
- **Structured ingredients** — ingredients stored as structured data (name, amount, unit, preparation) enabling smart scaling, consolidation, and AI reasoning
- **Recipe sections** — group both ingredients and steps into named sections (e.g. a granola component vs a smoothie component) in the editor, with drag-and-drop to reorder rows and move them between sections; sections carry through to the recipe view, cooking mode, print, share, and export, and AI generation uses them automatically for multi-component recipes. Sections themselves can be dragged to reorder, dragged rows follow the pointer as a floating card, and emptying a section leaves it in place — sections are only removed explicitly
- **Cooking mode** — fullscreen step-by-step view with large text, embedded countdown timers, ingredient highlighting, and wake lock (prevents screen sleep). Finished timers chime audibly (repeating until acknowledged), vibrate on supported devices, and pop up an alert card showing the step they belong to with a jump-to-step shortcut; active timers in the sidebar and mobile shelf show a preview of their step. The in-cook AI quick-ask sees the whole recipe — every ingredient and step, scaled to your serving count — so it can answer about what comes next, earlier steps, or leftover quantities, not just the step you're on
- **Minimise cooking mode** — "Minimise" shrinks a cook to a persistent bar so you can check the shopping list or another recipe without losing your place. The bar shows the recipe, your step, and the next timer counting down; tap it to drop straight back in. Timers keep running while minimised and their alerts follow you anywhere in the app. Sessions are deadline-based, so they stay accurate through a backgrounded tab or a page reload, and survive a refresh (abandoned cooks are cleared after 12 hours). "Exit Cooking Mode" still ends the cook outright
- **Multiple cooks at once** — dinner and dessert can both be in progress. Each cook keeps its own step, servings, ticked ingredients and timers, and a switcher in the cooking-mode header jumps straight between them showing each one's step and next timer. Timers fire wherever you are, including while a different cook is on screen, and the alert names the dish it belongs to; the mini bar shows the cook in front plus a "+N more" count
- **Recipe scaling** — change serving count and all ingredient amounts recalculate with smart fraction and unit handling
- **Shopping lists** — auto-generated from recipes or meal plans, with ingredient consolidation, category grouping, and manual additions. Items can be edited inline (quantity, unit, name, notes), and those pulled from a recipe link back to it — an item consolidated from several recipes shows every contributing recipe ("from X +2 more")
- **Meal planner** — weekly view with day/meal-type slots; navigate between weeks and generate shopping lists from the whole plan. Slots already added to the shopping list show an "On list" badge, which now only appears when ingredients actually reached the list. Adding a meal reports what happened — how many items were added or topped up, and which ingredients your pantry already covers — with an "add them anyway" override for the skipped ones. The AI weekly planner respects each recipe's **suitable meals** so breakfast slots get breakfast food, not reheated dinners
- **Meal-type tagging** — every recipe can be marked as suiting one or more meals (breakfast/lunch/dinner/dessert/snack); the AI sets this automatically when generating, editing, or scanning a recipe, and an admin "Tag recipes by meal type" maintenance action backfills the existing library
- **AI recipe concierge** — describe what you want, get 5 concept cards, pick one, and the app generates a complete structured recipe. Suggestions adapt to who's eating, so picking a young child yields simple, mild, age-appropriate ideas rather than full dinners. Generated recipes are filed into an existing collection automatically when one is a clear fit — batch-saved recipes show which collection they landed in, and a single recipe shows the suggestion on the form where it can be dropped before saving
- **Recipe photos** — upload images to MinIO/S3; shown on recipe cards and detail pages. AI image generation supports selectable styles (studio, moody, rustic, and more) plus free-text custom instructions per shot (e.g. "just a slice with a fork, not the whole cake")
- **Household model** — multi-member households with role-based permissions (admin / adult / child); all data is household-scoped
- **Pantry** — staples list (always-available ingredients excluded from shopping lists) and current stock tracking, automatically updated when cooking is completed or a shopping list is archived. The pantry page has search, a multi-column layout on wide screens, quick-add forms at the top of each section, inline editing of stock items, multi-select bulk delete with per-section select-all (clear a whole section — or the whole pantry — in a couple of taps), and A–Z / recently-added sorting for stock. The sidebar shows a live stock-count badge
- **Recipe sharing** — public share links with a magazine-style page: split hero with large photography, sticky ingredients card, step-by-step method cards with timer chips, per-serving nutrition, and Open Graph metadata so links unfurl with the dish photo in chat apps
- **Cook history & ratings** — log every cook with a 0–5 star rating (half-star precision), duration, notes, occasion, and a dish photo; the app learns your actual pace over time. Ratings and notes belong to the individual cook, not the recipe — the headline star rating is the average across entries — and each entry in the History tab can be edited (rating, occasion, notes) or deleted outright to clear duplicates. Rating a recipe from the star row without cooking it is recorded as a "Rating only" entry: it still counts towards the average rating, but not towards how many times you've cooked the dish
- **Ask AI about a recipe** — one "Ask AI" menu on the recipe page gathers the AI actions: ask a free-form question about the dish (what to serve with it, when to start cooking to eat at a given time, what can be prepped ahead, substitutions), "Tweak for tonight", and "Find similar recipes". Questions are answered against the full ingredient list, method, and your past cooks of that recipe. Answers render as formatted markdown (headings, lists, bold), and each conversation is saved per recipe — reopen a past question to reread the answer or carry it on, delete one, or clear the whole recipe's history. Settings → AI conversation history shows how many conversations are stored and lets an admin purge them in bulk — everything, or only those older than 7/30/90/365 days, across recipe questions, cooking-mode questions, or both
- **Taste profiling** — builds a per-household preference model from accumulated cook history; scores cuisines, ingredients, and tags by recency-weighted average rating and uses it to personalise AI generation and surface recipe suggestions on the home screen
- **Nutrition** — per-serving calorie and macro breakdown (protein, carbs, fat, fibre, sugar, sodium) on every recipe, scaling with serving size. The AI fills it in automatically when generating or editing a recipe, an on-demand "Estimate nutrition" button backfills existing recipes, and values can be entered manually. The concierge accepts a per-serving calorie target and the meal planner accepts a max-calories-per-meal cap
- **Household push notifications** — opt-in Web Push alerts when someone in the household makes a shared change: adding, removing or clearing shopping-list items, pulling a recipe onto the shopping list, generating the week's shopping list, or adding an AI meal plan. Every household device is notified (including the actor's other devices, so they stay in sync), and rapid bursts of changes are collapsed into a single push per household within a short window
- **Integrations API** — JSON API with bearer token auth for n8n, Home Assistant, dashboards, and other automation tools
- **Client API** — a separate `/api/v1` JSON API for Dishes' own clients, authenticated as a specific household member rather than as an anonymous household token. Recipes, the full shopping list, and the meal planner (week view, assigning and moving meals, per-meal and whole-week shopping generation) are covered today; it is the groundwork for a native iOS app and for offline writes beyond the shopping list
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
| `DISHES_OIDC_ISSUER` | No | Authelia root URL (e.g. `https://auth.example.com`). Enables bearer-token auth on `/api/v1` for native clients. Leave unset and the app stays proxy-headers-only, rejecting every bearer token. |
| `DISHES_OIDC_CLIENT_ID` | No | OIDC client id registered in Authelia. Used to validate the `aud` claim when the provider issues JWT access tokens. |
| `DISHES_OIDC_USERINFO_CACHE_SECONDS` | No | How long to cache userinfo lookups. Default: `60`. Set `0` to disable — revocation then takes effect immediately, at the cost of a call to Authelia per request. |
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

> Dishes has two APIs. `/api/integrations` (below) is for external automation and authenticates with household-scoped tokens. `/api/v1` is the **client API** used by Dishes' own clients — it resolves a specific household member, via Authelia proxy headers in the browser or an OIDC access token from a native app, and is the foundation for the planned native iOS app. See [API.md](API.md), [Authelia OIDC](#authelia-oidc-for-native-clients) and [TODO_MOBILE.md](TODO_MOBILE.md).

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

## Authelia OIDC (for native clients)

The browser reaches Dishes through Authelia at the reverse proxy, which injects
`Remote-User` and friends. A native app connects directly and has no such
headers, so it authenticates with an OIDC access token instead. Both paths
resolve to the same household member — nothing else in the app changes.

**This is optional.** Leave `DISHES_OIDC_ISSUER` unset and the app behaves exactly as
before, rejecting any bearer token with `401`.

### 1. Register the client in Authelia

Add to your Authelia `configuration.yml`. This is a **public** client using PKCE
— a mobile app cannot keep a client secret, so it must not have one.

```yaml
identity_providers:
  oidc:
    lifespans:
      access_token: 1h
      refresh_token: 90d
    clients:
      - client_id: dishes-mobile
        client_name: Dishes iOS
        public: true
        authorization_policy: one_factor
        redirect_uris:
          - dishes://auth/callback
        # offline_access + the refresh_token grant are required, or the app
        # forces a full interactive login every time the access token expires.
        scopes: [openid, profile, email, groups, offline_access]
        grant_types: [authorization_code, refresh_token]
        response_types: [code]
        require_pkce: true
        # require_pkce alone still permits the useless 'plain' method.
        pkce_challenge_method: S256
        token_endpoint_auth_method: none
        # First-party app — no consent screen on every login.
        consent_mode: implicit
```

`profile` and `groups` are not optional. `preferred_username` (from `profile`)
is what household membership is keyed on, and roles depend on `groups`.

**Do not set `access_token_signed_response_alg`.** Authelia deliberately omits
identity claims from access tokens — its maintainers treat them as opaque to
clients, with identity belonging to the ID token or userinfo endpoint. Turning
access tokens into JWTs therefore gains nothing here: Dishes still has to call
userinfo to learn who you are. It is supported (`lib/oidc.ts` verifies the JWT
locally and then falls through to userinfo for the claims), just pointless.

### 2. Point Dishes at Authelia

```env
DISHES_OIDC_ISSUER=https://auth.yourdomain.com
DISHES_OIDC_CLIENT_ID=dishes-mobile
```

`DISHES_OIDC_ISSUER` must serve `/.well-known/openid-configuration`; Dishes reads
the JWKS and userinfo endpoints from there rather than hardcoding them.

### 3. Get the access control rules right

This is the part that bites. A **bypassed** request gets no `Remote-User` header
— Authelia does not evaluate the session for it. So bypassing all of `/api` would
break every browser-facing API route in the app (`/api/shopping/*` for offline
sync, `/api/push/*`, `/api/upload`, `/api/cook-assist`), which all identify the
member from that header.

Bypass only the two self-validating surfaces, and put the rule **above** any
broader `/api` bypass — Authelia matches rules in order, first match wins:

```yaml
access_control:
  rules:
    - domain: 'dishes.yourdomain.com'
      policy: bypass
      resources:
        - '^/api/v1([/?].*)?$'            # client API — OIDC token or proxy headers
        - '^/api/integrations([/?].*)?$'  # n8n / Home Assistant household tokens
        - '^/share/.*$'
        - '^/_next/static/.*$'
        - '^/_next/image.*$'
        - '^/favicon\.ico$'
        - '^/manifest\.json$'
    - domain: 'dishes.yourdomain.com'
      policy: one_factor
```

`bypass` means "Authelia does not gate it", not "unauthenticated": every
`/api/v1` route calls `requireSession()` and returns `401` without a valid
access token or proxy headers.

**Consequence: in a deployment like this, `/api/v1` is bearer-only.** Because it
is bypassed, browser requests to it arrive without identity headers too, so a
`curl` with only a session cookie gets `401`. That costs nothing today — the web
app uses server actions and the older `/api/shopping/*` routes, and nothing in
the browser calls `/api/v1` — but a future local-first PWA layer will need
`/api/v1` reachable *with* an identity, which means either serving it on a
second, authenticated path or having the browser send a token as well.

The `resolveIdentity()` proxy-header path is not dead code: it is what runs when
`/api/v1` is *not* bypassed (local development, or a deployment that fronts the
API differently). It just isn't the path this Authelia setup exercises.

### 4. Verify it

`/api/v1/auth/whoami` reports who the server resolved and how.

With no credentials it should return `401` — that is correct, not a failure.
`/api/v1` is bypassed by Authelia, so a cookie alone carries no identity:

```bash
curl -s https://dishes.yourdomain.com/api/v1/auth/whoami
```

To get an access token without a native app, run the PKCE flow from a terminal:

```bash
DISHES_OIDC_ISSUER=https://auth.yourdomain.com \
DISHES_APP_URL=https://dishes.yourdomain.com \
  node scripts/oidc-token.mjs --whoami
```

It opens your browser at Authelia, catches the redirect on
`http://localhost:8765/callback`, exchanges the code, prints the access and
refresh tokens, and (with `--whoami`) calls the endpoint for you. The loopback
URI must be in the client's `redirect_uris`; use `--manual` to paste the
redirect URL yourself instead and avoid registering it. `--refresh <token>`
exchanges a refresh token without signing in again.

The token it prints is a live credential for your account — don't paste the
output anywhere shared.

Or check by hand. With an access token you should get `200`,
`transport: "bearer"`, your username, your groups, and a `memberId`:

```bash
curl -s -H "Authorization: Bearer <access-token>" \
  https://dishes.yourdomain.com/api/v1/auth/whoami
```

The `memberId` must match the member the web app attributes your cooks to — if a
*new* household appears instead, the token is missing `preferred_username` and
the client needs the `profile` scope.

Reading `oidcConfigured` requires a successful call, so to check the variable
reached the container when you have no token yet, look at the container
environment directly:

```bash
docker exec dishes printenv DISHES_OIDC_ISSUER
```

Empty output means it didn't arrive — the Compose file maps environment
variables explicitly, so a new variable in `.env` also has to be added there.

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
