# Dishes — Product & Technical Specification

## Project Overview

A mobile-first smart recipe application focused on:

- Recipe storage
- Guided cooking
- Intelligent ingredient handling
- AI-generated meal planning
- Shopping list management
- Family-oriented cooking workflows
- AI-assisted recipe generation

The application should feel like a polished modern cooking assistant rather than a traditional recipe database.

Primary target platform:
- Mobile phones (iPhone-first UX)
- Responsive web support
- Future iOS/Android native app compatibility

Architecture should support:
- Web-first deployment
- Progressive Web App (PWA)
- Future React Native / Expo mobile app
- Shared backend/business logic

---

# Core Product Philosophy

The app should:

- Reduce friction while cooking
- Reduce meal planning fatigue
- Help users decide what to cook
- Reuse existing ingredients intelligently
- Support real family cooking habits
- Feel fast, clean, and modern
- Use AI only where genuinely useful

Avoid:
- Cluttered recipe-blog aesthetics
- Social-media-style feeds
- Overcomplicated nutrition obsession
- Excessive gamification

Design inspiration:
- Apple Human Interface style
- Minimal, tactile UI
- Large readable cooking mode
- Clean typography
- Strong mobile ergonomics

---

# Suggested Tech Stack

## Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui

## Backend

- Self-hosted Docker Compose stack
- PostgreSQL for relational data
- Drizzle ORM for type-safe database access and migrations
- Redis for queues, caching, background jobs, and rate limiting
- Worker container for scheduled jobs, AI generation tasks, imports, and notifications (Phase 2)
- S3-compatible object storage for recipe images and uploads, such as MinIO or external S3/R2
- Application-managed household permissions
- Server-side API routes/actions for AI, imports, scheduling, and secure operations

## AI

- OpenAI APIs
- Server-side AI integration only
- Optional Vercel AI SDK or direct OpenAI SDK usage
- Household-scoped AI configuration and usage limits

## Authentication

Authentication is handled at the infrastructure level by Authelia via the reverse proxy. The app receives pre-authenticated requests and trusts user identity from Authelia session headers. No in-app email/password or OAuth flows are required.

The family profile picker (Phase 2) acts as a household-level identity layer on top of the Authelia session — a convenience UX feature, not the primary security boundary.

## Hosting

- Self-hosted Docker Compose deployment on James's existing server infrastructure
- Designed to run alongside existing containerised apps
- Authelia handles access control and SSO at the reverse proxy level
- Can later be migrated to managed hosting if the app becomes commercial or needs public scaling
- Internal/external integration API for n8n, Home Assistant, and other automation tools
- Household-scoped API tokens with granular permissions/scopes

## Future Mobile App

Potential future migration:
- Expo / React Native
- Shared monorepo architecture

---

# High-Level Architecture

## Monorepo Structure

```txt
/apps
  /web
  /mobile (future)

/packages
  /ui
  /api
  /db
  /shared
```

## Docker Compose Runtime Structure

Suggested containers/services:

```txt
app-web       Next.js web application
app-worker    background jobs, scheduled tasks, AI generation, notifications, imports (Phase 2)
postgres      primary relational database
redis         queues, cache, rate limiting, job coordination
storage       S3-compatible image/upload storage, e.g. MinIO or external S3/R2
```

The app should be designed so that the web app remains responsive while slow or expensive work runs in the worker container.

Examples of worker tasks (Phase 2):
- Weekly meal plan generation
- AI recipe generation
- Recipe import and cleanup
- AI image generation
- Shopping list generation
- Notification dispatch
- Pantry expiry checks

---

# Core Features

# 1. Recipe Storage

Users can:

- Create recipes manually
- Import recipes from URLs
- Edit recipes
- Categorise recipes
- Add tags
- Mark recipes as favourites
- Rate recipes
- Filter recipes by tags, ratings, favourites, cuisine, and difficulty
- Add prep/cook times
- Add servings
- Add notes
- Add images

Recipes should support:

- Structured ingredients
- Structured cooking steps
- Embedded timers
- AI-generated metadata

---

