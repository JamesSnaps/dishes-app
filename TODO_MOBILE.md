# Dishes — Native iOS Roadmap

Tracks the work to ship a native iOS app (`/apps/mobile`, Expo / React Native) alongside the existing PWA. The PWA is **not** being replaced — it remains the desktop/Mac experience and the admin surface.

Items are ordered by dependency. Phases A and B benefit the web app on their own, so they are worth doing even if the native app is deferred.

---

## Guiding principles

- **The perceived slowness is a data-layer problem, not a rendering problem.** Almost every screen currently waits on a server round-trip (~110 server actions across `apps/web/app/actions/` plus RSC page loads). A native client hitting the same endpoints the same way would feel identical. The fix is local-first reads on both platforms.
- **Share types and logic, not UI.** `@dishes/shared` types, a new `@dishes/client` (API client + sync engine) are shared. Screens are written twice. Do not attempt cross-platform React/React Native components.
- **Server actions stay.** REST routes and server actions both call the same underlying functions in a shared module. The web app does not get rewritten to use `fetch`.
- **One auth model, two transports.** Proxy headers (browser via Authelia) and bearer tokens (native) resolve to the same `AutheliaUser` identity. See Phase A1.

---

## Phase A — Make the backend a real API

The unavoidable prerequisite. Nothing native can start until A1 lands.

### A1. Auth for native clients  ⚠️ blocker

`getAutheliaUser()` (`apps/web/lib/auth.ts:10`) reads `Remote-User` / `Remote-Name` / `Remote-Groups` headers injected by Authelia. A native app connecting directly has none. Household membership is keyed on `household_members.authelia_user`, so any native auth path **must produce a username**, not just a household id — the existing integration tokens (`apps/web/lib/integration-auth.ts`) carry `householdId` and scopes only.

