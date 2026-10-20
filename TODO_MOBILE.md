# Dishes — Native iOS Roadmap

Tracks the work to ship a native iOS app (`/apps/ios`, SwiftUI) alongside the existing PWA. The PWA is **not** being replaced — it remains the desktop/Mac experience and the admin surface.

Items are ordered by dependency. Phases A and B benefit the web app on their own, so they are worth doing even if the native app is deferred.

---

## Guiding principles

- **The perceived slowness is a data-layer problem, not a rendering problem.** Almost every screen currently waits on a server round-trip (~110 server actions across `apps/web/app/actions/` plus RSC page loads). A native client hitting the same endpoints the same way would feel identical. The fix is local-first reads on both platforms.
- **Share contracts, not UI.** The wire format, sync protocol and client-side rules are defined once (`@dishes/shared`, `@dishes/client`) and pinned by shared JSON fixtures that the TypeScript and Swift implementations must both pass. Screens are written twice.
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
- [x] **Adding an entry — done, via temp-id reconciliation in the engine.**
  `mutate()` now takes a list of optimistic changes, any of which can be marked
  `temporary`: a row written under a client-generated id that the server really
  owns. `drainQueue` removes those rows once the mutation settles — on success
  the server's real row lands in the same cycle's pull, on failure it is the
  rollback — and the ids are persisted with the queued mutation so a reload
  mid-flight doesn't strand them. Adding a meal to a week with no plan yet
  creates *two* placeholders (plan and entry) and both are reconciled.
  Verified online, offline-then-reconnect, and against the database: one plan
  row per week, no duplicates
- [ ] **Shopping-list generation stays a server action** and probably should.
  It is not in the sync schema, and its result (added / topped up /
  skipped-because-pantry) is computed server-side from ingredients and pantry
  stock, so there is nothing meaningful to show optimistically
- [x] **Stale-while-revalidate reads — every screen paints from cache.** The
  service worker already existed; the problem was that `defaultCache` serves
  pages and RSC payloads NetworkFirst, so every navigation waited on the server
  even with an identical copy cached. Routes are now registered explicitly
  instead of through `runtimeCaching` — precedence is registration order, and
  constructor-passed routes register first, so a plain `destination ===
  "document"` matcher could never get ahead of defaultCache's same-origin
  catch-all. Order is now `NavigationRoute` → RSC → images → Next defaults.
  Verified offline in a real browser
- [x] **A correctness bug fixed on the way.** That catch-all is NetworkFirst,
  which only falls back to cache on a network *error*. A reverse proxy answering
  502 while the app server restarts is a valid response, so it handed the error
  page to the user with a good copy sitting in the cache. Navigations no longer
  go through it
- [x] **Mutation queue with optimistic UI + rollback on failure.** Rollback for
  *edits* is implicit — the next pull carries the server's version, so a
  rejected change simply reverts. Rollback for *creates* needed the temp-id
  mechanism above, since there is no server row to revert to. Both are in and
  exercised by the meal plan; the remaining screens get them for free
- [ ] **Background Sync for the *sync engine's* queue.** A `sync` handler exists,
  but it flushes the old `dishes-shopping` IndexedDB queue, not the engine's
  `dishes-sync` one — so an engine mutation queued offline waits for the app to
  be reopened rather than going out when connectivity returns. Note the hazard
  before starting: draining from the worker means reimplementing the push
  protocol *including* temp-id reconciliation, and getting that wrong duplicates
  entities exactly as the temp-id work was written to prevent. Waking an open
  client to call `engine.sync()` is the safe subset; draining with the app closed
  is the part that needs care
- [x] Offline indicator + "last synced" affordance in the app shell — already
  shipped with the sync provider (`SyncStatus` in the side nav)
- [x] Cache recipe images for favourites and this week's plan (Cache API) —
  already in the service worker: `recipe-images`, 250 entries, 30 days
- [ ] Re-measure cold-load-to-first-paint once the service-worker items above
  land — that is the change that can actually move it. Baseline is in the Phase B
  list: 61 KB / 831 ms at 50 KB/s for `/meal-plan`

---

## Phase C — The SwiftUI app

**Decided 16 Oct 2026: SwiftUI, not Expo.** This plan originally said Expo so
the app could reuse `@dishes/client`. Two things changed:

1. **Keepsake now has a working SwiftUI app** (`~/Github/keepsake/apps/ios`)
   talking to the same Authelia, with OIDC + PKCE, Keychain tokens, a GRDB store,
   a sync engine with an outbox, a device list, XcodeGen and simulator/device
   scripts. That is most of the plumbing this phase needs, already proven, in
   the language it would be copied in. Two apps on two mobile stacks would mean
   two sets of SDK upgrades to keep alive.
2. **Every item under "native-only wins" is an Apple framework** — WidgetKit,
   ActivityKit (Live Activities), App Intents, share extensions, AVAudioSession,
   UserNotifications. In Expo each is a Swift module bridged to JavaScript; in
   SwiftUI it's a direct call. Cooking mode with pooled timers on the Lock
   Screen is the headline feature, and it's ActivityKit end to end.

**What it costs:** the sync engine (`packages/client/src/sync-engine.ts`, ~340
lines) and the small amount of client-side logic below get written a second
time in Swift. That's handled the way Keepsake handles it — **shared JSON
fixtures both test suites must pass** (C2) — rather than by sharing code.

**What does not carry over from Keepsake:** its sync *semantics*. Keepsake sends
`baseRev` and gets `conflict` responses; Dishes is last-write-wins at whole-
entity granularity with temp-id reconciliation for optimistic creates. The
Swift engine is a port of `@dishes/client`, using Keepsake's code only for the
shape (GRDB store, outbox table, `ValueObservation` driving SwiftUI).

### C0. Server gaps — features added since v0.75 (audited 16 Oct 2026)

This plan was last revised at v0.75; the app is now v1.23. The sync log already
carries more than expected: whole rows are selected, so new **columns** on
synced tables arrive automatically. New **tables** do not.

| Feature (version) | In sync? | In `/api/v1`? | Needed for iOS v1? |
|---|---|---|---|
| Combined meals — `meal_plan_groups` (v1.14) | ✅ collection + `meal_plan_group.add/update/delete` | via sync only — fine | ✅ yes, already covered |
| Cooking schedule — `serve_at`, `timeline` on groups (v1.18) | ✅ as fields | ❌ AI timeline planning (`planMealTimelineWithAi`) is server-action only | ✅ read; planning can stay web for v1 |
| Recipe roles — `recipes.meal_role` (v1.20) | ✅ on the recipe document | ✅ | ✅ covered |
| Per-person cook ratings — `cook_history.member_ratings` (v1.8) | ✅ | ✅ in the cook-history wire schema | ✅ covered |
| Saved meals + meal options — `meals`, `meal_components`, `meal_slots`, `meal_slot_options` (v1.14/v1.16) | ❌ | ❌ | ✅ — the planner picker offers them |
| Accompaniment suggestions (v1.20) / side-dish generation (v1.23) | — | ❌ server action / AI | Later |
| Cook-timer pushes (v1.19) | — | web-push only | Replaced on iOS by local notifications + Live Activity; no server work |
| Dinner reminders (v1.12) + snooze | — | web-push only, `/api/dinner-reminders/snooze` is browser-session | ✅ needs APNs fan-out (C5) and a `/api/v1` snooze |
| Grocery deliveries + order emails (v1.21/v1.22) | ❌ | integrations API only (household token, no member) | Later — read-only card on Home at most |
| Shared libraries (v0.82) | ❌ | ❌ | Later — browse/copy is a web task |
| Stats, Wrapped, nutrition (v1.4–v1.9) | — | ❌ server-computed | No — stays web |
| AI concierge, web-grounded generation, AI meal plan preview (v1.6–v1.11) | — | ❌ (the open A2 AI item) | Later (C4) |
| Cook-assist / recipe-assist chat | — | browser-specific streaming routes | Later (C4) |
| Crouton / URL import | — | ❌ server action | ✅ for the share extension (C4) |
| Pantry, collections, notes | ❌ | ❌ (open A2 / A3 items) | Collections read-only would be nice; the rest later |
| Push subscriptions | — | web-push only | ✅ APNs device registration (C5) |