# 2. Structured Ingredients System

Ingredients must NOT be stored as plain text only.

Each ingredient should contain:

```json
{
  "ingredient_name": "Potatoes",
  "amount": 1000,
  "unit": "g",
  "preparation": "peeled and diced",
  "optional": false
}
```

This enables:

- Smart scaling
- Ingredient linking
- Shopping list generation
- Pantry comparison
- AI reasoning
- Ingredient substitutions

---

# 3. Ingredient Recognition During Cooking

During recipe playback:

- Ingredient references in steps should be tappable
- Tapping an ingredient shows:
  - Quantity required
  - Preparation notes
  - Where else used
  - Remaining amount

Example:

Step:
> Add the potatoes to the pan.

User taps:
> Potatoes → 1kg, peeled and diced

Implementation ideas:
- Ingredient ID linking
- NLP parsing
- Regex fallback

---

# 4. Guided Cooking Mode

Cooking mode should include:

- Large readable typography
- Step-by-step navigation
- Hands-free friendly UI
- Wake-lock enabled
- Embedded timers
- Ingredient highlighting
- Voice navigation (future)

Possible gestures:
- Swipe for next step
- Tap timer to start
- Long press ingredient for details

---

# 5. Embedded Timers

Automatically detect timings from recipe steps.

Example:

> Bake for 25 minutes

App should:
- Detect duration
- Offer one-tap timer
- Allow multiple concurrent timers

Features:
- Push notifications
- Background timer support
- Timer labels

---

# 6. Recipe Scaling

Users can scale servings dynamically.

Scaling should intelligently handle:

- Fractions
- Whole ingredients
- Spice scaling
- Unit conversion
- Sensible rounding

Examples:
- 1 egg → 2 eggs
- 0.25 tsp → 0.5 tsp
- Avoid ugly decimal outputs

Future enhancement:
- Pan-size warnings
- Cook-time adjustments

---

# 7. AI Recipe Concierge

Users can request recipes via AI prompts.

Flow:

1. User enters request
2. AI generates 5 concise meal concepts
3. User selects one
4. Full recipe generated

Example prompt:
> Easy vegetarian pasta for 2 adults and 1 child under 30 minutes

AI should generate:
- Title
- Short description
- Difficulty
- Prep time
- Cuisine style

Then expand selected recipe into:
- Ingredients
- Steps
- Timings
- Tips
- Optional substitutions

---

# 8. AI Menu Planner

Users can generate meal plans for:
- Specific days
- Full weeks
- Date ranges

AI planner should consider:
- Meat-free days
- Dietary preferences
- Children vs adults
- Prep time
- Budget
- Leftovers
- Repeated ingredients
- Pantry inventory
- Freezer meals

Example preferences:
- 2 vegetarian days
- Child-friendly
- Under 45 minutes weekdays
- One fakeaway night
- No mushrooms

Output:
- Meal plan
- Consolidated shopping list
- Prep suggestions

Scheduled meal plan automation (recurring weekly generation, draft approval flow, notifications) is a Phase 2 feature. The data model should be designed from the start to support it without restructuring.

---

# 9. Shopping Lists

Shopping lists should support:

- Auto-generation from recipes
- Manual additions
- Ingredient consolidation
- Checkbox completion
- Categorisation by aisle
- Pantry exclusion

Examples:

```txt
2 onions
1 red onion
```

May become:

```txt
3 onions
```

Future integrations:
- Tesco API
- Aldi mode
- Online ordering export

---

# 10. Pantry System

Users can track:
- Staple ingredients
- Expiring items
- Frequently stocked items

AI should use pantry data to:
- Avoid duplicate purchases
- Suggest meals
- Prioritise expiring ingredients

Possible future features:
- Barcode scanning
- OCR receipt parsing

---

# 11. Recipe Import

Users can paste recipe URLs.

System should:
- Extract ingredients
- Extract steps
- Parse timings
- Extract images
- Clean blog content

Potential implementation:
- JSON-LD / microdata parsing (recipe schema.org)
- Readability parser fallback
- AI cleanup layer

---

# 12. AI Recipe Images

