# Dishes

A self-hosted, family-oriented recipe management and meal planning app. Mobile-first, AI-assisted, and designed to run as a Docker Compose stack alongside existing home server infrastructure.

![Mobile recipe view](setup_guide/mobile-recipe-example.png)

---

## Features

- **Recipe library** — create, edit, search (by title, tag, or ingredient — e.g. "chickpeas" finds every recipe that uses them), and filter recipes by cuisine, tag, difficulty, time, and favourites. Filters (including role) live in one panel opened from the Filters button in the search box (a bottom sheet on phones, a side drawer on wider screens), with type-to-find pickers for cuisines and tags that suggest the most used ones first; active filters show as removable chips under the search box. Cuisines and tags match case-insensitively, so "British" and "british" are one option. On a recipe page, tap the cuisine or difficulty badge to see the other recipes that share it. Multi-select mode supports bulk actions: add tags, remove tags, and add or move recipes into a collection (creating the collection inline if needed)
- **Recipes is the front page** — there's no separate Home: with nothing searched or filtered, Recipes opens on browse mode — tonight's meal with Start cooking (or a way to plan one; once a cook is logged for it today it turns green and ticked with View recipe, or moves on to a meal still to cook, like dessert — and the iPhone's Cook tonight bar goes), quick chips (All, Favourites, top cuisines) and shelves you scroll sideways: Favourites, Cook again (with when you last made it), Suggested for you, Recently added and your top cuisines. "See all" on a shelf opens the grid with that filter or sort (there's a "Recently cooked" sort too); the All chip shows the whole library as a grid, and clearing the filters goes back to the shelves. The same on the web and in the iOS app, whose tabs are Recipes, Planner, AI, Shopping and Settings (the web's phone nav matches, with the AI button in the middle). On a phone, Settings → Kitchen and insights links to Pantry, Saved meals, Collections, Memories, Notes, Shared with me, Stats and Wrapped
- **Cookbook (iOS)** — read your recipes as a real book: a cloth cover with the household's name, contents, a chapter per cuisine, an index, and page-turn animations. A recipe that fits takes one page opposite its photo (ingredients beside the method, serif type); a long one gets a full-page photo, then the method over the page. The pages look used — aged paper, and stains that build up with how often you've cooked a dish (flour on baking, gravy on roasts, a coffee ring) — and the household's real notes are handwritten in the margins, each member in their own hand and ink, with tally marks for every cook, the date it was first made, a scribbled heart for favourites and your star rating. Open it from the Cookbook button on Recipes (it binds whatever you've searched or filtered), or on an iPhone Duo just half-fold it like a book and it opens by itself
- **Recipe roles and accompaniments** — label recipes as Main, Side, Sauce or Extra from the recipe page (tap the role badge beside the cuisine — "Set dish type" when there isn't one) (or the editor), see roles on recipe cards, and filter the library by role. Ask AI to generate a new side dish for a recipe, a combined meal, or from the concierge — five ideas, then a full recipe already marked Side. Saved meal editing, combining planned dishes and existing combined meals can also suggest accompaniments from your library, with optional context and a reason for each pairing. Automatic weekly planning keeps designated accompaniments out of standalone meal slots
- **Recipe page on wide screens** — on a laptop or desktop (1280 px and up) the recipe page splits in two: the photo, title, badges, rating, Start Cooking, nutrition and description on the left, and Ingredients, Steps, Notes and History as tabs on the right, so both are in view without scrolling past the photo. Narrower screens keep the single column with the Overview tab
- **Structured ingredients** — ingredients stored as structured data (name, amount, unit, preparation) enabling smart scaling, consolidation, and AI reasoning
- **Recipe sections** — group both ingredients and steps into named sections (e.g. a granola component vs a smoothie component) in the editor, with drag-and-drop to reorder rows and move them between sections; sections carry through to the recipe view, cooking mode, print, share, and export, and AI generation uses them automatically for multi-component recipes. Sections themselves can be dragged to reorder, dragged rows follow the pointer as a floating card, and emptying a section leaves it in place — sections are only removed explicitly
- **Cooking mode** — fullscreen step-by-step view with large text, embedded countdown timers, ingredient highlighting, and wake lock (prevents screen sleep). Finished timers chime audibly (repeating until acknowledged), vibrate on supported devices, and pop up an alert card showing the step they belong to with a jump-to-step shortcut; active timers in the sidebar and mobile shelf show a preview of their step. The in-cook AI quick-ask sees the whole recipe — every ingredient and step, scaled to your serving count — so it can answer about what comes next, earlier steps, or leftover quantities, not just the step you're on
- **Add to shopping list mid-cook** — every ingredient in cooking mode's checklist carries a cart button. Notice you're running low on something while you're using it, tap once, and it goes on the household's active shopping list (created if there isn't one) at the amount this cook is actually using — the scaled figure shown next to it, not the recipe's original. Ingredients already on the list are marked as such before you tap, which is the usual case when the meal came from the planner, and tapping one tops up its amount instead of adding a second row — the same name-and-unit matching the shopping list generator uses. A ticked-off item is treated as bought, so needing it again starts a fresh line. Pantry staples are not skipped here, unlike list generation: tapping the button is an explicit "I've run out of this"
- **Minimise cooking mode** — "Minimise" shrinks a cook to a persistent bar so you can check the shopping list or another recipe without losing your place. The bar shows the recipe, your step, and the next timer counting down; tap it to drop straight back in. Timers keep running while minimised and their alerts follow you anywhere in the app. Sessions are deadline-based, so they stay accurate through a backgrounded tab or a page reload, and survive a refresh (abandoned cooks are cleared after 12 hours). "Exit Cooking Mode" still ends the cook outright
- **Multiple cooks at once** — dinner and dessert can both be in progress. Each cook keeps its own step, servings, ticked ingredients and timers, and a switcher in the cooking-mode header jumps straight between them showing each one's step and next timer. Timers fire wherever you are, including while a different cook is on screen, and the alert names the dish it belongs to; the mini bar shows the cook in front plus a "+N more" count
- **Recipe scaling** — change serving count and all ingredient amounts recalculate with smart fraction and unit handling
- **Shopping lists** — auto-generated from recipes or meal plans, with ingredient consolidation, category grouping, and manual additions. Items can be edited inline (quantity, unit, name, notes), and those pulled from a recipe link back to it — an item consolidated from several recipes shows every contributing recipe ("from X +2 more"). Consolidation matches ticked-off rows too: once something is in your basket it stays there, so adding another meal that needs it records the extra recipe against the existing line instead of putting a finished shop back on the list. The add field suggests as you type, on the web and in the iPhone and iPad app: things the household has put on a list before (the most often and most recently bought first) and then ingredients from its recipes. Pick one with a tap, or with the arrow keys and Enter on the web, and it goes on with any quantity and unit you've typed — and back into the aisle it was filed under last time, unless you've chosen one. Suggestions come from the data already on the device, so they work offline
- **Meal planner** — weekly view that fits the screen: on a phone the days fold up with today open, on an iPad in portrait the day list sits beside the open day, and on a wide screen the whole week is a grid of days and meal slots ("+ Add dinner" where one is missing); navigate between weeks and generate shopping lists from the whole plan. Move a meal to another day by dragging it onto another day or from its menu — including into the next or previous week: "Move to… → Next week / Previous week" picks any day there, and while dragging, the week arrows become drop targets for the following Monday / previous Sunday. A toast confirms the move with a "View" link that jumps to the meal's new day. "Generate plan" and adding the week to the shopping list live in the + menu beside the week arrows, with "Add meal". Under the week title, two small pills show the next grocery order (only while it has something to do) and the week's heart-healthy count with any suggested swaps; tap one for the details. Slots already added to the shopping list show an "On list" badge, which now only appears when ingredients actually reached the list. Adding a meal reports what happened — how many items were added or topped up, and which ingredients your pantry already covers — with an "add them anyway" override for the skipped ones. Adding a meal lets you filter the library by the slot's meal type, by favourites, and by whether a recipe is a main, side, sauce or extra — the meal-type buttons choose the slot and, with “Suited to dinner” on, only list recipes marked for it. The AI weekly planner respects each recipe's **suitable meals** so breakfast slots get breakfast food, not reheated dinners. In the AI plan preview, tapping a meal opens a preview modal (library picks show their photo, time, servings, calories and ingredients; new dishes show the concept) with Swap and Remove buttons right there. You can also swap a single meal from the list, or untick a few and "Redo unticked" — only those are regenerated, with the rest of the draft passed in as context so the week stays balanced. Planning part of a week (say Friday–Sunday after planning Monday–Thursday) takes the meals already on the planner into account — their cuisine, calories, saturated fat and fibre — and counts them towards the heart-healthy weekly targets instead of treating the new days as a separate mini-week
- **Combined meals** — plan a meal made of several recipes (a Sunday roast: the meat, roast potatoes, cabbage, carrots and gravy) as one card on the planner. Each dish keeps its own recipe and has a role (main, side, sauce or extra). Swap one dish for this week only, add a dish, change roles, set servings for the whole meal, move or drag the whole meal to another day, add all of it to the shopping list in one go (consolidated like a week), or split it back into separate dishes. Combine dishes already on a day with "Make into a meal…", or add a **saved meal** from the "Saved meals" tab in the add-meal picker. A saved meal's dishes can each have **options** — one "Sunday roast" whose meat is chicken, pork or beef and whose veg is any of broccoli, carrots and peas — so you don't need a saved meal per combination: adding it opens a quick chooser with last time's picks already ticked, and the planned meal shows one-tap chips to swap the meat or toggle a veg. Save any planned meal for reuse, fold this week's version back into the saved meal (new dishes are added, nothing is removed), and create or edit saved meals — dishes, options, "pick several" — on the Saved meals page (linked from Recipes). A meal's time shows its longest dish, since the dishes cook side by side. Integrations responses tag each dish with its `mealGroup`
- **Cooking a combined meal** — "Cook this meal" on a planned meal starts every dish's cook at once (each scaled to the plan's servings) and opens on the main. Cooking mode then shows a tab per dish with where it's up to and its running timer, so switching between the chicken, the potatoes and the gravy is one tap; a tab pulses when that dish's timer finishes. A "Rest of the meal" panel lists the other dishes' timers with start/pause/reset, so you can manage them without leaving the dish on screen
- **Meal cooking schedule** — give a combined meal a "ready by" time (a dinner defaults to that day's dinner time) and "Timing" on the meal card shows what to start when, worked back so every dish finishes together: e.g. 13:50 chicken in, 15:05 potatoes in, 16:00 serve. The simple schedule runs each dish's steps back to back and warns when two dishes want the oven at different temperatures; "Plan with AI" (needs Settings → AI) plans a smarter one — overlapping prep with hands-off roasting, sharing the oven, resting the meat — always pointing at your recipes' own steps, and it's kept until the dishes change. Every dish finishes at the end: a dish's last step that only serves it ("Carve and serve", "Garnish with parsley") is part of the one Serve step at the serve time, which lists each dish's serving step, and a finishing step such as carving never comes before the cooking ahead of it has finished. With dinner reminders on, each step arrives as a push notification at its time (plus a heads-up before the first), replacing the single "start cooking" reminder for that dinner. In cooking mode each dish's tab shows its next step time, a "Now / next" strip under the tabs jumps straight to that dish and step, and the sidebar shows the whole schedule against the clock. Starting a scheduled meal on its day asks when you started ("Schedule says start Mushroom Risotto at 08:20 for 17:00"), with Start now or I started earlier at…; a start more than a few minutes off offers to move dinner by the difference — the serve time (or that day's dinner time), every dish's cues, the push reminders, the Lock Screen Live Activity and the planner's dinner chip all follow, and cues already past aren't re-sent — or to keep the serve time, which moves only the first dish's steps on that device. Started early, cooking mode opens that dish on the step the schedule has it on by now; after that it never moves your step for you. "Started at a different time…" (on the schedule strip, and in the ⋯ menu on iOS) asks again mid-cook
- **Timer alerts when you're away** — a cooking-mode timer that finishes while the phone is locked, Dishes is in the background or the app is closed arrives as a push notification ("Roast potatoes — timer done · Step 4"); tap it to go straight back to that dish. While the app is on screen the in-app chime handles it instead, so you never get both. Works per device (opening Dishes on a laptop doesn't cancel the phone's timers) and survives a server restart mid-cook. Needs notifications turned on for the device in Settings — cooking mode shows a hint under a running timer if they aren't
- **Meal-type tagging** — every recipe can be marked as suiting one or more meals (breakfast/lunch/dinner/dessert/snack); the AI sets this automatically when generating, editing, or scanning a recipe, and an admin "Tag recipes by meal type" maintenance action backfills the existing library
- **AI recipe concierge** — describe what you want, get 5 concept cards, pick one, and the app generates a complete structured recipe. A “Kind of dish” choice (or asking in the box, or the Side dish quick prompt) generates a side, sauce or extra instead of a main, and the saved recipe is marked with that role. Suggestions adapt to who's eating, so picking a young child yields simple, mild, age-appropriate ideas rather than full dinners. Generated recipes are filed into an existing collection automatically when one is a clear fit — batch-saved recipes show which collection they landed in, and a single recipe shows the suggestion on the form where it can be dropped before saving. An optional **"Check recipes against the web"** setting (Settings → AI) has the AI look up a few published versions of the dish before writing the full recipe, to keep proportions, temperatures and times realistic; the sources are credited on the recipe ("Inspired by …" link plus a list in Notes). Generation runs on the server, so you can leave the page while it works: a card in the corner follows you round the app with its progress, then offers the finished recipe (Open), the ideas (View ideas — the concierge comes back as you left it), a Plan My Week draft (View plan — the plan tab comes back with its choices and the draft) or, for several recipes at once, says they've been saved
- **Recipe photos** — upload images to MinIO/S3; shown on recipe cards and detail pages. AI image generation supports selectable styles (studio, moody, rustic, and more) plus free-text custom instructions per shot (e.g. "just a slice with a fork, not the whole cake"). On a recipe page, generate a photo where there isn't one, or replace one with **New photo** on the image (also under Ask AI)
- **Household model** — multi-member households with role-based permissions (admin / adult / child); all data is household-scoped
- **Pantry** — staples list (always-available ingredients excluded from shopping lists) and current stock tracking, automatically updated when cooking is completed or a shopping list is archived. The pantry page has search, a multi-column layout on wide screens, quick-add forms at the top of each section, inline editing of stock items, multi-select bulk delete with per-section select-all (clear a whole section — or the whole pantry — in a couple of taps), and A–Z / recently-added sorting for stock. The sidebar shows a live stock-count badge
- **Recipe sharing** — public share links with a magazine-style page: split hero with large photography, sticky ingredients card, step-by-step method cards with timer chips, per-serving nutrition, and Open Graph metadata so links unfurl with the dish photo in chat apps
- **Memories** (`/memories`) — every photo you've taken while cooking, in two views: a polaroid scatter with hand-placed tilt, and a borderless wall that lays photos out as a masonry at their own aspect ratio, so landscape and portrait shots aren't cropped to squares. The wall shows nothing but the pictures until you hover, when the dish name and rating fade in; tapping any photo opens it with the date, occasion, who you cooked for and your notes
- **Shared libraries** — open part of your recipe library to another household on the same instance. Scope it to everything, to named collections, or to named tags, and add a list of tags to hide on top of any of those (exclusions always win, even over a shared collection). They accept a one-time invitation link, after which the library appears permanently under **Shared with me**: they browse it read-only, take a copy of a single recipe, or multi-select several and get them filed into a "From <household>" collection. The grant is live — recipes you add later that match the scope simply appear — and either side can end it at any time, leaving already-copied recipes in place. Your meal plans, shopping lists, pantry and private recipe notes are never exposed
- **Import from a website** — New Recipe → **Import from web**: paste a link to any recipe page and the form fills in with the title, description, ingredients (split into amount, unit and preparation, with sections), method, times, servings, published nutrition, a source link and the photo, ready to check before saving. Most recipe sites publish schema.org recipe data, which is read directly and needs no AI; when the household has an AI key it also tidies the ingredients, adds step timers, cuisine and meal types, and reads pages that don't publish recipe data at all. The photo is copied into your own storage rather than linked. The importer only fetches public addresses — never anything on the server's own network. To send pages from the browser, add a bookmarklet: `javascript:location.href='https://dishes.yourdomain.com/recipes/new?importUrl='+encodeURIComponent(location.href)` (the installed PWA on Android appears in the share sheet itself). In the iPhone/iPad app it's New Recipe → **From a website…**, and **Dishes is on the share sheet**: share a recipe page from Safari (or a link from any app) and pick Dishes — it's imported and saved there and then, and shows up in the app on its next sync (open the app and sign in once after updating so the share sheet can use your sign-in)
- **Crouton import** — Settings → Import → "Import from Crouton" reads a `.crumb` export, previews the recipes and imports the ones you pick
- **Add to my Dishes** — a share link doubles as an import. Anyone with a Dishes login can save their own editable copy of a shared recipe (ingredients, steps, sections, tags, nutrition and a duplicated photo) into their own household, badged "From <household>" and linked back to the original. Re-opening the same link reuses the copy instead of stacking duplicates, and revoking the link stops both reading and importing
- **Welcome wizard** — first-run tour for a new member: what the app does, then optional steps to add an OpenAI key (admins only, skipped when the household already has one) and install the PWA to the home screen, with iOS-specific instructions where the browser offers no install prompt. Re-runnable any time from Settings
- **Cook history & ratings** — log every cook with a 0–5 star rating (half-star precision), duration, who ate, what each of them thought (their own star rating), notes, occasion, and a dish photo; the app learns your actual pace over time. Ratings and notes belong to the individual cook, not the recipe — each entry's rating is the average of everyone who rated it (your own stars are recorded as your voice), the headline star rating averages those, and the recipe page shows who thinks what (e.g. "James ★ 5 · Louis ★ 1"). The AI meal planner never suggests a recipe the household rated 2★ or less overall (including when you swap or redo a meal), and when it plans for particular people it also sees their own ratings: anything one of them rated 2★ or less is left out, and dishes they rated highly are favoured — and each entry in the History tab can be edited with the same full form as the end of cooking mode (including adding, replacing or removing the photo) or deleted outright to clear duplicates. Rating a recipe from the star row without cooking it is recorded as a "Rating only" entry: it still counts towards the average rating, but not towards how many times you've cooked the dish
- **Ask AI about a recipe** — one "Ask AI" menu on the recipe page gathers the AI actions: ask a free-form question about the dish (what to serve with it, when to start cooking to eat at a given time, what can be prepped ahead, substitutions), "Tweak for tonight", "Generate a side dish", and "Find similar recipes". Questions are answered against the full ingredient list, method, and your past cooks of that recipe. Answers render as formatted markdown (headings, lists, bold), and each conversation is saved per recipe — reopen a past question to reread the answer or carry it on, delete one, or clear the whole recipe's history. Settings → AI conversation history shows how many conversations are stored and lets an admin purge them in bulk — everything, or only those older than 7/30/90/365 days, across recipe questions, cooking-mode questions, or both
- **Taste profiling** — builds a per-household preference model from accumulated cook history; scores cuisines, ingredients, and tags by recency-weighted average rating and uses it to personalise AI generation and surface recipe suggestions on Recipes ("Suggested for you")
- **Nutrition** — per-serving calorie and macro breakdown (protein, carbs, fat, saturated fat, fibre, sugar, sodium) on every recipe, shown as a calories line that opens to the full breakdown (open or closed is remembered per device), scaling with serving size. The AI fills it in automatically when generating or editing a recipe, an on-demand "Estimate nutrition" button backfills existing recipes, and values can be entered manually. The concierge accepts a per-serving calorie target and the meal planner accepts a max-calories-per-meal cap
- **Meals eaten out** — log the meals you didn't cook: eating out, a takeaway, at friends', or skipped. "Ate out?" / "Not cooking?" on a planner day (or Not cooking in the orange + menu) opens the sheet. Planned ahead, it keeps the slot free: no dinner reminder or cooking cues that day, the AI planner (and the integrations API's plan generation) leaves the slot alone, and a recipe still planned there is marked as not counted. Logged afterwards, describe what you had, paste the dish's line from the menu, add photos of the menu and the plate and say how big it was — the household's AI estimates the nutrition of the portion you ate (a calorie figure printed on the menu is used as given). Had a starter and a dessert too? Add each course (starter, main, side, dessert, drink) with its own words, menu kcal and photo: each is estimated on its own and the sitting's figures are their sum. Meals out then count everywhere a cooked meal does: the planner's weekly nutrition and heart-health protein targets (a steak out is that week's red meat — even before the AI has looked, from the words you used), Stats, and the taste profile when you rate them. Restaurant estimates are rough and are labelled as estimates. **Help me choose**: on the day (or before), give the sheet the menu (photos, a PDF, a link or the text) and say who's eating, and the household's AI suggests two or three dishes for each person. Each comes with why it suits them: their dietary requirements (never broken), what they like, this week's heart-health targets ("red meat's at its limit this week") and what they've had lately. It gives the calories when the menu prints them, a lighter tweak to ask for, and what to steer clear of. Tick what you ordered and the sheet fills in the dish, its menu line and printed calories, ready to log. In the iOS app the menu photo is read on the device first. In the iOS app too (planner chip and cards, the same sheet — a menu photo is read on the device — and Apple Health once the estimate is in; the Tonight card, widgets and Siri know you're out). Synced as `outsideMeals`; `/api/v1/outside-meals` for clients; `outsideMeals` on the integrations `today` and `meal-plan/week`
- **Stats** — a household stats page (side nav, or Settings → Kitchen and insights on a phone): meals eaten, different and new recipes, ratings and cooking time over 4 weeks / 3 months / 12 months / all time; heart-healthy share by week or month, average saturated fat, fibre and calories; protein mix per week (oily fish, pulses, red and processed meat) against cholesterol-lowering targets; most-eaten dishes and cuisines; a per-person breakdown; and "worth a look" nudges (favourites not eaten in 8+ weeks, heart-healthy recipes never tried). Narrow it to one person, and "Download PDF" saves a print-friendly snapshot (light theme, no navigation, dated, with a note that figures are estimates) — e.g. to take to a GP or dietitian. "Eaten" means planned meals whose day has passed plus logged cooks; a meal counts for everyone unless a logged cook names who ate it
- **Dishes Wrapped** — a Spotify-Wrapped-style story of your year in food (`/wrapped`, side nav, the Stats page, Settings, or a banner at the top of Recipes in December and January): meals eaten, different and brand-new recipes, your top dish and top 5, MVP ingredient (salt, oil and water don't count), favourite cuisine, busiest month, favourite day, longest streak, behind-the-scenes numbers, everyone's favourite, and a cooking personality. Full-screen slides auto-advance (tap left/right to step, hold or Space to pause, pick earlier years), and "Share this" turns a slide into a story-sized 1080×1920 PNG for the phone's share sheet (or a download on desktop) It also uses per-person ratings for each person's favourite, a "biggest disagreement" slide, the harshest critic and easiest to please, a collage and "photo of the year" from your cook photos, a quote from your review notes, and an optional AI-written recap of the year from those notes (generated on request with your household's AI key, cached in Redis)
- **Heart-healthy (cholesterol-lowering) support** — recipes with at most 4 g saturated fat and at least 3 g fibre per serving get a "Heart-healthy" badge and can be filtered on (recipes page and `GET /api/v1/recipes?heartHealthy=1`). The AI concierge has a "Heart-healthy" option that steers concepts toward suitable dishes, checks the generated nutrition against those targets and revises the recipe once if it misses. "Ask AI → Make it heart-healthy" rewrites an existing recipe with swaps (butter → olive oil, cream → yoghurt, mince → part lentils…), shows before/after saturated fat and fibre, and saves as a copy or over the original. The meal planner has a "Heart-healthy week" quick-select (oily fish twice, pulses three times, red meat at most once, scaled to the slots picked; library recipes known to be high in saturated fat are skipped and new ones are written to the targets). Members can be given a "Cholesterol-lowering" dietary toggle: the AI then keeps every dish heart-healthy when they're eating, and ticking them in the concierge or planner switches the heart-healthy option on. The meal planner shows a collapsible weekly nutrition strip (heart-healthy count, saturated fat, fibre, and the protein targets when someone is on a cholesterol-lowering diet) with **swap suggestions** when the week misses a target: each names the meal to change and a library recipe that fixes it (ranked by heart-healthiness, favourites, household rating and cuisine; recipes rated 2★ or less are never suggested), with Swap / Other ideas buttons, a 💡 marker on the affected meal and day, and an "Ask AI" fallback that proposes new dishes and writes, saves and swaps in the one you pick, plan previews mark each suggestion's heart-healthy status, and the shopping list suggests swaps (butter → olive oil, cream → Greek yoghurt, mince → 5% or half lentils, white pasta → wholewheat…) for households with a cholesterol-lowering member. Settings → Maintenance → "Estimate saturated fat" fills in the new value for recipes created before it existed
- **Dinner reminders** — opt in under Settings → Dinner reminders to get a push like "Start Chicken Katsu in 10 min — to eat at 17:00, start by 16:05". The start time comes from how long the recipe actually takes you in cooking mode (median of your recent cooks), falling back to the recipe's stated time adjusted by how far off stated times usually are for your household — an adjustment that only ever adds time, so a household that's quicker than recipes say doesn't get told to start an eight-hour roast two hours late; the slack added to a stated time is capped at 15 minutes. When the dinner is a combined meal with a cooking schedule, the planner's "start" time is the schedule's first step, the same time the reminders use. Set a usual dinner time, optional per-weekday times, the warning period and timezone; change a single date's dinner time (or skip its reminder) from the clock chip on the meal planner without touching the defaults. The notification has a "Push back 30 min" button that moves tonight's dinner and re-arms the reminder. Needs the VAPID keys below; the scheduler runs inside the web container
- **Grocery deliveries** — from Deliveries in the sidebar (also under Settings), pick the weekdays your shopping arrives and when orders close (e.g. 23:00 the day before). The meal planner marks delivery days, and a card for the next open order shows the days it has to cover (up to the next delivery or a holiday) and what's still to do: dinners not planned, planned meals not added to the list, and items not ticked off (ticked = in the online basket). Mark an order as placed, skip a week, add a one-off delivery (one-offs get the same deadline reminders as regular days), or add holidays to skip every delivery in that time (listed under Holidays & time away, where they can be edited or removed). Holidays show on the meal planner too: an "Away" pill for the week (tap it to jump to the first day away), a tinted day with a plane icon, and an "Away · Cornwall" chip on the day. Opt in to a push at chosen times on the deadline day listing whatever is outstanding, with a "Mark as ordered" button; once an order is placed you're only nudged if items are added to the list before it closes or the total is under the household's minimum order (optional, e.g. £50), plus one "last orders" reminder at the final reminder time with the slot and total. Days earlier (3 by default, set under "Remind us to book if nothing's ordered"), a "Book Thursday's delivery" push goes at the first reminder time if no order has been logged yet, so there's time to get a slot; a confirmation email arriving first cancels it. Each person turns it on with **Book a delivery** in Settings → Notifications (until they choose, it follows their deadline-reminder switch). "Send me a test reminder" pushes a preview of the next order's final reminder to the current device, and skipped reminders are logged with the reason. The page refreshes itself every minute while open (and on returning to the app), so orders marked from emails or another phone show up without a reload. Needs the VAPID keys below; uses the household timezone from Dinner reminders
- **Order emails & grocery spend** — forward your supermarket's order emails from n8n to `POST /api/integrations/deliveries/email` and the household's AI reads them: confirmations mark the delivery ordered with its slot and total, amendments update it (moving it if the slot changed day), cancellations put it back to not-ordered, and delivered/receipt emails record the final total. Matched by order number; anything else is ignored. Fix or fill in an order's slot, total and order number by hand from the planner card, the day's delivery chip or Settings → Grocery deliveries (saving marks it ordered). Totals show on Stats → Grocery spend (per order, per week, by week or month), and the next open order with its to-do list is on `GET /api/integrations/deliveries` and `today.nextDelivery` for Home Assistant. Setup steps on Settings → Grocery deliveries and in [API.md](API.md)
- **Cooking a whole meal** — a planned combined meal with a cooking schedule is cooked as one sequence: Next and Back walk every dish's steps in schedule order, each screen showing which dish and step it is, when it's due ("16:10 · in 25 min", "Now", "10 min late"), anything else due at the same time, and what's next; the whole schedule is beside it (iPad and desktop) or a tap away (phones). An AI-planned schedule can batch the same prep across dishes into one step ("Chop 3 onions — 2 for the gravy, 1 for the stuffing"), showing each dish's original step beneath. The schedule is frozen when the cook starts, so editing a recipe mid-cook moves nothing; "View a dish" reads one recipe in full and "Back to the meal" returns to your place. It ends with one review of the whole meal — its own stars and everyone's, occasion, notes, photo — plus a quick star row per dish, saved as a meal cook with each dish's own history entry, so a saved meal shows its average and its best and lowest-rated combination of options
- **Leaving cooking mode** — Exit (top left) ends the cook; for a planned meal it ends every dish at once, and the mini bar's close does the same, so a meal never leaves its dishes behind minimised. Minimise (top right) keeps the cook and its timers going in the mini bar. In the iPhone and iPad app, Exit asks whether to cancel any running timers or leave them going
- **Choose your notifications** — Settings → Notifications (on the web and in the iPhone and iPad app) lists every kind Dishes sends — meal plan ready, shopping list ready, shopping list changes, dinner reminders, cooking timers, order deadlines and order updates — each with its own switch. Choices are per person and apply to every device you use, which are listed on the same page (browsers and the app) with a button to stop sending to any of them. The iPhone and iPad app gets them through Apple Push (needs the `APNS_*` settings below); a change you've turned off still reaches the app silently, so it stays in sync
- **Household push notifications** — opt-in Web Push alerts when someone in the household makes a shared change: adding, removing or clearing shopping-list items, pulling a recipe onto the shopping list, generating the week's shopping list, or adding an AI meal plan. Every household device is notified (including the actor's other devices, so they stay in sync), and rapid bursts of changes are collapsed into a single push per household within a short window
- **Stale-paint repaint budget** — the service worker tells an open page when a cached copy it just painted turned out to be out of date, and the page repaints itself. That repaint is now capped at two per route visit, no closer than five seconds apart, with a matching cooldown in the worker. Without the cap a page whose server render is not byte-identical on consecutive requests (a relative timestamp is enough) repainted in a loop, and on iOS Safari killed the tab outright with "Application error: a client-side exception has occurred" once it passed 100 `history.replaceState()` calls in 10 seconds
- **Crash diagnostics** — when a device hits a client-side error, the browser posts the real message, stack, route and app version to the server, where it is written both to `docker logs dishes` (`grep -A 12 "client exception"`) and to **Settings → Crash reports** (admin only), so "Application error: a client-side exception has occurred" can be diagnosed from the phone that hit it rather than over SSH. On iOS 27 the iPhone and iPad app sends its crash, hang and memory reports there too, each saying what it was doing at the time (cooking, planning, shopping…). Reports that can't be delivered — the device was offline, or the page was torn down mid-send — are held locally and sent when the app next opens online. A report from an app version older than the server's is flagged as a stale bundle (a PWA left open across a deploy) rather than a bug in the screen it crashed on
- **Clean sign-in after an expired session** — when the Authelia session runs out, the app notices on its next sync, goes to the sign-in page once, and comes straight back afterwards. The service worker only caches real pages, never the proxy's redirect to the login portal, and throws away its cached copy of a page as soon as the server answers with a redirect or a 401. Previously it could store that redirect as the page and replay it after you signed in, bouncing the browser between Dishes and Authelia until it cleared itself; and an expired session looked to the app exactly like being offline, because Authelia's redirect to another domain surfaced as a network error
- **Integrations API** — JSON API with bearer token auth for n8n, Home Assistant, dashboards, and AI assistants (Grok, ChatGPT, Claude). Today's meals (with serve and start-cooking times on the household clock), the week plan, full recipes (ingredients + steps), the shopping list (add, tick off, remove), who's cooking right now with their step and timers, AI plan generation, and a diner brief (who's eating, their dietary needs and tastes, this week's protein targets and recent meals) so Claude or ChatGPT can help choose from a restaurant menu and then log what you ordered as a meal out, which the app estimates the nutrition for. A token can act as a household member, so meals out it logs are filed as theirs, with their rating. Settings → Integrations has setup for a ChatGPT custom GPT and for Claude, which gets the same tools through an MCP server (`/api/integrations/mcp`). The [Dishes Home Assistant integration](https://github.com/JamesSnaps/dishes-hass) turns these into sensors, a meal calendar, a shopping to-do list and "who's cooking" presence. **Settings → Integrations** is a full API reference: create/revoke scoped tokens, expandable docs with example requests and responses, copy-ready `curl` commands for your domain, a Try-it console that runs requests live, and a public OpenAPI spec (`/api/integrations/openapi.json`) an AI assistant can import directly
- **Client API** — a separate `/api/v1` JSON API for Dishes' own clients, authenticated as a specific household member rather than as an anonymous household token. Recipes, the full shopping list, and the meal planner (week view, assigning and moving meals, per-meal and whole-week shopping generation) are covered today; it is the groundwork for a native iOS app and for offline writes beyond the shopping list
- **Delta sync** — `/api/v1/sync` gives a client everything that changed since its last cursor, and accepts a batch of queued offline mutations back. Backed by a database-trigger change log, so every write is captured — including deletes, and anything done outside the app — and the cursor is a sequence number rather than a timestamp, so there is no clock skew to reason about. This is the foundation for local-first reads on both the PWA and a native app
- **Apple Watch app** — comes with the iPhone app. The shopping list on the wrist, grouped by aisle: tap to tick, add an item by voice or Scribble, or say "add to shopping in Dishes" to Siri on the Watch. Tonight's meal with its cooking schedule as clock times, and the cook in progress — the step and every timer counting down — **even when it's being cooked on the kitchen iPad or in a browser**: the device cooking (the iPhone/iPad app or the web's cooking mode) shares its cook through the server (`/api/v1/cooking-sessions`), and the Watch follows it read-only, so nothing on the Watch can change cooking mode and the alarms stay on the device cooking. Complications show items left to get, and tonight's next step or the running timer. The Watch never signs in: everything goes through the iPhone over WatchConnectivity, and ticks made out of range wait on the Watch until the phone is back
- **PWA & offline** — installable on mobile; a service worker (Serwist) precaches the app shell and caches pages as you visit them, so the app launches and switches between sections even on poor or no signal instead of hanging. The shopping list works fully offline — changes queue locally and sync automatically when you reconnect. Unconfirmed local changes always win over a server refresh, so ticking items off in a shop and switching between apps can't revert them. Shopping and meal plan refresh on resume (reopening the app re-fetches when online), and the shopping cache also refreshes via Periodic Background Sync where the browser supports it (Chrome/Android & desktop; iOS has no PWA background execution). A global offline indicator shows when you lose signal, opening an unvisited route offline lands on a friendly offline page instead of hanging, and the app auto-recovers from stale-chunk errors after a redeploy. Home-screen shortcuts jump straight to Shopping, Meal Plan, or the AI concierge, and recipe photos are cached for ~30 days so recipes stay readable (with images) offline
- **iPhone and iPad app (in development)** — a native SwiftUI app in `apps/ios` that keeps the household's recipes, meal plan and shopping list on the device and syncs through `/api/v1/sync`, so it works with no signal. It follows the web app's design — the same cards, colours and gradient buttons, inside the native iOS floating tab bar (across the top on iPad, at the bottom on iPhone). Tick off and add shopping items offline, add meals to the plan and page through weeks without a network, and read recipes with serving scaling; on iPad, recipes show ingredients beside the method, and in landscape the photo and details sit on the left with ingredients and method tabbed on the right, as on the web. **Cooking mode** is built for an iPad propped up in the kitchen: the step in large type, the step's ingredients and timers beside it, tap or swipe to move on, arrow keys on a keyboard case, and the screen kept awake. Timers are system alarms or notifications, so they go off with no signal and the app closed; with Dishes open they also ring through silent mode until you tap Stop. A combined meal cooks as one, with every dish's timers together. Recipes show the full nutrition panel and the household's cook history; log a cook (stars, who ate it, notes, a photo) from the recipe or when you finish cooking. Create and edit recipes, file them in collections, and move meals around the planner or plan a saved meal — planner changes work offline. While cooking, the current step and the next timer are on the Lock Screen and in the Dynamic Island as a Live Activity — tapping it opens that cook at that step. Signs in with the same Authelia account through the `dishes-mobile` OIDC client. Notifications arrive through Apple Push with their buttons — Push back 30 min and Start cooking on a dinner reminder, Mark as ordered on a delivery reminder. A combined meal on the planner opens as one, and on the day it's cooked its schedule can go on the Lock Screen as a Live Activity: the next step and a countdown to it, updated by the server as each step comes due. Cooking mode in the app now matches the web's: the ingredients a step names are picked out in its text (tap one for its amount in a tooltip, as on the web — tapping the text no longer moves on) and in the list (following the step's section when the recipe has them), the dish's photo and a servings stepper that rescales every amount, timers of your own alongside the steps' ones, ← → and space on a keyboard, and Minimise to go back to the app with a resume bar while the cook and its timers carry on. Several cooks can go at once (dinner and a dessert): starting another keeps the first, the resume bar shows the cook in front with the others stacked behind it, and tapping it fans them all out — each with its step (or place in the meal), next timer or due time, and a close — to pick one; in cooking mode a switcher (the title menu on iPhone) jumps between them. Cook tonight and the planner's Cook resume a meal already cooking, and cooks in progress survive the app being closed for up to 12 hours. Finishing a cook opens the same review as the web — how long it took (updating the recipe's cook time when it's well out), your rating, who ate and what they thought, the occasion, notes, a photo with the AI's feedback, marking ingredients used from the pantry, or Review later — and clears that dish's timers; any cook in a recipe's history can be edited or deleted. The household's AI works in the app too: Create with AI (describe a dish and tick any of five ideas — several are written out one after another — or choose "I know what I want" and name the dish; or photograph a cookbook page; ticking someone on a cholesterol-lowering diet switches Heart-healthy on, here and in Generate plan, as on the web), Generate plan on the planner (a draft week to trim before adding — on iOS 27 drafted on the device from your own recipes, favourites and cook history, offline, then added through the household's AI as before), and Ask about this step in cooking mode, with the answer streaming in (on iOS 27 it's answered on the device when it can, offline, and by the household's AI otherwise) — each conversation is saved as you go, carries on if you close it and come back, and earlier ones for the step (from the app or the website) show above it. The rest of the website is in the app as well: the pantry (staples and stock, and adding ticked shopping items to it), deliveries (delivery days and deadline, holidays, one-offs, order details and reminders), saved meals, notes, Stats, Wrapped and the taste profile, the household (members, roles, diets and dislikes), recipe links and shared libraries, and AI settings. A recipe's ⋯ menu has the AI tools — improve it, make it heart-healthy, similar recipes, a side, a photo (pick a style and add your own instructions, as on the web; it's made in the background), nutrition — plus share and add a note; Recipes has the web's filters and sorts, and New Recipe can read a recipe in from a website, a photo, or pages scanned with the document camera (a two-page recipe in one go) — on iOS 27 with Apple Intelligence a photo is read on the device itself, offline and with no AI key, and opens in the editor to check before it's saved (the server estimates its nutrition afterwards); without it, the household's AI reads and saves it as before. Recipes shared to Dishes from Notes, Messages, a caption or a screenshot are read the same way — on the device first, with a preview to check and save from the share sheet (links still go to the server, which reads the page's recipe data). The recipe editor takes pasted ingredients and method, read on the device too, and typing "500g beef mince" on the shopping list fills in the amount and unit; Settings → AI says what this device reads itself; and a meal on the planner has its cooking schedule (ready-by time, what to start when, or planned by the AI) and can be saved as a saved meal. The chosen day on the planner shows its dinner time and when to start (tap to change that day's time or skip its reminder) and any grocery delivery (mark ordered, add the slot and total, skip). "Hey Siri, add to shopping in Dishes" adds an item without opening the app (offline too, synced later) — the same action is in Shortcuts and on the Action button, and an "Add to Shopping" control in Control Center or on the Lock Screen opens the list ready to type; on an Apple Watch, the Dishes Watch app does the same. Siri also answers "What's for dinner in Dishes?" (tonight's meal and serve time), starts cooking tonight's meal or a named recipe, adds a recipe or a day's meals to the shopping list, plans a recipe for a day and ticks items off — planning and ticking work offline — and it knows what's on screen, so "add this to Friday" on a recipe or "how much butter?" on a cooking step refers to what you're looking at. Recipes are in Spotlight, searched by ingredient and when you last cooked them ("that chicken thing"), and open straight to the recipe. On iOS 27, shopping items can be dragged into a different order, or onto another aisle to change their category, and a day's meals on the planner can be dragged into the order you want (the website shows them that way too). Home Screen and Lock Screen widgets: Tonight (today's meal, its serve time and Start cooking — set it to lunch or breakfast instead), This week (the iPad's large and extra-large sizes) and Shopping (what's left, one aisle or all, ticked off from the widget itself — with no signal too, sent as soon as it can be). Cooking mode has a hands-free mic: say "next", "back", "read it", "start the timer" or "how much butter?" and it answers out loud — all on the device, nothing recorded. Settings → Apple Health adds the meals you log as eaten to Health (calories, protein, carbs, fat, saturated fat, fibre, sugar and sodium, times the portion you ate) — off by default and per device, for whoever eats from it, so the kitchen iPad doesn't write the family's meals to its owner; editing or deleting the cook updates Health. "Shopping trip" on the list puts what's left on the Lock Screen — the count and the next items, each ticked off from there — kept current as anyone at home adds or ticks things, and gone once everything's in the basket. Dishes links open in the app (a recipe sent in Messages, say), and the recipe, shopping list or planner on screen continues on the family's other devices with Handoff — on a Mac, in the browser. A combined meal's ⋯ menu matches the web's (add to the shopping list, cooking schedule, servings for everything, rename, move, change meal type, save or update the saved meal, split, remove — with a confirmation), and cooking it starts with the dish to begin first. Two banners under the planner's buttons flag the week's heart-healthy share, missed protein targets and suggested swaps (when someone's on a cholesterol-lowering diet) and the next grocery order's to-do list; tap either for the detail. Big combined meals switch dishes in cooking mode from a menu on iPhone, members' profile photos show, and the app asks for notification and timer-alarm permission when it first opens. Integrations, email settings and diagnostics stay on the website. See [apps/ios/RUNBOOK.md](apps/ios/RUNBOOK.md) to build and run it, and [TODO_MOBILE.md](TODO_MOBILE.md) for what's next

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
  /ios          native iPhone + iPad app (SwiftUI) — see apps/ios/RUNBOOK.md

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

`push` creates the tables but not the triggers that fill the sync change log
(`sync_changes`), so the iOS app and the PWA's offline sync would only ever
see their first snapshot. Apply the migrations that install them:

```bash
for f in 0025_sync_change_log 0035_meal_groups 0042_sync_saved_meals; do
  docker exec -i dishes-dev-db-1 psql -U dishes -d dishes -q < drizzle/$f.sql
done
```

(Notices about triggers or tables that don't exist yet are expected.)

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

The taste profile requires no setup. After you log ratings on cooked recipes, the profile is refreshed automatically in the background. Once you have at least 2 rated cooks, a **Suggested for you** shelf appears on Recipes. At 10+ rated cooks, the profile is also injected into AI generation prompts to skew concepts and recipes towards your household's preferences. View the profile at **Settings → Taste profile**; admins can reset it if it has drifted.

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
| `DISHES_ALLOWED_GROUPS` | No | Comma-separated Authelia groups that may use the client API with a bearer token (the iOS app). Default: `admins,dishes`. Anyone else gets a 403. Match it to the Authelia rule for the web app. |
| `DISHES_ADMIN_GROUP` | No | Authelia group of the people who run the server. Only they see Settings → Diagnostics (every household's crash reports) and the log level. Default: `admins`. |
| `DISHES_SYNC_RETENTION_DAYS` | No | How many days of offline-sync change log to keep. Default: `30`. Pruning runs opportunistically, at most hourly. A device offline for longer than this resyncs from scratch on its next connection rather than receiving a delta — correct, but it downloads everything, so don't set this very low. `0` disables pruning and lets the log grow forever. |
| `POSTGRES_PASSWORD` | Compose only | PostgreSQL password (used by Docker Compose) |
| `S3_ENDPOINT` | No | S3-compatible storage endpoint |
| `S3_ACCESS_KEY` | No | S3 access key |
| `S3_SECRET_KEY` | No | S3 secret key |
| `S3_BUCKET` | No | S3 bucket name. Default: `dishes` |
| `S3_PUBLIC_URL` | No | Public base URL for serving images (e.g. `https://media.yourdomain.com`). Falls back to `S3_ENDPOINT` if absent. |
| `VAPID_SUBJECT` | No | Contact URI for push notifications (e.g. `mailto:you@example.com`). Required to enable push. |
| `VAPID_PUBLIC_KEY` | No | VAPID public key for Web Push. Generate with `npx web-push generate-vapid-keys`. |
| `VAPID_PRIVATE_KEY` | No | VAPID private key for Web Push. Keep secret and stable — rotating this invalidates all existing subscriptions. |
| `APNS_KEY_ID` | No | Key ID of the Apple Push `.p8` key (developer.apple.com → Keys). With `APNS_TEAM_ID` and a key, enables notifications in the iPhone and iPad app. |
| `APNS_TEAM_ID` | No | Apple Developer team ID that owns the key and the app. |
| `APNS_KEY` | No | Contents of the `.p8` key. Newlines may be written as `\n` so it fits on one line. Keep secret. |
| `APNS_KEY_FILE` | No | Alternative to `APNS_KEY`: path to the `.p8` file inside the container (mount it read-only). |
| `APNS_TOPIC` | No | The app's bundle id. Default: `uk.collco.dishes`. Debug builds register for Apple's sandbox and release builds for production; each device says which, so one server serves both. |
| `APPLE_APP_IDS` | No | The iOS app named in `/.well-known/apple-app-site-association` for universal links and Handoff, as `TEAMID.bundle.id` (comma-separated for several). Default: `C729B84RYG.uk.collco.dishes`. |

---

## Integrations API

The app exposes a JSON API for external tools. Full documentation: [API.md](API.md).

> Dishes has two APIs. `/api/integrations` (below) is for external automation and authenticates with household-scoped tokens. `/api/v1` is the **client API** used by Dishes' own clients — it resolves a specific household member, via Authelia proxy headers in the browser or an OIDC access token from a native app, and is what the native iOS app (`apps/ios`) uses. See [API.md](API.md), [Authelia OIDC](#authelia-oidc-for-native-clients) and [TODO_MOBILE.md](TODO_MOBILE.md).

Tokens are created at **Settings → Integrations** (admin only). Each token carries granular scopes and is rate-limited at 100 requests/minute via Redis. The same page documents every endpoint with examples and has a Try-it console.

**AI assistants (Grok etc.):** create a `read:meal_plan`-only token, import `https://dishes.yourdomain.com/api/integrations/openapi.json` as a custom action/tool (no token needed to fetch the spec), and set auth to Bearer with the token. The existing Authelia bypass for `^/api/integrations([/?].*)?$` already covers both the spec and the new recipe endpoint.

**ChatGPT: help choosing when eating out.** A custom GPT reads a menu you send it (photo, PDF or link), suggests dishes using the diner brief (dietary needs, tastes, this week's heart-health targets, recent meals), and logs what you ordered as a meal out, whose nutrition Dishes then estimates.

1. Create a token with `read:preferences`, `read:meal_plan` and `write:outside_meals`, **acting as** you.
2. In ChatGPT, GPTs → Create → Configure → Actions → Create new action → **Import from URL**: `https://dishes.yourdomain.com/api/integrations/openapi.json?ops=meals-out`. This trimmed spec has only the eating-out operations.
3. Authentication: API Key, auth type Bearer, then paste the token.
4. Paste the instructions from Settings → Integrations (there's a Copy button) into the GPT's Instructions.
5. Keep the GPT shared with **Only me**. Anyone who can use it can read the household's brief and log meals as you.

ChatGPT calls the API from OpenAI's servers, so the domain must be reachable from the internet. The Authelia bypass for `^/api/integrations` already lets these calls through, and the token does the authentication.

**Claude: the same, as an MCP server.** `/api/integrations/mcp` serves the same eating-out tools to Claude over MCP (Streamable HTTP, stateless). The tools are `getDinerBrief`, `listOutsideMeals`, `getOutsideMeal`, `logOutsideMeal` and `updateOutsideMeal`, with the GPT's instructions sent as the server's instructions. Claude only sees the tools the caller can use. Settings → Integrations has the URL and the snippets below, filled in for your domain.

- **Claude Code:** `claude mcp add --transport http dishes https://dishes.yourdomain.com/api/integrations/mcp --header "Authorization: Bearer <token>"`
- **Claude Desktop:** add this to `claude_desktop_config.json`. It runs [`mcp-remote`](https://www.npmjs.com/package/mcp-remote), which needs Node.js, to pass the token:

  ```json
  {
    "mcpServers": {
      "dishes": {
        "command": "npx",
        "args": ["-y", "mcp-remote", "https://dishes.yourdomain.com/api/integrations/mcp", "--header", "Authorization:${DISHES_AUTH}"],
        "env": { "DISHES_AUTH": "Bearer <token>" }
      }
    }
  }
  ```
- **claude.ai and the Claude apps:** a custom connector signs in with OAuth, not a pasted token. See [Claude custom connector via Authelia](#claude-custom-connector-via-authelia). Set up on the server; not yet tried from claude.ai.

Use a token with `read:preferences`, `read:meal_plan` and `write:outside_meals`, acting as you, as for the GPT.

| Scope | Description |
|---|---|
| `read:meal_plan` | Read meal plan and full recipes |
| `write:meal_plan` | Create meal plan entries, trigger AI generation |
| `read:shopping_list` | Read the active shopping list |
| `write:shopping_list` | Add, tick off, rename and remove shopping list items |
| `read:deliveries` | Read grocery delivery days and order status |
| `write:deliveries` | Record grocery orders (e.g. forwarded retailer emails) |
| `read:cooking` | See who is cooking right now — dish, step and running timers |
| `read:preferences` | Read members' dietary requirements, dislikes and tastes, and this week's eating — the diner brief an AI uses to choose from a menu |
| `write:outside_meals` | Log and update meals eaten out. The token must **act as** a member (chosen when it's created): the meal and its rating are theirs |

### Quick examples

```bash
# Today's meals
curl -H "Authorization: Bearer <token>" https://dishes.yourdomain.com/api/integrations/today

# Full recipe (ingredients + steps) for a recipe.id from the call above
curl -H "Authorization: Bearer <token>" https://dishes.yourdomain.com/api/integrations/recipes/<recipe-id>

# Add a shopping list item
curl -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"items":[{"ingredientName":"Milk","amount":"2","unit":"litres","category":"dairy"}]}' \
  https://dishes.yourdomain.com/api/integrations/shopping-list/items

# Who's cooking right now, with their step and timers (Home Assistant)
curl -H "Authorization: Bearer <token>" https://dishes.yourdomain.com/api/integrations/cooking

# The diner brief for James and Sam tonight, for an AI choosing from a menu
curl -H "Authorization: Bearer <token>" "https://dishes.yourdomain.com/api/integrations/preferences?members=James,Sam"

# Log what was ordered (the token acts as a member; the nutrition estimate follows)
curl -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"date":"2026-10-28","place":"Côte","menuText":"Sea bass, crushed potatoes, beurre blanc","menuKcal":720}' \
  https://dishes.yourdomain.com/api/integrations/outside-meals

# Next grocery order and what's still to do before it closes (Home Assistant)
curl -H "Authorization: Bearer <token>" https://dishes.yourdomain.com/api/integrations/deliveries

# Forward a supermarket order email (n8n) — AI marks the delivery ordered
curl -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"subject":"Your order is confirmed","text":"Order 1234567890 ... Monday 19 October, 8am - 9am ... Total £94.20"}' \
  https://dishes.yourdomain.com/api/integrations/deliveries/email
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
        - '^/\.well-known/apple-app-site-association$'  # iOS universal links; Apple fetches it with no login
        - '^/\.well-known/oauth-protected-resource(/.*)?$'  # MCP sign-in discovery for claude.ai; names the issuer, nothing private
        - '^/_next/static/.*$'
        - '^/_next/image.*$'
        - '^/favicon\.ico$'
        - '^/manifest\.json$'
    - domain: 'dishes.yourdomain.com'
      policy: one_factor
```

Note that only `/share/` is bypassed. `/import/`, `/shared/` and
`/library-invite/` must **not** be added to that list. The share page is the
public, read-only view; the other three identify the acting household, so they
have to go through Authelia — `/import/<token>` resolves (or creates) the
importer's household, `/shared/` reads another household's recipes under a
grant, and `/library-invite/` decides who a grant belongs to.

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


### Claude custom connector via Authelia

A custom connector on claude.ai (which the Claude apps share) signs in with OAuth. The server side is in place:

- `/api/integrations/mcp` answers `401` with a `WWW-Authenticate` header pointing at `/.well-known/oauth-protected-resource/api/integrations/mcp`.
- That metadata names `DISHES_OIDC_ISSUER` as the authorization server.
- The endpoint then accepts the Authelia access token Claude gets. The connector acts as whoever signed in, with the eating-out tools, and the user must be in an allowed group, as for the iOS app.

Authelia has no dynamic client registration, so register Claude as a confidential client and give claude.ai its ID and secret. Generate the secret and its hash with `authelia crypto hash generate pbkdf2 --random`:

```yaml
      - client_id: dishes-claude
        client_name: Claude
        client_secret: '$pbkdf2-sha512$310000$…'  # the hash; claude.ai gets the plain secret
        public: false
        authorization_policy: one_factor
        redirect_uris:
          - https://claude.ai/api/mcp/auth_callback
        # Claude names the MCP server in an RFC 8707 `resource` parameter;
        # without this Authelia refuses it with invalid_target.
        audience:
          - https://dishes.yourdomain.com/api/integrations/mcp
        scopes: [openid, profile, email, groups, offline_access]
        grant_types: [authorization_code, refresh_token]
        response_types: [code]
        require_pkce: true
        pkce_challenge_method: S256
        token_endpoint_auth_method: client_secret_post
        # A third party acting as you: ask, unlike the first-party iOS app.
        consent_mode: explicit
```

Add the `/.well-known/oauth-protected-resource` bypass rule shown in step 3. Then, in Claude, go to **Settings → Connectors → Add custom connector**:

- URL: `https://dishes.yourdomain.com/api/integrations/mcp`
- Under **Advanced settings**: client ID `dishes-claude` and the plain secret

Checked against Authelia 4.39 (28 Oct 2026), short of signing in from claude.ai itself:
- the discovery metadata comes through the bypass
- the client reaches the login page with Claude's `resource` parameter, which needs the `audience` above
- the token endpoint accepts the secret in the request body

If claude.ai still fails:

- **The token exchange is rejected as `invalid_client`.** Claude is sending the secret in the `Authorization` header: switch `token_endpoint_auth_method` to `client_secret_basic`.
- **The connector signs in but every call is `401`.** Check that `/api/integrations/mcp` is still bypassed, and that Dishes can reach the issuer's userinfo endpoint.

If it won't work, Claude Desktop with a token (above) is the Claude route.
---

## Household Roles

| Role | Permissions |
|---|---|
| **Admin** | Full access: manage members, recipes, meal plans, shopping, household settings, AI config, integration tokens |
| **Adult** | Create/edit recipes, use AI, manage shopping lists and meal plans |
| **Child** | View recipes and meal plans, tick shopping list items, favourite and rate recipes |

---

## Giving Someone Else Their Own Kitchen

Dishes is multi-tenant: a second family can share the instance without seeing
any of your data. To add one:

1. **Create their Authelia user** and grant it access to the Dishes domain in
   your access-control rules. There is no in-app sign-up.
2. **They open the app.** On the first request their household is created
   automatically (named after their display name) and they become its admin.
   The welcome wizard runs on that first load.
3. **They add their own OpenAI key** in Settings → AI, or in the wizard. AI is
   strictly household-scoped: there is no instance-wide key and no fallback, so
   their generation is billed to them and invisible to you. Until a key is set,
   the AI features report that AI is not configured; everything else works.

Their recipes, meal plans, shopping lists and pantry are scoped to their
household at the query layer, so nothing leaks in either direction.

**Choose their username carefully.** The new household's slug is derived from
the Authelia username; if that slug already belongs to an existing household,
the new user is added to *that* household instead of getting their own.

To swap recipes between the two households, share a link from the recipe's
⋯ menu and have them press **Add to my Dishes** on the page.

---

## Debugging the Meal Planner

By default the planner draws uniformly at random from your entire recipe album —
ratings and cook counts do not tilt the odds. Narrow it deliberately with the
**Suggestion style** buttons, which are real library filters:

| Style | What the planner may pick from |
|---|---|
| *(none)* | Every recipe in the library, equal chance |
| From our favourites | Only recipes you have starred as favourites |
| Our regulars | Only dishes planned or cooked 3+ times |
| Try something new | Only never-tried recipes, plus fresh AI ideas |
| Mix it up | Everything, with a nudge towards some new suggestions |

Each button shows how many recipes it can draw from, and expands to preview the
actual titles — so you can see at a glance whether a style has enough behind it.
The *Rated only*, cuisine, tag and calorie filters stack on top. Recipes used in
the last three weeks are held back so last fortnight's dinners don't come
straight back; if that leaves too few to fill the week, the cooldown relaxes
automatically and the debug log says so. The one
automatic exclusion is a three-week recency cooldown so last fortnight's dinners
don't come straight back.

If the AI meal planner still keeps proposing the same handful of recipes, set
**Settings → Developer → Server log level** to *Debug (verbose)* and generate a
plan. The container logs then show exactly what the planner considered:

```bash
docker logs -f dishes 2>&1 | grep '\[ai\] meal-plan'
```

You get one summary line — how many recipes were scanned, how many were filtered
out, how many sat in the recency cooldown, and how many actually reached the
model — followed by the full list of titles sent, each with its plan count and
last-used date. Set the level back to *Info* when you're done; the title list is
long.

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
- **Taste profiling** ✓ — recency-weighted preference model; personalises AI and the Recipes page's suggestions
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
