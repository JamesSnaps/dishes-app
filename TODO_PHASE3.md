# Dishes — Phase 3 Roadmap

Phase 3 is the personalisation and intelligence layer. It builds on the household model and AI foundation from Phases 1 and 2, adding features that make the app feel like it knows your family.

Items are ordered by dependency — build them roughly top to bottom. Several features share a `cook_history` table as their data foundation, so that comes first.

---

## 1. Cook History & Rating System

**Why first:** ratings are the raw signal that powers taste profiling, AI food memory, and cooking time learning. Everything else in Phase 3 depends on this table existing.

### Data model

New table: `cook_history`

```
cook_history
  id              uuid PK
  household_id    uuid FK → households
  recipe_id       uuid FK → recipes
  cooked_at       timestamptz
  rating          numeric(3,1)   -- 0.0–10.0, nullable until rated
  actual_duration integer        -- minutes, nullable
  notes           text           -- free-form post-cook notes
  photo_url       text           -- S3 key for final dish photo, nullable
  occasion        text           -- e.g. "Anniversary dinner", nullable
  cooked_for      text[]         -- names from household_members, nullable
```

### Tasks

- [x] Migration: create `cook_history` table (`packages/db/drizzle/0004_cook_history.sql`)
- [x] Server action: `logCook(recipeId, data)` — creates or upserts a cook history record
- [x] Server action: `rateCook(cookId, rating)` — updates rating on existing record
- [x] Recipe detail page: show average rating + cook count beneath the title
- [x] Recipe list/grid: show star rating on cards (average, greyed out if unrated)
- [x] "Rate this recipe" bottom sheet — triggered from recipe detail; half-star precision, 0–10 scale
- [x] Cook history tab on recipe detail — list of past cooks with date, rating, notes

---

## 2. Post-Cooking Flow

After the user finishes cooking mode, present a lightweight debrief screen rather than just navigating away. This is the primary collection point for cook history data.

### Tasks

- [x] "You're done!" screen at end of cooking mode — full-screen overlay replaces inline done state (`cook-debrief.tsx`)
- [x] Display auto-timed session duration (cooking mode starts a timer on mount via `cookStartRef`)
- [x] Prompt: "How long did it actually take?" — pre-filled with session duration, editable with ±5 min buttons
- [x] Prompt: "How did it go?" — half-star rating widget (0–10 scale)
- [x] Prompt: "Any notes?" — textarea (optional)
- [x] Prompt: "What was the occasion?" — text field with quick-select chip suggestions
- [ ] Prompt: "Who did you cook for?" — multi-select from `household_members` names (blocked on Section 3)
- [ ] "Upload a photo of your dish" — optional (blocked on Section 5)
- [x] On submit: call `logCook()` server action; auto-updates recipe cook time if elapsed differs ≥5 min; navigates to recipe detail
- [x] Skip button — exits without logging (no friction for casual cooks)

---

## 3. Family Member Profiles

Family members don't need app accounts. They are household-level records that carry dietary preferences, restrictions, and dislikes. These feed into AI generation prompts so the app can automatically avoid problem ingredients.

### Data model

New table: `household_members`

```
household_members
  id              uuid PK
  household_id    uuid FK → households
  name            varchar(100)
  relationship    varchar(50)    -- e.g. "child", "partner", "parent"
  date_of_birth   date           -- optional, used to infer age context for AI
  dietary_flags   text[]         -- e.g. ["vegetarian", "nut-allergy"]
  dislikes        text[]         -- ingredient/food names they dislike
  preferences     text[]         -- things they particularly like
  custom_notes    text           -- free-form, e.g. "won't eat anything green"
  created_at      timestamptz
  updated_at      timestamptz
```

### Tasks

- [x] Preference columns added to existing `household_members` table (`0005_member_preferences.sql`) — no separate table needed, members already existed
- [x] Settings page: preferences edit sheet on each member row (gear icon) — dietary flags, dislikes, preferences, custom notes
- [x] Dietary flags: preset chip toggles (Vegetarian, Vegan, Gluten-free, Dairy-free, Nut allergy, Shellfish allergy, Halal, Kosher, Low-FODMAP, Egg-free)
- [x] Dislikes + Favourites: tag inputs (type and press Enter)
- [x] Preference summary shown inline beneath each member row when any data exists
- [x] Slug removed from settings household card
- [ ] "Who did you cook for?" multi-select in post-cooking debrief (unblocked — wire to existing members)
- [ ] "Who's eating?" selector on AI recipe generation — inject constraints into AI system prompt
- [ ] "Who's eating?" selector on meal plan day

---

## 4. Cooking Time Learning

The app uses recipe-specified durations for planning, but learns each household's actual pace over time. Once enough cook history exists, actual durations replace estimates.

### Tasks