Server work this implies, in order:

- [x] **Saved meals over sync** — a `meals` collection (meal + components +
  slots + options rolled up to the meal, like recipe children roll up to the
  recipe). Read-only on the phone for v1; creating and editing saved meals
  stays on the web. Plus `meal_plan_group.add_from_meal` (or reuse the existing
  service call) so "plan this saved meal" works offline
- [ ] `/api/v1/dinner-reminders/snooze` — bearer equivalent of the browser route
- [ ] `/api/v1/import` — URL or text in, recipe out, for the share extension
  (lift the body out of the server action into `lib/services/recipe-import.ts`)
- [ ] `/api/v1/collections` read + add/remove (already listed under A2)
- [ ] Device list in Settings (open A1 item) — copy Keepsake's version
  (`1a2f1b3 Devices: list signed-in phones and sign one out`)
- [ ] Bump the sync schema version so an older app build fails loudly rather
  than silently ignoring a collection it doesn't know

### C1. Project scaffold

Mirror Keepsake's layout so the two apps can be worked on with the same habits:

```
apps/ios/
├─ project.yml                 # XcodeGen; .xcodeproj generated, not committed
├─ RUNBOOK.md                  # build/run/device how-to + dated log, as Keepsake
├─ scripts/sim.sh              # build, install, launch against a dev server
├─ Dishes/                     # app target: SwiftUI views, lifecycle, App Intents
├─ DishesWidgets/              # WidgetKit + Live Activity extension (C4)
├─ DishesShare/                # share extension (C4)
└─ Packages/DishesCore/        # models, store, sync, API, auth — no UI, `swift test` on macOS
fixtures/                      # repo root: the TS ↔ Swift contract (C2)
```

**Started 16 Oct 2026** — see `apps/ios/RUNBOOK.md` for how to run it and the log.

- [x] `apps/ios` with XcodeGen, Swift 6 strict concurrency, iOS 26.1 minimum
  (same as Keepsake). **Universal from the start — iPhone and iPad**
  (`TARGETED_DEVICE_FAMILY: "1,2"`, all iPad orientations). Most cooking
  happens on the iPad, so it is not a later port; screens are built with size
  classes from the first commit rather than retrofitted
- [x] Bundle id `uk.collco.dishes`, team `C729B84RYG` (James's individual
  membership, as Keepsake)
- [ ] App Group `group.uk.collco.dishes` — widgets and the share extension
  both need to read the store. **Deferred to the first extension** rather than
  day one: it needs a provisioning profile with the group, and the database is
  a copy of the server's, so moving it into the group container later is a
  resync, not a migration
- [x] **One dependency: GRDB.** Everything else is Apple frameworks
- [x] Debug **Developer** menu pointing at a local dev server, wiping the local
  store when the server changes (Keepsake's `forgetOtherServer`) so dev data
  never reaches production
- [x] Dev server accepts token-less `/api/v1` requests as a stand-in user in
  development only — already true: with no bearer token `resolveIdentity()`
  falls back to the proxy headers, which in development return `DEV_USER`
- [x] `sim.sh` so the simulator can be driven from a session (it takes a
  simulator name or UDID), and an `apps/ios` section in `CLAUDE.md` and `README.md`
- [x] Version: `MARKETING_VERSION` tracks `apps/web/package.json`

### C2. `DishesCore` — the shared-logic contract

Port, don't redesign. Each piece has a TS original that stays the reference.

- [x] **Auth** — copy Keepsake's `OIDC.swift`, `WebAuthenticator.swift`
  (`ASWebAuthenticationSession` + PKCE), `Keychain.swift`, `AuthSession.swift`.
  Client id is `dishes-mobile` (already configured in Authelia). Refresh-token
  handling is the open A1 item, and it lands here — `AuthSession` refreshes
  once however many requests find the token expired. Sign-in against the real
  Authelia verified on James's iPad (17 Oct 2026); a refresh after expiry not
  yet observed
- [x] **API client** — `URLSession` + async/await, the `/api/v1` error envelope
  decoded into a typed error
- [x] **Store** — GRDB: one `records` table keyed by (collection, id) holding
  each row's JSON, plus `outbox` and `meta`. Rows are kept whole so a column
  the server adds later survives; typed views read them (`Entities.swift`).
  Pull applied in one transaction with the cursor
- [x] **Sync engine** — port of `sync-engine.ts`: opaque cursor, paginated
  pull, batched push with client `opId`s, `duplicate` on replay, temp-id
  reconciliation persisted with the queued mutation, and the stale-cursor
  path (`invalid_request` → clear store → full snapshot, outbox untouched).
  Pushes go in batches of 200 (the server's limit; the web sends its whole
  queue). 10 Swift tests in `SyncEngineTests` mirror the TS rules
- [ ] **Fixtures** (`fixtures/` at the repo root; Vitest and Swift Testing both
  loop over them — change a rule, change a fixture, both suites must agree):
  - `wire/*.json` — sample pulls/pushes for every collection; decode → re-encode → compare.
    **Started:** `wire/pull-snapshot.json` is a real dev-server snapshot the
    Swift tests decode; the Vitest side and the other fixtures are still to do
  - `sync-scenarios/*.json` — offline create then push; replay → `duplicate`;
    pull while an op is pending; temp-id plan + entry created together;
    tombstone for an entity with a pending edit; stale cursor → snapshot
  - `scale.json` — `lib/scale-ingredient.ts` + `lib/format-quantity.ts`
    (fractions, unit promotion, metric/imperial)
  - `filter.json` — `lib/recipe-filtering.ts` (the eight parity cases already
    checked against SQL become the first fixtures)
  - `timeline.json` — step-cue times from `lib/meal-timeline.ts` for a serve-at
- [ ] Moving those TS modules into `@dishes/shared` first would let the fixtures
  test one copy on the web side rather than reaching into `apps/web/lib` —
  worth doing as part of writing the fixtures

### C3. Screens — offline-first MVP

Order is by value on poor signal, not by how the web app is laid out.
Standard SwiftUI: `TabView`, `NavigationStack`, sheets, `.searchable`,
`.swipeActions`, `.contextMenu`. Every read comes from the local store via
`ValueObservation`; every write is an outbox mutation.

- [x] Sign-in screen + tab shell: **Plan · Recipes · Shop · More**. On iPad
  the same `TabView` with `.sidebarAdaptable`, so it becomes a sidebar in
  regular width and tabs in compact (Split View / Slide Over / Stage Manager)
- [x] **Shopping list** first — the screen used in a supermarket with no signal.
  Add, check off (haptic), swipe to delete, clear ticked; grouped by aisle as
  the web. Add and tick verified against the dev server
- [ ] Shopping: edit an item (amount, notes, category)
- [x] Meal plan week, read-only: week paging with no network, entries and
  combined meal groups (iPad: a grid of day cards), remove a dish
- [x] Meal plan: move a dish to another day or next week, change meal type
  and servings (menu on every card), drag between days on the week grid,
  move a combined meal, and plan a saved meal with a choice per slot (Add
  meal → Saved meals). All sync mutations, so offline too
- [ ] Drag between days: built but not confirmed — simulated drags don't lift
  the card; check on the iPad. Dragging over the week arrows flips the week
  (spring-loaded), so a meal can be dropped into another week; a second finger
  tapping an arrow works too. Combined meals can't change week yet (the
  server's group update has no week) — they say so and stay put
- [ ] **Meal plan week** — move/change type/servings, add from the recipe library or
  a saved meal (needs C0), "add week to shopping" (online — stays a server call,
  see Phase B)
- [x] Recipes: list (iPad: card grid), search on title/cuisine/tags,
  favourites filter; detail with ingredients beside the method on iPad,
  serving scaling with kitchen fractions, favourite toggle (online — not a
  sync mutation)
- [x] **Recipes** — the web's filters and sorts (v1.37.0: dish role,
  difficulty, ready-in time, tags, heart-healthy; A–Z, newest, rating), cook
  history and per-person ratings on the detail
