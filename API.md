# Dishes — HTTP APIs

Dishes exposes two distinct JSON APIs. They are **not** interchangeable:

| API | Prefix | Audience | Auth | Identity |
|---|---|---|---|---|
| Integrations API | `/api/integrations` | n8n, Home Assistant, dashboards | Household-scoped bearer token | Household only — no user |
| Client API | `/api/v1` | First-party clients (native iOS, PWA offline layer) | Authelia proxy headers (bearer/OIDC planned) | A specific household member |

Integrations tokens are deliberately **not** accepted on `/api/v1`: they carry no username, so they cannot attribute a write to a household member.

The Integrations API is documented first; the Client API is at the end of this file.

---

## Authentication

All requests must include a Bearer token in the `Authorization` header. Tokens are created and managed at **Settings → Integrations** in the app (admin only).

```
Authorization: Bearer <token>
```

Tokens carry granular scopes. Each endpoint documents the required scope. Requests with a missing or invalid token receive `401`; requests with a valid token that lacks the required scope receive `403`.

## OpenAPI spec

`GET /api/integrations/openapi.json` returns an OpenAPI 3.1 description of every endpoint below — parameters, request schemas, example responses, and an `operationId` per endpoint (`getToday`, `getWeekMealPlan`, `getRecipe`, `getShoppingList`, `addShoppingItems`, `quickAddShoppingItem`, `generateMealPlan`, `getDeliveries`, `ingestDeliveryEmail`, `recordDeliveryOrder`). It needs **no token**, so AI assistants (Grok, ChatGPT custom actions, Claude) and n8n can import it before auth is configured; it contains no household data. `servers[0].url` is taken from the request's `X-Forwarded-Host`/`X-Forwarded-Proto`.

The spec and the **Settings → Integrations** reference page are both generated from `apps/web/lib/integrations-catalog.ts` — update that file alongside this one when an endpoint changes.

For an AI assistant, a `read:meal_plan`-only token is enough to answer "what's for dinner and how do I make it?": `getToday` → `getRecipe` with the meal's `recipe.id`.

## Rate limiting

100 requests per minute per token (fixed window). Exceeding the limit returns `429` with a `Retry-After` header (seconds until the window resets). Rate limiting is enforced via Redis and is a no-op if Redis is unavailable.

## Scopes

| Scope | Description |
|---|---|
| `read:meal_plan` | Read meal plan entries and full recipes |
| `write:meal_plan` | Create meal plan entries and trigger AI generation |
| `read:shopping_list` | Read the active shopping list |
| `write:shopping_list` | Add items to the active shopping list |
| `read:deliveries` | Read grocery delivery days and order status |
| `write:deliveries` | Record grocery orders (e.g. from retailer emails) |

## Common error shape

```json
{ "error": "Human-readable message" }
```

---

## Endpoints

### `GET /api/integrations/today`

Returns today's meal plan entries across all meal types.

**Scope:** `read:meal_plan`

**Query params:** none

**Response `200`**

```json
{
  "date": "2026-05-14",
  "meals": [
    {
      "id": "uuid",
      "mealType": "dinner",
      "servings": "4",
      "notes": null,
      "mealGroup": {
        "id": "uuid",
        "title": "Sunday roast",
        "role": "main"
      },
      "recipe": {
        "id": "uuid",
        "title": "Chicken Tikka Masala",
        "cuisine": "Indian",
        "prepTimeMinutes": 20,
        "cookTimeMinutes": 35,
        "calories": 650
      }
    }
  ],
  "nextDelivery": null
}
```

`nextDelivery` is the next grocery order that's still open, in the same shape as `next` from [`GET /api/integrations/deliveries`](#get-apiintegrationsdeliveries), or `null` when no delivery is coming (or delivery days aren't set up).

`recipe.calories` is the per-serving calorie estimate, or `null` if the recipe has no nutrition data. `meals` is empty `[]` if no plan exists for the current week or no entries fall on today.

`mealGroup` is set when the dish is part of a combined meal (a roast with its sides, say): every dish in that meal carries the same `id` and `title`, and `role` is one of `"main"`, `"side"`, `"sauce"`, `"other"`. It is `null` for a dish planned on its own. To show "tonight: Sunday roast" rather than four separate dishes, group `meals` by `mealGroup.id`.

---

### `GET /api/integrations/meal-plan/week`

Returns all meal plan entries for a given week.

**Scope:** `read:meal_plan`

**Query params**

| Param | Type | Default | Description |
|---|---|---|---|
| `week` | `YYYY-MM-DD` | current Monday | The Monday date of the week to fetch |

**Example**

```
GET /api/integrations/meal-plan/week?week=2026-05-11
```

**Response `200`**

```json
{
  "weekStartDate": "2026-05-11",
  "planStatus": "draft",
  "entries": [
    {
      "id": "uuid",
      "dayOfWeek": 0,
      "mealType": "dinner",
      "servings": "4",
      "notes": null,
      "mealGroup": null,
      "recipe": {
        "id": "uuid",
        "title": "Pasta Carbonara",
        "cuisine": "Italian",
        "prepTimeMinutes": 10,
        "cookTimeMinutes": 20,
        "calories": 720
      }
    }
  ]
}
```

`dayOfWeek` values: `0` = Monday … `6` = Sunday.  
`planStatus`: `"draft"` | `"active"` | `"archived"`.  
`entries` is empty `[]` if no plan exists for the week.  
`mealGroup`: `{ id, title, role }` for a dish in a combined meal, otherwise `null` — see `/today`.

---

### `GET /api/integrations/recipes/{id}`

Returns one recipe from the household library with ingredients, numbered steps and per-serving nutrition. Use it to follow up a `recipe.id` from `/today` or `/meal-plan/week`, which only carry a summary.

**Scope:** `read:meal_plan`

**Path params**

| Param | Type | Description |
|---|---|---|
| `id` | uuid | Recipe id |

**Response `200`**

