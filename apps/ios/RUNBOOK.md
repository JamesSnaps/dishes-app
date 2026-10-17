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
- Not yet checked: delete and clear-ticked from the UI (the mutations are
  covered by the engine tests and are the ones the web already sends).

### 17 Oct 2026 — first device build, real server

- Device build signed with `C729B84RYG` and installed on James's iPad Pro
  13-inch (M4) with `devicectl` (commands above), v1.25.0 on the server.
- Sign-in through the real Authelia (`dishes-mobile`, PKCE) works from the
  app, and the first sync brought down the household's real recipes, meal
  plan and shopping list.
- Still to see on a device: a token refresh after the 1-hour access token
  expires (`AuthSession` handles it; not yet observed).

### 17 Oct 2026 — cooking mode (branch `feat/ios-cooking-mode`)

- iPad portrait (11-inch simulator): step large on top with Back/Next and the
  step's timer pinned below it, ingredients and timers side by side
  underneath. Starting "Soften soffritto · 15 min" counted down in the timers
  panel.
- **AlarmKit is refused in the simulator** — iPhone and iPad alike, instantly
  and with no prompt (`mobiletimerd`: "Denial for uk.collco.dishes"), though
  `NSAlarmKitUsageDescription` is in the built Info.plist. The notification
  fallback asked for permission and took over, as designed.
- In-app ring: More → Developer → "Start a 10-second test timer" (Debug only).
  At zero the chime played (audio session `.playback`, so silent mode doesn't
  mute it) and the Stop banner appeared over whatever screen was showing; Stop
  silenced it.
- **The simulator can't rotate here** (no Simulator.app in this Xcode, and
  the control tool has no rotation), so the landscape three-column layout is
  unchecked — check it on the iPad.
- Launching takes several seconds on the simulator before the first screen;
  not seen on the real iPad. Worth timing if it shows up there.
- **On James's iPad Pro (device build):** the landscape three-column layout
  looks right, and a step timer asked for alarm permission and went off as an
  AlarmKit alarm. So AlarmKit works on iPad; only the simulators refuse it.

### 17 Oct 2026 — design pass: match the web app (branch `feat/ios-web-design`)

James: the first build "looks like an iOS app from 10 years ago". Rebuilt on
the web's design rather than stock iOS styling:

- `Design/Theme.swift` mirrors the web's tokens (globals.css slate + orange, in
  light and dark), the shadcn Card (12pt corners, 1px border, small shadow),
  Badge, and the gradient action buttons. The web sets no font, so it renders
  in SF Pro on Apple devices — the system font here is already an exact match.
- Navigation as the web: the desktop sidebar on iPad (logo, Home, Recipes,
  Meal Planner, Shopping List with its count, Personal → Favourites, sync line,
  Settings, the signed-in person); the mobile bottom bar on iPhone with the
  raised orange button (here: cook tonight's meal, or open the planner).
- New Home screen (greeting, search, Favourites, the stats banner, Recently
  Added). Recipe cards are the web's card. Planner has the day strip, gradient
  buttons ("Add N meals to list" calls the server; "Generate plan" opens the
  web), web entry cards and an Add meal sheet that works offline (temp ids).
  Shopping has the add card with qty/unit/category, "Show N checked", web
  category order, square checkboxes, edit and delete. Recipe page has the
  web's header, servings stepper, tabs; side-by-side when the page is ≥760pt.
- Fixed: a wide photo made its card overflow into its neighbours (James's
  burger) — `RecipeImage` now takes exactly the space it's offered.
- Known gaps: the "from <recipe>" line under shopping items needs the
  `shopping_item_recipes` table in sync; the placeholder is SF's fork.knife
  (no crossed-utensils symbol); AI buttons link to the web.
- Checked on iPhone 18 Pro and iPad Pro 11-inch simulators in light mode, side
  by side with the web at the same widths.

### 17 Oct 2026 — Live Activities (branch `feat/ios-live-activity`)

- New `DishesWidgets` extension (bundle `uk.collco.dishes.widgets`) and a
  `Shared/` folder compiled into both targets for the types they share
  (`CookingActivityAttributes`, `CookTimerMetadata`).
- iPhone 18 Pro simulator: starting a step timer in cooking mode and going to
  the Home Screen shows the pan and the countdown in the Dynamic Island; a
  long press shows step 1/5, the dish, the instruction and the timer; the Lock
  Screen shows the full card with a progress bar. iOS asks "Allow Live
  Activities from Dishes?" the first time.
- The AlarmKit countdown activity can't be seen in the simulator (AlarmKit is
  refused there) — check on the iPad: start a timer, lock it.
- The activity's state carries the timer's end date and the system counts it
  down, so the app does nothing while locked; it updates on step changes and
  timer changes, and ends when cooking mode closes.

### 17 Oct 2026 — James's iPad feedback

- **Lock Screen card unreadable** on a light photo: a 90%-white background tint
  with system text colours became see-through glass with white text. Now an
  opaque card (white / slate-900 by appearance) with explicit text colours.
