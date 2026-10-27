import type { TokenScope } from "@/app/actions/integration-constants";

/**
 * Single source of truth for the Integrations API surface.
 *
 * Drives both the Settings → Integrations reference page and the generated
 * OpenAPI document at /api/integrations/openapi.json, so the two can't drift.
 * When you add or change a route under app/api/integrations/, update the entry
 * here and API.md in the same change.
 */

export type JsonSchema = {
  type?: "string" | "integer" | "number" | "boolean" | "object" | "array";
  description?: string;
  format?: string;
  enum?: readonly (string | number)[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  example?: unknown;
};

export type ParamDoc = {
  name: string;
  in: "query" | "path";
  required: boolean;
  schema: JsonSchema;
  description: string;
  /** Pre-fills the Try-it console. */
  example?: string;
};

export type EndpointDoc = {
  /** Stable id; doubles as the OpenAPI operationId (what AI tools call it). */
  id: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  /** null: any valid token may call it. */
  scope: TokenScope | null;
  summary: string;
  description: string;
  params?: ParamDoc[];
  body?: { schema: JsonSchema; example: unknown };
  response: { status: number; description: string; example: unknown };
  errors?: { status: number; description: string }[];
  /** Calls the AI provider — slow and costs credit. Flagged in the Try-it console. */
  costly?: boolean;
};

export const SCOPE_DESCRIPTIONS: Record<TokenScope, string> = {
  "read:meal_plan": "Read meal plan entries and full recipes",
  "write:meal_plan": "Trigger AI meal plan generation",
  "read:shopping_list": "Read the active shopping list",
  "write:shopping_list": "Add items to the active shopping list",
  "read:deliveries": "Read grocery delivery days and order status",
  "write:deliveries": "Record grocery orders (e.g. from retailer emails)",
  "read:cooking": "See who is cooking right now: the dish, the step and the running timers",
};

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;

const RECIPE_SUMMARY_EXAMPLE = {
  id: "8f14e45f-ceea-4e7a-9c1b-2b6d1f0e9a11",
  title: "Chicken Tikka Masala",
  cuisine: "Indian",
  prepTimeMinutes: 20,
  cookTimeMinutes: 35,
  calories: 650,
};

const NEXT_DELIVERY_EXAMPLE = {
  date: "2026-10-19",
  status: "scheduled",
  slot: null,
  total: null,
  orderReference: null,
  orderBy: "2026-10-18T22:00:00.000Z",
  orderByLabel: "23:00 tomorrow",
  covers: ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"],
  unplannedDinners: ["2026-10-21"],
  mealsNotOnList: 1,
  itemsNotInBasket: 6,
  addedSinceOrder: [],
};

const ORDER_RESULT_EXAMPLE = {
  action: "ordered",
  delivery: {
    date: "2026-10-19",
    status: "ordered",
    slot: "08:00-09:00",
    total: "94.20",
    orderReference: "1234567890",
  },
};

const DELIVERY_ENDPOINTS: EndpointDoc[] = [
  {
    id: "getDeliveries",
    method: "GET",
    path: "/api/integrations/deliveries",
    scope: "read:deliveries",
    summary: "Grocery deliveries",
    description:
      "The next grocery order that's still open, with what's left to do before it closes: dinners not planned in the days it covers, planned meals not on the shopping list, and items not ticked off (ticked = in the online basket). Once ordered, addedSinceOrder lists items added afterwards that need amending in. upcoming lists deliveries for the next two weeks; status is scheduled, ordered or skipped, and orderBy is the order deadline. Good for a Home Assistant sensor.",
    response: {
      status: 200,
      description: "`next` is null when no order is open.",
      example: {
        today: "2026-10-17",
        timezone: "Europe/London",
        deliveryWeekdays: [0, 4],
        next: NEXT_DELIVERY_EXAMPLE,
        upcoming: [
          {
            date: "2026-10-19",
            status: "scheduled",
            regular: true,
            away: null,
            slot: null,
            total: null,
            orderReference: null,
            orderBy: "2026-10-18T22:00:00.000Z",
          },
        ],
      },
    },
  },
  {
    id: "ingestDeliveryEmail",
    method: "POST",
    path: "/api/integrations/deliveries/email",
    scope: "write:deliveries",
    summary: "Record an order from a retailer email",
    description:
      "Forward an order email from Sainsbury's, Tesco, Ocado or similar, e.g. from an n8n email trigger. The household's AI reads it and the delivery for that date is marked ordered (confirmation), updated (amendment, including moving to another day) or put back to not-ordered (cancellation); a delivered/receipt email records the final total. The order number links later emails to the same order. Anything else (marketing, \"you can still amend\" reminders) is ignored. Members with delivery reminders on get a push. Send text or html; text wins if both are given.",
    costly: true,
    body: {
      schema: {
        type: "object",
        properties: {
          subject: { type: "string", description: "Email subject." },
          from: { type: "string", description: "Sender address." },
          receivedAt: {
            type: "string",
            format: "date-time",
            description: "When it arrived. Dates without a year are read relative to it. Defaults to now.",
          },
          text: { type: "string", description: "Plain-text body." },
          html: { type: "string", description: "HTML body, used when text is missing." },
        },
      },
      example: {
        subject: "Your Sainsbury's order confirmation",
        from: "groceries@sainsburys.co.uk",
        receivedAt: "2026-10-17T19:42:00Z",
        text: "Thanks for your order 1234567890. Delivery: Monday 19 October, 8:00am - 9:00am. Order total £94.20",
      },
    },
    response: {
      status: 200,
      description:
        "What happened (ordered, updated, cancelled or ignored) and what the AI read. movedFrom is set when an amendment moved the delivery to another day.",
      example: {
        ...ORDER_RESULT_EXAMPLE,
        extracted: {
          kind: "placed",
          retailer: "Sainsbury's",
          orderReference: "1234567890",
          deliveryDate: "2026-10-19",
          slotStart: "08:00",
          slotEnd: "09:00",
          total: 94.2,
        },
      },
    },
    errors: [
      { status: 400, description: "Body isn't valid JSON or has no text, html or subject." },
      { status: 422, description: "The household has no AI key set up (Settings → AI)." },
      { status: 502, description: "The AI call failed or returned something unreadable." },
    ],
  },
  {
    id: "recordDeliveryOrder",
    method: "POST",
    path: "/api/integrations/deliveries/order",
    scope: "write:deliveries",
    summary: "Record an order from parsed details",
    description:
      "Like ingestDeliveryEmail without the AI, for when you've already pulled out the details. kind placed or amended marks the date ordered (an amendment with a known orderReference and a new deliveryDate moves it); cancelled puts it back to not-ordered; delivered records the final total. Needs a deliveryDate, an orderReference, or both.",
    body: {
      schema: {
        type: "object",
        required: ["kind"],
        properties: {
          kind: { type: "string", enum: ["placed", "amended", "cancelled", "delivered"], default: "placed" },
          deliveryDate: { type: "string", format: "date", description: "YYYY-MM-DD." },
          slot: { type: "string", description: "e.g. \"08:00-09:00\" or \"7-8pm\"." },
          total: { type: "number", description: "Order total in pounds." },
          orderReference: { type: "string", description: "The retailer's order number." },
          retailer: { type: "string", description: "Shown in the push, e.g. \"Sainsbury's\"." },
        },
      },
      example: {
        kind: "placed",
        deliveryDate: "2026-10-19",
        slot: "08:00-09:00",
        total: 94.2,
        orderReference: "1234567890",
        retailer: "Sainsbury's",
      },
    },
    response: {
      status: 201,
      description: "What happened. 200 with action \"ignored\" when there was nothing to update.",
      example: ORDER_RESULT_EXAMPLE,
    },
    errors: [{ status: 400, description: "Bad JSON, unknown kind, bad date, or neither date nor reference." }],
  },
];

export const INTEGRATION_ENDPOINTS: EndpointDoc[] = [
  {
    id: "getToken",
    method: "GET",
    path: "/api/integrations/token",
    scope: null,
    summary: "This token",
    description:
      "The calling token's name, household and scopes. Any valid token may call it — use it to check a token works and to offer only what its scopes allow.",
    response: {
      status: 200,
      description: "The token.",
      example: {
        name: "Home Assistant",
        household: "The Snaps",
        scopes: ["read:meal_plan", "read:cooking", "read:shopping_list", "write:shopping_list"],
      },
    },
  },
  {
    id: "getToday",
    method: "GET",
    path: "/api/integrations/today",
    scope: "read:meal_plan",
    summary: "Today's meals",
    description:
      "Every meal planned for today, across all meal types. \"Today\" is the household's date in its own timezone (Settings → Dinner reminders), not the server's. Each meal includes a recipe summary; pass recipe.id to getRecipe for ingredients and method. Dishes that are part of a combined meal (a roast and its sides) share a mealGroup { id, title, role }; role is main, side, sauce or other. mealGroup is null for a dish planned on its own. serveAt is when the meal should be ready (its own ready-by time, else the day's dinner time for dinner; null otherwise). dinner is tonight's dinner time and when to start cooking it — the time the start-cooking reminder goes by; startCookingAt is null when no dinner is planned or nobody is cooking. outsideMeals lists meals today not cooked from the plan — kind is eat_out, takeaway, at_friends or skipped; calories is the AI's estimate once made (nutritionSource ai), typed in (manual) or null (none); courses is [] for one dish, else each course in eating order (course starter/main/side/dessert/drink, name, calories) with calories above the whole sitting. When dinner is one of them, dinner.notCooking is its kind and there's no reminder. nextDelivery is the next grocery order still open (see getDeliveries), or null when delivery days aren't set up.",
    response: {
      status: 200,
      description: "Today's meals. `meals` is empty when nothing is planned.",
      example: {
        date: "2026-10-03",
        timezone: "Europe/London",
        meals: [
          {
            id: "3c59dc04-8f2b-4b7e-a1d0-6a2f4c9b7e01",
            mealType: "dinner",
            servings: "4",
            notes: null,
            serveAt: "2026-10-03T16:30:00.000Z",
            mealGroup: null,
            recipe: RECIPE_SUMMARY_EXAMPLE,
          },
          {
            id: "e4da3b7f-bbce-4d34-9e7a-0b1c2d3e4f50",
            mealType: "dinner",
            servings: "4",
            notes: null,
            serveAt: "2026-10-03T16:30:00.000Z",
            mealGroup: {
              id: "1679091c-5a88-4faf-afb5-e6087eb1b2dc",
              title: "Sunday roast",
              role: "main",
            },
            recipe: { ...RECIPE_SUMMARY_EXAMPLE, title: "Roast Chicken", cuisine: "British" },
          },
        ],
        outsideMeals: [
          {
            id: "45c48cce-2e2d-4fbd-a1b2-c3d4e5f6a7b8",
            date: "2026-10-03",
            dayOfWeek: 5,
            mealType: "lunch",
            kind: "eat_out",
            title: "Fish & chips",
            place: "The Harbour Café",
            cuisine: "British",
            calories: 1150,
            nutritionSource: "ai",
            courses: [],
          },
        ],
        dinner: {
          time: "17:30",
          serveAt: "2026-10-03T16:30:00.000Z",
          startCookingAt: "2026-10-03T15:20:00.000Z",
          reminderEnabled: true,
          notCooking: null,
        },
        nextDelivery: null,
      },
    },
  },
  {
    id: "getWeekMealPlan",
    method: "GET",
    path: "/api/integrations/meal-plan/week",
    scope: "read:meal_plan",
    summary: "Week meal plan",
    description:
      "All meal plan entries for one week. dayOfWeek runs 0 = Monday to 6 = Sunday. planStatus is draft, active or archived. Entries in a combined meal share a mealGroup { id, title, role } (null otherwise), and serveAt is when the meal should be ready (null for meals with no time), as in getToday. outsideMeals are the week's meals not cooked from the plan (eating out, takeaways, at friends', skipped), in the same shape as getToday's; a recipe still planned in one of their slots won't be cooked.",
    params: [
      {
        name: "week",
        in: "query",
        required: false,
        schema: { type: "string", format: "date" },
        description:
          "A date in the week to fetch (YYYY-MM-DD); its Monday is used. Defaults to the current week in the household's timezone.",
      },
    ],
    response: {
      status: 200,
      description: "The week's entries. `entries` is empty when no plan exists.",
      example: {
        weekStartDate: "2026-09-28",
        timezone: "Europe/London",
        planStatus: "active",
        entries: [
          {
            id: "a87ff679-a2f3-4d1c-8e0b-5c1d2e3f4a5b",
            dayOfWeek: 0,
            mealType: "dinner",
            servings: "4",
            notes: null,
            serveAt: "2026-09-28T16:30:00.000Z",
            mealGroup: null,
            recipe: { ...RECIPE_SUMMARY_EXAMPLE, title: "Pasta Carbonara", cuisine: "Italian" },
          },
        ],
        outsideMeals: [
          {
            id: "c9f0f895-fb98-4b91-8a2b-3c4d5e6f7a8b",
            date: "2026-10-02",
            dayOfWeek: 4,
            mealType: "dinner",
            kind: "takeaway",
            title: "Chicken tikka masala",
            place: "Spice Garden",
            cuisine: "Indian",
            calories: null,
            nutritionSource: "none",
            courses: [],
          },
        ],
      },
    },
  },
  {
    id: "getRecipe",
    method: "GET",
    path: "/api/integrations/recipes/{id}",
    scope: "read:meal_plan",
    summary: "Full recipe",
    description:
      "One recipe from the household library with ingredients, numbered steps and per-serving nutrition. Recipe ids come from getToday and getWeekMealPlan.",
    params: [
      {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
        description: "Recipe id (recipe.id from today or the week plan).",
      },
    ],
    response: {
      status: 200,
      description: "The recipe.",
      example: {
        recipe: {
          ...RECIPE_SUMMARY_EXAMPLE,
          description: "A creamy, mildly spiced curry.",
          difficulty: "medium",
          servings: "4",
          servingsUnit: "servings",
          mealTypes: ["dinner"],
          tags: ["curry", "family"],
          notes: null,
          sourceUrl: null,
          nutrition: {
            calories: 650,
            proteinG: 42,
            carbsG: 38,
            fatG: 34,
            saturatedFatG: 12,
            fiberG: 5,
            sugarG: 9,
            sodiumMg: 980,
          },
          ingredients: [
            {
              id: "e4da3b7f-bbce-4345-9e7a-1f2d3c4b5a69",
              ingredientName: "chicken thighs",
              amount: "600",
              unit: "g",
              preparation: "diced",
              isOptional: false,
              groupLabel: null,
            },
          ],
          steps: [
            {
              step: 1,
              instruction: "Marinate the chicken in yoghurt and spices for 20 minutes.",
              durationMinutes: 20,
              timerLabel: "Marinate",
              groupLabel: null,
              ingredientIds: ["e4da3b7f-bbce-4345-9e7a-1f2d3c4b5a69"],
            },
          ],
        },
      },
    },
    errors: [{ status: 404, description: "No recipe with that id in this household." }],
  },
  {
    id: "getCooking",
    method: "GET",
    path: "/api/integrations/cooking",
    scope: "read:cooking",
    summary: "Who's cooking now",
    description:
      "The cooks in progress in cooking mode, on any of the household's devices: who is cooking, the dish, the step on screen and its timers. A cook left open but untouched for 15 minutes, with no timer still running, isn't listed. members lists the household's active members with cooking: true for each one cooking now. Timer endsAt is set while a timer runs (null when paused or finished); remainingSeconds is as of the response. Read-only: cooks are only changed by the device cooking them.",
    response: {
      status: 200,
      description: "`cooking` is false and `sessions` is empty when nobody is cooking.",
      example: {
        cooking: true,
        members: [
          { id: "45c48cce-2e2d-4fbd-8a5c-1b2c3d4e5f60", name: "James", cooking: true },
          { id: "d3d94468-02a4-4b1e-9c3d-2e3f4a5b6c71", name: "Sam", cooking: false },
        ],
        sessions: [
          {
            id: "6512bd43-d9ca-4a6e-8e0f-3a4b5c6d7e82",
            memberId: "45c48cce-2e2d-4fbd-8a5c-1b2c3d4e5f60",
            memberName: "James",
            title: "Sunday roast",
            dish: "Roast Chicken",
            step: 3,
            totalSteps: 8,
            instruction: "Baste the chicken and return it to the oven for 25 minutes.",
            device: "iPad",
            startedAt: "2026-10-04T15:05:00.000Z",
            updatedAt: "2026-10-04T15:41:12.000Z",
            timers: [
              {
                id: "roast-1",
                label: "Roast",
                dish: "Roast Chicken",
                state: "running",
                endsAt: "2026-10-04T16:06:00.000Z",
                remainingSeconds: 1488,
                durationSeconds: 1500,
              },
            ],
          },
        ],
      },
    },
  },
  {
    id: "getShoppingList",
    method: "GET",
    path: "/api/integrations/shopping-list",
    scope: "read:shopping_list",
    summary: "Active shopping list",
    description: "The household's active shopping list and all of its items.",
    response: {
      status: 200,
      description: "`list` is null and `items` is empty when there is no active list.",
      example: {
        list: {
          id: "1679091c-5a88-4faf-8b0e-2d3c4e5f6a7b",
          name: "Shopping – 3 Oct",
          createdAt: "2026-10-03T09:00:00.000Z",
        },
        items: [
          {
            id: "c4ca4238-a0b9-4382-8dcc-509a6f75849b",
            ingredientName: "Chicken breast",
            amount: "500",
            unit: "g",
            category: "meat",
            isChecked: false,
            position: 0,
          },
        ],
      },
    },
  },
  {
    id: "addShoppingItems",
    method: "POST",
    path: "/api/integrations/shopping-list/items",
    scope: "write:shopping_list",
    summary: "Add shopping items",
    description:
      "Adds structured items to the active shopping list, creating a list if none is active. Items with an empty ingredientName are skipped.",
    body: {
      schema: {
        type: "object",
        required: ["items"],
        properties: {
          items: {
            type: "array",
            minItems: 1,
            description: "Items to add.",
            items: {
              type: "object",
              required: ["ingredientName"],
              properties: {
                ingredientName: { type: "string", description: "Name of the ingredient." },
                amount: { type: "string", description: "Quantity, kept as text so fractions survive." },
                unit: { type: "string", description: "Unit of measure, e.g. g, ml, litres." },
                category: { type: "string", description: "Aisle/category label, e.g. produce, dairy." },
              },
            },
          },
        },
      },
      example: {
        items: [
          { ingredientName: "Milk", amount: "2", unit: "litres", category: "dairy" },
          { ingredientName: "Bread" },
        ],
      },
    },
    response: {
      status: 201,
      description: "How many items were added and to which list.",
      example: { added: 2, listId: "1679091c-5a88-4faf-8b0e-2d3c4e5f6a7b" },
    },
    errors: [{ status: 400, description: "Body isn't valid JSON or `items` is missing/empty." }],
  },
  {
    id: "quickAddShoppingItem",
    method: "POST",
    path: "/api/integrations/shopping-list/quick-add",
    scope: "write:shopping_list",
    summary: "Quick-add one item",
    description:
      "Adds a single item from free text, exactly as spoken or typed. Built for Siri Shortcuts and voice assistants.",
    body: {
      schema: {
        type: "object",
        required: ["text"],
        properties: {
          text: { type: "string", description: "The item, e.g. \"2 pints of milk\"." },
        },
      },
      example: { text: "2 pints of milk" },
    },
    response: {
      status: 201,
      description: "The item that was added.",
      example: {
        added: "2 pints of milk",
        listId: "1679091c-5a88-4faf-8b0e-2d3c4e5f6a7b",
        itemId: "c81e728d-9d4c-4f63-af06-7f89cc14862c",
      },
    },
    errors: [{ status: 400, description: "Body isn't valid JSON or `text` is empty." }],
  },
  {
    id: "updateShoppingItem",
    method: "PATCH",
    path: "/api/integrations/shopping-list/items/{id}",
    scope: "write:shopping_list",
    summary: "Tick off or rename an item",
    description:
      "Checks or unchecks an item on the household's shopping list, or renames it. Item ids come from getShoppingList.",
    params: [
      {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
        description: "Item id (items[].id from getShoppingList).",
      },
    ],
    body: {
      schema: {
        type: "object",
        properties: {
          isChecked: { type: "boolean", description: "Ticked off (true) or still to buy (false)." },
          ingredientName: { type: "string", description: "A new name for the item." },
        },
      },
      example: { isChecked: true },
    },
    response: {
      status: 200,
      description: "The item id and the fields that changed.",
      example: { id: "c4ca4238-a0b9-4382-8dcc-509a6f75849b", isChecked: true },
    },
    errors: [
      { status: 400, description: "Bad JSON, a field of the wrong type, or nothing to update." },
      { status: 404, description: "No item with that id on this household's lists." },
    ],
  },
  {
    id: "deleteShoppingItem",
    method: "DELETE",
    path: "/api/integrations/shopping-list/items/{id}",
    scope: "write:shopping_list",
    summary: "Remove an item",
    description: "Removes an item from the household's shopping list.",
    params: [
      {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
        description: "Item id (items[].id from getShoppingList).",
      },
    ],
    response: {
      status: 200,
      description: "The id of the removed item.",
      example: { deleted: "c4ca4238-a0b9-4382-8dcc-509a6f75849b" },
    },
    errors: [{ status: 404, description: "No item with that id on this household's lists." }],
  },
  {
    id: "generateMealPlan",
    method: "POST",
    path: "/api/integrations/meal-plan/generate",
    scope: "write:meal_plan",
    summary: "AI meal plan generation",
    description:
      "Generates meals for a week with AI, writes each one up as a full recipe in the library and links it into the plan. Slow (two AI calls per meal) and uses the household's AI credit. Days the household isn't cooking that meal (eating out, a takeaway… — see getWeekMealPlan's outsideMeals) are skipped and listed in notCooking.",
    costly: true,
    body: {
      schema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "What to generate.",
            default: "family-friendly weeknight dinners",
          },
          week: { type: "string", format: "date", description: "Monday of the target week. Defaults to the current week." },
          days: {
            type: "array",
            items: { type: "integer", minimum: 0, maximum: 6 },
            description: "Days to fill, 0 = Mon … 6 = Sun. Takes precedence over count.",
          },
          count: {
            type: "integer",
            minimum: 1,
            maximum: 7,
            default: 7,
            description: "Number of days from Monday when days isn't given.",
          },
          mealType: { type: "string", enum: MEAL_TYPES, default: "dinner", description: "Slot to fill." },
          overwrite: {
            type: "boolean",
            default: false,
            description: "Replace existing entries in the same day + meal-type slots.",
          },
          maxCaloriesPerMeal: { type: "integer", description: "Optional per-serving calorie cap (kcal)." },
        },
      },
      example: { prompt: "quick vegetarian dinners", days: [0, 2, 4], mealType: "dinner" },
    },
    response: {
      status: 201,
      description: "The generated meals. `complete` is false for a meal whose full write-up failed.",
      example: {
        planId: "eccbc87e-4b5c-4e2f-8a3b-1c2d3e4f5a6b",
        weekStartDate: "2026-09-28",
        mealType: "dinner",
        meals: [
          {
            dayOfWeek: 0,
            day: "Mon",
            mealType: "dinner",
            recipeTitle: "Halloumi Traybake",
            recipeId: "8f14e45f-ceea-4e7a-9c1b-2b6d1f0e9a11",
            calories: 610,
            complete: true,
          },
        ],
        notCooking: ["Fri"],
      },
    },
    errors: [
      {
        status: 409,
        description:
          "A requested slot already has an entry and overwrite is false, or the household isn't cooking on any of the requested days.",
      },
      { status: 502, description: "The AI returned an unexpected or incomplete response." },
    ],
  },
  ...DELIVERY_ENDPOINTS,
];