Optional feature:
- Generate stylised recipe thumbnails

Use cases:
- Visual recipe cards
- Placeholder artwork

Important:
- Avoid hyper-fake food imagery
- Use tasteful modern styling

---

# 13. Family Preferences

Track recipe feedback:
- Loved
- Liked
- Tolerated
- Refused

Track preferences:
- Spice tolerance
- Texture dislikes
- Favourite meals
- Per-user favourite recipes
- Per-user ratings
- Family-wide favourites
- Child-safe meal preferences

---

# 14. "What Can I Cook?" Mode

User enters available ingredients.

AI suggests:
- Full meals
- Missing ingredients
- Substitutions
- Fast options

Potential future enhancement:
- Camera ingredient detection

---

# 15. Integrations API

The app should expose a secure JSON API so tools such as n8n, Home Assistant, dashboards, or personal automations can interact with recipe and meal planning data.

Primary use cases:
- Get today's planned meal
- Get this week's meal plan
- Trigger generation of a new meal plan
- Trigger generation of a one-off meal suggestion
- Add items to the shopping list
- Read current shopping list items
- Trigger household automations manually

Example endpoints:

```txt
GET  /api/integrations/today
GET  /api/integrations/meal-plan/week
GET  /api/integrations/shopping-list
POST /api/integrations/shopping-list/items
POST /api/integrations/meal-plan/generate
POST /api/integrations/automations/run
```

Requirements:
- Bearer token authentication
- Household-scoped API tokens
- Granular scopes: `read:meal_plan`, `write:meal_plan`, `read:shopping_list`, `write:shopping_list`, `run:automation`
- Redis rate limiting
- Audit/debug logs
- Adult/admin-only token management
- Children cannot create or manage integration tokens

This allows n8n or Home Assistant to handle notifications and automations without the recipe app needing to own every notification workflow from day one.

## Webhooks

The app should support outbound webhooks for household events.

Potential events:
- `meal_plan.generated`
- `meal_plan.approved`
- `shopping_list.updated`
- `pantry_item.expiring`
- `automation.completed`
- `automation.failed`

Webhook deliveries should run through the worker/Redis queue system, retry with backoff, and expose delivery logs to admins.

---

# Data Model Ideas

## Recipe

```json
{
  "id": "",
  "title": "",
  "description": "",
  "cuisine": "",
  "servings": 4,
  "prep_time_minutes": 20,
  "cook_time_minutes": 45,
  "difficulty": "easy",
  "ingredients": [],
  "steps": [],
  "tags": [],
  "image_url": ""
}
```

---

## Recipe Ingredient

```json
{
  "ingredient_name": "Potatoes",
  "amount": 1000,
  "unit": "g",
  "preparation": "peeled and diced",
  "optional": false
}
```

---

## Recipe Step

```json
{
  "step_number": 1,
  "instruction": "",
  "timers": [],
  "ingredient_ids": []
}
```

---

## Household / Workspace

```json
{
  "id": "",
  "name": "Collard Family",
  "display_name": "Collard Family",
  "created_by_user_id": "",
  "ai_enabled": true,
  "ai_provider": "openai",
  "ai_key_reference": "encrypted_secret_reference",
  "ai_monthly_usage_limit": 1000,
  "subscription_status": "active"
}
```

## Household Membership

```json
{
  "id": "",
  "household_id": "",
  "user_id": "",
  "display_name": "James",
  "avatar_url": "",
  "role": "admin",
  "pin_hash": "hashed_pin_value",
  "can_use_ai": true,
  "can_edit_recipes": true,
  "can_manage_meal_plan": true,
  "can_manage_household": true
}
```

Important:
- Store AI keys/secrets securely; never expose them to the client.
- Store PINs as secure hashes; never store raw PINs.
- Prefer storing encrypted secret references rather than raw API keys in normal application tables.
- Enforce household isolation at the database/query layer, not just UI filtering.
- All application queries must be scoped by household/workspace membership.
- Consider database-level safeguards, views, policies, or helper functions to reduce the risk of cross-household data leaks.

