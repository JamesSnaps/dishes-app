# iOS runbook

How to build, run and check the Dishes iOS app, and a log of what's been
checked. `TODO_MOBILE.md` Phase C is the scope; this file is the how-to and
the record. Add to the log at the end of each session.

The layout and habits are Keepsake's (`~/Github/keepsake/apps/ios`), so the
two apps are worked on the same way.

## One-time setup (this Mac)

```bash
brew install xcodegen
sudo /Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild -license accept   # after each Xcode update
sudo xcodebuild -runFirstLaunch          # CoreSimulator; without it simctl/xcodebuild fail early
xcodebuild -downloadPlatform iOS          # the simulator runtime
```

If `xcode-select -p` says `/Library/Developer/CommandLineTools`, plain
`xcodebuild` / `xcrun` can't find Xcode: prefix commands with
`DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`, or point it at Xcode
for good with `sudo xcode-select -s /Applications/Xcode.app`. `swift test` in
`Packages/DishesCore` needs Xcode's toolchain too (Swift Testing's macros).

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

When an entitlement is added (Push Notifications in v1.32.0), the cached
profile lacks it, and `xcodebuild` started outside Xcode fails with "No
Accounts" even though Xcode is signed in. Press Run once in Xcode with the
device selected; it regenerates the profile, and command-line builds work again.

## TestFlight

```bash
apps/ios/scripts/testflight.sh            # archive (Release, app + widgets) and upload
UPLOAD=0 apps/ios/scripts/testflight.sh   # archive and export an .ipa only
```

- It signs and uploads with an **App Store Connect API key** (Admin role) when
  `~/.appstoreconnect/dishes.env` names one (`ASC_KEY_ID`, `ASC_ISSUER_ID`;
  the key at `~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8`, never in the
  repo). Xcode 27.1 stopped sharing its signed-in account with `xcodebuild`
  ("No Accounts", even from your own Terminal), so the key is what works.
  Without one it falls back to Xcode's account (team C729B84RYG).
- A new capability (App Groups, HealthKit…) has to be on the App ID first:
  with a key, `xcodebuild` can't switch one on and says "Authentication
  failed". Open the target's Signing & Capabilities in Xcode once and it
  registers them.
- The script puts `/usr/bin` first on the PATH: Homebrew's rsync 3.x breaks
  Xcode's export ("Copy failed").
- The build number is the UTC time (`yyyymmddHHMM`); the version is
  `MARKETING_VERSION` in `project.yml`.
- Needs the app in App Store Connect once: Apps → ＋ → New App, iOS, bundle id
  `uk.collco.dishes`. Export compliance is answered in Info.plist
  (`ITSAppUsesNonExemptEncryption` false).
- **Internal testing** (people on the team in App Store Connect): no review.
  **External** testers need Beta App Review the first time, with a sign-in
  they can use (an Authelia account).
- TestFlight builds are Release: the real server only, no Developer menu, push
  in APNs production (the device reports which, so the server copes with both).
- Privacy manifest: `Dishes/Resources/PrivacyInfo.xcprivacy` (no tracking;
  UserDefaults, CA92.1).

## Share extension

`DishesShare` (`uk.collco.dishes.share`) puts **Dishes** on the share sheet:
a recipe page from Safari, or a link another app shares as text, is sent to
`POST /api/v1/recipes/import-url` and saved; the app picks it up on its next sync.

- It signs in with the app's tokens. Both targets list the Keychain group
  `$(AppIdentifierPrefix)uk.collco.dishes.shared` (entitlements) and name it
  in Info.plist (`DishesKeychainGroup`); `KeychainTokenStore.dishes()` uses it.
  Tokens saved before the group existed are moved into it the first time the
  app loads them, so updating doesn't sign anyone out — but the extension
  only sees them once the updated app has been opened.
- Authelia rotates refresh tokens, so the two processes must never refresh
  with a spent one: `AuthSession` reads the store before refreshing and uses
  a pair the other process saved. If both refresh at once, the loser's
  invalid_grant isn't taken as a sign-out while the store holds the winner's
  new pair (AuthSessionTests, AuthSessionRaceTests).
- A build signed without the group (errSecMissingEntitlement) keeps the
  tokens in the app's own group: the app works, the extension says "Sign in
  to Dishes first".
- Debug builds: the app leaves its dev server choice in the shared group
  (`Developer.shareServerWithExtension`), so the extension follows it.
- Adding the entitlement means the cached provisioning profile is stale:
  press Run once in Xcode (see "On a device" above) before command-line builds.

## Apple Watch

`DishesWatch` (watchOS 26, `uk.collco.dishes.watchkitapp`) is embedded in the
phone app and installs with it, with its complications in `DishesWatchWidgets`.
The Watch never signs in or talks to the server: `Dishes/App/WatchLink.swift`
on the phone sends it a snapshot (shopping list, tonight's meal and its meal
clock, cooks in progress) by application context whenever any of it changes,
and applies what's done on the Watch (ticks, new items) through the same
outbox paths as the shopping screen. `WatchShared/WatchContract.swift` has the
messages. Each Watch action has an id; the Watch shows it on top of the
snapshot until a snapshot lists it as applied, and the phone applies each id
once. The Watch keeps its copy in the App Group `group.uk.collco.dishes.watch`
for the complications.

**Cooks on other devices.** `Dishes/Cooking/CookingShare.swift` publishes the
cooking device's state (fed by `CookingActivity`, so it follows exactly what
the Live Activity shows) to `/api/v1/cooking-sessions` — Redis, versioned,
ended for good on Exit, refused if started 12 h ago (API.md). The web's
cooking mode publishes the same way (`apps/web/lib/cooking-share.ts`, device
"Browser"). The server sends
a silent push `kind: "cooking"`; a phone with a Watch fetches the cooks and
passes them on, and the Watch asks again every 15 s while its cooking screen is
open. Nothing from the server changes cooking mode on any device.

```bash
xcrun simctl create "Dishes Watch Phone" com.apple.CoreSimulator.SimDeviceType.iPhone-17 com.apple.CoreSimulator.SimRuntime.iOS-27-0
xcrun simctl create "Dishes Watch" com.apple.CoreSimulator.SimDeviceType.Apple-Watch-Series-12-46mm com.apple.CoreSimulator.SimRuntime.watchOS-27-0
xcrun simctl pair <watch-udid> <phone-udid>      # then boot both (iOS 27.1 won't pair with watchOS 27.0)
DEVICE=<phone-udid> WATCH=<watch-udid> apps/ios/scripts/sim.sh
```

Simulator limits (Xcode 27.1):
- The phone only sees the Watch app as installed (`isWatchAppInstalled`) a
  little after it's installed, and loses it again whenever the phone app is
  reinstalled. Reinstall the Watch app, wait a few seconds, relaunch the phone
  app. Messages (and their replies) still work when it's wrong, so the Watch
  gets fresh snapshots whenever it asks.
- `transferUserInfo` doesn't cross between paired simulators (as Keepsake
  found); a tick made with the phone "unreachable" only arrives on a device.
- `simctl openurl` can't open a watchOS app's URLs. Debug builds of the Watch
  app take `-DishesScreen shopping|tonight|cooking` and `-DishesDemo tick|add`;
  the phone app takes `-DishesCookTonight YES` to open cooking mode on
  tonight's meal.
- A fresh pair takes minutes to boot the first time, and with many simulators
  booted on 16 GB the Watch never finished — shut down the others first.
- Logs: `xcrun simctl spawn <phone> log stream --level debug --predicate 'subsystem == "uk.collco.dishes" AND category == "watch"'`.

## The App Group, Siri and Spotlight (Phase D0, D1)

- **The database is in the App Group** `group.uk.collco.dishes`
  (`<group>/Library/Application Support/Dishes/dishes.sqlite`), so the widgets
  and the share extension can read it. The first launch after v1.55.0 moves
  the old copy there with its -wal and -shm (`LocalStore.moveDatabase`). A
  build signed without the group keeps the old place. The cached AI context
  (`ai-context.json`) sits in the group's root.
- **Writes in the background go inside `AppModel.awake { }`.** iOS kills an
  app that's suspended while holding a lock on a file in a shared container
  (0xDEAD10CC), so the store is suspended when the app goes off screen
  (after sending anything waiting) and resumed for each piece of background
  work: BGAppRefreshTask, silent pushes, notification buttons, the Watch,
  Siri. A suspended store still reads; a write throws. New background entry
  points must use it.
- **Siri and Shortcuts** are `Dishes/Intents/`: the entities (read from the
  store, never the network), the intents, and the App Shortcuts' phrases
  (`DishesShortcuts`, ten at most, one parameter per phrase, never "my …
  shopping list"). Recipes are in Spotlight (`SpotlightIndex`, following the
  store; only changes are sent).
- **Testing them:** `DishesIntentTests` runs the intents through the system
  with AppIntentsTesting (iOS 27 simulators only), launching the app against
  the dev server first, so start `pnpm dev`:

  ```bash
  DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild test -project Dishes.xcodeproj -scheme Dishes \
    -destination 'platform=iOS Simulator,name=iPad Pro 11-inch (M5)' -derivedDataPath build/dd
  ```

  By hand: Shortcuts → Dishes shows every action; Spotlight (swipe down on
  the Home Screen) finds a recipe by an ingredient.

## On-device AI (Phase D2)

