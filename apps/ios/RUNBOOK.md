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

When an entitlement is added (Push Notifications in v1.32.0), the cached
profile lacks it, and `xcodebuild` started outside Xcode fails with "No
Accounts" even though Xcode is signed in. Press Run once in Xcode with the
device selected; it regenerates the profile, and command-line builds work again.

## TestFlight

```bash
apps/ios/scripts/testflight.sh            # archive (Release, app + widgets) and upload
UPLOAD=0 apps/ios/scripts/testflight.sh   # archive and export an .ipa only
```

- Run it from your own terminal: it signs with the Apple account in Xcode
  (team C729B84RYG, automatic signing), which a sandboxed shell can't see.
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