- [x] **Log a cook (v1.30.0)** — half-star rating, who ate it and what each
  of them thought, notes; from the recipe page and offered on Finish in
  cooking mode. Online (`POST /api/v1/cook-history`); the entry syncs back.
  Members come from the new `GET /api/v1/members`, cached for offline
- [x] Log a cook: dish photo from the camera or library, resized to 2048px and
  uploaded after the cook saves. Not seen succeeding locally — the dev server
  has no storage configured ("Storage not configured.") — check on the device
- [ ] Log a cook: occasion; logging offline (needs a sync mutation for cook
  history); background upload for big photos
- [x] Recipe page: full nutrition panel with heart-healthy badge, the
  household's rating and how often it's been cooked and planned, Add to
  shopping list, cook history, "You might also like"
- [x] Cook history screen (from "Recently cooked" on Home), grouped by month,
  photos-only filter
- [ ] **Today** card on Plan: tonight's meal, serve-at time, start-cooking time
- [x] **Design matches the web app (v1.27.0).** Shared tokens and components
  in `Design/Theme.swift`; the native floating tab bar (top on iPad, bottom on
  iPhone — James preferred it to a web-style sidebar) with a "Cook tonight"
  pill; a Home screen; web recipe cards, planner day strip and entry cards, shopping list
  layout. Adding a meal to the plan now works offline (Add meal sheet)
- [x] Wide iPad layouts: whole-week planner (seven columns), two-column
  shopping with a Sainsbury's side panel, full-width recipe grids, a Tonight
  card on Home
- [ ] Web: take the whole-week planner layout and the Sainsbury's side panel
  across to wide desktop screens
- [ ] Shopping: "from <recipe>" for items linked only through
  `shopping_item_recipes` (0022) — items with a direct recipeId already show it
- [x] More: signed-in member, sync status and pending count, sign out,
  Developer menu (Debug). Devices still to do (needs the server's device list)
- [x] **The rest of the website (v1.37.0)** — through the action bridge
  (`POST /api/v1/actions/{name}`, `lib/api/v1-actions.ts`), so each screen
  runs the web's own server action: pantry, deliveries, saved meals (create
  and edit), notes, Stats, Wrapped, taste profile, household and members,
  recipe links and shared libraries, AI settings; on a recipe the AI tools
  (improve, heart-healthy, similar, sides, photo, nutrition), share and note;
  paste-to-parse in the editor, a meal's cooking schedule (incl.
  Plan with AI) and Save as a saved meal; Add to pantry on Shopping. Stays on
  the web: integrations tokens, email/SMTP settings, diagnostics, the welcome
  wizard. Pantry, deliveries and the rest need a connection — only recipes,
  plan, shopping and saved meals are on the device
