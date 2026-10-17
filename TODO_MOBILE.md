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
- [ ] **Meal plan week** — move/change type/servings, add from the recipe library or
  a saved meal (needs C0), "add week to shopping" (online — stays a server call,
  see Phase B)
- [x] Recipes: list (iPad: card grid), search on title/cuisine/tags,
  favourites filter; detail with ingredients beside the method on iPad,
  serving scaling with kitchen fractions, favourite toggle (online — not a
  sync mutation)
- [ ] **Recipes** — the web's full filter set and sorts (port
  `lib/recipe-filtering.ts`), cook history and per-person ratings on the detail
- [ ] **Log a cook** — rating, per-person ratings, notes, dish photo from the
  camera (background `URLSession` upload, as Keepsake's `UploadManager`)
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
- [ ] More → Settings: server, signed-in member, devices, sign out. Everything
  else in Settings links to the web app — it remains the admin surface
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
- [ ] **Live Activity — meal schedule.** The serve-at timeline (v1.18) as a
  countdown across the whole meal: "Potatoes in at 18:05 · serve 18:45".
  Started remotely by the dinner-reminder push (ActivityKit push-to-start
  tokens, via C5), so it's on the Lock Screen before the app is opened
- [ ] **Log a cook → HealthKit** (see the HealthKit section below)

#### Tier 2 — at a glance

- [ ] **Interactive widgets** (App Intents buttons): tonight's meal with a
  "Start cooking" button; shopping list with tap-to-tick. Home Screen and Lock
  Screen sizes. Read from the App Group store, refreshed after each sync.
  iPad Home Screen widgets get the larger family showing the week
- [ ] **StandBy** (iPhone on its side, charging): tonight's meal, or the
  current step and timers while cooking
- [ ] **Live Activity — shopping trip.** "9 items left", updated by push as
  someone at home adds or ticks things
- [ ] **Control Center control** — "Add to shopping"
- [ ] **App Intents / Siri / Shortcuts** — "add milk to the shopping list",
  "what's for dinner", "start cooking tonight's meal". Queues an outbox
  mutation, so it works offline. Also makes an NFC tag on the fridge (via a
  Shortcuts automation) free
- [ ] **Spotlight** — recipes indexed with `CoreSpotlight`, searchable from the
  Home Screen, offline

#### Tier 3 — getting recipes in

- [ ] **Share extension** — import from Safari/Instagram/Notes via the Share
  Sheet (needs `/api/v1/import`, C0)
- [ ] **Scan a cookbook page or recipe card** — VisionKit document camera +
  on-device text recognition, then the existing parser/AI to structure it
- [ ] **Barcode scanning** (`DataScannerViewController`) for shopping items,
  and for the pantry once it has an API
- [ ] **On-device Foundation Models** — free, private, offline help for small
  jobs: tidy pasted recipe text, "what can I swap for crème fraîche?", unit
  questions. The concierge and meal-plan generation stay on OpenAI server-side
- [ ] Cook-assist chat and AI recipe generation once the A2 AI endpoints exist
  (they must stream; `URLSession.bytes` reads SSE directly)

#### Tier 4 — later

- [ ] **Apple Watch app** — the shopping list on the wrist, timers and step
  cues as taps while cooking. Strongest second-wave feature
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

- [ ] `.p8` token auth from the server, env vars in the `docker` repo compose
  file as well as `.env` (see deploy notes)
- [ ] `POST/DELETE /api/v1/push/devices` — register an APNs token against the
  member, alongside the existing web-push subscriptions
- [ ] Extend `lib/push.ts` so `sendPushToHousehold` / `sendPushToUsers` /
  `notifyHousehold` fan out to web-push **and** APNs from the same call sites.
  Covers shopping changes, dinner reminders and delivery deadlines at once
- [ ] Silent "sync now" push after a household write, so a second phone is
  current before it's opened
- [ ] Notification actions: snooze a dinner reminder, open cooking mode

### C6. Distribution

- [ ] Development installs on family phones first (`devicectl`, as Keepsake's
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

## Explicitly not doing

- **Capacitor/Tauri wrapper around the PWA.** ~1 week of work for an App Store build, APNs and native wake lock, but it ships the same webview and the same network-bound data layer — it does not fix the responsiveness complaint. Only reconsider if the goal changes to "a Home Screen icon that isn't a Safari bookmark."
- **Expo / React Native.** Superseded by SwiftUI (see Phase C). `@dishes/client` stays as the web client and the reference implementation the Swift engine is tested against.
- **CarPlay, SharePlay.** No real use in a recipe app.
- **Sharing UI components between web and native.** Consistently costs more than it saves.
- **Replacing the PWA.** It stays as the desktop/Mac client and the admin surface.