- [ ] Schema: `actual_duration` already on `cook_history` (see section 1)
- [ ] Server query: `getAverageDuration(recipeId, householdId)` — average of non-null `actual_duration` values, minimum 2 data points before surfacing
- [ ] Recipe detail: show "Usually takes you ~X mins" beneath recipe's stated time once 2+ cooks logged
- [ ] Meal plan: use household average duration (if available) when planning day timings
- [ ] Cooking mode: show "Last time this took you X mins" as a subtle note on the start screen
- [ ] Integration API: include `household_avg_duration` in recipe responses where available

---

## 5. Final Dish Photo

After cooking, the user can photograph their result. The photo is stored on S3, attached to the cook history record, and optionally reviewed by the AI.

### Tasks

- [ ] Post-cooking flow: "Upload a photo of your dish" button — uses `<input type="file" accept="image/*" capture="environment">` for mobile camera access
- [ ] Server action: `uploadCookPhoto(cookId, file)` — uploads to S3 under `cook-history/{cookId}/dish.jpg`, updates `cook_history.photo_url`
- [ ] AI review: after upload, optionally call OpenAI vision API with the image + recipe context; return short feedback (presentation, colour, suggested improvements)
- [ ] Display AI feedback in a card beneath the photo on the post-cooking screen
- [ ] Recipe detail: "Your versions" gallery — grid of dish photos from cook history, tapping shows the cook's date, rating, and notes
- [ ] AI feedback is generated server-side only; image is never sent client-side to OpenAI

---

## 6. AI Food Memory

The app accumulates a structured memory of notable cooks — occasions, improvements, personal notes — and can surface them contextually.

### Tasks

- [ ] `occasion` and `notes` fields already on `cook_history` (see section 1)
- [ ] Recipe detail: "Memories" section — timeline of past cooks that have an occasion or note; e.g. "Anniversary dinner · March 2025 · Rated 9.5 · You added orange zest"
- [ ] AI generation prompt: when generating a recipe variant or tweak, include relevant cook history context (e.g. "Last time, user added X and rated it 9.5")
- [ ] Meal plan AI: when suggesting recipes, surface occasion history — "You made this for Alice's birthday last year"
- [ ] "On this day" hook (Phase 2 worker): notify if a recipe was cooked on this calendar date in a previous year (anniversary meals)
- [ ] Search: filter recipes by occasion keyword ("anniversary", "birthday") via cook history join

---

## 7. Taste Profiling

Build a per-household preference model from accumulated cook history. Use it to personalise AI recipe generation and ranking.

**Depends on:** rating system (section 1), family member profiles (section 3).

### Data model

New table: `taste_profile` (materialised, refreshed on each new cook or rating)

```
taste_profile
  id              uuid PK
  household_id    uuid FK → households
  cuisines        jsonb    -- { "Italian": 8.2, "Thai": 7.1, ... } weighted scores
  ingredients     jsonb    -- { "garlic": 9.0, "mushroom": 3.2, ... }
  tags            jsonb    -- { "comfort food": 8.5, "quick": 7.0, ... }
  meal_types      jsonb    -- { "dinner": 8.0, "dessert": 6.5, ... }
  updated_at      timestamptz
```

Scores are weighted averages of ratings for recipes that contain each attribute, with recency weighting (recent cooks count more).

### Tasks

- [ ] Migration: create `taste_profile` table
- [ ] Server function: `refreshTasteProfile(householdId)` — recomputes all scores from cook history; called after each new cook log or rating update
- [ ] AI generation: inject top-5 cuisine preferences and top-10 liked/disliked ingredients into the system prompt when household has ≥10 rated cooks
- [ ] Settings page: `/settings/taste` — read-only visualisation of the household's taste profile (bar charts or tag clouds per category); labelled "Your taste profile"
- [ ] Recipe suggestions on home screen: rank uncooked recipes by taste profile similarity score
- [ ] "Why this?" tooltip on suggested recipes — "We suggested this because you enjoy Thai cuisine and garlic-forward dishes"
- [ ] Profile resets: admin can clear the taste profile from settings if it has drifted

---

## Infrastructure & Cross-cutting

- [ ] `cook_history` must be household-scoped in all queries — enforce at the query layer, same rule as recipes
- [ ] All AI calls in Phase 3 (vision review, taste-aware generation) remain server-side only
- [ ] S3 key structure for cook photos: `households/{householdId}/cook-history/{cookId}/dish.jpg`
- [ ] Extend integration API: `GET /api/integrations/recipes/{id}/history` — returns cook history for external dashboards
- [ ] Add `cook_count` and `average_rating` as computed columns (or a view) on recipes for efficient sorting
- [ ] Privacy: cook history, family members, and taste profiles are household-scoped and never shared across households

---

## Feature dependency order

```
Rating system + cook_history table
        │
        ├─► Post-cooking flow  ──► Final dish photo
        │
        ├─► Cooking time learning
        │
        ├─► AI food memory
        │
        └─► Taste profiling
                │
                └─► Personalised AI generation

Family member profiles  ──► "Who's eating?" AI injection
```