- **`DishesCore/AI`:** the router (device first, then the server — or, for
  ingredient lines, the rules), the checks an on-device answer must pass, the
  prompts (Swift copies of the server's, each pointing at its original), and
  the two jobs so far: `IngredientLineReader` and `RecipeReader`.
- **The simulator uses the Mac's model**, so it needs Apple Intelligence on
  the Mac. The document camera isn't in the simulator: test scans with From a
  photo… after `xcrun simctl addmedia <udid> card.png`.
- **Evaluations** decide where a job starts (`AITask.firstTry`), and run on
  the Mac (macOS 27, the same model as the devices — check Settings → AI →
  This iPad shows the same model as `DeviceAI.modelDescription` on the Mac):

  ```bash
  cd apps/ios/Packages/DishesCore
  DISHES_EVALS=1 DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --filter DishesCoreEvaluations
  ```

  About 6 minutes. Results go to `fixtures/evals/results/<job>.json`; the
  rule for "close enough" is in TODO_MOBILE.md, D2. To see the printed cards:
  add `DISHES_EVAL_CARDS=<folder>`. Real photos go in
  `fixtures/evals/recipe-photos/` (`<name>.jpg` + `<name>.json`). Keep the
  prompts' examples out of the evaluation sets, or the score means nothing.
- **Rules shared with the web** (`IngredientRules`, `MethodRules`) are checked
  against `fixtures/ingredient-lines.json` by `IngredientRulesTests` and
  `pnpm --filter @dishes/web check:ai-context`.

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

### 17 Oct 2026 — notifications (v1.32.0)

- Apple Push: the app registers for a token at every launch (silent pushes need
  no permission) and sends it to `/api/v1/push/devices` once signed in;
  `aps-environment` is `development` in the entitlements, and Xcode switches it
  to production when exporting for TestFlight. Settings → Choose notifications
  asks for permission, has a test button, the switch for each kind and the
  device list.
- Checked on the 13-inch simulator against a dev server given the real key
  (`APNS_KEY_FILE`, key 98BUQ32WWY): the simulator got a sandbox token,
  registered, and both the test and a real "Shopping list updated" (an item
  added over `/api/v1`) arrived through Apple as banners. With "Shopping list
  changes" off, the next change arrived with no banner.
- **Tapping a notification to open its tab not confirmed**: the banner is gone
  before a simulated tap lands. Try it on the iPad.
- **On James's iPad Pro (device build, production server):** notifications
  work: permission, the test send and household notifications all arrive.

### 17 Oct 2026 — notification buttons, meals in cooking mode, meal Live Activity (v1.33.0)

- Notification buttons: the server sends a notification's first web action id
  as the APNs category; the app registers `snooze` (Start cooking, Push back
  30 min) and `delivery-ordered` (Mark as ordered). Checked on the 13-inch
  simulator from Notification Center: Push back 30 min reached
  `/api/v1/dinner-reminders/snooze` and the "Dinner moved to 17:30" confirmation
  replaced it; tapping a dinner reminder opened cooking mode for Fish Tacos.
- Simulated taps on a banner rarely land before it slides away; open
  Notification Center (a slow drag down from the top edge) and act there.
- Planner: a combined meal's card in the whole-week grid opens the meal (every
  dish, Cook for all of them) instead of its first dish's recipe.
- Exit asks "Stop cooking?" when this cook's timers are running: end and cancel
  them, or keep them going. Checked: the risotto timer was cancelled.
- Meal-schedule Live Activity: "Show schedule on Lock Screen" on the meal page
  for today. Checked on the simulator against a dev server with the APNs key:
  the card showed the next step and countdown, the token reached
  `/api/v1/live-activities`, and after moving the serve time the server's
  minute tick sent an update that Apple accepted
  (`[live-activities] … sent=true`). Not yet seen arriving on a locked iPad.
- Dev-only oddity: after the dev server restarted mid-session the simulator app
  came up signed out once; relaunching with `-DishesDevServer` fixed it.

### 17 Oct 2026 — AI in the app (v1.34.0)

- Server: thin `/api/v1/ai/*` routes over the web's own AI actions, and
  `/api/v1/cook-assist` re-exporting the web route. The actions found the user
  from the proxy headers only (`getAutheliaUser`); they now use
  `resolveIdentity`, which takes the app's bearer token and falls back to the
  headers, so the web is unchanged.
- App: Create with AI (Recipes), Generate plan (Planner, no longer opens the
  website), Ask about this step (cooking mode, streamed). AI calls get their own
  long timeouts (90 s to 10 min) instead of the client's usual 10 s.
- Checked: the screens, validation errors, and the "AI isn't set up" path. **Not
  checked: a real generation** — the dev household has no OpenAI key. Try each
  on the iPad against production.
- The dev database had drifted again (0033 recorded but `web_grounding`
  missing); applied the file's SQL directly.
- The simulator "signed out" quirk: a cold dev server takes more than 10 s to
  compile `/auth/whoami`, so the dev launch path gives up. Hit the route once
  (`curl localhost:3000/api/v1/auth/whoami`) before launching.

### 17 Oct 2026 — cooking mode catch-up with the web (v1.35.0)

James: no ingredient highlighting, no scaling, no section ingredients, no
image, no keyboard, no custom timer, and Exit was the only way out.

- `StepMatch` (Cooking/StepText.swift) ports the web's StepText matcher:
  names in the step text are highlighted and their ingredients picked out in
  the list, on top of any stored step→ingredient links. Candidates follow the
  step's section ("For the sauce") when the ingredients are grouped the same
  way; other sections fade in the list, with a NOW tag on the current one.
- Ingredients rail: the dish photo and a Serves stepper (scale per dish).
- Add timer (timers rail / iPhone strip): a label and a duration, joining
  the cook's AlarmKit timers.
- Minimise (⌄ top right, or Esc): the cook becomes a `CookSession` kept on
  `AppNav`; a resume bar sits at the bottom (iPad) or in the tab bar's
  accessory (iPhone) with the dish, step and next timer. Tapping Cook on the
  same dishes resumes rather than restarts. Exit ends the session.
- Keyboard: ← → steps, space starts the step's timer (or goes on), Esc
  minimises — via onKeyPress on a focused view, since button shortcuts didn't
  reach the full-screen cover.
- Checked on the 13-inch simulator: highlighting (Greek Salad, Chocolate Chip
  Cookies), Serves 4→5 rescaled every amount, a custom 3-minute timer,
  Minimise → resume bar with the countdown → back in at the same step and
  scale, Exit with a running timer ended it. **Not checked:** the keyboard
  (the simulator tool can't type keys) — try it on the iPad's keyboard case.

### 17 Oct 2026 — the post-cook review and editing cooks (v1.36.0)

James: cook history couldn't be edited, the web's post-cook flow was missing,
and finishing should clear timers.

- `CookReviewSheet` (Cooking/LogCookSheet.swift) is the web's cook-review form
  in three modes: Log a cook, the "All done!" debrief after Finish, and Edit.
  Duration (−/+ 5; after cooking the real time, and the recipe's cook time is
  updated when it's 5+ minutes out), your rating, who ate + their ratings,
  occasion chips or free text, notes, photo (replace or remove), then the AI's
  photo feedback when there's a new photo. After cooking: Mark ingredients as
  used from pantry, and Review later (logs time/who/occasion only).
- Server: `/cook-history/{id}/feedback`, `/recipes/{id}/cook-time`,
  `/recipes/{id}/use-pantry`; pantry actions use `resolveIdentity` for bearer auth.
- History cards: ⋯ menu (Edit/Review, Delete) and tap to edit; they show the
  duration now.
- Finishing a dish cancels its timers; in a meal the next unfinished dish
  comes up (✓ on finished tabs) and the cook ends after the last.
- Checked on the 13-inch simulator: edited a cook (25 min, Date night) and it
  showed in the history; started cooking, ran a step timer, Finish → debrief →
  4 stars, Save & finish → logged, cooking closed, no timers left. **Not
  checked:** AI photo feedback (no key in dev) and the pantry button.

### 17 Oct 2026 — the rest of the website (v1.37.0)

James: "Add all website features not added yet."

- Server: `POST /api/v1/actions/{name}` runs the web's server actions for a
  bearer token (adapters in `apps/web/lib/api/v1-actions.ts`); every action
  file now resolves the member with `resolveIdentity()`. Crumb import has
  `/api/v1/import/crumb/*`. `updateMemberPreferences` now lets non-admins edit
  only themselves and never their own role (it trusted the client before).
- App: Settings has Kitchen (pantry, deliveries, saved meals, notes), Insights
  (Stats, Wrapped, taste profile) and Household (members, sharing, AI
  settings) sections — `Dishes/Web/`. Recipe ⋯ → AI tools, Share…, Add a note;
  Filters on Recipes; Import from Crumb; paste ingredients/method in the
  editor; a meal's cooking schedule and Save as a saved meal on the planner;
  Add to pantry on Shopping; nutrition estimates in the app.
- Toasts now live in a window of their own (`ToastWindow` in RootView), so
  they show above sheets — errors inside a sheet were invisible before.
- Checked on the 13-inch simulator: every new Settings screen loads; saved a
  member's preferences, delivery settings (Friday → upcoming Fri 23 Oct) and
  a saved meal; filters (tag "pasta" → 2 recipes); the AI tools menu and the
  sides sheet; a meal's schedule (Ready by 17:30 with every dish's steps).
  **Not checked:** anything that needs an AI key (none in dev — the 422 shows
  as a toast), Crumb import with a real export, sharing by email.
- Simulator tip: a plain tap doesn't flip a SwiftUI `Toggle`; tap with
  `duration: 0.15`.

### 17 Oct 2026 — iPhone fixes, planner chips, permissions (v1.38.0)

James, on the iPhone TestFlight build (1.37.1):

- Recipes header wrapped ("A I", "N…") — on iPhone the buttons are icons now;
  the import button is gone (Crumb import removed — no longer needed) and
  New Recipe is a menu: Write a recipe, Photograph a recipe, From a photo…
  (the photo goes straight into `ConciergeSheet(photo:)`).
- Filter tags: picked tags, then the 12 most used with counts; search and
  "Show all N tags" for the rest.
- Cooking a 4+ dish meal on iPhone: the segmented tabs were "…"; it's a menu
  headed "Dish n of m" now (segmented only on iPad with up to 4 dishes).
  Menu items are plain Buttons — an inline Picker inside the Menu didn't
  switch dishes.
- Planner: the chosen day shows the web's dinner-time chip (start-by time;
  tap to change the day's time or skip its reminder) and delivery chip (mark
  ordered, slot/total, skip). Bridge: `dinner.week|setTime|setReminder`.
