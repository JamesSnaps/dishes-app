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

### A1. Auth for native clients — ✅ done

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
- [x] **Deployed and verified in production (15 Aug 2026)** — Authelia config applied, `DISHES_OIDC_ISSUER` / `DISHES_OIDC_CLIENT_ID` set, v0.62.3 released. Full PKCE flow via `scripts/oidc-token.mjs` returns `transport: "bearer"` with the correct member. **A1 is closed.**
- [x] Confirmed the header path works after the rule reorder (shopping badge renders). Could not establish whether it was broken *before*, only that it is correct now
- [ ] Optional hardening, written but not deployed: an explicit `deny` rule for the Dishes domain, so anonymous requests stop falling through to the global `^/api` bypass and being rejected by the app instead of by Authelia
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
- [x] `/api/v1/cook-history` — history + stats in one call, log, rate-without-cooking, edit, delete, dish photo
- [x] `/api/v1/upload` — raw-body image upload sharing one service with the browser's multipart route (a presigned-URL flow was unnecessary; the server already resizes and thumbnails)
- [ ] `/api/v1/pantry` — list, add, update, delete
- [ ] `/api/v1/collections` — list, add/remove recipe
- [ ] AI endpoints (`/api/v1/ai/*`) — generate, tweak, ask; must stream (SSE) for native too. **Much larger than the other domains**: `app/actions/ai.ts` is ~1,300 lines of client setup, prompt building, taste-profile and household-config integration, and the two existing assist routes stream in a browser-specific way. Worth treating as its own piece of work rather than the tail of A2
- [x] `API.md`: `/api/v1/*` documented as a second section, distinct from `/api/integrations/*`

### A3. Sync endpoint

The thing that makes offline actually work, on both platforms.

- [x] **Change log instead of `updated_at`/`deleted_at`** — `sync_changes`, written by DB triggers (migration `0025`). Captures deletes without adopting soft deletes app-wide, and catches writes from anywhere including manual SQL. Child rows roll up to their aggregate root
- [x] `GET /api/v1/sync` — delta since a cursor, or a full snapshot when none given; paginated, with repeats collapsed to final state
- [x] `POST /api/v1/sync` — batched mutations with client-generated `opId`s; replays return `duplicate`, one failure doesn't discard the batch
- [x] Conflict policy: last-write-wins at whole-entity granularity, documented in `API.md`
- [x] Cursor is an opaque server-issued token encoding a sequence number, not a timestamp
- [ ] Recipe edits over sync (deliberately excluded from v1 — rare offline, large to merge)
- [ ] Collections and pantry over sync (out of the agreed v1 scope)
- [x] **Retention for `sync_changes`** — fixed window (`DISHES_SYNC_RETENTION_DAYS`, default 30), pruning `sync_operations` too. A fixed window rather than "oldest active cursor" because nothing tracks clients, and the fallback is already correct: migration `0026` adds `sync_prune_state`, `pull()` rejects a cursor below the household's watermark with `SyncCursorError`, and the engine's existing `invalid_request` handling clears the store and takes a full snapshot. Verified against the dev database — a stale cursor 400s and the very next request is a cursor-less snapshot, with nothing visible to the user. Runs opportunistically after a pull (max hourly, fire-and-forget) since Phase 1 has no worker; `pruneSyncLog()` is exported for the Phase 2 worker to take over

---

## Phase B — Local-first on the PWA

Ship this before writing any native code and reassess. This is where "clunky on poor signal" actually dies, and it validates the sync design on a platform you can iterate on quickly.