- [x] **Decided: Authelia OIDC provider.** Household membership is keyed on `household_members.authelia_user`, so native auth must produce a *username*. Integration tokens carry only `householdId` + scopes, so they cannot attribute a write to a member — using them would silently break cook-history attribution, roles, and the Phase 2 profile picker. OIDC also avoids a long-lived static secret sitting in a family member's Keychain, and keeps Authelia the single identity source.
- [x] `lib/auth.ts`: `resolveIdentity()` tries a bearer token, then proxy headers; `AuthError` for the unauthenticated case
- [x] `lib/session.ts`: `requireSession()` — identity + household membership in one call, with `HouseholdContext` for service functions
- [x] `middleware.ts`: `/api/v1` added as a self-validating prefix (as `/api/integrations` already is)
- [x] `lib/oidc.ts`: access-token verification. JWT tokens verified locally against the provider's JWKS (issuer + audience); opaque tokens (Authelia's default) exchanged at userinfo with a short Redis cache. `getBearerUser()` is live
- [x] Map OIDC claims (`preferred_username`, `name`, `groups`) onto the existing `AutheliaUser` shape — `getOrCreateHousehold()` untouched
- [x] `GET /api/v1/auth/whoami` — diagnostic showing resolved identity + transport, for verifying the setup with curl
- [x] Env vars `DISHES_OIDC_ISSUER` / `DISHES_OIDC_CLIENT_ID` / `DISHES_OIDC_USERINFO_CACHE_SECONDS` (namespaced so they can't clash in the shared server `.env`), documented in `README.md` with the Authelia client config and access-control rules
- [x] Authelia config written in the `docker` repo — `dishes-mobile` client (S256 PKCE, `offline_access` + `refresh_token`, `consent_mode: implicit`) and Dishes access-control rules reordered above the global `^/api` bypass. Validated with `authelia validate-config`
- [x] Settled: **no** `access_token_signed_response_alg`. Authelia omits identity claims from access tokens, so JWTs would still need a userinfo call — no gain
- [x] `scripts/oidc-token.mjs` — terminal PKCE flow so the API can be tested with a real token before the native app exists (loopback or `--manual`, plus `--refresh` and `--whoami`)
- [ ] **Deploy it** — restart Authelia, set `DISHES_OIDC_ISSUER` / `DISHES_OIDC_CLIENT_ID` in the server `.env`, redeploy Dishes, then confirm with `/api/v1/auth/whoami`
- [ ] Check whether the old global `^/api` bypass was silently breaking `/api/shopping/*`, `/api/push/*` and `/api/upload` in production (bypassed requests get no `Remote-User`)
- [ ] Refresh token handling in the app (server side needs nothing — it only sees access tokens). Revocation is Authelia's, but note opaque tokens stay valid here for up to `DISHES_OIDC_USERINFO_CACHE_SECONDS` after revocation
- [ ] Device list in Settings: name, last seen, revoke button
- [x] Document the Authelia OIDC client config in `README.md` (new env vars)

### A2. Promote the mutation surface to REST

Not all ~110 actions — only what the mobile app needs. Pattern: move the body into `lib/services/<domain>.ts`, have both the server action and the new route handler call it.

- [x] `lib/services/` extraction pattern established with one domain first (recipes) as the reference — `lib/services/recipes.ts`; `app/actions/recipes.ts` is now FormData parsing + revalidate/redirect only
- [x] `/api/v1/recipes` — list, get, create, replace, delete, favourite toggle
- [x] Shared error envelope (`lib/api/respond.ts`, `withApiErrors`) + Zod wire schemas (`lib/api/schemas/recipe.ts`)
- [x] `/api/v1/shopping` — complete set: list, add, update, delete, toggle, clear-checked, archive, preview, generate. `clearChecked`, `archiveList` and `generateFromRecipe` are no longer server-action-only
- [x] Existing `/api/shopping/*` offline endpoints rewired onto the same service (contracts unchanged), so offline-synced edits now notify the household like browser edits do
- [x] `/api/v1/meal-plan` — week get, add entry, patch (move day / change slot / servings), delete, per-entry shopping add, whole-week shopping generate. The two near-duplicate shopping generators in `app/actions/meal-plan.ts` now share one `applyToShoppingList` in the service
- [ ] `/api/v1/cook-history` — log, rate, edit, delete
- [ ] `/api/v1/pantry` — list, add, update, delete
- [ ] `/api/v1/collections` — list, add/remove recipe
- [ ] `/api/v1/upload` — direct-to-S3 presigned URL flow (native can't reuse the browser upload path)
- [ ] AI endpoints (`/api/v1/ai/*`) — generate, tweak, ask; must stream (SSE) for native too
- [x] `API.md`: `/api/v1/*` documented as a second section, distinct from `/api/integrations/*`

### A3. Sync endpoint

The thing that makes offline actually work, on both platforms.

- [ ] Add `updated_at` + soft-delete `deleted_at` to all syncable tables (migration — remember `docker exec` commands)
- [ ] `GET /api/v1/sync?since=<cursor>` — returns changed/deleted recipes, shopping items, meal plan entries, cook history since cursor
- [ ] `POST /api/v1/sync` — batched mutation upload with client-generated idempotency keys
- [ ] Conflict policy: last-write-wins per field for recipes; append-only for shopping items and cook history
- [ ] Cursor is an opaque server-issued token, not a raw timestamp (clock skew)

---

## Phase B — Local-first on the PWA

Ship this before writing any native code and reassess. This is where "clunky on poor signal" actually dies, and it validates the sync design on a platform you can iterate on quickly.

- [ ] Extract `@dishes/client` package: typed API client + sync engine, storage-adapter agnostic
- [ ] Dexie (already a dependency) as the web storage adapter
- [ ] Stale-while-revalidate reads: recipe list, recipe detail, shopping list, this week's meal plan paint from cache instantly
- [ ] Mutation queue with optimistic UI + rollback on failure
- [ ] Background Sync API registration for queued mutations
- [ ] Offline indicator + "last synced" affordance in the app shell
- [ ] Cache recipe images for favourites and this week's plan (Cache API)
- [ ] Measure: cold-load-to-first-paint on a throttled connection, before and after

---

## Phase C — The Expo app

- [ ] `apps/mobile` scaffolded with Expo (dev client, not Expo Go — needs native modules)
- [ ] Turborepo pipeline updated; `@dishes/shared` and `@dishes/client` consumed by mobile
- [ ] expo-sqlite storage adapter for `@dishes/client`
- [ ] OIDC login flow via `expo-auth-session` + `ASWebAuthenticationSession`, tokens in Keychain (`expo-secure-store`)
- [ ] Navigation shell: tabs matching the web app (Recipes, Plan, Shop, Settings)
- [ ] Recipe list + detail
- [ ] Shopping list (the highest-value offline screen — it's used in a supermarket with bad signal)
- [ ] Meal planner week view
- [ ] Recipe create/edit
- [ ] Expo Background Tasks for periodic sync
- [ ] Push via APNs — extend `lib/push.ts` to dispatch to both web-push and APNs from one call site

### Native-only wins (the actual reason to do this)

- [ ] **Cooking mode** — `expo-keep-awake`, audio session that survives lock, no Safari chrome
- [ ] **Share extension** — import a recipe from Safari/Instagram/Notes via the iOS Share Sheet
- [ ] **Home Screen widget** — tonight's meal + shopping item count (WidgetKit, via a native module)
- [ ] **Live Activity** — cooking timers on the Lock Screen / Dynamic Island
- [ ] **Siri / App Intents** — "add milk to my shopping list"
- [ ] Camera capture for cook-debrief dish photos
- [ ] Haptics on step navigation and item check-off

---

## Explicitly not doing

- **Capacitor/Tauri wrapper around the PWA.** ~1 week of work for an App Store build, APNs and native wake lock, but it ships the same webview and the same network-bound data layer — it does not fix the responsiveness complaint. Only reconsider if the goal changes to "a Home Screen icon that isn't a Safari bookmark."
- **Sharing UI components between web and native.** Consistently costs more than it saves.
- **Replacing the PWA.** It stays as the desktop/Mac client.
