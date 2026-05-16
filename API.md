# Dishes — Integrations API

External JSON API for use with n8n, Home Assistant, dashboards, and other automation tools.

---

## Authentication

All requests must include a Bearer token in the `Authorization` header. Tokens are created and managed at **Settings → Integrations** in the app (admin only).

```
Authorization: Bearer <token>
```

Tokens carry granular scopes. Each endpoint documents the required scope. Requests with a missing or invalid token receive `401`; requests with a valid token that lacks the required scope receive `403`.

## Rate limiting

100 requests per minute per token (fixed window). Exceeding the limit returns `429` with a `Retry-After` header (seconds until the window resets). Rate limiting is enforced via Redis and is a no-op if Redis is unavailable.

## Scopes

| Scope | Description |
|---|---|
| `read:meal_plan` | Read meal plan entries and recipes |
| `write:meal_plan` | Create meal plan entries and trigger AI generation |
| `read:shopping_list` | Read the active shopping list |
| `write:shopping_list` | Add items to the active shopping list |

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
      "recipe": {
        "id": "uuid",
        "title": "Chicken Tikka Masala",
        "cuisine": "Indian",
        "prepTimeMinutes": 20,
        "cookTimeMinutes": 35
      }
    }
  ]
}
```

`meals` is empty `[]` if no plan exists for the current week or no entries fall on today.

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
      "recipe": {
        "id": "uuid",
        "title": "Pasta Carbonara",
        "cuisine": "Italian",
        "prepTimeMinutes": 10,
        "cookTimeMinutes": 20
      }
    }
  ]
}
```

`dayOfWeek` values: `0` = Monday … `6` = Sunday.  
`planStatus`: `"draft"` | `"active"` | `"archived"`.  
`entries` is empty `[]` if no plan exists for the week.

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

Triggers AI meal plan generation for a given week. Creates stub recipes and adds them to the meal plan. The household must have an AI API key configured in **Settings → AI**.

**Scope:** `write:meal_plan`

**Request body** (all fields optional)

```json
{
  "prompt": "family-friendly weeknight dinners",
  "week": "2026-05-11",
  "days": [0, 2, 4],
  "count": 7,
  "mealType": "dinner",
  "overwrite": false
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
      "recipeId": "uuid"
    },
    {
      "dayOfWeek": 2,
      "day": "Wed",
      "mealType": "dinner",
      "recipeTitle": "Spaghetti Bolognese",
      "recipeId": "uuid"
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
