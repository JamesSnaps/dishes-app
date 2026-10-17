# iOS runbook

How to build, run and check the Dishes iOS app, and a log of what's been
checked. `TODO_MOBILE.md` Phase C is the scope; this file is the how-to and
the record. Add to the log at the end of each session.

The layout and habits are Keepsake's (`~/Github/keepsake/apps/ios`), so the
two apps are worked on the same way.

## One-time setup (this Mac)

```bash
brew install xcodegen
sudo xcodebuild -runFirstLaunch          # CoreSimulator; without it simctl/xcodebuild fail early
xcodebuild -downloadPlatform iOS          # the simulator runtime
```

## Build and run (the quick way)

Start the web dev server first (`pnpm dev`, or the `dishes-web` launch config
in `.claude/launch.json`, both on :3000), then:

```bash
apps/ios/scripts/sim.sh                                   # booted simulator, against http://localhost:3000
DEVICE="iPad Pro 11-inch (M5)" apps/ios/scripts/sim.sh    # boots that simulator first if needed
FRESH=1 apps/ios/scripts/sim.sh                           # uninstall first: empty database
```

It regenerates the Xcode project when `project.yml` is newer, builds into
`apps/ios/build/dd` (gitignored) and launches with `-DishesDevServer`.

By hand:

```bash
cd apps/ios && xcodegen generate         # after any change to project.yml or added/removed files
xcodebuild -project Dishes.xcodeproj -scheme Dishes \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro' -derivedDataPath build/dd build
```

Don't pass `CODE_SIGNING_ALLOWED=NO`: the ad hoc signature ("Sign to Run
Locally") is what lets the app use the simulator's Keychain.

`DishesCore` on its own, on macOS with no simulator:

```bash
cd apps/ios/Packages/DishesCore && swift test
```

## Run against the local dev server (no Authelia)

Debug builds have a **Developer** menu (sign-in screen → Developer, or More →
Developer). A development build of the web app signs any `/api/v1` request
without a token in as its stand-in user (`lib/auth.ts`, `DEV_USER`), so the
simulator needs no sign-in. The simulator's `localhost` is the Mac.

Switching server removes the device's copy (`AppModel.forgetOtherServer`), so
dev data and unsent changes never reach production, and the reverse.

If the first sync fails with `internal_error`, the dev database is probably
behind on migrations:

```bash
cd packages/db && set -a && . ../../apps/web/.env.local && set +a && npx drizzle-kit migrate
```

## Against the real server

Release builds — and Debug builds with the Developer setting cleared — sign in
through Authelia with the `dishes-mobile` OIDC client (PKCE,
`dishes://auth/callback`, already configured in the `docker` repo). Tokens live
in the Keychain under `uk.collco.dishes`.

## On a device

Signed with James's individual membership (`C729B84RYG` in `project.yml`, as
Keepsake). Bundle id `uk.collco.dishes`. A new device is registered on the
first build with `-allowProvisioningDeviceRegistration`:

```bash
cd apps/ios && xcodegen generate
xcodebuild -project Dishes.xcodeproj -scheme Dishes -destination 'platform=iOS,name=<device name>' \
  -derivedDataPath build/device -allowProvisioningUpdates -allowProvisioningDeviceRegistration build
xcrun devicectl device install app --device '<device name>' build/device/Build/Products/Debug-iphoneos/Dishes.app
```

## Things worth knowing

- **Week keys are local dates.** Meal plans are keyed `yyyy-MM-dd` on the
  Monday. Formatting that Monday with an ISO-8601 formatter writes UTC, which
  in British Summer Time turns Monday 00:00 into Sunday's date and matches no
  plan. `Week.key` reads the date components in the local calendar instead.
- **Records are stored whole.** The local store keeps each synced row as the
  server's JSON; `Entities.swift` reads typed fields out of it. A column the
  server adds later is kept, and only needs reading.
- **The sync engine is a port, not a redesign.** `packages/client/src/sync-engine.ts`
  is the reference; `SyncEngineTests` mirror its rules. Two deliberate
  differences: pushes go in batches of 200 (the server's limit), and an
  optimistic write and its queue entry are one SQLite transaction.

## Log

### 16 Oct 2026 — first build

Xcode 27.1, iOS 27 simulators.

- `DishesCore`: OIDC/Keychain/AuthSession copied from Keepsake; API client,
  GRDB store and sync engine ported from `@dishes/client`. 10 tests pass,
  including decoding a real dev-server snapshot (`fixtures/wire/pull-snapshot.json`).
- iPhone 18 Pro: launches against the dev server as the stand-in user, takes a
  full snapshot, shows the week plan, recipes and shopping list. Ticking an
  item and adding one both reached the server (checked in Postgres). Week
  paging needs no network.
- iPad Pro 11-inch: the tab bar becomes the top/side bar, the plan is a grid,
  the recipe grid has three columns, and recipe detail puts ingredients beside
  the method. Serving stepper scales 4 → 5 correctly (200 g → 250 g, 1 tsp → 1¼ tsp).
- Fixed on the way: the week key bug above; the shopping keyboard had no way
  to close (now dismissed by dragging the list, or Done on an empty field).
- Not yet checked: sign-in against the real Authelia from the app (the flow is
  Keepsake's, already proven there with the same Authelia), a device build,
  delete and clear-ticked from the UI (the mutations are covered by the engine
  tests and are the ones the web already sends).
