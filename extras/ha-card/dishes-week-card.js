// Dishes Week Planner — Home Assistant Lovelace custom card
// Drop this file in your HA config/www/ folder and add it as a resource.
//
// Card config (in Lovelace YAML):
//   type: custom:dishes-week-card
//   url: https://your-dishes-app.example.com
//   token: your_integration_token_here
//   title: This Week's Meals          # optional
//   meal_types: [breakfast, lunch, dinner]  # optional, defaults shown

const MEAL_TYPE_LABELS = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  dessert: "Dessert",
  snack: "Snack",
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const DEFAULT_MEAL_TYPES = ["breakfast", "lunch", "dinner"];

class DishesWeekCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = null;
    this._data = null;
    this._error = null;
    this._loading = false;
  }

  setConfig(config) {
    if (!config.url) throw new Error("dishes-week-card: 'url' is required");
    if (!config.token) throw new Error("dishes-week-card: 'token' is required");
    this._config = {
      url: config.url.replace(/\/$/, ""),
      token: config.token,
      title: config.title || "This Week's Meals",
      meal_types: config.meal_types || DEFAULT_MEAL_TYPES,
    };
    this._fetchData();
  }

  connectedCallback() {
    if (this._config && !this._data && !this._loading) {
      this._fetchData();
    }
  }

  async _fetchData() {
    this._loading = true;
    this._error = null;
    this._render();

    try {
      const res = await fetch(
        `${this._config.url}/api/integrations/meal-plan/week`,
        {
          headers: { Authorization: `Bearer ${this._config.token}` },
        }
      );
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${res.status}: ${body}`);
      }
      this._data = await res.json();
    } catch (e) {
      this._error = e.message;
    } finally {
      this._loading = false;
      this._render();
    }
  }

  _buildGrid() {
    const { entries } = this._data;
    const mealTypes = this._config.meal_types;

    // index entries by dayOfWeek + mealType
    const index = {};
    for (const entry of entries) {
      const key = `${entry.dayOfWeek}:${entry.mealType}`;
      if (!index[key]) index[key] = [];
      index[key].push(entry);
    }

    const rows = mealTypes.map((mealType) => {
      const cells = DAY_LABELS.map((_, dayIndex) => {
        const key = `${dayIndex}:${mealType}`;
        const meals = index[key] || [];
        if (meals.length === 0) {
          return `<td class="cell empty">—</td>`;
        }
        const items = meals
          .map(
            (m) => `<span class="recipe-name" title="${m.notes || ""}">${m.recipe.title}</span>`
          )
          .join("");
        return `<td class="cell">${items}</td>`;
      });

      return `
        <tr>
          <th class="meal-label">${MEAL_TYPE_LABELS[mealType] || mealType}</th>
          ${cells.join("")}
        </tr>`;
    });

    const todayIndex = this._getTodayIndex();

    const dayHeaders = DAY_LABELS.map((label, i) => {
      const isToday = i === todayIndex;
      return `<th class="day-header${isToday ? " today" : ""}">${label}</th>`;
    }).join("");

    return `
      <table class="grid">
        <thead>
          <tr>
            <th class="corner"></th>
            ${dayHeaders}
          </tr>
        </thead>
        <tbody>
          ${rows.join("")}
        </tbody>
      </table>`;
  }

  _getTodayIndex() {
    // JS getDay(): 0=Sun,1=Mon,...6=Sat → convert to Mon=0..Sun=6
    const jsDay = new Date().getDay();
    return jsDay === 0 ? 6 : jsDay - 1;
  }

  _render() {
    const title = this._config?.title || "This Week's Meals";

    let body;
    if (this._loading) {
      body = `<div class="state">Loading…</div>`;
    } else if (this._error) {
      body = `<div class="state error">Failed to load meals: ${this._error}</div>`;
    } else if (!this._data) {
      body = `<div class="state">No data</div>`;
    } else if (this._data.entries.length === 0) {
      body = `<div class="state">No meals planned this week.</div>`;
    } else {
      body = this._buildGrid();
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: var(--primary-font-family, sans-serif);
        }
        .card {
          background: var(--card-background-color, #fff);
          border-radius: var(--ha-card-border-radius, 12px);
          box-shadow: var(--ha-card-box-shadow, 0 2px 6px rgba(0,0,0,.15));
          padding: 16px;
          overflow: hidden;
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
        }
        .title {
          font-size: 1rem;
          font-weight: 600;
          color: var(--primary-text-color, #212121);
        }
        .refresh-btn {
          background: none;
          border: none;
          cursor: pointer;
          color: var(--secondary-text-color, #727272);
          padding: 2px 4px;
          border-radius: 4px;
          font-size: 0.85rem;
          line-height: 1;
        }
        .refresh-btn:hover {
          color: var(--primary-color, #03a9f4);
        }
        .grid {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.78rem;
        }
        .corner { width: 60px; }
        .day-header {
          text-align: center;
          font-weight: 600;
          color: var(--secondary-text-color, #727272);
          padding: 4px 2px;
          width: calc((100% - 60px) / 7);
        }
        .day-header.today {
          color: var(--primary-color, #03a9f4);
        }
        .meal-label {
          text-align: left;
          font-weight: 500;
          color: var(--secondary-text-color, #727272);
          padding: 5px 4px 5px 0;
          white-space: nowrap;
          font-size: 0.72rem;
          vertical-align: top;
        }
        .cell {
          text-align: center;
          padding: 4px 3px;
          vertical-align: top;
          border-top: 1px solid var(--divider-color, #e8e8e8);
        }
        .cell.empty {
          color: var(--disabled-text-color, #bdbdbd);
        }
        .recipe-name {
          display: block;
          color: var(--primary-text-color, #212121);
          line-height: 1.3;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }
        .state {
          text-align: center;
          color: var(--secondary-text-color, #727272);
          padding: 16px 0;
          font-size: 0.9rem;
        }
        .state.error {
          color: var(--error-color, #db4437);
          font-size: 0.8rem;
        }
      </style>
      <ha-card>
        <div class="card">
          <div class="header">
            <span class="title">${title}</span>
            <button class="refresh-btn" title="Refresh">↺</button>
          </div>
          ${body}
        </div>
      </ha-card>`;

    this.shadowRoot
      .querySelector(".refresh-btn")
      ?.addEventListener("click", () => this._fetchData());
  }

  getCardSize() {
    return 3;
  }
}

customElements.define("dishes-week-card", DishesWeekCard);