```json
{
  "recipe": {
    "id": "uuid",
    "title": "Chicken Tikka Masala",
    "description": "A creamy, mildly spiced curry.",
    "cuisine": "Indian",
    "difficulty": "medium",
    "servings": "4",
    "servingsUnit": "servings",
    "prepTimeMinutes": 20,
    "cookTimeMinutes": 35,
    "calories": 650,
    "mealTypes": ["dinner"],
    "tags": ["curry", "family"],
    "notes": null,
    "sourceUrl": null,
    "nutrition": {
      "calories": 650, "proteinG": 42, "carbsG": 38, "fatG": 34,
      "saturatedFatG": 12, "fiberG": 5, "sugarG": 9, "sodiumMg": 980
    },
    "ingredients": [
      {
        "id": "uuid",
        "ingredientName": "chicken thighs",
        "amount": "600",
        "unit": "g",
        "preparation": "diced",
        "isOptional": false,
        "groupLabel": null
      }
    ],
    "steps": [
      {
        "step": 1,
        "instruction": "Marinate the chicken in yoghurt and spices for 20 minutes.",
        "durationMinutes": 20,
        "timerLabel": "Marinate",
        "groupLabel": null,
        "ingredientIds": ["uuid"]
      }
    ]
  }
}
```

`nutrition` is `null` when the recipe has no nutrition data; individual macros may also be `null`. `steps[].ingredientIds` reference `ingredients[].id`. Amounts are strings so fractions survive.

**Error `404`** — no recipe with that id in the token's household (malformed ids also return `404`).

---

### `GET /api/integrations/shopping-list`

Returns the current active shopping list and all its items.

**Scope:** `read:shopping_list`

**Query params:** none

**Response `200`**

```json
{
  "list": {
    "id": "uuid",
    "name": "Shopping – 14 May",
    "createdAt": "2026-05-14T09:00:00.000Z"
  },
  "items": [
    {
      "id": "uuid",
      "ingredientName": "Chicken breast",
      "amount": "500",
      "unit": "g",
      "category": "meat",
      "isChecked": false,
      "position": 0
    }
  ]
}
```

`list` is `null` and `items` is `[]` if there is no active list.

---

### `POST /api/integrations/shopping-list/items`

Adds one or more items to the active shopping list. Creates a new list automatically if none is active.

**Scope:** `write:shopping_list`

**Request body**

```json
{
  "items": [
    {
      "ingredientName": "Milk",
      "amount": "2",
      "unit": "litres",
      "category": "dairy"
    },
    {
      "ingredientName": "Bread"
    }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `items` | array | yes | Non-empty array of items to add |
| `items[].ingredientName` | string | yes | Name of the ingredient |
| `items[].amount` | string | no | Quantity (stored as string to preserve fractions) |
| `items[].unit` | string | no | Unit of measure (e.g. `"g"`, `"ml"`, `"litres"`) |
| `items[].category` | string | no | Aisle/category label (e.g. `"produce"`, `"dairy"`) |

Items with an empty `ingredientName` are silently skipped.

**Response `201`**

```json
{
  "added": 2,
  "listId": "uuid"
}
```

**Error `400`** — body is not valid JSON or `items` is missing/empty.

---

### `POST /api/integrations/shopping-list/quick-add`

Adds a single item from a plain-text string. Designed for Siri Shortcuts and voice input — no array wrapping required. Creates a new list automatically if none is active.

**Scope:** `write:shopping_list`

**Request body**

```json
{ "text": "2 pints of milk" }
```

| Field | Type | Required | Description |
|---|---|---|---|
| `text` | string | yes | The item to add, exactly as spoken or typed |

**Response `201`**

```json
{
  "added": "2 pints of milk",
  "listId": "uuid",
  "itemId": "uuid"
}
```

**Error `400`** — body is not valid JSON or `text` is empty.

**iOS Shortcut setup**

1. Create a new Shortcut in the Shortcuts app
2. Add **Ask for Input** — prompt: "What do you want to add?"
3. Add **Get Contents of URL**:
   - URL: `https://dishes.collardserver.co.uk/api/integrations/shopping-list/quick-add`
   - Method: `POST`
   - Headers: `Authorization` → `Bearer <your-token>`
   - Request body: JSON → `{ "text": "<Provided Input>" }`
4. Add **Show Notification** — `Added <Provided Input> to shopping list`
5. Name the Shortcut **"Add to shopping list"** — Siri will pick it up automatically

---

### `POST /api/integrations/meal-plan/generate`

Triggers AI meal plan generation for a given week. Each meal is written up as a **complete recipe** — ingredients, steps, tags and per-serving nutrition — saved to the household library and linked into the meal plan. The household must have an AI API key configured in **Settings → AI**.

Because every meal costs a second AI call, a full week takes appreciably longer than a single day — allow for it in n8n/Home Assistant timeouts. Recipes are written three at a time. If one write-up fails, that meal is still saved from its concept alone and returned with `"complete": false`.

**Scope:** `write:meal_plan`

**Request body** (all fields optional)