export const COMMON_ERRORS = [
  { status: 401, description: "Missing, invalid or expired token." },
  { status: 403, description: "Token lacks the endpoint's scope." },
  { status: 429, description: "Rate limit (100 requests/minute per token) exceeded. See Retry-After." },
];

/** Flattens a body schema into rows for the reference table (items[].name etc). */
export function flattenFields(
  schema: JsonSchema,
  prefix = ""
): { name: string; type: string; required: boolean; description: string }[] {
  const rows: { name: string; type: string; required: boolean; description: string }[] = [];
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    const name = prefix + key;
    const type =
      prop.type === "array" ? `${prop.items?.type ?? "any"}[]` : prop.enum ? prop.enum.join(" | ") : (prop.type ?? "any");
    const extra = prop.default !== undefined ? ` Default: ${JSON.stringify(prop.default)}.` : "";
    rows.push({
      name,
      type,
      required: schema.required?.includes(key) ?? false,
      description: (prop.description ?? "") + extra,
    });
    if (prop.type === "array" && prop.items?.type === "object") {
      rows.push(...flattenFields(prop.items, `${name}[].`));
    }
  }
  return rows;
}

/** A copy-pasteable curl command, with the token left as an env var. */
export function curlExample(ep: EndpointDoc, origin: string): string {
  const path = ep.path.replace("{id}", ep.params?.find((p) => p.in === "path")?.example ?? "<recipe-id>");
  const lines = [`curl${ep.method === "POST" ? " -X POST" : ""} "${origin}${path}"`, `  -H "Authorization: Bearer $DISHES_TOKEN"`];
  if (ep.body) {
    lines.push(`  -H "Content-Type: application/json"`);
    lines.push(`  -d '${JSON.stringify(ep.body.example)}'`);
  }
  return lines.join(" \\\n");
}