## Household Automation (Phase 2)

```json
{
  "id": "",
  "household_id": "",
  "type": "weekly_meal_plan",
  "enabled": true,
  "schedule": "0 9 * * 0",
  "timezone": "Europe/London",
  "preferences_json": {},
  "notify_user_ids": [],
  "last_run_at": null,
  "next_run_at": null,
  "created_by_user_id": ""
}
```

The `schedule` field uses standard cron syntax (`0 9 * * 0` = Sunday at 09:00).

Automation types may include:
- Weekly meal plan generation
- Shopping list reminder
- Pantry expiry reminder
- Recipe suggestion reminder

Scheduled automation rules:
- Automations belong to a household/workspace
- Automations should be configurable by adults/admins only
- Automations should produce draft outputs where appropriate
- Automations should write run logs for debugging and auditability
- Automations should handle failures gracefully and notify admins if needed
- Automation execution should happen in the worker container, not in the request/response path
- Redis-backed queues should be used for retries, locking, and concurrency control

The `household_automations` table and related worker logic are Phase 2. The household data model should be structured from the start so automations can be added without schema changes to core tables.

---

# UX Goals

The app should feel:

- Fast
- Calm
- Elegant
- Useful
- Mobile-native
- Minimal friction

Avoid:
- Tiny buttons
- Dense layouts
- Endless scrolling
- Ad-style clutter

---

# Offline Support

Important feature (Phase 2).

Requirements:
- Cached recipes
- Offline cooking mode
- Local shopping lists
- Sync when online

---

# Authentication

Authentication is fully managed by Authelia at the reverse proxy layer. The app does not implement its own login, OAuth, or session management.

The family profile picker (Phase 2) provides a household-level identity layer within an already-authenticated session. It is a UX convenience to switch between household members, not a security boundary.

Security notes for the profile picker (Phase 2):
- PINs should be hashed (bcrypt or argon2), never stored as plain text
- PIN login operates within an existing Authelia-authenticated session
- Sensitive account-level actions should still require adult/admin confirmation
- PIN attempts should be rate-limited application-side
- Adults/admins can reset child PINs

---

# Multi-User Family Support

The application should support:

- Multiple user accounts
- Shared household access
- Shared recipes
- Shared meal planners
- Shared shopping lists
- Shared pantry inventory
- Multiple independent households/families
- Tenant-level data isolation
- Shared AI configuration per household/family
- Profile-picture based family member login (Phase 2)
- PIN-based profile unlocking within a household (Phase 2)
- Fast switching between household members (Phase 2)

Users should be able to belong to one or more households/families.

A household/family should be treated as a tenant/workspace boundary. This allows the app to support James's own family initially, while also supporting multiple independent families/customers in the future.

Each household/family should have its own:
- Members
- Recipes
- Meal plans
- Shopping lists
- Pantry inventory
- Permissions
- AI usage configuration
- Billing/subscription context, if commercialised later

## Permission System

The app should support role-based permissions.

Example roles:

### Admin
Can:
- Manage household members
- Edit all recipes
- Use AI tools
- Manage pantry
- Manage meal plans
- Configure permissions

### Adult
Can:
- Create/edit recipes
- Use AI tools
- Manage shopping lists
- Manage meal planner

### Child
Can:
- View recipes
- View meal plans
- Tick shopping list items
- Favourite recipes
- Rate recipes

Cannot:
- Access AI generation tools
- Delete recipes
- Manage permissions
- Edit household settings

### Guest
Can:
- View shared recipes
- View meal plans

## Family Profile Picker Login (Phase 2)

The app should support a household login screen that shows available family profiles as large tappable avatars.

Flow:
1. User opens the app (already authenticated via Authelia)
2. App shows family/household profiles
3. User taps their profile picture/avatar
4. User enters their PIN
5. App loads their profile with the correct permissions

This should feel similar to a family media app profile picker, but with a PIN step for each profile.

Important behaviour:
- Children should only see child-safe actions after selecting their profile
- AI tools should remain hidden or disabled for users without AI permissions
- Admin/adult profiles can manage recipes, meal plans, shopping lists, and household settings
- The app should support fast user switching without needing a full re-authentication