- **No way to clear a timer**: tapping toggled pause (so a paused timer
  "restarted") and cancel hid behind a long press. Each timer now shows
  Pause/Resume, 1 min and Cancel (Clear when done); "Clear all" on the panel.
- **Floating tab bar instead of the sidebar**: the native Liquid Glass tab bar
  (`.sidebarAdaptable`) — across the top on iPad, at the bottom on iPhone —
  with the shopping count as a badge and Settings as a tab. The web's orange
  middle button became a "Cook tonight" pill above the tab bar
  (`tabViewBottomAccessory`), shown only when something's planned tonight.
- Checked: iPad top bar, timer controls and Clear all; iPhone tab bar; adding
  tonight's dinner from the Add meal sheet shows the pill at once and reached
  the server once the dev server was back (it had been stopped — the outbox
  held it meanwhile).

### 17 Oct 2026 — using the iPad's width (James's second round)

- **Top bar by default** (`.defaultAdaptableTabBarPlacement(.tabBar)`); the
  sidebar button remains.
- **Width caps gone.** Recipes fill the width (up to 7 columns; 4 on a 13-inch
  in portrait). Home sections show one full row on iPad, two rows of two on
  iPhone. The recipe page goes to 1240pt.
- **Planner: the whole week** as seven day columns when the page is ≥1000pt
  (13-inch portrait, any iPad in landscape), each with its meals as upright
  cards and its own +; narrower keeps the day strip. Suggested for the web too.
- **Shopping**: categories in two columns when wide. Each item has the web's
  cart button (Sainsbury's search); on a wide screen it opens in a side panel
  beside the list (WKWebView, sign-in remembered), on iPhone in a sheet.
  The page takes a few seconds to load behind Sainsbury's cookie banner.
- **Tonight**: the bottom pill was too subtle on a big screen. Home now opens
  with a large orange Tonight card (photo, serve-at, Start cooking; "Plan a
  meal" when nothing's planned). The pill stays on iPhone only, recoloured.
- Checked on the iPad Pro 13-inch simulator, portrait.
- **Timers as a native menu.** The pill buttons wrapped badly in a narrow
  column ("Resum e"). A timer card is now just an icon, label and countdown;
  tap it for Pause/Resume, Add a minute, Cancel (Clear once done). Clearing
  "poofs" it away (scale up, blur, fade — `AnyTransition.poof`). Menu and
  cancel checked on the 13-inch simulator; the animation is too quick to
  capture in a screenshot, so judge it on the device.

### 17 Oct 2026 — recipe page filled out, cook history

- Recipe page now has: the household's stars, "Cooked N times · last …" and
  "On the menu N times · last planned week of …" (from synced cook history
  and plans), the full nutrition panel (kcal, macros, sat fat in red over 4 g,
  heart-healthy badge, AI-estimate tag; "Estimate on the website" when empty),
  Add to shopping list (server, at the servings shown), Cook history cards,
  and "You might also like" (same cuisine, shared tags).
- Log a cook sheet: half-star rating, who ate it (household members, you
  pre-ticked), per-person stars, notes. Logged one on the 13-inch simulator:
  saved to Postgres, synced back, showed on the recipe, Home ("Recently
  cooked") and the Cook history screen.
- Fixed on the way: half-star taps landed a half too high — SF Symbols' stars
  are wider than their point size, so the control measures its real width.
- Server: `GET /api/v1/members` (API.md).

### 17 Oct 2026 — planner editing, collections, recipe editor, cook photos

- Planner: every card's menu has Move to (this week / next week), Meal and
  Servings; combined meals move as one. Add meal → Saved meals → pick a dish
  per slot. Checked on the 13-inch: Move to → Wednesday and a Sunday roast
  with four dishes both reached Postgres. **Drag between days not confirmed**:
  simulated drags never lift the card (a plain long-press opens the menu fine).
- Collections: `/api/v1/collections` (list, create, add, remove), chips on
  Recipes, Add to collection on a recipe. Filtering checked.
- Recipe editor: page-sized sheet with Details / Ingredients / Method tabs; a
  Timer row per step; "Uses N ingredients" per step. Saving Chocolate Chip
  Cookies unchanged left every column identical (nutrition source became
  "manual", as the web editor does).
- Found and fixed: saving dropped every step's ingredient links (cooking-mode
  chips) — the server re-creates ingredients with new ids and the write format
  had no way to say which a step uses. Steps now send `ingredientIndexes`;
  checked on Fish Tacos (links point at the right new ingredients). Also: the
  editor would have wiped nutrition on rows marked "none" but holding numbers.
- Cook photo: picker and resize work; upload got a 400 "Storage not
  configured." because the dev server has no S3 settings. Production has
  storage — confirm there.
- Cross-week drags: the week arrows are spring-loaded (hover a dragged meal on
  ‹ or › and the week flips). Fixed a bug that would have bitten this: the drop
  compared the target week with the week *on screen*, so after flipping it
  sent no week and the meal only changed day. It now compares with the week the
  entry is in. Checked via Move to → Monday 19 Oct (same code path): the entry
  moved into a newly created plan for next week.