- [x] `/api/web/*` alias so the browser can reach the client API with its session (middleware rewrite; no Authelia change needed)
- [x] `@dishes/client`: typed API client + sync engine behind a `SyncStore` interface. No Dexie, no React, no timers — the host decides *when* to sync, which keeps it identical on web and native
- [x] Dexie `SyncStore` implementation for the browser (`apps/web/lib/sync-store.ts`), one table per collection, pull applied in a single transaction with the cursor
- [x] `SyncProvider` owns one engine and decides *when* to sync (mount, reconnect, tab visible). No polling — a household app is idle for hours at a time
- [x] Read hooks `useSyncedCollection` / `useSyncedRecord` / `useOnline`, plus a quiet `SyncStatus` affordance in the side nav
- [x] **Favourites converted first, as the pattern** (84 lines vs the recipes list's 1,507). Server render is passed in as `initial` so first paint is unchanged and nothing regresses without a local store; the synced copy takes over once the engine has data. Cook stats are derived client-side from the synced `cookHistory`
- [x] **Recipes list converted.** `lib/recipe-filtering.ts` mirrors the SQL (title-or-tag search, cuisine, favourites, difficulty, maxTime with the same null handling, any-of tags, three sorts); `RecipesLocalGrid` reads the store, applies them from the URL, and wraps the existing 689-line grid rather than rewriting it, so multi-select and bulk actions are untouched. Parity checked against the server across eight filter combinations
- [x] **Filter changes no longer block on the server.** `RecipeFilters` uses `history.pushState` when local data is available (Next syncs `useSearchParams` from it), falling back to `router.push` otherwise. Measured: the list re-filters within 50ms, before the RSC request returns. Next still fetches that payload in the background, but nothing waits for it and there is no flicker
- [x] **Measured — and the metric this item asked for was the wrong one.** Cold
  load still server-renders: every converted screen passes the server's data in
  as `initial` precisely so first paint doesn't regress, so cold-load-to-first-
  paint is *unchanged by design* and no before/after number was ever going to
  move. Production build, `curl` against `next start` (deterministic, unlike
  browser timings):

  | | bytes | TTFB | total @ 50 KB/s |
  |---|---|---|---|
  | `/meal-plan` cold | 61 KB | 25 ms | 831 ms |
  | `/recipes` cold | 86 KB | 24 ms | 954 ms |
  | one week change (RSC) | 16 KB | 6 ms | 114 ms |

  What the local-first work actually removed is the third row, repeated on every
  interaction: a week change now transfers **nothing at all**, and filter
  changes re-filter locally instead of waiting on the server. The cold 61 KB is
  untouched, and only the still-open service-worker items below can touch it —
  which makes "stale-while-revalidate reads" the item that would move this
  number, not anything already merged
- [x] **Meal plan converted.** `WeekPlannerLocal` wraps `WeekPlanner` the same way `RecipesLocalGrid` wraps the grid, so its ~690 lines of drag-and-drop, per-entry menus and shopping flows are untouched. Week entries, the picker's recipe list, top ingredients and the shopping badge are all derived from the local store; the server render stays as `initial`. Notes on the reverted first attempt below
- [ ] **Recipe detail — investigated 15 Aug 2026, deliberately not converted
  yet.** The wrapper pattern that worked for the list and the meal plan does not
  transfer, for two reasons:

  1. **It cannot remove the round-trip.** The wins so far came from *same-route*
     URL changes — filter chips and week arrows — where `pushState` replaces a
     server fetch. Going list → detail is a *route* change to a server-rendered
     page, so Next fetches the RSC payload regardless of what the local store
     holds. A wrapper would only change what renders after that fetch lands.
  2. **The page is not fully derivable locally.** Of its 12 queries, the store
     covers the recipe document, cook history, and (via `mealPlans` /
     `mealPlanEntries`) planner stats. Notes, SMTP config and AI image config
     are not synced, so the server render is still required.

  What would actually make this screen instant is the service-worker /
  stale-while-revalidate item below, not a local-store wrapper. Worth settling
  first: whether `<Link>` prefetch already covers it in production. The cards do
  use `<Link>`, but prefetch is disabled in dev, so the 402 ms RSC fetch measured
  on click locally is **not** a production figure, and default prefetch on a
  dynamic route with no `loading.tsx` boundary may fetch nothing useful. Measure
  that against a production build before building anything

- [ ] Retire `lib/shopping-db.ts` when the shopping screen moves across

#### Meal plan conversion — how it actually went

Traced on 15 Aug 2026 before rebuilding. **`AddEntryDialog` gets its recipes
from exactly one place**: `WeekPlanner`'s `recipes` prop, passed straight
through at its two call sites. There is no second source — the note below
guessed wrong. The two `Recipe` types were already field-for-field identical.

So the `tags is not iterable` failure was a per-record hole, not a wrong-source
problem: the server guarantees `tags: … ?? []` in `page.tsx`, and any mapping
that reads `tags` off a record where it can be absent yields `undefined` while
the type still says `string[]`. `WeekPlannerLocal` closes that off by routing
every field through a narrowing helper (`strArray`, `difficulty` via `find` so
the compiler derives the union, and so on) rather than a cast, applying the same
defaults the server does. A malformed store record cannot reach the picker.

Two things worth knowing for the next conversion:

1. **Memoise the mapped arrays.** `WeekPlanner` copies `entries` into state via
   an effect keyed on its identity, so rebuilding the array each render loops
   forever. `useMemo` on the store arrays is not an optimisation here.
2. **A stale Turbopack chunk looks exactly like a code bug.** Changing the props
   `page.tsx` passes left the dev server serving a client chunk that still
   rendered `WeekPlanner` directly, so it received no `entries` and threw
   `localEntries.length` of undefined — with the *new* server render behind it.
   `rm -rf apps/web/.next` and restart before believing a prop-shape error.

#### The reverted first attempt — original notes

The wrapper approach is sound and the seam exists: `WeekPlanner` takes `entries`
and `recipes` as props, so it can be wrapped exactly like `RecipesGrid` was,
leaving its ~690 lines of drag-and-drop, per-entry menus and shopping flows
untouched. A `WeekPlannerLocal` built this way typechecked and the page wired
up cleanly.

It failed at runtime with `r.tags is not iterable`, thrown from
`AddEntryDialog`. **Unresolved** — reverted rather than committed.

Two things worth carrying forward:

1. **Never cast to the target prop type.** The first attempt used
   `as LocalRecipe`, which silenced the compiler on a type carrying seven more
   fields than were mapped, so `tags` arrived undefined. Build the object
   literal and let the compiler check it — that alone would have caught this
   before the browser did.
2. ~~**Mapping all the fields did not fix it.** So something other than
   `WeekPlanner`'s `recipes` prop is feeding `AddEntryDialog`.~~ **Wrong** — the
   trace above found a single source. Kept as a reminder that "it must be coming
   from somewhere else" is a tempting and expensive wrong turn.

The picker's `Recipe` type needs `tags`, `ingredientNames`, `avgRating`,
`isFavourite`, `imageUrl` and both time fields — a heavier mapping than the
recipe card needs. `ingredientNames` comes from the synced recipe's
`ingredients` array; `avgRating` has to be derived from synced `cookHistory`.

**Still outstanding on this screen.** The remaining writes (add, delete,
shopping generate) still go through the existing server actions.

- [x] **Drag-and-drop between days on `engine.mutate()` — the sync push path is
  now proven end to end through a real user action**, not just at the API level.
  `WeekPlanner` takes an optional `onMoveEntry`; it defaults to the
  `moveMealEntry` server action, and `WeekPlannerLocal` supplies a version that
  queues `meal_plan_entry.update` instead. Verified online (`POST /api/web/sync`
  returned `applied`, move survived a reload) and offline (server stopped
  mid-drag: the UI moved, the mutation sat in the Dexie queue, and it drained to
  the server on reconnect)
- [x] **Week navigation via `history.pushState`.** Better than the filter chips:
  those still let Next fetch the RSC payload in the background, whereas a week
  change now issues **no network request at all** — the store already holds every
  week. Needed one thing the chips didn't: `weekStartDate` is a server prop, so
  `WeekPlannerLocal` derives the week (and `isCurrentWeek` / `todayDayIndex`)
  from `useSearchParams` when local, or nothing would re-render. Back/forward
  verified
- [x] **Delete, change meal type, change servings and move-from-the-menu over
  `engine.mutate()`.** `WeekPlanner` takes an optional `mutations` object
  (`moveEntry` / `changeEntryType` / `updateEntryServings` / `deleteEntry`),
  each defaulting to its server action, forwarded down to `EntryCard`. These are
  exactly what `POST /api/v1/sync` accepts as `meal_plan_entry.update` /
  `.delete`
- [ ] **Adding an entry — needs engine work first, not screen work.** The server
  assigns the entry id and creates the week's plan row, so an optimistic entry
  needs a client-generated id; `applyPull` only removes ids the server reports
  as deleted, so the temporary row would outlive the pull that brings the real
  one and the meal would show twice, permanently. Needs the engine to reconcile
  a temp id against the `id` in the push response. Until then adding stays on
  its server action, with `onEntryAdded` triggering a sync so the store catches
  up straight away
- [ ] **Shopping-list generation stays a server action** and probably should.
  It is not in the sync schema, and its result (added / topped up /
  skipped-because-pantry) is computed server-side from ingredients and pantry
  stock, so there is nothing meaningful to show optimistically
- [ ] Stale-while-revalidate reads: recipe list, recipe detail, shopping list, this week's meal plan paint from cache instantly
- [ ] Mutation queue with optimistic UI + rollback on failure — first real use
  is the meal-plan drag above; rollback there is implicit (the next pull carries
  the server's version), which may or may not be enough for the other screens
- [ ] Background Sync API registration for queued mutations
- [ ] Offline indicator + "last synced" affordance in the app shell
- [ ] Cache recipe images for favourites and this week's plan (Cache API)
- [ ] Re-measure cold-load-to-first-paint once the service-worker items above
  land — that is the change that can actually move it. Baseline is in the Phase B
  list: 61 KB / 831 ms at 50 KB/s for `/meal-plan`

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