```json
{
  "prompt": "family-friendly weeknight dinners",
  "week": "2026-05-11",
  "days": [0, 2, 4],
  "count": 7,
  "mealType": "dinner",
  "overwrite": false,
  "maxCaloriesPerMeal": 700
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `prompt` | string | `"family-friendly weeknight dinners"` | Description passed to the AI |
| `week` | `YYYY-MM-DD` | current Monday | Monday date of the target week |
| `days` | `number[]` | — | Specific days to generate, `0`=Mon … `6`=Sun. Takes precedence over `count`. |
| `count` | number | `7` | Number of days from Monday when `days` is not provided. Clamped to 1–7. |
| `mealType` | string | `"dinner"` | `"breakfast"` \| `"lunch"` \| `"dinner"` \| `"snack"` |
| `overwrite` | boolean | `false` | If `true`, replaces existing entries for the same day+mealType slots. Other meal types on those days are left untouched. |
| `maxCaloriesPerMeal` | number | — | Optional per-serving calorie cap (kcal). The AI keeps each meal at or below it; the generated recipe stores the AI's per-serving calorie estimate. |

`calories` in the response is the finished recipe's own per-serving estimate, and `complete` is `false` only for a meal whose full write-up failed.

**Day selection examples**

| Goal | Body |
|---|---|
| Full week dinners | `{}` |
| Weekdays only (Mon–Fri) | `{ "count": 5 }` |
| Mon, Wed, Fri dinners | `{ "days": [0, 2, 4] }` |
| Weekend lunches | `{ "days": [5, 6], "mealType": "lunch" }` |
| Just Tuesday breakfast | `{ "days": [1], "mealType": "breakfast" }` |

**Response `201`**

```json
{
  "planId": "uuid",
  "weekStartDate": "2026-05-11",
  "mealType": "dinner",
  "meals": [
    {
      "dayOfWeek": 0,
      "day": "Mon",
      "mealType": "dinner",
      "recipeTitle": "Chicken Tikka Masala",
      "recipeId": "uuid",
      "calories": 650,
      "complete": true
    },
    {
      "dayOfWeek": 2,
      "day": "Wed",
      "mealType": "dinner",
      "recipeTitle": "Spaghetti Bolognese",
      "recipeId": "uuid",
      "calories": 580,
      "complete": true
    }
  ]
}
```

**Error `409`** — one or more requested slots already have an entry and `overwrite` is `false`.

```json
{
  "error": "Entries already exist for dinner on: Mon, Wed. Pass overwrite: true to replace them."
}
```

**Error `502`** — AI returned an unexpected or incomplete response.

---

### `GET /api/integrations/deliveries`

The next grocery order that's still open, with what's left to do before it closes, plus every delivery in the next two weeks. Good for a Home Assistant sensor ("Order by 23:00 tonight · 2 dinners not planned").

**Scope:** `read:deliveries`

**Response `200`**

```json
{
  "today": "2026-10-17",
  "timezone": "Europe/London",
  "deliveryWeekdays": [0, 4],
  "next": {
    "date": "2026-10-19",
    "status": "scheduled",
    "slot": null,
    "total": null,
    "orderReference": null,
    "orderBy": "2026-10-18T22:00:00.000Z",
    "orderByLabel": "23:00 tomorrow",
    "covers": ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"],
    "unplannedDinners": ["2026-10-21"],
    "mealsNotOnList": 1,
    "itemsNotInBasket": 6,
    "addedSinceOrder": []
  },
  "upcoming": [
    {
      "date": "2026-10-19",
      "status": "scheduled",
      "regular": true,
      "away": null,
      "slot": null,
      "total": null,
      "orderReference": null,
      "orderBy": "2026-10-18T22:00:00.000Z"
    }
  ]
}
```

| Field | Description |
|---|---|
| `next` | The soonest delivery that's coming (not skipped) and whose order deadline hasn't passed. `null` if none. |
| `status` | `scheduled` (not ordered yet), `ordered`, or `skipped` (in `upcoming` only). |
| `orderBy` | The order deadline as a UTC instant; `orderByLabel` is the same in household-local words. |
| `covers` | The dates the delivery has to feed: up to the day before the next delivery, stopping at a holiday, at most 7 days. |
| `unplannedDinners` | Dates in `covers` with no dinner on the meal plan. |
| `mealsNotOnList` | Planned meals in `covers` not yet added to the shopping list (a combined meal counts once). |
| `itemsNotInBasket` | Unticked items on the active shopping list. Ticking an item means it's in the online basket. |
| `addedSinceOrder` | Once ordered: names of unticked items added after the order was placed — they need amending in before `orderBy`. |
| `deliveryWeekdays` | Regular delivery days, `0` = Monday … `6` = Sunday. |
| `away` | The holiday label when a date falls in one (`"Away"` if unlabelled). |

---

### `POST /api/integrations/deliveries/email`

Forward a supermarket order email — Sainsbury's, Tesco, Ocado and similar — and the household's AI reads it and updates the matching delivery. The household must have an AI key in **Settings → AI**. Each call is one small AI request.

**Scope:** `write:deliveries`

**Request body** (send `text`, `html` or both; `text` wins)

```json
{
  "subject": "Your Sainsbury's order confirmation",
  "from": "groceries@sainsburys.co.uk",
  "receivedAt": "2026-10-17T19:42:00Z",
  "text": "Thanks for your order 1234567890. Delivery: Monday 19 October, 8:00am - 9:00am. Order total £94.20"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `subject` | string | no | Email subject |
| `from` | string | no | Sender |
| `receivedAt` | string (ISO date-time) | no | When it arrived. Dates without a year are read relative to it. Defaults to now. |
| `text` | string | no* | Plain-text body |
| `html` | string | no* | HTML body; markup is stripped before the AI sees it |

\* At least one of `text`, `html` or `subject`. Bodies are cut to 15,000 characters.

What happens, by the kind of email:

| Email | Effect |
|---|---|
| Order confirmed | The delivery date is marked **ordered** with slot, total and order number. Reminders stop. |
| Order amended | Same, by order number. If the slot moved to another day the order moves with it; a regular delivery day it left is marked skipped. |
| Order cancelled | The delivery goes back to **not ordered**, so reminders pick it up again. |
| Delivered / receipt | The final charged total replaces the estimate (it feeds Stats → Grocery spend). |
| Anything else | Ignored — offers, "you can still amend until…" reminders, slot reservations. |

Members with delivery reminders on get a push for confirmations, amendments and cancellations.

**Response `200`**

```json
{
  "action": "ordered",
  "delivery": {
    "date": "2026-10-19",
    "status": "ordered",
    "slot": "08:00-09:00",
    "total": "94.20",
    "orderReference": "1234567890"
  },
  "extracted": {
    "kind": "placed",
    "retailer": "Sainsbury's",
    "orderReference": "1234567890",
    "deliveryDate": "2026-10-19",
    "slotStart": "08:00",
    "slotEnd": "09:00",
    "total": 94.2
  }
}
```

`action` is `ordered`, `updated`, `cancelled` or `ignored` (with a `reason`). `movedFrom` is added when an amendment moved the delivery to another date. `extracted` is what the AI read, for checking in n8n's execution log. A delivery date more than 14 days before or 60 days after `receivedAt` is discarded as a misread.

**Error `400`** — bad JSON, or no text/html/subject. **Error `422`** — no AI key set up. **Error `502`** — the AI call failed (bad key, rate limit, unreadable answer).

**n8n setup**

1. Create a token with `write:deliveries` in **Settings → Integrations**.
2. Add an **Email Trigger (IMAP)** node (or the Gmail / Outlook trigger) on the mailbox the orders go to. Filter to the supermarket's sender, e.g. a Gmail search of `from:sainsburys.co.uk`, or an **If** node on `from` containing `sainsburys`.
3. Add an **HTTP Request** node:
   - Method `POST`, URL `https://dishes.yourdomain.com/api/integrations/deliveries/email`
   - Authentication: Generic → Header Auth, `Authorization` = `Bearer <token>`
   - Body: JSON, e.g. `{ "subject": {{ JSON.stringify($json.subject) }}, "from": {{ JSON.stringify($json.from) }}, "receivedAt": {{ JSON.stringify($json.date) }}, "text": {{ JSON.stringify($json.textPlain || $json.text || "") }}, "html": {{ JSON.stringify($json.textHtml || $json.html || "") }} }` (field names vary slightly between the trigger nodes — check one execution's output).
4. Send yourself a test by running the workflow on a past confirmation email; the response's `extracted` shows what was read.

---

### `POST /api/integrations/deliveries/order`

Record an order from details you've already parsed — no AI involved. Same effects as the email endpoint.

**Scope:** `write:deliveries`

**Request body**

```json
{
  "kind": "placed",
  "deliveryDate": "2026-10-19",
  "slot": "08:00-09:00",
  "total": 94.2,
  "orderReference": "1234567890",
  "retailer": "Sainsbury's"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `kind` | string | no | `placed` (default), `amended`, `cancelled` or `delivered` |
| `deliveryDate` | string | see below | `YYYY-MM-DD` |
| `slot` | string | no | `"08:00-09:00"`, `"8am-9am"` or `"7-8pm"` — stored as `HH:MM-HH:MM` |
| `total` | number or string | no | Pounds; `"£94.20"` is accepted |
| `orderReference` | string | see below | The retailer's order number; links later updates to this order |
| `retailer` | string | no | Shown in the push notification |

Give `deliveryDate`, `orderReference`, or both.

**Response `201`** — same shape as the email endpoint, without `extracted`. `200` with `action: "ignored"` when nothing matched (e.g. cancelling an unknown order).

**Error `400`** — bad JSON, unknown `kind`, malformed date, or neither date nor reference.

---

## Day-of-week reference

| Value | Day |
|---|---|
| `0` | Monday |
| `1` | Tuesday |
| `2` | Wednesday |
| `3` | Thursday |
| `4` | Friday |
| `5` | Saturday |
| `6` | Sunday |

---

# Client API (`/api/v1`)

The first-party API used by Dishes' own clients. Unlike the Integrations API it
resolves a **specific household member**, so writes are attributed correctly and
role checks apply.

## Authentication

Requests are authenticated by `resolveIdentity()` (`apps/web/lib/auth.ts`), which
accepts either:

1. **Authelia reverse-proxy headers** (`Remote-User`, `Remote-Name`,
   `Remote-Groups`) — how the browser reaches the app.
2. **An OIDC access token** — `Authorization: Bearer <token>`, for native
   clients. Requires `DISHES_OIDC_ISSUER` to be set; see the Authelia OIDC section of
   `README.md`. When it is unset, every bearer token is rejected with `401`.

Both transports converge on the same `AutheliaUser`, so household scoping, roles
and member attribution behave identically regardless of client.

Access tokens are verified two ways, chosen automatically by token shape:

| Token | Verification |
|---|---|
| Opaque (Authelia default, `authelia_at_…`) | Exchanged for claims at the provider's userinfo endpoint. |
| JWT (provider sets `access_token_signed_response_alg`) | Signature, issuer and expiry checked locally against the JWKS, plus audience when `DISHES_OIDC_CLIENT_ID` is set. Identity claims are then read from the payload **if present**, and fetched from userinfo otherwise. |

On Authelia the JWT path always ends at userinfo anyway: Authelia deliberately
omits `preferred_username` and `groups` from access tokens, treating them as
opaque to clients. The fallback is what keeps that correct — trusting the JWT
payload alone would key a household on the `sub` UUID and grant no groups.

Userinfo results are cached in Redis for `DISHES_OIDC_USERINFO_CACHE_SECONDS`
(default 60), keyed on a SHA-256 of the token, never the token itself. Because
of the cache, revoking a session takes up to the TTL to take effect; set it to
`0` if that matters more than the per-request round trip.

Claims map as follows. `preferred_username` is required — household membership
is keyed on it, so a token without it is rejected rather than silently
bootstrapping a new household.

| Claim | Maps to | Notes |
|---|---|---|
| `preferred_username` | `username` | **Required, no fallback.** Requires the `profile` scope. A token without it is rejected rather than bootstrapping a household keyed on an opaque `sub`. |
| `name` | `displayName` | Falls back to the username. |
| `groups` | `groups` | Requires the `groups` scope; roles depend on it. |

The scheme is matched case-insensitively (`bearer` and `Bearer` both work). A
bearer scheme with no token is a `401`, not a fall-through to proxy headers.

**Integration tokens are not accepted here.** They carry a household id and
scopes but no username, so they cannot attribute a write to a member. They
remain confined to `/api/integrations`.

### `GET /api/v1/auth/whoami`

Diagnostic endpoint — who the server resolved you as, and how. Use it to verify
an OIDC setup before any native client exists.

```json
{
  "transport": "bearer",
  "oidcConfigured": true,
  "user": { "username": "james", "displayName": "James Collard", "groups": ["admins"] },
  "household": { "householdId": "uuid", "memberId": "uuid", "role": "admin" }
}
```

`transport` is `"bearer"` or `"proxy_headers"`. Whenever a user can reach the
API both ways, both must return the same `username` and `memberId` — that
equality is the contract the two transports exist to satisfy.

Note that a deployment which bypasses `/api/v1` at the reverse proxy (the
recommended Authelia setup, since a native client has no session) also strips
the proxy headers, making `/api/v1` bearer-only in practice.

### `GET /api/v1/members`

The household's active members, by name. Cook history keys "who ate it"
(`cookedFor`) and per-person ratings (`memberRatings`) on display names, so a
client needs these to offer them.

```json
{ "members": [ { "id": "uuid", "displayName": "James", "role": "admin" } ] }
```

### `GET /api/v1/collections`

Every collection with the ids of its recipes.

```json
{ "collections": [ { "id": "uuid", "name": "Baking", "icon": "🧁", "description": null, "recipeIds": ["uuid"] } ] }
```

### `POST /api/v1/collections`

`{ "name": "Weeknight", "icon": "🍝" }` → the new collection (201).

### `PUT /api/v1/collections/{id}/recipes/{recipeId}` · `DELETE …`

Add a recipe to a collection (idempotent) or take it out. 204, no body; 404 for
a collection or recipe outside the household.

### `GET /api/v1/notifications` · `PATCH`

Your notification choices and the devices they go to. Each `type` is one of
`meal_plan`, `shopping_ready`, `shopping_updated`, `dinner`, `cook_timers`,
`delivery_deadline`, `delivery_orders`.

```json
{
  "types": [ { "id": "meal_plan", "title": "Meal plan ready", "description": "…", "group": "Household", "enabled": true } ],
  "devices": [ { "id": "uuid", "kind": "ios", "name": "James's iPad", "createdAt": "2026-10-17T13:22:13.664Z" } ]
}
```

`PATCH` with `{ "type": "shopping_updated", "enabled": false }` changes one and
answers the same shape. `DELETE /api/v1/notifications/devices/{id}` stops
sending to one of your devices (web or iOS), 204.

### `POST /api/v1/push/devices` · `DELETE`

Register this device for Apple Push: `{ "token": "<hex>", "environment":
"sandbox" | "production", "deviceName": "James's iPad" }` → `{ "id", "apnsConfigured" }`
(201). Re-registering the same token is an upsert, so the app does it at every
launch. `DELETE` with `{ "token" }` on sign-out, 204.

### `POST /api/v1/push/test`

`{ "token": "<hex>" }` sends a test notification to that device (yours only).
503 when the server has no APNs key, 410 when Apple says the token is dead.

### The browser door: `/api/web/*`

Because of that, the same API is also reachable at **`/api/web/*`**, which is
deliberately *not* in the proxy's bypass list. Authelia authenticates it and
injects the identity headers, and middleware rewrites the path onto the same
`/api/v1` handlers.

```
/api/web/sync        →  /api/v1/sync         (browser, session cookie)
/api/v1/sync         →  /api/v1/sync         (native, bearer token)
```

One API, two doors. No handler knows the difference — `requireSession()` already
accepts either transport, and responses are identical apart from `transport` in
`whoami`. Use `/api/web` from the PWA and `/api/v1` from native clients.

One thing browser callers must handle: an expired Authelia session. Send
**`Accept: application/json`**. Authelia decides between a 401 and a redirect
from that header, and fetch's default `*/*` counts as accepting HTML, so without
it the request gets a **302 to the login portal**. The portal is another origin,
so the browser won't follow the redirect and `fetch` rejects as if the network
were down — indistinguishable from being offline. With the header, the request
gets a **401 with an HTML body**. Treat a non-JSON 401 as "session expired" and
send the user to sign in again, rather than trying to parse it. If a service
worker caches pages, clear those caches first, or the reload is answered from
cache and never reaches the portal.

## Error shape

Distinct from the Integrations API's flat `{ "error": "…" }`:

```json
{ "error": { "code": "not_found", "message": "Recipe not found" } }
```

`details` is present on validation failures and carries the Zod issue list.

| Code | Status |
|---|---|
| `unauthenticated` | 401 |
| `forbidden` | 403 |
| `not_found` | 404 |
| `invalid_request` | 400 |
| `internal_error` | 500 |

## Endpoints

### `GET /api/v1/recipes`

Lists the household's recipes.

Query parameters (all optional): `q` (matches title, tags or ingredient names), `cuisine`, `favourites` (`0`/`1`),
`heartHealthy` (`0`/`1` — at most 4 g saturated fat and at least 3 g fibre per serving),
`difficulty` (`easy`/`medium`/`hard`), `maxTime` (minutes, prep + cook),
`tags` (comma-separated), `sort` (`recent` default, `title`, `time`),
`limit` (default 100, max 500), `offset`.

```json
{ "recipes": [ { "id": "…", "title": "Shakshuka", "cuisine": "Middle Eastern" } ] }
```

### `POST /api/v1/recipes`

Creates a recipe. Returns `201` with the full recipe including ingredients,
steps and tags.

```json
{
  "title": "Shakshuka",
  "description": "Eggs poached in a spiced pepper and tomato sauce.",
  "cuisine": "Middle Eastern",
  "prepTimeMinutes": 10,
  "cookTimeMinutes": 25,
  "servings": "4",
  "servingsUnit": "servings",
  "difficulty": "easy",
  "mealTypes": ["breakfast", "dinner"],
  "nutrition": { "calories": 510, "proteinG": 24 },
  "ingredients": [
    { "ingredientName": "Eggs", "amount": "4", "unit": "", "preparation": "", "isOptional": false, "groupLabel": "" }
  ],
  "steps": [
    { "instruction": "Fry the peppers.", "durationMinutes": "8", "timerLabel": "Peppers", "groupLabel": "" }
  ],
  "tags": ["brunch"],
  "collectionId": null
}
```

`nutrition` is per serving and accepts `calories`, `proteinG`, `carbsG`, `fatG`,
`saturatedFatG`, `fiberG`, `sugarG` and `sodiumMg` — all optional.

Only `title` is required. `mealTypes` entries that aren't valid meal types are
dropped. `collectionId` is ignored unless it names one of this household's
collections.

Each step may carry `ingredientIndexes`: the ingredients it uses, by position in
the same request's `ingredients` array. Ingredients get new ids on every write,
so this is how a step keeps its links (cooking mode's ingredient chips); the
server maps positions to the new ids. Omitted, the step has no links.

### `GET /api/v1/recipes/{id}`

Full recipe with ingredients, steps and tags. `404` if it isn't this
household's recipe.

### `PUT /api/v1/recipes/{id}`

Full replacement — not a partial patch. Ingredients and steps are positional
child rows, so a partial update has no coherent meaning for them; any omitted
field reverts to its default. Same body as `POST`. Returns the updated recipe.

### `DELETE /api/v1/recipes/{id}`

`204` on success, `404` if not found.

### `POST /api/v1/recipes/{id}/favourite`

Toggles the favourite flag and returns the new state.

```json
{ "isFavourite": true }
```

### `GET /api/v1/shopping`

The household's active shopping list and its items, each with the titles of
every recipe that contributed to it (`recipeTitles`, primary first) and the
same recipes with their ids (`recipeSources`).

```json
{
  "listId": "uuid",
  "listName": "This Week",
  "items": [
    {
      "id": "uuid",
      "listId": "uuid",
      "ingredientName": "Chicken breasts",
      "amount": "3.000",
      "unit": null,
      "notes": null,
      "isChecked": false,
      "category": "Meat & Fish",
      "position": 0,
      "recipeId": null,
      "recipeTitle": null,
      "recipeTitles": [],
      "recipeSources": []
    }
  ]
}
```

`listId` and `listName` are `null` and `items` is `[]` when there is no active list.

### `POST /api/v1/shopping/items`

Adds an item, creating an active list if none exists. Returns `201` with the item.

```json
{
  "ingredientName": "Olives",
  "amount": "2",
  "unit": "jars",
  "category": "ambient",
  "notes": null,
  "id": "client-generated-uuid",
  "listId": "uuid",
  "position": 21
}
```

Only `ingredientName` is required. `id`, `listId` and `position` exist for
offline clients: supplying `id` lets an item created on-device keep its identity
when the mutation queue drains. `position` defaults to the end of the list.

### `PATCH /api/v1/shopping/items/{id}`

Partial update of `ingredientName`, `amount`, `unit`, `notes`, `category`. An
empty body is `400` — omitting a field leaves it alone, sending `null` clears it.

### `DELETE /api/v1/shopping/items/{id}`

`204` on success.

### `POST /api/v1/shopping/items/{id}/toggle`

Body `{ "checked": true }`. Deliberately does **not** send a household push —
ticking items off in a supermarket would otherwise notify every device.

### `POST /api/v1/shopping/clear-checked`

Body `{ "listId": "uuid" }`. Removes every checked item; returns `{ "cleared": 3 }`.

### `POST /api/v1/shopping/archive`

Body `{ "listId": "uuid" }`. Archives the list; the next write starts a fresh one.

### `GET /api/v1/shopping/preview`

Query: `recipeId` (required), `servings` (optional). Shows what `/generate`
would add and what the pantry already covers, without writing.

```json
{
  "adding": [{ "ingredientName": "chopped tomatoes", "amount": "1600", "unit": "g" }],
  "skipped": [{ "ingredientName": "onions", "amount": "1", "unit": null, "reason": "staple" }]
}
```

`reason` is `"staple"` or `"in_stock"`.

### `POST /api/v1/shopping/generate`

Pulls a recipe's ingredients onto the active list, scaled to `servings`, skipping
anything the pantry covers, and merging into a matching unchecked line where one
exists (same name and unit).

```json
{ "recipeId": "uuid", "servings": 8, "forceInclude": ["onions"] }
```

`forceInclude` names ingredients to add even though the pantry covers them.
Returns `{ "listId": "uuid", "changed": true }`.

### `GET /api/v1/meal-plan`

A week's plan and its entries. `week` is the **Monday** the week starts on
(`YYYY-MM-DD`, required).

```json
{
  "plan": { "id": "uuid", "weekStartDate": "2026-09-07", "status": "active", "notes": null },
  "entries": [
    {
      "id": "uuid",
      "dayOfWeek": 2,
      "mealType": "dinner",
      "servings": "6.00",
      "notes": null,
      "addedToShoppingListAt": null,
      "recipe": {
        "id": "uuid",
        "title": "Shakshuka",
        "cuisine": "Middle Eastern",
        "prepTimeMinutes": 10,
        "cookTimeMinutes": 25,
        "servings": "4.00",
        "difficulty": "easy",
        "thumbnailUrl": null,
        "calories": 510
      }
    }
  ]
}
```

`plan` is `null` and `entries` is `[]` for a week that has never been planned.
`dayOfWeek` is `0` = Monday … `6` = Sunday (see the reference table above).

### `POST /api/v1/meal-plan/entries`

Assigns a recipe to a slot, creating the week's plan if it doesn't exist.
Returns `201` with `{ "entryId": "uuid" }`.

```json
{
  "weekStartDate": "2026-09-07",
  "recipeId": "uuid",
  "dayOfWeek": 2,
  "mealType": "dinner",
  "servings": 4
}
```

`servings` is optional — omit it (or send `null`) to use the recipe's own
servings count.

### `PATCH /api/v1/meal-plan/entries/{id}`

Moves an entry between days, changes its meal slot, or sets its servings. All
fields optional, at least one required.

```json
{ "dayOfWeek": 5, "mealType": "lunch", "servings": 6 }
```

`servings` may be `null` to fall back to the recipe's own base servings.

To move an entry into another week, send `weekStartDate` (the target week's
Monday, `YYYY-MM-DD`) together with `dayOfWeek`; the target week's plan is
created if it doesn't exist. `weekStartDate` without `dayOfWeek` is a `400`.

```json
{ "weekStartDate": "2026-09-14", "dayOfWeek": 0 }
```

### `DELETE /api/v1/meal-plan/entries/{id}`

`204` on success.

### `POST /api/v1/meal-plan/entries/{id}/shopping-list`

Adds one planned meal's ingredients to the active shopping list, scaled from the
recipe's base servings to the entry's servings, skipping what the pantry covers.

```json
{ "forceInclude": ["feta"] }
```

Body optional. `forceInclude` is an **override pass**: only the named
ingredients are processed, because the rest already went on the list in the
first pass and re-running them would double their amounts. Use it to implement
"add anyway" after a pantry skip.

```json
{ "added": 2, "merged": 1, "skipped": ["eggs", "onions"] }
```

`merged` counts ingredients folded into an existing unchecked line. `skipped`
names what the pantry already covers, so the caller can offer to add it anyway.
The entry is only flagged as added when `added + merged > 0`.

### `POST /api/v1/meal-plan/generate-shopping`

Aggregates every not-yet-added entry in a plan onto the active shopping list,
combining the same ingredient across recipes into one line (200g flour in two
recipes becomes one 400g line).

```json
{ "mealPlanId": "uuid", "forceInclude": ["feta"] }
```

Returns the same `{ added, merged, skipped }` shape. Entries already flagged as
added are skipped so re-running never duplicates a meal — except on an override
pass, which revisits every entry.

### `GET /api/v1/cook-history`

One recipe's cook history plus its derived stats. Query: `recipeId` (required).

```json
{
  "entries": [
    { "id": "…", "cookedAt": "2026-08-15T09:12:00.000Z", "rating": 8.5,
      "actualDuration": 42, "notes": null, "occasion": null,
      "cookedFor": ["Alice", "Bob"],
      "memberRatings": [{ "name": "Alice", "rating": 10 }, { "name": "Bob", "rating": 6 }],
      "photoUrl": null, "source": "cook" }
  ],
  "stats": { "cookCount": 1, "averageRating": 8.5 },
  "averageDuration": null
}
```

All three come back together because a recipe screen needs all three.

`source` is `"cook"` or `"rating"`. The average spans every entry, but only
`cook` entries count towards `cookCount` — rating a dish you haven't made
shouldn't claim you cooked it. `averageDuration` stays `null` until there are at
least two timed cooks; one is not a pattern.

### `POST /api/v1/cook-history`

Log a cook. `201` with the new entry id.

```json
{ "recipeId": "uuid", "rating": 8.5, "actualDuration": 42,
  "notes": "…", "occasion": "Anniversary", "cookedFor": ["Alice"],
  "memberRatings": [{ "name": "Alice", "rating": 9 }] }
```

Only `recipeId` is required. Ratings are 0–10 with half-star precision.

`memberRatings` is what other people who ate it thought, by display name
(matching `cookedFor`). `rating` is the caller's own opinion: it's filed under
the calling member's name in `memberRatings`, and the entry's stored `rating`
becomes the average of everyone's — so the recipe's average, the AI planner and
the taste profile weigh the whole household. Entries in `GET` return that
average as `rating` and every voice (the caller's included) in `memberRatings`.

### `POST /api/v1/cook-history/rate`

Rate without logging a cook — recorded as a `rating` entry.

```json
{ "recipeId": "uuid", "rating": 6, "notes": "…" }
```

### `PATCH /api/v1/cook-history/{id}`

Any of `rating`, `actualDuration`, `notes`, `occasion`, `cookedFor`,
`memberRatings`, or `removePhoto: true` (clears the dish photo; upload a new one
with the photo endpoint). Empty body is `400`. `rating` updates only the
caller's own voice; `memberRatings` replaces everyone else's (`null` clears
them). Either can be sent alone and the other is kept.

### `DELETE /api/v1/cook-history/{id}`

`204`. Also removes that entry's rating from the recipe average.

### `POST /api/v1/cook-history/{id}/photo`

Dish photo. Send the image as the **raw request body** with a matching
`Content-Type` — no multipart. JPEG, PNG or WebP, under 15 MB. Stored resized to
1600px wide with EXIF orientation applied and the tag stripped.

```json
{ "url": "https://…/dish.jpg" }
```

### `POST /api/v1/upload`

Recipe image. Raw body again, with `Content-Type`. JPEG, PNG, WebP or GIF, under
8 MB. `201` on success; `503` when object storage isn't configured.

```json
{ "url": "https://…/abc.jpg", "thumbnailUrl": "https://…/abc_thumb.jpg" }
```

`thumbnailUrl` is `null` for GIFs, which aren't resized.

### `GET /api/v1/sync`

Changes since a cursor. Omit `cursor` for a **full snapshot** — a first run, or
a local store that was wiped.

Query: `cursor` (opaque, from a previous response), `limit` (default 200, max 1000).

```json
{
  "cursor": "djE6NDIx",
  "hasMore": false,
  "changes": {
    "recipes": [ { "id": "…", "title": "…", "ingredients": [], "steps": [], "tags": [] } ],
    "shoppingLists": [], "shoppingItems": [],
    "mealPlans": [], "mealPlanEntries": [], "mealPlanGroups": [], "cookHistory": [],
    "meals": [ { "id": "…", "title": "Sunday roast", "notes": null, "defaultMealType": "dinner",
                 "slots": [ { "id": "…", "role": "main", "label": "Meat", "position": 0, "allowMultiple": false,
                              "options": [ { "id": "…", "position": 0, "isDefault": true,
                                             "recipe": { "id": "…", "title": "Roast chicken", "thumbnailUrl": null,
                                                         "imageUrl": null, "prepTimeMinutes": 15, "cookTimeMinutes": 90 } } ] } ] } ]
  },
  "deleted": { "recipes": ["uuid"], "shoppingLists": [], "shoppingItems": [], "mealPlans": [], "mealPlanEntries": [], "mealPlanGroups": [], "cookHistory": [], "meals": [] }
}
```

`changes` carries whole current rows, not field-level diffs — apply them as
upserts. `deleted` carries ids that are gone. Store `cursor` and pass it next
time; keep pulling while `hasMore` is true.

**The cursor is opaque.** Don't parse it, compare it, or do arithmetic on it.
It encodes a position in an append-only change log, not a timestamp — which is
why there is no clock skew and no overlap window to worry about.

Notes on semantics:

- **Granularity is the aggregate root.** Editing an ingredient, step or tag
  produces a `recipe` change carrying the whole recipe. Clients replace the
  recipe rather than reconciling child rows. Saved meals (`meals`) work the
  same way: a change to any slot or option arrives as the whole meal. A slot
  whose recipes were all deleted is left out. The embedded `recipe` summary is
  for display; look the recipe up in `recipes` for anything more.
- **Deleting a parent does not list its children.** Deleting a shopping list
  emits one `shoppingLists` tombstone, not one per item; same for a meal plan
  and its entries, and a recipe and its ingredients. Cascade locally.
- **Repeats collapse.** An entity changed ten times within one page appears
  once, in its final state. Something created and then deleted inside the same
  page appears only in `deleted`.

### `POST /api/v1/sync`

Upload a batch of mutations — the drain path for an offline queue.

```json
{
  "mutations": [
    { "opId": "client-uuid", "type": "shopping_item.add",
      "payload": { "ingredientName": "Capers", "amount": "1", "unit": "jar" } },
    { "opId": "client-uuid", "type": "shopping_item.toggle",
      "payload": { "itemId": "uuid", "checked": true } }
  ]
}
```

```json
{
  "results": [
    { "opId": "client-uuid", "status": "applied", "id": "server-uuid" },
    { "opId": "client-uuid", "status": "duplicate", "id": "server-uuid" },
    { "opId": "client-uuid", "status": "failed", "error": "Shopping list item not found" }
  ],
  "cursor": "djE6NDMw"
}
```

`opId` is client-generated and must be stable across retries: replaying one
returns `duplicate` with the original result rather than applying it twice.

Mutations are applied **in array order, individually — not in one transaction**.
A queue is a sequence of independent user actions, so one failure does not
discard the rest; check each result. Failures are not recorded in the
idempotency ledger, so a mutation that failed on transient state can be retried.

Supported `type` values:

| Type | Payload |
|---|---|
| `shopping_item.add` | `ingredientName` (required), `amount`, `unit`, `category`, `notes`, `id`, `listId`, `position` |
| `shopping_item.update` | `itemId` + any of `ingredientName`, `amount`, `unit`, `notes`, `category` |
| `shopping_item.toggle` | `itemId`, `checked` |
| `shopping_item.delete` | `itemId` |
| `shopping_list.clear_checked` | `listId` |
| `meal_plan_entry.add` | `weekStartDate`, `recipeId`, `dayOfWeek`, `mealType` |
| `meal_plan_entry.update` | `entryId` + any of `dayOfWeek`, `mealType`, `servings`; `weekStartDate` (with `dayOfWeek`) moves it to another week |
| `meal_plan_entry.delete` | `entryId` |
| `meal_plan_group.add` | `weekStartDate`, `title`, `dayOfWeek`, `mealType`, plus `components` (`{recipeId, role}[]`) and/or `entries` (`{entryId, role}[]`); optional `sourceMealId`, `servings`, `rememberChoices` |
| `meal_plan_group.add_from_meal` | `mealId`, `weekStartDate`, `dayOfWeek`; optional `mealType` (default: the meal's own), `optionIds` (chosen options across all slots — omit for each slot's defaults; a slot with none listed is left out), `servings`. Returns the new group's `id`; the group and its entries arrive in the next pull. The choices become the saved meal's next defaults, as on the web |
| `meal_plan_group.update` | `groupId` + any of `title`, `dayOfWeek`, `mealType`, `servings` |
| `meal_plan_group.delete` | `groupId`; `keepRecipes` leaves its recipes on the plan as separate meals |

Recipe and saved-meal edits are deliberately absent: they are rare offline and much larger to
merge. Create and edit recipes through `/api/v1/recipes` while connected.

Conflict policy is last-write-wins at whole-entity granularity — the shape that
suits a family app, where genuine concurrent edits of the same recipe are rare
and shopping-list changes are near-append-only.

## Push notifications

Shopping mutations notify the household (throttled to one push per 90 seconds
per household, shared across all shopping endpoints) on add, delete, clear-checked
and generate. Toggling an item does not notify.

Meal-plan pushes are separate and **not** throttled, because they are infrequent
and individually meaningful: adding an AI-generated plan, and generating the
week's shopping list. Both exclude the person who triggered them.

All of this lives in the service layer, so an action taken from a phone notifies
the family exactly as the same action taken in the browser does.

## Adding a domain

`/api/v1/recipes` is the reference implementation. The pattern:

- Domain logic lives in `apps/web/lib/services/<domain>.ts`. It takes a
  `HouseholdContext`, takes plain typed objects (never `FormData`), scopes every
  query by `householdId`, and never redirects or calls `revalidatePath`.
- Route handlers resolve `requireSession()`, validate with Zod, call the
  service, and return JSON. Wrap them in `withApiErrors` so domain errors map to
  the envelope above.
- Server actions in `apps/web/app/actions/` become thin: parse `FormData`, call
  the same service, then revalidate and redirect.