- [ ] More → Settings: devices (needs the server's device list)
- [x] Recipe create/edit (v1.31.0): tabbed editor (Details / Ingredients /
  Method), sections, reorder, a timer per step, which ingredients each step
  uses; edit and delete from the recipe's ⋯ menu; New Recipe on Recipes.
  Online. Fields the editor doesn't show (photo, nutrition, notes, source)
  are carried over. Server now keeps step → ingredient links across writes
  (`ingredientIndexes`), which the web editor drops too — worth adopting there
- [x] Collections: chips on Recipes, Add to collection / New collection on a
  recipe; `/api/v1/collections` (not in sync yet — fetched after each sync)
- [ ] Recipe create/edit — last in C3; the web editor is large and editing on
  a phone is rare. Recipe edits are also not in the sync schema (A3), so this
  is online-only via `/api/v1/recipes`
- [ ] **iPad layouts** for each screen above, not stretched phone screens:
  - Recipes: grid of cards in regular width; detail as two columns
    (ingredients beside steps), as the desktop web view
  - Meal plan: the whole week as a grid, drag-and-drop between days (the
    desktop planner's layout), with the picker as a side panel rather than a
    sheet
  - Shopping: list plus a side panel of recipes it came from; mostly a phone
    screen, but must still work in Split View next to a recipe
  - Check every screen at the narrowest Split View width — it behaves like an
    iPhone and that is where layouts break
- [x] No Home tab: Recipes opens on browse mode (RecipesBrowse — tonight's
  meal, shelves, All/Clear chips) and the tabs are Recipes, Planner, AI
  (the concierge as a tab), Shopping, Settings; Wrapped is a banner on
  Recipes in December and January (v1.39.0, mirrors the web)
- [x] Cookbook / book mode (`Book/`): the recipes as a page-curl book with
  stains and handwritten notes, opened from Recipes or by half-folding an
  iPhone Duo like a book (`UIHingeInteraction`, iOS 27.1) (v1.45.0)
- [ ] iPhone Duo: unfolded layouts (iPad-style two columns), stand mode for
  cooking (half-folded with the hinge level), drag a recipe onto a planner day
- [ ] Cookbook second pass: circled servings, underlined ingredients a note
  mentions; check a real spread on the Duo
- [ ] `BGAppRefreshTask` for periodic sync; sync on foreground and on
  reachability change (no polling — the same rule as the web `SyncProvider`)

### C4. Native-only wins (the actual reason to do this)

Grouped by priority. Where a feature differs on iPad it says so — the iPad is
the main cooking device, and some iPhone features (Dynamic Island, StandBy)
don't exist there.

#### Tier 1 — cooking, done properly

- [x] **Cooking mode, designed iPad-first (v1.26.0, `Dishes/Cooking/`).** One
  recipe (from the recipe page, at its chosen scale) or a combined meal (Cook
  on the plan), screen kept on, the step's ingredients shown as scaled chips
  from its ingredient references, haptics on step change. Portrait iPad and
  iPhone checked in the simulator, landscape on James's iPad Pro. Not yet: inline highlighting of
  ingredient names in the step text (the web's matcher), one column per dish
  in landscape (tabs for now), logging the cook at the end
  - iPad landscape: the current step large in the centre, ingredients in one
    rail and running timers in another — no scrolling to find a timer with wet
    hands. Portrait: step above, ingredients and timers in a bottom tray
  - Combined meal: one column per dish in landscape (tabs on iPhone), timers
    pooled across dishes
  - Big targets: tap or swipe anywhere on the step area to advance; nothing
    precise needed with floury fingers
  - Hardware keyboard shortcuts (→ / ← steps, space starts the step's timer)
    for an iPad on a keyboard case
- [x] **Several cooks at once (v1.46.1, `Cooking/CookStack.swift`).** `AppNav`
  keeps a list of cooks, the one in front first; starting another (a dessert
  while the roast is minimised) adds it, starting one already going resumes
  it (a planned meal matches by its group). The resume bar stacks the others
  behind the front cook and fans them out on a tap; cooking mode switches
  between them (toolbar on iPad, title menu on iPhone). The Live Activity
  follows the cook in front, updated rather than restarted. Cooks are kept
  across a relaunch for 12 h (`SavedCooks`, as the web)
- [ ] **Hands-free cooking.** On-device `SpeechAnalyzer` for "next step",
  "previous step", "start the timer", "how much butter?"; `AVSpeechSynthesizer`
  to read a step aloud. Most useful on the iPad, propped up out of reach
- [x] **Timers that alarm with no signal (`CookTimers`).** AlarmKit when
  allowed, else a time-sensitive local notification; either way the system
  owns the countdown, so it fires with no server, no signal and the app
  closed. Pause, resume, +1 minute, cancel; kept across relaunches. While
  Dishes is open a finished notification timer also rings in the app — a
  looping chime that ignores silent mode, with a big Stop banner on every
  screen. **AlarmKit works on a real iPad** (asked for permission, went off —
  17 Oct 2026); only the simulators refuse it, where the fallback runs
- [x] **Live Activity — timers and next step (v1.28.0).** `DishesWidgets`
  extension: the cooking activity (dish, "Step 3 of 8", the instruction, the
  soonest timer counting down, a progress bar) on the Lock Screen and in the
  Dynamic Island while cooking mode is open, started/updated/ended by
  `CookingActivity`; plus each AlarmKit timer's own countdown, paused and
  "Done" states (AlarmKit only shows a timer on the Lock Screen through an
  extension). Cooking activity checked in the iPhone simulator (compact,
  expanded, Lock Screen). The AlarmKit countdown needs a real device — the
  simulator refuses AlarmKit. No App Group needed yet: ActivityKit carries the
  state; Home Screen widgets will need one
- [x] **Tapping a Live Activity opens that cook (v1.46.4).** `dishes://cook?…`
  (`Shared/CookLink.swift`) as the cooking activity's `widgetURL` (Lock Screen
  and every Dynamic Island size): cooking mode for that cook, in front of any
  others, at the step (or place in a meal's sequence) it showed; the recipe if
  the cook has ended. The meal-schedule activity opens the meal's cook, else
  the Planner. Works from a cold launch (held until saved cooks are back)
- [x] **Live Activity — meal schedule.** (v1.33.0: started from the meal page; the server keeps it current over APNs. Push-to-start from the dinner reminder is still to do.) The serve-at timeline (v1.18) as a
  countdown across the whole meal: "Potatoes in at 18:05 · serve 18:45".
  Started remotely by the dinner-reminder push (ActivityKit push-to-start
  tokens, via C5), so it's on the Lock Screen before the app is opened
- [ ] **Log a cook → HealthKit** (see the HealthKit section below)

#### Tier 2 — at a glance

- [ ] **Interactive widgets** (App Intents buttons; built in Phase D4): tonight's meal with a
  "Start cooking" button; shopping list with tap-to-tick. Home Screen and Lock
  Screen sizes. Read from the App Group store, refreshed after each sync.
  iPad Home Screen widgets get the larger family showing the week
- [ ] **StandBy** (iPhone on its side, charging): tonight's meal, or the
  current step and timers while cooking
- [ ] **Live Activity — shopping trip.** "9 items left", updated by push as
  someone at home adds or ticks things
- [x] **Control Center control** — "Add to shopping" (v1.40.0: opens the
  shopping list with the add field focused; a control can't take text)
- [x] **App Intents / Siri / Shortcuts** — "add milk to the shopping list"
  (v1.40.0: `AddToShoppingListIntent`, runs in the background, queues an
  outbox mutation so it works offline; Action button and NFC automations too)
- [x] **App Intents, the rest** — "what's for dinner", "start cooking
  tonight's meal" — Phase D1 (v1.55.0)
- [x] **Spotlight** — recipes indexed with `CoreSpotlight`, searchable from the
  Home Screen, offline — Phase D1 (the iOS 27 semantic index, v1.55.0)

#### Tier 3 — getting recipes in

- [x] **Share extension** — import a recipe page from the Share Sheet
  (v1.53.0, `DishesShare`, through `/api/v1/recipes/import-url`). Shared text
  and screenshots: Phase D3
- [ ] **Scan a cookbook page or recipe card** — Phase D3 (on-device image
  input + `OCRTool`)
- [ ] **Barcode scanning** for shopping items, and for the pantry once it has
  an API — Phase D3
- [ ] **On-device Foundation Models** — now Phase D2/D3: the device first for
  every job it does well enough, the server only when it doesn't (decided
  20 Oct 2026; replaces "the concierge and meal-plan generation stay on OpenAI")
- [x] Cook-assist chat and AI recipe generation (v1.34.0: concierge, photo → recipe, plan generation, Ask about this step) once the A2 AI endpoints exist
  (they must stream; `URLSession.bytes` reads SSE directly)

#### Tier 4 — later

- [x] **Apple Watch app** (v1.47.0, `DishesWatch`; RUNBOOK.md "Apple Watch").
  The phone relays everything over WatchConnectivity — the Watch never signs in
  (Authelia rotates refresh tokens, so the phone and Watch can't share one).
  - [x] W1 — shopping list: aisle groups, tap to tick, Add by voice/Scribble,
    "Add to Shopping List" App Intent on the Watch, items-left complication.
    Ticks are WatchActions with ids, applied once by the phone and kept on the
    Watch until a snapshot confirms them
  - [x] W2 — tonight's meal and its schedule (the meal clock) as clock times,
    and a "Tonight" complication that moves on at each cue
  - [x] W3 — the cook in progress, from any device: `CookingShare` publishes
    the cooking device's state to `/api/v1/cooking-sessions` (Redis, versioned,
    tombstoned on end, refused after 12 h), a silent push (`kind: "cooking"`)
    tells phones with a Watch to fetch it, and the Watch polls while the
    cooking screen is open. View-only
  - [ ] Watch controls for the cook (Next step, pause a timer): requests to the
    cooking device, which decides — only once the view-only round trip has
    proved itself
  - [x] The web's cooking mode publishing its cook too: `lib/cooking-share.ts`,
    fed by cooking mode (the step on screen) and the cook-session provider
    (timers, and ending the cook when it leaves the list), device "Browser"
  - [ ] Check on a real Watch: complications on a face, Siri on the wrist,
    the Action button, a tick with the phone locked in a pocket, a cook on the
    iPad followed on the Watch
- [ ] **Handoff + universal links** — a Dishes URL opens in the app; a recipe
  open on the Mac continues on the iPad (`NSUserActivity` with `webpageURL`)
- [ ] **Supermarket geofence** — "You're at Tesco: 12 items on the list"
- [ ] **Live Activity — delivery order deadline**, from the v1.21 delivery data

#### HealthKit — nutrition from logged cooks

Recipes already carry per-serving nutrition (`calories`, `protein_g`,
`carbs_g`, `fat_g`, `saturated_fat_g`, `fiber_g`, `sugar_g`, `sodium_mg`;
migrations `0019` / `0031`), which is exactly what HealthKit's dietary types
take. The heart-healthy diet support makes saturated fat and sodium the
numbers worth having in Health.

- [ ] **Write-only**, opt-in, asked for at the moment it's first useful (logging
  a cook), not at launch. Dishes never reads Health data
- [ ] On logging a cook, write one `HKCorrelation` of type `.food` for the
  person using this device, dated the cook time, containing
  `dietaryEnergyConsumed`, `dietaryProtein`, `dietaryCarbohydrates`,
  `dietaryFatTotal`, `dietaryFatSaturated`, `dietaryFiber`, `dietarySugar`,
  `dietarySodium` — whichever the recipe has (skip nulls; skip entirely if
  `nutrition_source` is `none`)
- [ ] Portion: default 1 serving, adjustable on the log sheet (½, 1, 1½, 2).
  `cook_history` has no per-person portion and doesn't need one — it's a
  device-side choice
- [ ] Combined meals write one food entry per dish eaten, so Health shows
  "Roast chicken" and "Roast potatoes" rather than one opaque total
- [ ] Only write if this device's member is in `cookedFor` (matched by display
  name, as `member_ratings` is)
- [ ] Keep the written sample UUIDs locally against the cook-history id, so
  editing or deleting the log updates or deletes the Health entry
- [ ] **Shared-iPad caveat:** Health data belongs to the Apple ID signed into
  the device. On a family iPad, writing the cook's meal to whoever owns the
  iPad would be wrong. The setting is per device, off by default, with a
  "who eats from this device?" choice — expect it on for phones, off for the
  kitchen iPad
- [ ] HealthKit entitlement and `NSHealthUpdateUsageDescription` in
  `project.yml`; HealthKit is available on iPadOS 17+

### C5. Push via APNs

- [x] `.p8` token auth from the server (`lib/apns.ts`, HTTP/2, `APNS_*` env
  vars — also in the `docker` repo compose file)
- [x] `POST/DELETE /api/v1/push/devices` — register an APNs token against the
  member, alongside the existing web-push subscriptions
- [x] `lib/push.ts` fans out to web-push **and** APNs from the same call
  sites, filtered by each member's choices (`lib/notification-types.ts`,
  Settings → Notifications on the web and in the app)
- [x] Silent "sync now" push: every alert carries `content-available`, and
  members who've turned a kind off get a background push instead
- [x] Notification actions: Push back 30 min and Start cooking on a dinner reminder, Mark as ordered on a delivery reminder (v1.33.0)

### C6. Distribution

- [x] TestFlight: `apps/ios/scripts/testflight.sh` (first build 1.36.0, 17 Oct 2026). Development installs on family phones first (`devicectl`, as Keepsake's
  runbook), then TestFlight for anyone not plugged into the Mac
- [ ] App icon from `setup_guide/dishes-icon.png`, launch colour matching the
  web theme
- [ ] Privacy: `ITSAppUsesNonExemptEncryption: false`; camera, photo
  library, microphone/speech (hands-free cooking) and HealthKit usage strings;
  no tracking. The App Store privacy label must declare Health data (written,
  not collected by us)

### Open questions

- **Share Swift code with Keepsake?** Auth, Keychain and the API client will be
  near-identical. Copy first; extract a shared Swift package only once both
  apps are stable and the copies have actually stayed the same
- **Design tokens.** Keepsake generates `Tokens.swift` from `design/tokens.json`.
  Dishes' colours live in Tailwind config; extracting them is worth it if the
  iOS app should match the web's gradients rather than look stock-iOS
- **Background Sync on the PWA** (open Phase B item) doesn't block this —
  the iOS app has `BGAppRefreshTask` and a real outbox regardless

---

## Phase D — iOS 27 (planned 20 Oct 2026)

What iOS 27 adds that Dishes should use. API names below were checked against
the iOS 27.1 SDK in Xcode 27.1 (installed on James's Mac), not just WWDC
write-ups.

### Decisions

- **AI runs on the device first.** *Superseded:* "AI is server-side only" and
  the Tier 3 line that kept the concierge on OpenAI. The rule is now: use the
  on-device model when it's good enough for the job, and use the household's
  OpenAI key on the server only when it isn't. "Good enough" is measured by
  the D2 evaluation suite, not guessed. Keys still never leave the server; the
  on-device model needs none
- **Stay on iOS 26.1 as the minimum.** Everything here goes behind
  `if #available(iOS 27, *)`, and the AI features also check that Apple
  Intelligence is there (`SystemLanguageModel.default.availability`). Older OS
  or older device → the server path the app uses today. Nothing gets worse on
  a device that can't do it
- **The household's AI settings still apply on the device.** The measurement
  system, default prompt, kitchen equipment, members' dietary limits and the
  taste profile all go into the on-device prompts as well, so a recipe read on
  the iPad follows the same rules as one written on the server

### D0. Groundwork

- [x] `GET /api/v1/ai/context` — the prompt inputs only, readable by any
  member: `measurementSystem`, `defaultPrompt`, `kitchenEquipment`,
  `webGrounding`, members with dietary constraints, the taste-profile summary
  (`lib/services/taste-profile.ts`), the collection names. Never the key or the
  budget (`ai.config` stays admin-only). Cached on the device and refreshed on
  sync, so on-device AI works offline. *Done (v1.55.0):* `lib/services/ai-context.ts`;
  members carry everything `buildMemberConstraints` uses, notes included (which
  `/api/v1/members` leaves out). The taste summary moved to
  `lib/ai/taste-summary.ts`, shared with the server's prompts so the two can't
  drift. The app caches it as `ai-context.json` in the App Group
  (`DishesCore/Models/AIContext.swift`), refreshed after each sync
- [x] `POST /api/v1/recipes/generated` — saves a `GeneratedRecipe`
  (`lib/ai/recipe-generation.ts`) the way `saveGeneratedRecipe` does, with an
  optional `collectionId` so the AI collection suggestion can be skipped when
  the device already picked one. Saves the device turning `GeneratedRecipe`
  into the full `/api/v1/recipes` write format itself. *Done (v1.55.0):*
  `savedGeneratedRecipeSchema` (nutrition and meal role optional, unknown
  fields refused); `collectionId` omitted → the server suggests one, a uuid →
  filed there, null → nowhere. `pnpm --filter @dishes/web check:ai-context`
- [x] Add the endpoints above to `API.md`'s v1 section
- [x] **App Group** `group.uk.collco.dishes` on the app, `DishesWidgets` and
  `DishesShare`. Needed by D4 (widgets read the store) and D3 (the share
  extension uses the cached AI context). Move `dishes.sqlite` into the group
  container with a one-time migration (`AppModel` currently opens
  Application Support/Dishes/dishes.sqlite). *Done (v1.55.0):* opened as GRDB
  advises for a shared container (`DishesCore/Store/SharedStore.swift`:
  persistent WAL, busy timeout, file coordination), and suspended whenever the
  app is in the background with nothing running, so iOS can't kill it for
  holding a lock there (0xDEAD10CC); background work goes in
  `AppModel.awake { }`. Checked on the iPad simulator: a v1.54.1 install
  updated in place moved its database and sent the change it had queued
- [x] **Testing on the Mac:** the Mac is on macOS 26 (Darwin 25.6), and
  FoundationModels' iOS 27 APIs need macOS 27 to run under `swift test`. Either
  update the Mac or run the AI tests on the iPad. Decide before D2. *Settled
  (20 Oct 2026):* the Mac is on macOS 27.0.1 now, so `swift test` runs them

### D1. Siri, Spotlight and App Intents

Today the app has one intent (`AddToShoppingListIntent`) and no Spotlight
index. Everything here works without AI and offline.

- [x] **Entities** (`DishesCore` models → `AppEntity` + `IndexedEntity`) in a
  new `Dishes/Intents/` folder: `RecipeEntity` (title, cuisine, tags, total
  time, meal role, favourite, thumbnail), `PlannedMealEntity` (an entry or
  group on a day), `ShoppingItemEntity`, `SavedMealEntity`. Queries read the
  GRDB store, never the network. *Done (v1.55.0):* plus `CookingStepEntity`
  (the step being cooked, at its scale). Only recipes are indexed: a saved meal
  has no screen of its own to open on
- [x] **Spotlight semantic index**: `CSSearchableIndex.indexAppEntities(_:)`
  after each sync that changes recipes, and `deleteAppEntities` for tombstones.
  Gets "find that chicken thing we had last week" from the Home Screen and
  from Siri, with a link back. Replaces the Tier 2 Spotlight item. *Done
  (v1.55.0):* `SpotlightIndex` follows the store rather than sync, sends only
  what changed and removes what's gone; a tap runs `OpenRecipeIntent`
- [x] **Schema conformances** (`AppSchemaEntity` / `AppSchemaIntent`) where a
  schema fits, so Siri understands requests worded freely without a list of
  phrases. Check `AppSchema` for a domain matching recipes or lists; where none
  fits, plain entities + intents still work through Shortcuts and App Shortcuts.
  *Checked (20 Oct 2026):* none fits — the 27.1 SDK's domains are mail,
  photos, reminders, notes, journal, books, browser and the like. Reminders is
  the nearest and is the grammar Siri already confused the shopping list with
- [x] **Intents:** "What's for dinner?" (answers with tonight's meal and serve
  time; opens the plan), "Start cooking tonight's meal" / "Start cooking
  {recipe}" (opens cooking mode through `CookLinkHandler`), "Add {recipe} to
  the shopping list" (the existing `addRecipeToShopping`), "Add {day}'s meals
  to the shopping list", "Plan {recipe} for {day}" (a `meal_plan_entry.add`
  outbox mutation, so it works offline), "Tick off {item}". Replaces the Tier
  2 "App Intents, the rest" item. *Done (v1.55.0):* `Dishes/Intents/`. Start
  cooking goes through `AppRequests` → `RootView.openCooking` rather than
  `CookLinkHandler`, which would change what tapping an old Live Activity does.
  An App Shortcut phrase can hold one parameter, so "Plan {recipe} for {day}"
  is spoken as "Plan {recipe} in Dishes" and Siri asks the day
- [x] **Siri understands the screen:** `appEntityIdentifier(_:)` and
  `appEntityUIElements(_:)` on the recipe page, the plan's day cards and
  cooking mode's current step. So "add this to Friday" on a recipe, or "how
  much butter?" / "set a timer for this" on a step, refers to what's showing.
  The timer goes through `CookTimers` (AlarmKit), as the in-app button does.
  *Done (v1.55.0):* `appEntityIdentifier` on each; `appEntityUIElements` is for
  custom-drawn views, which none of these are
- [x] **Tests:** an `AppIntentsTesting` target in `project.yml` that runs each
  intent through the system on the simulator: entity lookup, the offline
  outbox write, the cooking-mode deep link. *Done (v1.55.0):*
  `DishesIntentTests`, six tests, passing on the iPad Pro 11" simulator

### D2. The local-first AI engine (`DishesCore/AI`)

*Decided (James, 20 Oct 2026):* every family device can run the on-device
model, and **Private Cloud Compute isn't used** — the router goes device →
server only. **"Close enough"**, set when D2 was built: a job moves to the
device when, on its evaluation set, (1) every sample passes the structure
checks, (2) its expected-answer score is at least 90% of the server's on the
same set, and (3) at least 0.75 out of 1 whatever the server scores. With no
server score yet (no household key where the evaluation ran), (1) and (3)
decide, and the server is measured when it can be.

One place that decides where each AI job runs, so features don't each decide
for themselves.

- [x] **`AIRouter`** — each job (`AITask`) says what it needs; the router picks
  the first option that can do it:
  1. **On the device:** `SystemLanguageModel.default`, guided generation into
     `@Generable` types, with `OCRTool` / `BarcodeReaderTool`
     (`_Vision_FoundationModels`) and `ImageAttachment` for photos
  2. **Private Cloud Compute:** `PrivateCloudComputeLanguageModel`, if
     `availability` says it's allowed and `quotaUsage` isn't at its limit.
     Bigger model, 32K context, still no household key. Whether a TestFlight
     app gets it is an open question (below); if not, the router skips this
     step
  3. **The server:** the household's OpenAI key, through D5's
     `DishesServerModel` or the existing `/api/v1/ai/*` route

  *Done (v1.56.0), `DishesCore/AI/AIRouter.swift`:* device → fallback, no
  Private Cloud Compute. A job's fallback is the server, or — for ingredient
  lines, which the server reads with rules — the rules on the device. Not
  `OCRTool`: Vision reads the page first (`RecipeReader`) and the text goes in
  the prompt, the photo too when there's little text. The tool would make the
  small model decide to read, and `_Vision_FoundationModels` isn't in the
  simulator SDK
- [x] **When it falls back to the server:** Apple Intelligence unavailable
  (device, setting, model still downloading, language); the job is marked
  server-only (below); or the on-device attempt fails — `LanguageModelError`
  (`contextSizeExceeded`, `guardrailViolation`, `refusal`, `timeout`), or the
  result fails our own checks (every step's ingredient references exist,
  amounts are numbers, metric units when the household is metric, no empty
  steps). One automatic retry on the server, no prompt to the user. *Done
  (v1.56.0), `AIChecks.swift`:* plus every unit and amount must be on the
  page (the model added "kg" to "4 ripe tomatoes" before that check). There
  are no ingredient references in `GeneratedRecipe`, so nothing to check there
- [x] **Show where it ran:** a small "On this iPad" / "Finished on the server"
  label on AI results, and a Settings → AI row saying whether this device can
  run Dishes' AI on the device. Helps while tuning; can be quieter later.
  *Done (v1.56.0):* "Read on this iPad" on the review screen; Settings → AI →
  "This iPad" (where reading runs, the model and its context size, or why not)
- [ ] **Dynamic Profiles** (`LanguageModelSession.DynamicProfile`, `.model(_:)`)
  so a conversation (cook assist) moves to the server mid-session without
  losing the transcript, instead of restarting. *Moved to D5:* it needs the
  server as a `LanguageModel` (`DishesServerModel`) to switch to, and cook
  assist is the first job that needs it
- [x] **Shared Swift types:** `GeneratedRecipe`, `GeneratedIngredient`,
  `GeneratedStep`, `RecipeConcept` as `@Generable` structs matching the
  TypeScript `GeneratedRecipe` field for field (`ingredientName`, `amount`,
  `unit`, `preparation`, `isOptional`, `groupLabel`…), with `@Guide`
  descriptions taken from the server prompts. A JSON fixture shared with the
  web tests keeps the two in step, as C2 does for sync. *Done (v1.56.0):*
  `GeneratedRecipe` (Codable, the wire twin) and `fixtures/wire/generated-recipe.json`,
  decoded by the Swift tests and parsed by the server's schema in
  `check:ai-context`. What the model fills is a separate, smaller `@Generable`
  `RecipeDraft` (no nutrition, role or collection — the server's job), with a
  regex guide on amounts. `RecipeConcept` waits for the concierge job (D3)
- [x] **Prompt copies:** the on-device prompts are Swift copies of the server
  ones (`analyzeRecipePhoto`, `fullRecipeSystemPrompt`, `buildSystemAddendum`).
  Put a comment on each side pointing at the other, so a change to one gets
  made to both. *Done (v1.56.0), `Prompts.swift`:* `buildSystemAddendum` and
  `analyzeRecipePhoto` (less "always use metric" — see the comment there), with
  comments both ways; `fullRecipeSystemPrompt` comes with the concierge job.
  The ingredient rules are copies too (`IngredientRules`, `MethodRules`),
  checked against `fixtures/ingredient-lines.json` on both sides
- [x] **Evaluations** (`Evaluations.framework`, Xcode 27): a fixed set per job
  — 20 cookbook photos and recipe cards (scanned, handwritten, two-column),
  20 pasted-text pages, 30 ingredient lines, 15 cook-assist questions — scored
  on structure (fields, references, units) and against expected answers. **A
  job's default moves to the device only once the on-device model scores
  within an agreed margin of the server on its set.** Re-run after each
  iOS point release. *Done (v1.56.0) for the first two jobs*, in the
  `DishesCoreEvaluations` target (`DISHES_EVALS=1 swift test --filter
  DishesCoreEvaluations`; results in `fixtures/evals/results/`):
  - **Ingredient lines** (32): device 0.969, rules (the server's path) 0.836,
    every answer passing its checks → device
  - **Recipe cards** (20): the dev seed's recipes printed in 20 styles —
    handwriting fonts, two columns, tilted, tinted paper: device 0.964, every
    card passing its checks → device. The server isn't measured yet (no
    household key where it ran), so the 0.75 floor decided. What it took: the
    model copies each quantity as printed and the rules split it (asked for the
    unit itself, it gave counted things one — "8 ea corn tortillas"); no
    "always use metric" in the reading prompt; a regex guide on amounts only
    (guides take `\d` and `\w`, no character classes; a unit guide made
    everything worse). Seen on the simulator: "1 tsp dried oregano" can lose
    its "tsp" — the review screen is there for that **Real photos still wanted:** drop `<name>.jpg` + `<name>.json`
    (GeneratedRecipe) into `fixtures/evals/recipe-photos/` and they join the set
  - D3's sets, run on this Mac (AFM 3 Core) on 20 Oct, server not measured:
    shared text 0.908 (20 messages, blog posts, captions and notes; 20/20
    checks) → device; recipe cards again 0.971 (20/20, once a name the model
    dropped — "salt, to taste" read as [] [to taste] — is read back from the
    printed line); cook assist 0.917 (12 questions, 12/12) → device, with
    substitutions sent to the server; "Improve with AI" 0.776 (13 tweaks), then 6 of 13 failing
    the tightened checks → server; recipe ideas 0.64–0.68 (12 requests) → server; a draft week 0.917
    (6 households, 6/6, twice) → device. See D3 for what each took

**Where each job starts** (the router's table, revised by the evaluations):

| Job | First try | Why |
|---|---|---|
| Ingredient line → structured (editor, shopping add) | Device | Small, offline, instant |
| Pasted / shared text → recipe | Device | Text-only, fits easily (0.908) |
| Photo or scan → recipe | Device (Vision text, + the image when there's little) | iOS 27 multimodal; was `/ai/photo-recipe` |
| Collection suggestion for a new recipe | Device | Picking from a short list |
| Cook assist ("Ask about this step") | Device; substitutions to the server when there's a key | Short answers, offline in the kitchen (0.917); the device's substitutes were wrong |
| Improve / refine a recipe | Server (the evaluation said so) | The device's edits read badly (6 of 13 fail the checks); heart-healthy rests on nutrition targets and stays on the server |
| Concierge — 5 concepts | Server (the evaluation said so) | 0.64–0.68: the request got lost under the household's preferences, and the guardrails stop some |
| Concierge — full recipe | Server first; device if the evaluation passes | Long, quality matters most |
| Meal-plan draft from saved recipes | Device, the library chosen by code from the local store | Picking, not writing (0.917) |
| Meal-plan apply, new recipes written out | Server | Writes several recipes and saves them |
| Web-grounded generation, recipe images, nutrition estimate, Wrapped, meal timeline | Server | Need the web, image models or server data |

### D3. On-device AI features

- [x] **Scan a cookbook page or recipe card** (replaces the Tier 3 item):
  VisionKit document camera or a photo → `ImageAttachment` + `OCRTool` →
  `GeneratedRecipe` → review screen (the existing `RecipeEditor`, filled in) →
  `POST /api/v1/recipes/generated`. Two-page recipes: several photos in one
  session. Nutrition is then filled in by the server's `ai.estimateNutrition`
  in the background, so the on-device model doesn't have to guess it.
  *Done (v1.56.0):* New Recipe →
  Scan a recipe… (VisionKit's document camera, any number of pages) or From a
  photo…, then `ConciergeSheet.readPhotos` → `RecipeEditor` as "Check the
  recipe" → `POST /api/v1/recipes/generated`. Falling back, the server reads
  it (pages stacked into one image) and saves it as before. Saved without
  nutrition, the server estimates it with the household's key in `after()`
  and it follows in the next sync
- [x] **Share extension, beyond web pages:** shared text (Notes, Messages,
  Instagram captions) and screenshots go through the same device-first
  pipeline. Web links still go to `/recipes/import-url`, which reads the page's
  recipe data properly. *Done (v1.58.0):* the share sheet reads text
  (`RecipeReader.read(text:)`, the server's prompt in its text form) or up to
  four images (Vision, as for a scan) on the device, shows the recipe to check,
  files it (`CollectionPicker`) and saves it through `POST
  /api/v1/recipes/generated`; falling back, the server reads it — `POST
  /api/v1/ai/text-recipe` (new, the text twin of photo-recipe) or
  photo-recipe. Evaluation: 20 texts in four styles, 0.908, 20/20 checks.
  Seen on the simulator: a screenshot read and filed into "Quick & Easy" in
  the extension's memory. The model once copied "nutmeg, to taste" out of the
  prompt's own example into a recipe: the example's gone, and every
  ingredient must now be in what was read (`RecipeChecks`)
- [x] **Ingredient lines as you type:** the recipe editor and the shopping add
  card turn "2 tbsp finely chopped parsley" into amount / unit / name /
  preparation, offline. Quick rules first (`DishesCore`), the model only for
  what they can't read. *Done (v1.56.0):* `IngredientLineReader`.
  The shopping add card splits "500g beef mince" into its fields; the recipe
  editor's Paste import reads on the device, offline (it was the server's
  `import.parse`). The editor's own rows still take the parts separately
- [x] **Cook assist on the device** (`CookAssistSheet`): the same context
  `CookAssistContext` sends today, kept on the device and streamed with
  `streamResponse`. *Done (v1.58.0):* `CookAssist` (the server's prompt,
  copied) through `AIRouter.stream`, which shows the answer as it's written and
  swaps in the server's if the device's throws or fails `CookAssistChecks`
  (empty, "check the recipe", a refusal, over 140 words). "Answered on this
  iPad" under it. Evaluation: 15 questions on the seed recipes
  (`fixtures/evals/cook-assist.json`); timings, doneness, what's next and
  quantities right, but two of three substitutions confidently wrong ("use
  480 ml red wine + red wine concentrate" for no red wine) — so substitution
  questions go to the server when the household has a key, and the rest score
  0.917, 12/12. Pairs with D1's "how much butter?" and with the Tier 1
  hands-free cooking item
- [x] **Collection suggestion** at save time, on the device, from the cached
  collection names. *Done (v1.57.0):* `CollectionPicker` (a dynamic schema of
  the names or none, so nothing's invented; the prompt is a copy of
  `collectionSuggestionFor`'s). A reviewed draft goes to the server with its
  `collectionId` (or null), so the server skips its own call. Evaluation (20
  recipes, `fixtures/evals/collections.json`): 0.80 → device
- [x] **Recipe tweaks** (improve, heart-healthy, refine) and **concierge
  concepts** behind the router, defaulting to whatever the evaluations say.
  *Done (v1.58.0), both on the server for now:*
  - `RecipeTweaker`: the model lists edits (remove this line, change that
    one, rewrite step 2), each picked from the recipe's own lines by a schema
    made for it, and code applies them, so nothing else changes and the answer
    fits the context. Numbered, the model pointed at "ingredient 10" of eight;
    picked from its lines, it scored 0.776 with every check passing — but the
    edits read badly (bananas swapped for avocado to leave out walnuts, "add a
    red pepper" leaving only the pepper, the guanciale step kept for bacon).
    `TweakChecks` now catches those (most of the recipe gone, a step still
    using what was removed) — 6 of the 13 fail them — and `AITask.improveRecipe` starts on the server.
    `recipes.generated` (new action) gives the device the recipe as the AI
    tools take it; a tweak saved without nutrition has it estimated afterwards
  - Heart-healthy isn't tried on the device: it's checked and revised against
    nutrition targets the device doesn't estimate
  - `ConceptWriter`: the concierge's five ideas from the cached context
    (`Prompts.concepts`, with Swift copies of `buildMemberConstraints` and the
    taste-profile addendum). 0.64, then 0.68, on 12 requests: "a cosy pasta dish" came
    back as five sauces and dips until the side-dish sentence was reworded,
    and then "a risotto" for someone who loves spicy food as five spicy
    dishes; the guardrails stop a child's breakfast every time. Restating the
    request made the guardrails worse. `AITask.recipeIdeas` starts on the server
- [x] **Meal-plan draft on the device:** "plan next week from favourites,
  nothing twice in a fortnight" never leaves the iPad; apply still goes to the
  server, which writes out any new recipes. *Done (v1.58.0):* `MealPlanDrafter`.
  Not a `Tool`: the library is chosen by code from the local store with the
  server's own rules (mains, favourites, 2★-or-less out, three-week cooldown
  relaxed when short, heart-healthy numbers, a random sample — 30 recipes, not
  the server's 120, to fit), plus a diet filter the server leaves to its model
  (the device gave a vegetarian prawn noodles). The model fills one field per
  slot, choosing only among recipes that suit that slot's meal type (it put a
  salad at breakfast), and a dish picked twice is asked again with the rest
  kept. Evaluation: 6 households (`fixtures/evals/meal-plans.json`), 0.903 and
  0.917, 6/6 both runs. Still weak: a preference for one day ("pasta on
  Friday") — the right dishes, the wrong days
- [ ] ~~**Barcode scanning for shopping**~~ — not for now (James, 20 Oct
  2026). When it comes back: a barcode needs a product database (Open Food
  Facts), so decide whether the lookup goes through the server first

### D4. Widgets

- [x] **Configurable widgets through App Intents** (`AppIntentConfiguration`),
  merging the Tier 2 interactive-widgets item: "Tonight" (meal, serve time,
  Start cooking button), "This week" (iPad large/extra-large), "Shopping" (tick
  items off with a button intent, as the Watch does). Choosing which list or
  which meal type is a widget setting. Read from the App Group store;
  `WidgetCenter.reloadAllTimelines()` after a sync that changes them.
  *Done (v1.59.0):* `DishesWidgets/HomeWidgets.swift`.
  - Tonight (small, medium, Lock Screen rectangular and inline; set to
    tonight's, breakfast, lunch, dinner or dessert), with Start cooking and
    Planner links (`dishes://widget/…`, `WidgetLink`)
  - This week (large rows, extra-large columns on the iPad; every meal or one type)
  - Shopping (small count, medium and large lists, Lock Screen circular; one
    aisle or all). A tick is `LocalStore.setShoppingItem` — written and queued
    in one go, as in the app — then sent at once through the app's tokens
    (`ExtensionAPI`, the shared Keychain group) when that takes under 8
    seconds; otherwise the app sends it next time
  - The widgets read the same code as the screens: `PlanData`, `ShoppingData`,
    `Week` and `Format` moved to `Shared/`, compiled into both. The widget
    opens the database only once the app has made it (an empty one at the
    group path would stop the app moving its own in). The app re-reads on
    coming back (`noticeOtherProcesses`: GRDB only sees its own process's
    writes) and reloads the widgets after a sync that changed anything and
    after each local change
  - Checked on the iPad simulator: all three in the gallery with real data;
    Tonight and Shopping on the Home Screen; a tick on the widget reached the
    server in a moment and the list went from 15 to 14; the cook link opened
    cooking mode on tonight's dish
- [ ] iOS 27 widget styling (tinted / clear modes) checked on the Home Screen
  and Lock Screen; StandBy (Tier 2) falls out of the same widgets. *Written:*
  in the tinted and clear styles the gradients go and the headings and buttons
  are accented (`widgetRenderingMode`, `widgetAccentable`). Not yet looked at
  on a device or the simulator's tinted Home Screen, nor the Lock Screen slots

### D5. The server as a `LanguageModel`

So the router's third step is the same Swift session code as the first two,
not a separate set of REST calls.

- [x] **`DishesServerModel: LanguageModel`** + its `LanguageModelExecutor` in
  `DishesCore/AI`: sends the `Transcript` (instructions, prompt, tool calls,
  tool output) and the generation schema to the server, streams text back
  through the `LanguageModelExecutorGenerationChannel`. Capabilities: tool
  calling and guided generation. Errors mapped to `LanguageModelError`
  (`rateLimited` for the monthly budget, `timeout`, `refusal`).
  *Done (v1.60.0), with these differences:* guided generation only — no job
  uses a tool, and attachments aren't sent (photos still go to
  `/ai/photo-recipe`, read with vision on the server). The transcript goes as
  chat messages (instructions → system, prompts → user, answers →
  assistant); the schema is the `GenerationSchema` encoded, which is already
  JSON Schema. Errors stay the app's `APIError` (the SDK's error contexts have
  no public initialisers); the router treats both the same. Tested with a
  stubbed server: a plain answer and a `@Generable` one come back through a
  real `LanguageModelSession`
- [x] **`POST /api/v1/ai/respond`** on the server: transcript + optional JSON
  schema in, streamed text out, through the household's key with
  `buildSystemAddendum` added on the server. OpenAI structured outputs
  (`json_schema`) when a schema is sent. Same budget checks and logging as the
  other AI routes; Redis rate limit per member. *Done (v1.60.0):* the
  addendum only with `settings: true` — the device's prompts already carry
  the household's settings from the cached context, so adding them again
  would say everything twice. Apple's `x-order` is stripped and the schema
  sent non-strict. There are no budget checks to share (the other routes have
  none); 30 calls a minute per member (`checkRateLimitFor`), 429 with
  Retry-After past it. Checked by curl: validation (400), no key (422), the
  31st call in a minute (429)
- [x] The existing task routes (`/ai/concepts`, `/ai/recipes`,
  `/ai/meal-plan*`, `/ai/photo-recipe`, `/cook-assist`) stay for the web and
  for the server-only jobs; iOS stops calling `photo-recipe` and `cook-assist`
  once D3's versions are in. *Done for cook assist:* its fallback is the same
  session on `DishesServerModel` (`CookAssist.onServer`, the server's prompt
  via `Prompts.cookAssist`). `photo-recipe` stays until images can go
  through `/ai/respond`

### D6. Smaller wins

- [ ] **Drag to reorder in SwiftUI (iOS 27):** shopping items within an aisle,
  and dragged *between* aisles to change the category (`shopping_item.update`
  already carries `position` and `category`). The planner already drags meals
  between days (`PlanScreen` `.draggable`/`.dropDestination`); move it to the
  new reordering API for ordering within a day, the drop animation and the
  iPad's multi-select drag
- [ ] **Lazy subviews with prefetch** on the recipe rows (`RecipesBrowse`'s
  `LazyHStack`, `RecipeCard`'s `LazyVStack`) and the cookbook pages, so
  thumbnails load before they scroll into view
- [ ] **MetricKit:** `MXMetricManager` subscriber in `AppModel`, with
  app-defined states (`cooking`, `planning`, `shopping`, `ai`) so memory and
  hang reports say where they happened, and memory-exception diagnostics.
  Payloads go to the server's crash reports — needs a bearer version of
  `/api/client-error` (it reads the Authelia browser session today), shown
  under Settings → Crash reports with a "iOS" source
- [x] **TabView selection (breaking in the iOS 27 SDK):** every tab in
  `RootView.shell` is always visible, so `nav.tab` can't point at a hidden one.
  Re-check if a tab is ever hidden conditionally (e.g. AI when the household
  has no key)

### Order

1. **D0 + D1** — no AI decisions, works offline, uses the store as it is (v1.55.0;
   v1.54 went to the web import fixes first)
2. **D2 engine + evaluations**, with **scan a page** and **ingredient lines**
   as its first jobs (v1.56.0)
3. **D3's other jobs**, each switched to the device as its evaluation passes;
   **D5** alongside, so falling back is the same code path (v1.57.0)
4. **D4 widgets** (needs D0's App Group) and **D6** in any gaps

### Open questions

- **Which family devices can do it?** On-device AI needs an Apple
  Intelligence device (iPhone 15 Pro or later, M-series iPads). Check the
  kitchen iPad and each phone; a phone that can't simply uses the server
- **Private Cloud Compute for a TestFlight app.** The free tier is for the App
  Store Small Business Program. Try `PrivateCloudComputeLanguageModel`'s
  `availability` in a TestFlight build; if it says unavailable, D2 skips it
- **How big a gap is "close enough"?** Agree the evaluation margin before the
  first job moves (proposed: structure checks must pass 100%; expected-answer
  score within 10% of the server)

---

## Explicitly not doing

- **Capacitor/Tauri wrapper around the PWA.** ~1 week of work for an App Store build, APNs and native wake lock, but it ships the same webview and the same network-bound data layer — it does not fix the responsiveness complaint. Only reconsider if the goal changes to "a Home Screen icon that isn't a Safari bookmark."
- **Expo / React Native.** Superseded by SwiftUI (see Phase C). `@dishes/client` stays as the web client and the reference implementation the Swift engine is tested against.
- **CarPlay, SharePlay.** No real use in a recipe app.
- **Sharing UI components between web and native.** Consistently costs more than it saves.
- **Replacing the PWA.** It stays as the desktop/Mac client and the admin surface.