- Start time "10:35 for 17:00" with an ~8h25m roast: the household's
  actual÷stated ratio (≈0.76) shrank the stated time. `estimateFrom` now
  only lets the ratio lengthen a recipe.
- Notification and AlarmKit permission asked on open after sign-in
  (`AppModel.askForPermissions`), not first mid-cook.
- Profile photos: `/api/v1/members` and `household.get` carry `avatarUrl`;
  `Avatar(url:)` shows it on Household, Home and Settings.
- Checked on the iPhone 18 Pro simulator: Recipes header, dinner chip, Fri
  delivery chip + menu, dish menu switching Greek Salad → Thai Green Curry.
  **Not checked:** the permission prompts (this simulator had already
  answered), a real avatar (none in dev), photo import (needs an AI key).

### 17 Oct 2026 — Home folded into Recipes, AI tab (v1.39.0)

James: Home was "just a collection of recipes mostly", and tabs are short on
a phone. Done on both the app and the web so they match:

- Tabs: Recipes, Planner, AI, Shopping, Settings (AI in the middle, like the
  web's phone nav button). `AppNav.Tab.home` is gone; a saved "home" tab
  falls back to Recipes, and push links to `/` or `/home` open Recipes.
- Recipes opens on browse mode (`RecipesBrowse.swift`) when nothing is
  searched, chosen or filtered: `TonightCard` (moved from Home, a little
  smaller on iPhone, with a Plan button), the Wrapped banner in Dec/Jan
  (`WrappedScreen(year:)`), then shelves — Favourites, Cook again (last cook
  from the synced history), Suggested for you (`taste.get`, left out
  offline), Recently added, top 3 cuisines with 3+ recipes. See all sets the
  chip or sort (`RecipeFilters.Sort.cooked` is new); the All chip shows the
  whole grid and a Clear chip goes back. Switching scrolls to the top.
- The AI tab is `ConciergeSheet(inTab: true)`: no Close, the form resets
  after saving, and the new recipe opens in Recipes (`nav.openRecipe`). It
  re-checks the AI key on reappearing.
- Checked on the iPhone 18 Pro simulator: tabs, browse mode, shelves, Cook
  again → See all → grid titled "Cook again", Clear, the AI tab.
  **Not checked:** the iPad (simulator was signed out), writing a recipe
  from the AI tab and landing on it (no AI key in dev), the Wrapped banner
  (it's October).

### 17 Oct 2026 — Siri / Shortcuts and a Control Center control for shopping (v1.40.0)

James wanted adding to the shopping list to be quick, especially from the Watch.

- `AddToShoppingListIntent` (`Dishes/Shopping/ShoppingIntents.swift`): an
  App Shortcut — "Add to my Dishes shopping list", Siri asks what. Runs in
  the background via `AppModel.addShoppingItem` (now shared with the add
  card), an outbox mutation, then a `syncNow` so it goes before iOS suspends
  the app. The item is stored as spoken, like the integrations quick-add.
  Also in Shortcuts and assignable to the Action button.
- `AddToShoppingControl` in DishesWidgets: Control Center / Lock Screen
  button. Its `OpenShoppingAddIntent` is in `Shared/` (both targets) with
  `openAppWhenRun`, sets `AppRequests.shared.shoppingAdd`; RootView switches
  to Shopping and `AddItemCard` focuses its field.
- Watch: not possible from the iPhone app (watchOS only runs intents from an
  app installed on the Watch). The quick-add Shortcut in API.md runs on the
  Watch today; a Watch app is the proper fix (TODO_MOBILE.md tier 4).
- Written in a cloud session with no Swift toolchain: **not compiled or run.**
  To check: build; "Hey Siri, add to my Dishes shopping list" with the app
  closed, online and in Airplane Mode; the item appears and syncs; the
  Shortcuts app lists the action; add the control in Control Center and tap
  it from the Lock Screen (cold and warm) — the field should be focused.

### 18 Oct 2026 — the planner's meal menu, warnings, cooking order (v1.41.0)

James: a saved meal cooks in the wrong order; the planner lacks the web's
meal menu; no heart-healthy or delivery warnings on mobile.

- Cooking a combined meal starts with its longest dish (`CookDish.inStartOrder`),
  the same rule as the simple cooking schedule — from the planner, Tonight and Home.
- `MealMenu` (Plan/MealMenu.swift) on combined meals: the web's menu item for
  item. Plan edits are sync mutations (`meal_plan_group.update` / `.delete`
  with `keepRecipes`); shopping, schedule and saved-meal go online. Remove
  asks first — a second tap on the ⋯ spot landed on Remove while testing.
  `MealPlanGroup.sourceMealId` now decoded.
- `PlanWeekStrips`: a delivery banner (next order, "n to do") and a nutrition
  banner (heart-healthy share, targets off, swaps) under the buttons; each
  opens a sheet. Server: `planner.nutrition` (lib/services/week-nutrition.ts,
  the planner's own summariseMeals/suggestSwaps), `planner.swap`,
  `planner.groupToShopping`. `NextDeliveryCard` is shared with Deliveries.
- A `.sheet` on a `ViewThatFits` never presented — host it on a stable view.
- Checked on the iPhone 18 Pro simulator with the dev user temporarily on a
  cholesterol-lowering diet: both banners and sheets, the meal menu, the
  remove confirmation, and Sunday roast cooking Mushroom Risotto first.
  **Not checked:** a swap applied (no library match in dev), iPad layout.

### 18 Oct 2026 — dinner chip vs cooking schedule (v1.41.1)

James: the planner chip said "start 07:40" for a Sunday roast whose cooking
schedule starts 08:20. The chip used the longest dish's prep+cook plus 10%
slack (40 min on an 8h25m slow cooker); the schedule sums the steps. Now
`dinner.week` returns each day's scheduled-meal start (`scheduled`, from the
same schedules the cue reminders use) and both chips use it for the dishes
it covers; other dishes still use estimates, and the earliest wins. The
stated-time slack is capped at 15 min. Checked on web and the iPhone
simulator: Saturday shows Fish Tacos at 16:45 (earlier than the roast's 16:52).

### 18 Oct 2026 — "When did you start?" in cooking mode (v1.42.0)

James often starts a meal before opening the app and wants the schedule to
follow — but not by re-syncing on step changes, since he reads ahead. Now a
scheduled meal's cook asks once as it begins, on its day ("Schedule says
start Mushroom Risotto at 08:20 for 17:00"): Start now, or I started earlier
at… (a wheel defaulting to now, or the due time within 10 min). More than
5 min off offers **Move dinner to …** (`timeline.shift` — the meal's
serve-at, or that date's dinner time when it follows it, so the planner chip
moves too; cues already due are marked sent so the reminder loop doesn't
re-fire them; the Live Activity's change key now includes the times, so a
moved meal is re-sent even when the next cue is the same) or **Keep …**
(only the first dish's cues shift, on this device). Started early, cooking
mode opens that dish on the step the schedule has it on by now. ⋯ →
"Started at a different time…" asks again mid-cook.

- `CookRequest.groupId` (planner Cook, Tonight, "Cook tonight", a reminder's
  link) and `MealClock.Cue.recipeId/stepIndex`; rules in
  `DishesCore/Models/MealStart.swift` with tests (same as
  apps/web/lib/meal-start.ts). `MealCueLine` shows the next cue under the
  progress bar, as the web's Now / next strip.
- Checked on the iPad Pro 11-inch simulator against the worktree's dev
  server, with the dev Sunday roast moved to today and dinner at 08:33:
  the sheet, 07:15 → "40 min early — move dinner?" → Move dinner to 07:53
  (the day's dinner time became 07:53) → Mushroom Risotto opened on step 4;
  the ⋯ menu entry. Web checked the same way, plus Keep (only the risotto's
  cues moved). **Not checked:** the Live Activity re-send on a real device,
  the iPhone layout of the sheet.
- The simulator often ignored the first tap after a screen change; tap again.

### 18 Oct 2026 — ingredient tooltips in cooking mode (v1.42.1)

James: highlighting did nothing, and the badges under the step got pushed
out of sight on long steps. Now the step's ingredient names are dotted-
underlined (as on the web) and tapping one shows its scaled amount and
preparation in a dark bubble by the word; tapping the text no longer goes
to the next step, and the badges are gone. `StepMatch.text` builds the Text
with an `IngredientTag` custom attribute per name; the tap is traced to a
name through `Text.LayoutKey` (`Text.Layout.ingredient(at:)`). Links
(`AttributedString.link` + openURL) didn't fire alongside a tap gesture.
The bubble sits below the word on the first line (above would be clipped
by the scroll view). Checked on the iPhone 18 Pro simulator.

### 18 Oct 2026 — Create with AI matches the web (v1.43.0)

- "Inspire me" / "I know what I want" modes; direct mode writes the named
  dish straight away (a concept with the title as its description, as the web does).
- The five ideas are tickable; several are written one after another with
  a progress list (each saved as it finishes, Open on any).
- Ticking a member on a cholesterol-lowering diet switches Heart-healthy on,
  in Create with AI and Generate plan; Generate plan gains the toggle and
  passes it to draft and apply. `/api/v1/members` adds `cholesterolDiet`.
- Checked on the iPhone simulator: both modes render. **Not checked:**
  generating (no AI key in dev), the batch list, the auto toggle with a real
  cholesterol member.

### 18 Oct 2026 — AI photo with style and instructions (v1.44.0)

Recipe ⋯ → AI tools → Generate a photo opens a sheet: style (the household's
default from AI settings first) and optional custom instructions (≤500
chars), as the web's Generate image button. It starts the same background
job (`lib/services/recipe-image-job.ts`, now shared with
`/api/recipes/[id]/generate-image`) through `ai.recipeImageJob`; the sheet
closes at once and the app syncs at ~30/50/80 s to pull the photo down.
**Not checked:** an actual image (no AI key or storage in dev).

### 18 Oct 2026 — the cookbook, and the iPhone Duo's hinge (v1.45.0)

James wanted a "book mode" for the iPhone Duo: half-folded like a book,
recipes on one side and photos on the other, page turns, a used family
cookbook look — stains, and handwriting in several hands and inks.

- `Book/Hinge.swift`: `UIHingeInteraction` (iOS 27.1) reports the hinge's
  status and angle, not which way it's turned, so the posture comes from the
  screen's shape: partly open and wider than tall = book, taller = stand.
  `RootView` opens the cookbook on `.book` and closes it again when the phone
  is opened flat (only if the hinge opened it).
- `Book/Cookbook.swift` lays the book out (cover, contents, chapter per
  cuisine, recipes, notes pages, index), measuring text with UIKit fonts to
  decide one page or two per recipe. `CookbookPages.swift` draws the pages —
  its sizes must match the measuring. `Ink.swift`: paper, pens, stains, all
  seeded from the recipe id so a page always looks the same.
- Handwriting is iOS's own hands (Bradley Hand, Noteworthy, Snell Roundhand,
  Marker Felt, Chalkboard) in six inks. Each member's notes are in their own
  pen — `notes.list` now returns `authorId` — and unsigned cook-review notes
  get a pen of their own.
- `PageCurl` wraps `UIPageViewController` (.pageCurl; .scroll with Reduce
  Motion). A rebuild (new data, folding) keeps your page: the controller is
  redrawn per `edition`, not per layout key — the key changed before the new
  book existed, which left the old pages on screen.
- Recreated the iPhone Duo simulator (iOS 27.1). It boots on a 466×678pt
  screen; there's no Simulator.app in this Xcode, so it can't be folded from
  here. **Checked**: cover with the household name, chapter, one-page recipe,
  photo page with a note in blue felt-tip and "First made" in green
  copperplate, tallies, heart, stars, flour stains, the long layout (forced
  for the test) with its drop cap, and — once James unfolded the simulator to
  its wide inner screen — the two-page spread with the curl over the spine.
  **Not checked**: the hinge opening the book by itself (half-folded), Reduce
  Motion, "Cook this" from the book.
- The status bar stays visible in the book: `.statusBarHidden()` on the Duo
  gave up the side column the time and signal are drawn in, and the pages
  slid under them. Hosted pages have `safeAreaRegions = []` so their measured
  size is exact.

### 18 Oct 2026 — a meal cooked as one sequence, and one meal review (v1.46.0)

James wanted a scheduled saved meal cooked as one merged sequence rather
than hopping between recipes, with the times visible to look ahead, and a
review of the whole meal (rating combinations) at the end.

- Cooking mode walks the frozen schedule (`MealSequence` in DishesCore, with
  tests; `MealSequenceViews.swift`): Next/Back go through every dish's steps
  in time order; each step shows its due time ("in 25 min", "Now", "late"),
  "also now" chips, and what's next. Whole schedule from the toolbar (iPad)
  or ⋯ (iPhone). The title menu opens one dish's recipe ("Back to the meal"
  returns to your place). Notes, combined prep steps (`covers`) and Serve get
  their own card.
- `timeline.freeze` on the first open of a cook: the server keeps that
  schedule (simple or AI) for 24 h, so edits mid-cook don't move cues,
  pushes or the Live Activity. The AI planner may now batch identical prep
  across dishes into one cue with `covers`.
- One review at the end (`MealReviewSheet`, `mealCooks.log`): the meal's own
  stars, who ate, occasion, notes, photo (on the main dish's entry), plus a
  quick star row per dish. New `meal_cooks` table (0044) + `cook_history.meal_cook_id`.
  Saved meals show the average and best/lowest combination.
- Checked on the iPhone 18 Pro simulator and the web (desktop and 375 px):
  start prompt → Keep 17:00 → sequence across risotto/soup/curry, schedule
  list, Serve → review saved with per-dish ratings; Saved meals shows 4.0 ·
  cooked 3 times. **Not checked:** an AI plan with combined steps (no AI key
  in dev — covered by unit tests), iPad layout, the photo upload.
- Simulator tip: screenshots at 0.2 scale on the iPhone are 920 px wide for
  402 pt — multiply by 0.437, not the iPad's 0.688.

### 18 Oct 2026 — several cooks at once (v1.46.1)

James minimised a saved-meal cook, started and minimised a dessert, and
couldn't get back to the meal: `AppNav` held one `CookSession`, and a new
request replaced it (only the timers survived, being global).

- `AppNav.sessions` is a list, the cook in front first. A request matching a
  live cook (`isCooking`, which now also matches a planned meal by
  `groupId`) brings it forward; a new one is added. `nav.end(_:)` ends one
  cook; `nav.cooking = nil` still ends the one in front.
- `Cooking/CookStack.swift`: `CookingBar` (one cook as before; with more, a
  count and the others' card edges peeking above it), `CookStackFan` (tap
  the bar: every cook as a card — title, "Step n of m" or "n of 15 in the
  meal", next timer or due time, ×; tap outside to put them back),
  `CookSwitcher` (iPad toolbar; on iPhone the same list is in the title's
  menu — there's no room beside the title for a separate button).
- The iPhone's tab-bar accessory clips anything drawn outside it, so the
  card edges are drawn over the app (`CookStackEdges`) from the accessory's
  measured frame; the fan lines its front card up with the same frame.
- A `confirmationDialog` from inside that overlay is presented invisibly and
  swallows the next taps (it ended a cook in testing), so the fan's × asks
  inline in the card, and only when the cook has timers running.
- Live Activity: the cook's name moved into `ContentState.title` (optional,
  old activities fall back to the attributes' title), so switching cooks
  updates the activity. Restarting it called `Activity.request`, which held
  the main thread for 1–2 s per switch, and taps landed on a stale layout.
- `SavedCooks`: cooks are saved (recipe ids, steps, scales, finished dishes,
  start shift, sequence position, started-at) on minimise, on any change to
  the list and when the app leaves the foreground, and restored minimised
  for 12 h; a meal's frozen schedule is fetched again on restore.
- Checked on the iPhone 18 Pro simulator: Sunday roast (scheduled meal) →
  minimise → Chocolate Chip Cookies → minimise: bar shows the stack, fan
  shows both, each opens at its own place (roast at 2 of 15, cookies at its
  step); Cook tonight resumes the roast; the title menu switches both ways;
  relaunch keeps both; × with a running timer asks inline. iPad Pro 11":
  toolbar "2 cooks" switcher, floating bar with the edge peeking, fan.
  **Not checked:** the Live Activity on a Lock Screen with two cooks, a
  device.
- Simulator tip: scripted taps that land mid-animation hit where the card
  is drawn at that moment; wait ~1.5 s after opening the fan before tapping
  a card.

### 18 Oct 2026 — one + on the iPhone's Recipes header (v1.46.2)

James found three filled buttons beside "Recipes" untidy on the phone. On
iPhone it's now one round orange + (as the planner's) with a menu: Write a
recipe, Photograph a recipe, From a photo…, Create with AI, then Open the
cookbook. iPad keeps the labelled Cookbook / Create with AI / New Recipe
buttons. Checked the header on the iPhone 18 Pro Max simulator (the 18 Pro
was in use by another session); the menu's items weren't tapped through.

Also in 1.46.2 — "Keep 17:00" anchors a dish's last steps to serving. James
started a slow-cooker lamb early, chose Keep, and its "carve and serve" step
came up at 16:15 for a 17:00 dinner: Keep shifted every one of the lamb's
cues. Now (`MealStart.kept` / `keepShift` in lib/meal-start.ts) only the
cues up to the dish's longest stretch move; that stretch absorbs the
difference and the finishing steps stay put. Unit-tested (KeptStartTests).

Also in 1.46.2 — timers say what they're for. James couldn't tell which
step a running timer belonged to, or get back to it, as the web lets you.
A step's timer now keeps its dish and step (`CookTimer.recipeId` /
`stepIndex`): the card reads "Chill dough · Step 3 · Chocolate Chip
Cookies" (the step first, so a narrow iPhone card keeps it), and its menu is
headed with the full source and starts with **Go to step N** — in a meal
sequence it goes to that step's place in the schedule, otherwise to the
dish at that step. Found on the way: the step was read inside the async
start task, so tapping Next straight after Timer labelled it with the next
step; it's now taken on tap. The alarm banner also names the dish under
"Time’s up" and its Stop no longer wraps to "Sto / p" on
the iPhone. Checked on the iPhone 18 Pro simulator: step 3's timer from
step 4 and step 1's from step 3 both jump back with the timer still
running. **Not checked:** Go to step inside a meal sequence, the iPad
timers rail, the banner with two timers at once.

### 18 Oct 2026 — every dish's serving at the one Serve (v1.46.3)

The rest of the lamb problem: nothing made a dish's finishing steps sit at the
end, and four dishes each ending "Serve" gave four serve cues before the one
"Serve". Server-side now (lib/meal-timeline.ts): a dish's last step that is
only serving it (`isServingStep` — "Serve", "Carve and serve", "Garnish with
…", "Spoon the sauce over … and serve"; anything with cooking, a timer or
over 10 min keeps its own cue) is folded into the serve cue's `covers`, in
both the simple schedule and the AI's (whatever time the AI gave it). A dish's
other finishing last step (carve, slice, plate) can't start until the step
before it has finished, unless it starts "Meanwhile". The AI prompt says the
same. The app needed no model change — `MealSequence.steps(of:)` already reads
the serve cue's covers — only the label: the Serve card read "Prep for 4
dishes" because covers was checked first (fixed in `CookSession.label` and
the web's `cueLabel`). Its card lists each dish's serving step under
"Everything should be ready". Unit-tested (MealSequenceTests
`serveCueDoesEachDishsServingStep`; web: `pnpm --filter @dishes/web
check:meal-timeline`). **Not checked** in the simulator or a browser; stored
and frozen schedules keep their old separate cues until replanned.

### 18 Oct 2026 — tapping the Live Activity opens that cook (v1.46.4)

James tapped the cooking Live Activity on step 4 of a recipe and the app
opened wherever it was, not at the cook. The activity now carries a link,
`dishes://cook?dish=<id>…&group=<id>&recipe=<id>&step=4&cue=<id>`
(`Shared/CookLink.swift`; the `dishes` scheme was already registered for the
sign-in callback), set as `widgetURL` on the Lock Screen view and the whole
Dynamic Island (compact, minimal and expanded). It's in the activity's
`ContentState` because the activity follows whichever cook is in front, so
the link changes with it. `CookLinkHandler` (`.onOpenURL` on RootView) finds
the cook — the same meal by group id, else the same dishes — brings it to the
front, opens cooking mode and goes to the step, or in a meal sequence to the
cue (on a cold launch the schedule isn't back yet, so the cue is stored as the
position and lands once it is). With the cook ended since, it opens the
recipe. From a cold launch the link waits for `restoreCooks`
(`AppNav.cooksRestored`). The meal-schedule activity links to `group=<id>`
only: that meal's cook if one's going, else the Planner. Cooking mode also
refreshes the activity when the sequence position or dish view changes (a
prep step or note can move on without the step changing).

Checked on the iPhone 18 Pro Max simulator, with cooks seeded through
SavedCooks (the `cooks` key in the app container's
`Library/Preferences/uk.collco.dishes.plist` — `simctl spawn defaults write
uk.collco.dishes` writes the device-wide domain instead, which the app never
reads) and the link opened by the app itself through `UIApplication.open`
via a temporary debug hook (`simctl openurl` puts up "Open in Dishes?", which
needs a tap, and the simulator panel wasn't attached):
- cold launch, one cook saved at step 1, link for step 4 → cooking mode on
  Bolognese step 4 of 5
- two cooks minimised (Bolognese in front), link for the cookies at step 3 →
  cookies in front at step 3 of 4, "2 cooks"; the activity's link followed
  (logged `…recipe=b82d…&step=3`); then a Bolognese step-2 link from inside
  cooking mode switched back
- a link for a dish with no cook → its recipe page, cooks left minimised
- a meal-schedule link with no cook → the Planner

**Not checked:** an actual tap on the Lock Screen or Dynamic Island (needs
the panel or a device), the app coming from the background rather than
already in front, a meal sequence's cue (no dev server running, so no meal
clock), the iPad, and opening over the cookbook cover.

### 18 Oct 2026 — the Apple Watch app (v1.47.0, branch `feat/watch-app`)

James: start the Watch app; and could a cook on the kitchen iPad show on the
Watch without being flaky or kicking a device out of cooking mode?

- The phone relays (option A in the plan): Authelia rotates refresh tokens, so
  the Watch can't share the phone's sign-in. No server change for W1/W2.
- W1 shopping (aisle groups, tick, Add by dictation/Scribble, the
  "Add to Shopping List" intent on the Watch), W2 tonight (meal clock as clock
  times), W3 cooks in progress from any device (new `/api/v1/cooking-sessions`,
  Redis only — **no migration**). Complications: Shopping and Tonight.
- `AppModel.setShoppingItem` is now the one tick path (shopping screen and
  Watch); `addShoppingItem` takes an id so an add from the Watch sent twice is
  one row.
- Checked on a paired iPhone 17 (iOS 27.0) + Watch Series 12 against the dev
  server: snapshot reaches the Watch (36 items, 6.6 kB); a tick on the Watch
  reached the server's `sync_operations` a second later; an add ("Watch
  test") landed; a cook PUT as an "iPad" showed on the Watch home and cooking
  screens with its running and paused timers, a step change arrived on the next
  poll, and ending it showed "That cook has finished"; cooking on the phone
  itself showed as "this iPhone" and published to the server. Server rules
  checked with curl: late version 409, after end 410, started 13 h ago 410.
- Fixed on the way: WatchConnectivity reply handlers made inside a main-actor
  method crashed when called off it (`@Sendable` now); `CookingActivity.show`
  ends its own activity before starting a new one, which also ended the shared
  cook — the Live Activity restart is `endActivity()` now.
- **Not checked:** complications on a watch face, Siri on the wrist, a real
  iPad (the iPad path is the same `CookingShare` code; an "iPad" was stood in
  for with curl), silent pushes (no APNs key in dev — the Watch's 15 s poll
  covered it), anything on a real Watch. New capability (App Group on the
  Watch targets): press Run in Xcode once so the profile picks it up.

### 18 Oct 2026 — a tidier recipe page (v1.49.0)

- The recipe's role is a badge in the meta row ("Main ✎", or a dashed "Set
  dish type") that opens `RecipeRoleSheet`: Main / Side / Sauce / Extra, and
  Generate a side dish. It saves through the new `recipes.setMealRole` action
  (`lib/api/v1-actions.ts`) and patches the local row, so it shows at once.
- `NutritionPanel` collapses to its kcal line; `@AppStorage("recipeNutritionOpen")`
  remembers open or closed.
- At 1000 pt and up (iPad landscape, iPad Pro 13" portrait) the page is two
  columns: photo, details, nutrition and overview on the left; Ingredients /
  Method tabs on the right. 760–1000 pt keeps ingredients beside the method;
  narrower keeps the three tabs.
- Checked on the iPad Pro 11" simulator: portrait layout, the role sheet, the
  collapsed nutrition, and the two-column layout (by lowering the threshold to
  800 for one build, since the headless simulator can't rotate). **Not
  checked:** a real landscape iPad, the iPad Pro 13" (its fresh simulator hung
  on first sync), or tapping a role in the app — the `recipes.setMealRole` action itself was checked with curl (set and cleared).

### 18 Oct 2026 — suggestions in the shopping add field (v1.50.0)

- `AddItemCard` suggests as you type: items the household has had on any list
  (scored by count, halved every 60 days, so recent beats long-ago) ahead of
  recipe ingredient names. Tapping one adds it with the Qty/Unit already typed
  and, unless a category is chosen, the aisle it was last filed under.
  Unticked items on the active list aren't offered.
- Ranking lives in `DishesCore/Models/ShoppingSuggestions.swift`, the same rules
  as the web's `lib/shopping-suggestions.ts` (tests: `ShoppingSuggestionsTests`).
  It reads raw `shoppingItems` and `recipes` records, so it's offline, and the
  observation only starts once the field has been focused.
- The list sits inside the card below Qty/Unit/Category, not over them.
- Checked on the iPad Pro 11" simulator: "on" → Onions (Produce, past list) then
  red onion (in a recipe); Qty 2 + tap red onion added "2 red onion" and kept
  the keyboard up. **Not checked:** the iPhone layout, or a hardware keyboard
  (arrow keys are web-only).

### 19 Oct 2026 — Siri phrases that don't collide with Reminders

James: "Add to my Dishes shopping list" got "I didn't find a Dishes shopping
list". "Add to my <name> list" is Siri's Reminders grammar, so it looked for
a Reminders list called "Dishes shopping" and never asked Dishes. The phrases
(iPhone and Watch) now name the app after "in"/"with": **"Add to shopping in
Dishes"**, "Add an item in Dishes", "Add shopping with Dishes", "Add something
to Dishes"; on the Watch also "Open/Show shopping in Dishes". Built for the
simulators; Siri can't be checked there — try it on the phone and the Watch
(Shortcuts → Dishes lists the phrases once installed).

### 19 Oct 2026 — "Ask about this step" keeps its conversations (v1.51.1)

James: the chat was gone as soon as he left it. It lived only in the sheet's
`@State` and was never saved — the web saves to `cook_assist_threads`, the app
never did. Now:
- The open conversation for each step is on the `CookSession` (`assist`, by
  recipe id + step), so closing the sheet and reopening carries on, and an
  answer still arriving when the sheet closes lands there.
- After every answer it's saved: `cookAssist.save` the first time (→ id),
  `cookAssist.update` after that. Best effort — a failed save is retried on the
  next answer.
- Opening the sheet loads `cookAssist.list` for the recipe and shows that
  step's other conversations under "Earlier", each with Delete. The web's
  cooking mode shows the app's conversations too, and vice versa.
- `saveCookAssistThread` now checks the recipe is the household's.
- A failed answer puts the question back in the field, as on the web.

Checked on the iPad Pro 11" simulator against the dev server (no AI key there,
so the route was stubbed with a canned answer for the test, then reverted):
seeded thread shows under Earlier and Delete removes it server-side; an
answer is saved; Done, reopen → same conversation, not duplicated under
Earlier; a follow-up updates the same row with the whole history sent.
**Not checked:** a real AI answer, the iPhone layout.

Uploaded to TestFlight as 1.51.1 (build 202610191617) from the PR branch; the
saving and Earlier list need the server side, which goes live once PR #51 is
merged and deployed.

### 20 Oct 2026 — Import a recipe from a website (v1.52.0)

The web's new **Import from web**, in the app:
- New Recipe → **From a website…** (`Recipes/WebImportSheet.swift`): paste a
  link (or the Paste button, which reads the clipboard only when tapped, so no
  paste prompt), Import. The server reads it and saves it —
  `POST /api/v1/recipes/import-url` → `{ recipeId, title, via, notice }` — then
  the app syncs and opens the recipe, as the photo import does. A `notice`
  ("the photo couldn't be downloaded") rides along in the toast.
- `dishes://import?url=<page>` opens that sheet and imports at once
  (`WebImportLink`, routed through `CookLinkHandler`'s `onOpenURL` into
  `AppNav.importLink`, which switches to Recipes). That's for a Shortcut on
  Safari's share sheet: *Receive URLs from Share Sheet → URL Encode → Text
  `dishes://import?url=<Encoded>` → Open URLs*.
- Works without an AI key on sites that publish schema.org recipe data; the
  server's 422 message is shown as is otherwise.

Written in a cloud session with no Xcode, so **not built or run yet**. To
check on the iPad simulator against the dev server: the sheet from New Recipe,
the Paste button, a real recipe link (the dev server needs outbound internet),
an error (`http://192.168.1.1` → "That address can't be imported from."), and
`xcrun simctl openurl booted "dishes://import?url=https%3A%2F%2Fwww.bbcgoodfood.com%2Frecipes%2Feasy-chocolate-cake"`.

### 20 Oct 2026 — Dishes on the share sheet (v1.53.0)

The share extension the last entry left for later (`DishesShare/`, RUNBOOK
"Share extension"). Share a recipe page → Dishes → it imports there and then
and says what it saved (or why not); Cancel while it works, Try again on an
error. Behind it:
- `KeychainTokenStore` takes an access group and moves pre-group tokens into
  it on first load; the app uses `KeychainTokenStore.dishes()`.
- `AuthSession.refreshOnce` reads the store first (another process may have
  refreshed). New `AuthSessionTests` cover it.

Written in a cloud session with no Xcode: **not built, run or `swift test`ed
yet.** To check: `swift test` in Packages/DishesCore; Run once in Xcode for the
new entitlement and target; on the simulator, sign in (or use the dev server),
then Safari → a recipe page → Share → Dishes; share a link from Notes as text;
share with the app never opened since updating (expect "Sign in to Dishes
first" until it is); and confirm an existing install stays signed in after
updating (the Keychain move).


Checked on the iPad Pro 11" simulator against the dev server, after #52 and
#53 merged: `swift test` passes (33, AuthSessionTests included); the app and
`DishesShare` build. Safari → BBC Good Food "Easy chocolate cake" → Share →
Dishes → "Saved to your recipes" (201; the photo notice is the dev server's
missing S3), and the app showed it after a sync. The v1.52.0 sheet:
`dishes://import?url=http%3A%2F%2F192.168.1.1` → "That address can't be
imported from." with Try again. **Not checked:** sharing a link from Notes as
text, the Keychain move on an existing signed-in install, the "Sign in to
Dishes first" case, the iPhone layout.

Uploaded to TestFlight as 1.53.0 (build 202610200826) from main. The command
line signed the new target and entitlement without a Run in Xcode first; the
archive's app and extension both carry `C729B84RYG.uk.collco.dishes.shared`.

### 20 Oct 2026 — iOS 27 Phase D0 + D1: App Group, Siri, Spotlight (v1.55.0)

D0: `GET /api/v1/ai/context` and `POST /api/v1/recipes/generated` on the
server; the App Group `group.uk.collco.dishes` on the app, widgets and share
extension, with the database moved into it and suspended in the background
(see "The App Group, Siri and Spotlight" above); the AI context cached as
`ai-context.json` after each sync. D1: `Dishes/Intents/` — entities for
recipes, planned meals, shopping items, saved meals and the step being
cooked; nine new intents and eight App Shortcuts; recipes in Spotlight;
the recipe page, the planner's cards and cooking mode's step annotated for
Siri.

Checked on the iPad Pro 11" (M5) simulator, iOS 27.1, against the dev server:
- `swift test`: 42 pass (six new: the move, persistent WAL, suspended reads
  and refused writes, the AI context fixture). Web: `tsc`, `check:ai-context`
- `DishesIntentTests`: all six pass — lookup by name and id, Spotlight query,
  planning through the outbox, Start Cooking opening cooking mode with its
  step visible to Siri, OpenRecipeIntent opening the page with the recipe
  visible to Siri. App Shortcuts registered: 8, 120 phrases
- Spotlight on the Home Screen: "green curry" shows a Dishes section with Thai
  Green Curry, its cuisine, time and ingredients. "coconut" alone didn't bring
  it up (web results crowd it out); ingredient keywords may need a look
- Updating in place from a v1.54.1 install: the database moved to the group
  (old folder empty, no fresh download — the cursor carried on) and a change
  queued in the old outbox reached the server
- Off screen and back, then a tick on the shopping list: saved and sent
- The endpoints, by curl: context with no AI key; a saved recipe with the
  collection omitted, chosen, unknown and null; an unknown field refused (400)

**Not checked:** Siri by voice (the simulator has none), the AI context on a
household with a taste profile, a Watch action or a silent push arriving
while the store is suspended, the widgets and share extension reading the
group (nothing reads it until D3/D4), a device build (the App Group must be
registered on the developer account — automatic signing should do it on the
first build with `-allowProvisioningUpdates`).

This Mac, after the macOS 27 update: no simulator runtimes and no xcodegen —
see One-time setup. The dev database made with `drizzle-kit push` alone has
no sync triggers, so a device only ever sees its first snapshot; the README's
local-dev step now applies them.

### 20 Oct 2026 — iOS 27 Phase D2: on-device AI, first two jobs (v1.56.0)

`DishesCore/AI`: the router (device → server, or the rules for ingredient
lines; no Private Cloud Compute), the checks an answer must pass, Swift copies
of the server's prompts and ingredient rules, and two jobs —
`IngredientLineReader` (rules, then the model for the lines they misread) and
`RecipeReader` (Vision reads the page, the model fills a `@Generable` draft).
In the app: New Recipe → Scan a recipe… (document camera, several pages) /
From a photo… → "Check the recipe" (RecipeEditor, "Read on this iPad") →
`POST /api/v1/recipes/generated`, the server estimating nutrition after; the
shopping add card and Paste import read lines on the device; Settings → AI →
This iPad.

Evaluations (`DishesCoreEvaluations`, on this Mac, AFM 3 Core, 4,096 tokens):
ingredient lines 0.969 against the rules' 0.836, 32/32 checks; recipe cards
0.964, 20/20 checks (server not measured: no key). Both start on the device.

Checked on the iPad Pro 11" simulator against the dev server: typing "2 tbsp
finely chopped flat-leaf parsley" on the shopping list saved 2 · tbsp ·
flat-leaf parsley; From a photo… with a printed Greek Salad card read it on
the device in about 20 seconds, opened "Check the recipe", and saving gave the
server an AI recipe with 7 ingredients and 3 steps — counted ones without
units, 200 g feta, 60 ml oil — but "1 tsp dried oregano" lost its "tsp".

Found on the way:
- The concierge sheet's `.task` is cancelled as the photo picker closes, and
  a cancelled Vision request fails: the read now starts in its own Task.
- The server's "always use metric" made the model add units ("4 kg tomato"):
  left out of the reading prompt (noted on both sides), and every unit and
  amount must now be on the page.
- Guided generation takes `\d` and `\w` but no character classes; Swift's
  `\d` matches ½ where JavaScript's doesn't, so the rules use `[0-9]`.

**Not checked:** the document camera (no camera in the simulator), Paste import
by hand, real cookbook photos, the server's score on the same sets (needs a
key), the fallback with a key set up, a device build.

### 20 Oct 2026 — iOS 27 Phase D3: the rest of the on-device jobs (v1.57.0–1.58.0)

v1.57.0 filed device-read recipes into a collection on the device
(`CollectionPicker`, 0.80 on 20 recipes). v1.58.0:

- Share extension: shared text and screenshots read on the device
  (`RecipeReader.read(text:)`, Vision for images), a preview to check, filed
  and saved through `POST /api/v1/recipes/generated`; the fallback is the new
  `POST /api/v1/ai/text-recipe` or photo-recipe
- Cook assist on the device (`CookAssist`, `AIRouter.stream`); substitution
  questions go to the server when there's a key
- Generate plan on the device (`MealPlanDrafter`): the library chosen by code
  from the local store, the model filling each slot from what suits it
- "Improve with AI" (`RecipeTweaker`) and recipe ideas (`ConceptWriter`) built
  and evaluated, but they start on the server — the evaluations said so
- `recipes.generated` action; a tweak saved without nutrition gets it estimated
- `Recipe.mealTypes` read from sync

Evaluations (this Mac, AFM 3 Core), with what each run turned up, are in
TODO_MOBILE.md D2/D3 and `fixtures/evals/results/`. Run one sample with
`DISHES_EVAL_ONLY=<part of its name>` (that run doesn't overwrite the record).

Checked on the iPad Pro 11" simulator against the dev server (no AI key):
Generate plan for five dinners next week drafted on the device in about
20 seconds — five library recipes, no request to `/ai/meal-plan`; Ask about
this step on carbonara step 1 answered on the device ("Answered on this
iPad"), right but loose ("skip ahead to step 2"). The test conversation was
deleted.

Found on the way:
- The model drops a name and keeps its preparation ("salt, to taste" →
  [] [to taste]); the name is read back from the printed line
- Small-model edits by number point at lines that aren't there; picking from
  the recipe's own lines (a schema built per recipe) fixes that, not the
  quality of the edits
- The guardrails stop a child's breakfast ideas on the device whatever the
  wording; the router sends those to the server
- Plan sheet (not new): "Draft 7 lunchs", and the chosen meal pill hardly
  looks chosen

**Not checked:** the share extension's text path by hand after the last prompt
change, the fallbacks with a key set up, a device build, barcode scanning (not
started: the product lookup needs a decision).

### 20 Oct 2026 — iOS 27 Phase D4: Home Screen widgets (v1.59.0)

Tonight, This week and Shopping (`DishesWidgets/HomeWidgets.swift`), read from
the App Group database with the screens' own code (`Shared/HouseholdData.swift`,
`Shared/Format.swift`). The widget extension now links DishesCore and shares the
app's Keychain group, so a Shopping tick is sent straight away
(`ExtensionAPI.client()`; the share sheet uses it too now). Widget taps open
`dishes://widget/cook?meal=…`, `/plan` or `/shopping` (`WidgetLink`).

To add them on the simulator: long-press the Home Screen → Edit (top left) →
Add Widget → Dishes, and page through the sizes.

Checked on the iPad Pro 11" simulator against the dev server: the gallery
showed all seven sizes with real data (tonight's carbonara, the week's dinners
with today picked out, 15 items to get); Tonight and Shopping on the Home
Screen; ticking Broccoli on the widget checked it on the server within a few
seconds and the widget showed 14 left (put back by hand); the cook link opened
cooking mode on the carbonara.

Found on the way: amounts came through raw ("300.000 ml") until `Format` was
shared, and the medium Shopping widget's header was pushed off by a fourth row.
In dev, a widget tap that cold-launches the app opens it without
`-DishesDevServer`, so it lands on Sign in — relaunch with `sim.sh`.

**Not checked:** the tinted and clear Home Screen styles, the Lock Screen
slots, StandBy, a device build (the widget extension now needs the Keychain
group on its provisioning profile).

### 20 Oct 2026 — iOS 27 Phase D5: the server as a LanguageModel (v1.60.0)

`DishesServerModel` (`DishesCore/AI`) is a FoundationModels `LanguageModel`
whose executor sends the session's transcript and schema to the new
`POST /api/v1/ai/respond` and streams the text back, so a job falls back with
its own prompt and `@Generable` type. Cook assist's fallback uses it
(`CookAssist.onServer`), so the app no longer calls `/cook-assist`.

Checked: `DishesServerModelTests` run a real `LanguageModelSession` against a
stubbed `/ai/respond` (a plain answer, a `ConceptList` decoded from JSON, and
cook assist's fallback — what's sent and what comes back); curl on the dev
server for 400, 422 (no key) and 429 (the 31st call in a minute).

**Not checked:** a real answer from OpenAI (no key on the dev household),
streaming a long answer through the session on the device.

### 20 Oct 2026 — iOS 27 Phase D6: drag to reorder, photo prefetch, MetricKit (v1.61.0)

- Shopping: drag within an aisle or onto another (`ShoppingReorder`, the iOS 27
  `reorderable` / `reorderContainer`); `shopping_item.update` takes `position`
- `ImageCache`: recipe photos ahead of the scroll on the shelves, the grid and
  the cookbook; `RecipeImage` draws from it
- `Diagnostics`: MetricKit's diagnostic reports to `POST /api/v1/client-error`
  (Settings → Crash reports on the web), labelled with what the app was doing
- The Shopping widget's aisle setting lists the list's own aisles (they're
  free text: the seed has "Meat & Fish", the app's list has "Meat" and "Fish")

Checked: `ShoppingReorderTests` (within an aisle, across, to uncategorised, a
drop in place, clashing positions); both crash routes by curl into
`client_errors` (rows removed after); the app launches and runs with MetricKit
started.

**Not checked:** a real drag (the simulator's drags don't lift), prefetching
with real photos (the seed has none), a real MetricKit report (none in the
simulator), the planner's ordering within a day (not built: meals have no
order field).

### 21 Oct 2026 — Loose ends: plan sheet, photos on the server model, a day's order (v1.62.0)

- Plan sheet: "Draft 7 lunches", and a disabled gradient button now looks
  disabled (it was "Draft 0 dinners" at full colour). The "unselected pill"
  seen before was a lagging screenshot, not the app
- Photos through `/ai/respond`: the scan and share fallbacks run `RecipeReader`
  on `DishesServerModel` with the pages attached, back as a draft (iOS 27)
- A day's meals in the order you drag them: `position` (migration `0045`,
  applied to the dev database by hand), `meal_plan_day.reorder`, both planners
  sort by it

Checked: `DishesServerModelTests` (a scanned page goes with its JPEG and comes
back as a draft); the reorder mutation through `/api/v1/sync` by curl, then the
app showing Sunday as risotto, shakshuka, salad (positions put back after).

Simulator screenshots from the control tool can lag by several seconds — use
`xcrun simctl io <udid> screenshot` when a check depends on it.

**Not checked:** a real drag on the planner (the simulator can't), a photo read
by the household's AI for real (no key in dev).

### 21 Oct 2026 — Phase C leftovers: hands-free, Health, shopping trip, Handoff (v1.63.0)

- **Hands-free cooking:** the mic in cooking mode (`HandsFree.swift`,
  `CookCommand` in DishesCore with tests). The simulator has no
  `SpeechTranscriber` for en-GB, so it falls back to `DictationTranscriber`,
  then deadlocks CoreAudio ("Initialize: RPC timeout") — the simulator's
  microphone, not the app. Check on the iPad
- **Apple Health:** Settings → Apple Health, the portion chips on the log
  sheets, `HealthLog.swift`. Asking for `HKCorrelationType(.food)` throws
  ("Authorization to share … is disallowed") — ask for the eight nutrients
  only; a save asks again if any of them is undecided. Synthetic taps don't
  flip a SwiftUI `Toggle` in the simulator; a short swipe across it does
- **Shopping trip Live Activity:** "Shopping trip" on the list. The tick
  buttons run `TickTripItemIntent` in the app, with the app in the background
  (locked) — where the shared store is suspended, so the handler goes through
  `AppModel.awake` (without it: "SQLite error 4: Database is suspended").
  Reinstalling the app ends running activities, and a stale cooking activity
  can sit on top of the stack and hide the others
- **Handoff and universal links:** `DishesLink`, the associated-domains
  entitlement (`applinks:` and `activitycontinuation:` for
  dishes.collardserver.co.uk), `/.well-known/apple-app-site-association`. The
  server needs the Authelia bypass in the README before Apple can fetch it

Checked: `CookCommandTests`; a Health write and its removal when the cook was
deleted (the dev Greek Salad was given nutrition for it and put back after);
the shopping-trip card on the Lock Screen, a tick from it reaching the server
and redrawing the card (Broccoli unticked after); the server's "next" order
against the app's; the association file served; `DishesLink` on sample URLs.

**Not checked:** hands-free with a real microphone, the trip's APNs updates
(no APNs key in dev), universal links and Handoff (need the deployed domain and
two devices), Health on a device. The Lock Screen card's text sometimes
captures white-on-white in simulator screenshots, the cooking card too; it
draws correctly a moment later.

Uploaded to TestFlight as 1.63.0 (build 202610210831) from main, after PR #59
merged — the first upload since 1.53.0, so it carries all of Phase D too. On
the way: Xcode 27.1's account wasn't visible to `xcodebuild`, so the script now
takes an App Store Connect API key; the App IDs lacked App Groups, HealthKit
and Associated Domains until Xcode's Signing & Capabilities registered them;
and Homebrew's rsync broke the export.

### 21 Oct 2026 — Cooking mode fixes: end-of-cook crash, timers (v1.63.1)

- **Crash ending the last cook** (✕ in cooking mode, or saving the review after
  Finish): the resume bar draws once more as the last cook goes, with
  `sessions.count - 1 = -1` cooks behind it, and `CookIcon`'s `0..<min(-1, 2)`
  trapped. Found from the iPhone's own crash logs — `xcrun devicectl device
  info files --device <udid> --domain-type systemCrashLogs`, then `copy from`
  and `atos` against `build/Dishes-<build>.xcarchive/dSYMs`. The crash also
  lost the "timers cancelled" write (UserDefaults flushes later), so the
  timers came back on relaunch
- **Finishing clears the cook's timers, finished ones too**
  (`CookTimers.clear(dishes:)`); before, a meal's Finish left the ones that had
  gone off
- **One timer per step:** `CookTimers.start` answers whether it started one; a
  step whose timer is going gets pointed to instead (Siri and hands-free say
  so). The step's button turns into that timer's countdown
- **Starting a timer shows:** it slides into the iPhone strip, which scrolls
  along to it, and glows for a couple of seconds (`spotlight`); a success haptic

Checked: built and launched on the iPhone 18 Pro simulator. **Not checked:**
the flows by hand on a device — needs a new TestFlight build.

### 21 Oct 2026 — Recipe page tidy-up, tappable badges (v1.64.0)

Same changes on the web's `/recipes/[id]`.

- **Heart-healthy badge** in the nutrition line: `ViewThatFits` tries the
  row with the full "Heart-healthy" pill, then with just a heart, so it no
  longer wraps onto two lines on an iPhone (the web hides the word below `sm`)
- **History line** is one short line: "Cooked 3×, last today · Planned 2×"
  (the last-planned week is gone — `RecipeExtras.lastPlannedWeek` removed)
- **Log a cook** left the rating row; it's in Cook history and the More menu
  (on the web, the History tab is always shown and has the button; the
  rating-row button only appears for a "Review later" landing)
- **Servings** read "4" beside the people icon; a unit that isn't people
  ("12 muffins") keeps its word (`servingsText`, web `servingsUnitLabel`)
- **Cuisine and difficulty badges are tappable:** `AppNav.recipeTag` switches
  to Recipes, pops its stack and shows the grid filtered to that cuisine or
  difficulty (web: links to `/recipes?cuisine=…` / `?difficulty=…`)

- **Planner decluttered:** the "N meals · time cooking" line is gone; the
  orange + is a menu (Add meal, Generate plan…, add the week to the shopping
  list) instead of the two gradient buttons; the next-order and nutrition
  banners are small pills under the week title (`PlanWeekStrips`). The order
  pill hides once it's ordered with nothing left to do; the web's nutrition
  panel only opens from its pill now (no longer remembered open per device)

Checked: built and opened on the iPhone 18 Pro simulator (Planner header only:
the notification prompt covered the rest); web checked at phone width, the +
menu's Add meal and the nutrition pill. **Not checked:** the order pill and a
filled-in heart pill — the dev data has no deliveries or nutrition figures.

### 21 Oct 2026 — Tonight's meal, once it's cooked (v1.64.1)

Same on the web's Recipes browse banner (`getTonight`, `recipes/page.tsx`).

- **Cooked counts from the cook log:** a meal is cooked when every dish with
  steps (every dish, if none has any) has a `cookHistory` entry today with
  `isCook` — a rating alone doesn't count. Derived, so deleting the cook
  brings Cook tonight back (`PlannedMeal.isCooked`, `PlanData.cookedToday`)
- **`PlanData.tonight(cooked:)`** picks the meal: dinner (or the last meal
  today) until it's cooked, then the next meal after it with steps still to
  cook (dessert), else the cooked one, flagged
- **Cook tonight pill** (`TonightMeal.load`) goes once it's cooked; the
  **Tonight card** turns emerald, ticked, "View recipe" instead of Start
  cooking; the **Tonight widget** goes green with only Planner
- **Still cookable on request:** Siri's "cook tonight" and the Watch use
  `TonightMeal.loadAny` (the next to cook, else tonight's anyway); a dinner
  reminder's cook link and a widget set to a meal type ignore the cook log

Checked: built for the iPhone 18 Pro simulator with a cook logged for
tonight's dinner (card green, no pill); web banner checked the same way.


### 2026-10-21 — tidier cook-history cards (v1.64.2)

`CookEntryCard` (recipe page's Cook history and the History screen):

- **Date on its own line**, one line only; rating as a compact `★ 5` and a
  small borderless ⋯ pinned top-right (tap still edits, long-press still
  gives the menu)
- **Time and occasion** as one muted text line (`20 min · Family dinner`)
  instead of a clock label and a truncating badge
- **Who ate it** as one muted line of first names (full names if two share
  one), each person's own rating in amber after their name; no chips

Checked on the iPad Pro 11-inch simulator with seeded cooks (two columns,
menu and tap-to-edit both work) and the iPhone 18 Pro (one column, menu works).

### 2026-10-22 — a refused push no longer freezes the device (v1.64.4)

A phone stuck on "can't reach the server" stopped seeing anything new (an
iPad's cook never turned its Tonight card green). It held a mutation with a
"temp-" id from before v1.64.3. The server rejected the whole batch with a
400, and `SyncEngine.run()` stopped after the failed push, so it never pulled.

- **Server** (`/api/v1/sync` POST): each mutation is validated on its own. A
  malformed one comes back `failed` and the client drops it, like any other
  failed mutation. Deploying this unsticks an affected phone on its next sync,
  with no app update.
- **iOS and `packages/client`**: a push the server answers with an error no
  longer skips the pull. Transport errors and sign-out behave as before.
  Test: `SyncEngineTests.aRefusedPushStillPulls`.

### 2026-10-24 — holidays on the planner, booking reminder setting (v1.65.0)

- **Planner**: `deliveries.weekPanel` now returns `away` (holidays overlapping
  the week). A day in one gets a sky-blue tint and a plane in the day strip,
  and an `AwayDayChip` ("Away · Cornwall") with its other chips (selected day
  on iPhone, each column on iPad). Older servers leave `away` out.
- **Deliveries → settings sheet**: "Book a delivery" picker (off, or 2–7 days
  before) saved as `bookingReminderDays`.
- **Notifications**: the new `delivery_booking` type gets the calendar icon.

Built for the iPhone 18 Pro simulator; the web side was checked in the browser.

### 2026-10-26 — Deliveries refreshes itself (v1.65.1)

A "Sainsbury's order confirmed" banner arrived while Deliveries was open, but
the screen kept showing "To order" until pulled down. Screens loaded straight
from the server (`WebPage`/`Remote`) only loaded once, on first appear.

- `AppModel.serverRevision` ticks when a push is shown with the app open
  (`willPresent`, server pushes only), after a silent push's sync, and on
  becoming active. Every `WebPage` reloads on it, and so do the planner's
  delivery chips (it's part of `extrasKey`).
- Deliveries also reloads every 60 s while it's open, for an order that
  lands without a push to this device.
- The app syncs every 60 s while it's on screen (`AppModel.startTicking`,
  stopped in the background, skipped offline or while backing off), so
  Shopping, Plan and Recipes pick up the rest of the household's changes
  without a pull-to-refresh. The server only pushes for notifications.

Built for the simulator; not checked against a real order push.

Uploaded to TestFlight as 1.65.1 (build 202610262133) from main, after PR #67
merged. `~/.appstoreconnect` had gone, so the archive first fell back to
Xcode's account ("No Accounts"). Key `5MW9DFM34T` archived but couldn't export
("Cloud signing permission error", no "iOS Distribution" certificate): it
isn't an Admin key. Admin key `82B45L27K9` uploaded the same archive
(`ARCHIVE=build/Dishes-202610262133.xcarchive`), and `dishes.env` now names it.

### 2026-10-27 — Meals eaten out (v1.67.0)

Written in a cloud session with no Swift toolchain (swift.org is blocked
there), so none of this has been compiled or run. Build and test it before
anything else: `swift test` in `Packages/DishesCore`, then the app on the iPhone
and iPad simulators. The server side (v1.66.0) was tested end to end on its own.

- **DishesCore**: `SyncCollection.outsideMeals` and `OutsideMeal`
  (Entities.swift). Store migration `v2-outside-meals` clears the records and
  the cursor once (not the outbox), so the next sync is a fresh snapshot — a
  store from before this build pulled past the first meals out without a
  table for them. Whichever process opens the database first after updating
  runs it (a widget can), and the app's next sync fills it again.
  `APIClient` gains the `/api/v1/outside-meals` calls, all with
  `estimate=false`: the app uploads its photos, then asks for one estimate.
  Tests: `OutsideMealTests` (decoding, odd values, the one-off resnapshot
  keeping the outbox, a pull storing them).
- **Planner**: "Ate out?" / "Not cooking?" chip on a day (gone once dinner has
  a meal out; its dinner-time chip goes too), "Not cooking — eating out…" in
  the + menu, a fork-and-knife on the day pill, `OutsideMealCard`s above the
  day's meals (compact ones in the iPad week columns), and a "not counted" line
  under a recipe still planned in a taken slot. Plan generation starts with
  nights out unticked. The nutrition strip reloads when the week's meals out
  change (it's the server's, which counts them).
- **OutsideMealSheet** (Plan/): the web sheet's fields. A menu photo is read
  on the device by Vision (`RecipeReader.text`) into the "From the menu" text,
  to trim to the dish — no on-device model job, so no evaluation needed. Save
  → photos → `POST …/estimate`, then the figures and what they count towards.
- **Tonight**: `PlanData.cookable` leaves out meals in a slot a meal out has
  taken, and `tonight`/`today` use it — widgets, the Tonight card and Siri no
  longer say "start the lasagne" on a night out. The Tonight card says
  "Tonight · Eating out" instead; "What's for dinner?" answers "You're eating
  out tonight, at The Swan."
- **Health**: `HealthLog` writes nutrient values, not just a `Recipe`. A meal
  out is written from the device that logged it (`loggedHere`), when its
  estimate is in: `reconcileOutside` runs after each sync that pulled
  something and writes, rewrites (the figures changed) or removes the entry.
  Removing the meal on this device removes it. One entry, the whole portion,
  at a usual hour for the meal type.

To check on a device: a meal out logged with a menu photo (Vision's text,
then the estimate), the Tonight card and Siri on a night out, the Health entry
appearing after the estimate and going when the meal's removed, and an update
from 1.65 keeping unsent changes through the resnapshot.

Uploaded to TestFlight as 1.67.0 (build 202610271707) from
`fix/ios-recipes-browse-try` (PR #70). Main didn't compile: splitting the guard
in `RecipesBrowse.swift` (Tonight's load) had dropped its `try`, and
`PlanData.cookedToday` throws.

### 2026-10-27 — Courses on a meal out (v1.68.0)

A meal out is one sitting; it can now hold courses (starter, main, side,
dessert, drink) in `outside_meals.courses` (migration 0048).

- **Model**: `OutsideMeal.Course` (eating order, unknown types dropped),
  `coverPhotoUrl` (the plate, else the first course photo), `usesMenuKcal`.
  The meal's figures stay the whole sitting's, so `HealthLog` is unchanged.
- **API**: `OutsideMealWrite.courses` — nil leaves them (plans, skipped),
  `[]` sends null (one dish again). Course photos go to
  `…/photo?slot=course&course=<id>` after the meal is saved.
- **Sheet**: "More than one course?" with + Starter / Main / Side / Dessert /
  Drink; a tinted card each with its words, menu kcal and photo. With courses
  the meal-level kcal is hidden and the plate photo becomes "the table" (only
  if one's set). The result lists each course's name and kcal, and a failed
  re-estimate now says so above the old figures.
- Tests: `OutsideMealTests.coursesComeBackInEatingOrder`,
  `aWriteSendsCoursesOnlyWhenTheFormHasThem`.

Checked in the iPhone 18 Pro simulator against the dev server: courses load
on the sheet, the card shows "3 courses", an edit keeps unchanged courses'
estimates and the result view lists them. Not checked: a real AI estimate (no
key locally) and course photo uploads (no storage locally).
