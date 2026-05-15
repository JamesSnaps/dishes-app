# Dishes Week Planner — Home Assistant Card

A custom Lovelace card that displays the current week's meal plan from your Dishes app.

## Setup

### 1. Create an integration token

In Dishes, go to **Settings → Integrations** and create a token with the `read:meal_plan` scope. Copy the token value.

### 2. Copy the card file to Home Assistant

```bash
cp dishes-week-card.js /path/to/ha-config/www/dishes-week-card.js
```

Or with Docker:
```bash
docker cp dishes-week-card.js homeassistant:/config/www/dishes-week-card.js
```

### 3. Register as a Lovelace resource

In HA go to **Settings → Dashboards → Resources** (or add to `configuration.yaml`):

```yaml
lovelace:
  resources:
    - url: /local/dishes-week-card.js
      type: module
```

Then restart HA (or reload Lovelace resources).

### 4. Add the card to a dashboard

In the Lovelace dashboard editor, add a **Manual card** with:

```yaml
type: custom:dishes-week-card
url: https://your-dishes-app.example.com
token: your_integration_token_here
```

## Configuration

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `url` | Yes | — | Base URL of your Dishes app (no trailing slash) |
| `token` | Yes | — | Integration token with `read:meal_plan` scope |
| `title` | No | `This Week's Meals` | Card heading |
| `meal_types` | No | `[breakfast, lunch, dinner]` | Which meal rows to show. Options: `breakfast`, `lunch`, `dinner`, `dessert`, `snack` |

### Example with all options

```yaml
type: custom:dishes-week-card
url: https://dishes.home.example.com
token: your_token_here
title: Weekly Meals
meal_types:
  - breakfast
  - dinner
```

## Updating

When you update Dishes, copy the new `dishes-week-card.js` to `www/` and clear your browser cache (or bump the resource URL with a `?v=2` query string to force reload).