## Tenant / Household Model

Use a tenant-style model even if the user-facing label is "Family" or "Household".

Suggested terminology:
- Internal/database term: `household` or `workspace`
- User-facing term: `Family` or `Household`

Recommended approach:
- Every recipe belongs to a household/workspace
- Every meal plan belongs to a household/workspace
- Every shopping list belongs to a household/workspace
- Every pantry item belongs to a household/workspace
- Users access data through household membership records
- Permissions are granted per household membership

This avoids building the app as a single-family tool and makes it easier to support other customers later.

## Shared AI Configuration

AI configuration should be scoped to the household/family, not individual users.

This means:
- The AI provider/API key should be configured once per household/family
- AI usage limits should apply at household/family level
- AI-generated recipes and plans should belong to the household/family
- Children should be blocked from AI tools through permissions, even though the household has AI enabled
- Adults/admins can use the shared household AI allowance/configuration

Potential future commercial model:
- Each household/customer has its own subscription
- Usage limits apply per household/customer
- Admins can configure AI access and limits
- Different households must never see each other's recipes, plans, pantry items, shopping lists, or AI history

---

# Non-Goals (Initial Version)

Avoid building initially:

- Social network
- Public recipe marketplace
- Advanced calorie tracking
- Restaurant delivery integrations
- Complex nutrition dashboards
- Full commercial billing system
- Public multi-tenant marketplace
- Managed serverless-first architecture

Focus on:
- Cooking workflows
- Meal planning
- Simplicity
- AI usefulness

---

# Development Priorities

## Phase 1 — MVP

The architecture (monorepo, household model, Docker Compose, Drizzle schema) should be designed from day one to support Phase 2 features without restructuring.

1. Recipe CRUD
2. Structured ingredients
3. Cooking mode
4. Recipe scaling
5. Shopping lists
6. AI recipe generation
7. Menu planner (manually triggered)
8. Household/workspace model
9. Role-based permissions
10. Household-scoped AI configuration
11. Docker Compose deployment foundation

## Phase 2

1. Family profile picker and PIN-based profile switching
2. Worker container and Redis queue architecture
3. Scheduled meal plan automation (recurring, draft approval flow)
4. Push/email/in-app notifications
5. Pantry system
6. Offline sync (PWA service worker)

## Later

1. AI image generation
2. Mobile app (Expo / React Native)
3. Voice features
4. Outbound webhooks
5. Barcode scanning / OCR receipt parsing
6. Grocery store integrations (Tesco, etc.)

---

# Suggested UI Pages

- Home
- Household Profile Picker (Phase 2)
- Recipes
- Recipe Detail
- Cooking Mode
- AI Concierge
- Meal Planner
- Scheduled Automations (Phase 2)
- Shopping List
- Pantry
- Household Management
- Family Profiles (Phase 2)
- Permissions & Roles
- Settings

---

# Design Direction

Visual style:
- Clean
- Warm
- Minimal
- Premium
- Apple-inspired

Typography:
- Large readable text
- Strong hierarchy

Animations:
- Smooth
- Subtle
- Functional

Dark mode:
- Supported from day one

---

# Final Goal

Create the best practical AI-assisted cooking and meal-planning experience possible.

The app should:
- Save time
- Reduce stress
- Improve cooking confidence
- Make meal planning enjoyable
- Feel genuinely intelligent
- Work beautifully on mobile devices
- Support collaborative family meal planning
- Provide safe child-friendly access controls
- Allow personalised experiences per family member
- Support multiple independent households/customers in the future
- Keep AI configuration and usage scoped to each household/family
- Make switching between family members quick and child-friendly using avatar and PIN login (Phase 2)
- Support optional scheduled automations, such as weekly AI-generated draft meal plans (Phase 2)
- Run cleanly as a self-hosted Docker Compose application using existing server infrastructure
- Use background workers and queues for scheduled, AI-heavy, or slow-running tasks (Phase 2)
- Include a CLAUDE.md file for codebase guidance and context
