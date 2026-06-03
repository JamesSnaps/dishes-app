import { db } from "./client";
import {
  recipes,
  recipeIngredients,
  recipeSteps,
  recipeTags,
  collections,
  recipeCollections,
  mealPlans,
  mealPlanEntries,
  shoppingLists,
  shoppingListItems,
  notes,
} from "./schema";
import { eq } from "drizzle-orm";

// ─── Dev seed data ────────────────────────────────────────────────────────────
//
// Populates a household with realistic dummy content so the app is usable
// immediately in development without Authelia or manual data entry. Idempotent:
// if the household already has recipes it does nothing, so it is safe to call on
// every dev boot.

type SeedIngredient = {
  name: string;
  amount?: string;
  unit?: string;
  prep?: string;
  optional?: boolean;
  group?: string;
};

type SeedStep = {
  text: string;
  // Indices into the recipe's ingredients array to highlight in cooking mode.
  uses?: number[];
  duration?: number;
  timer?: string;
};

type SeedRecipe = {
  title: string;
  description: string;
  cuisine: string;
  prep: number;
  cook: number;
  servings: number;
  difficulty: "easy" | "medium" | "hard";
  tags: string[];
  favourite?: boolean;
  aiGenerated?: boolean;
  collections: string[];
  ingredients: SeedIngredient[];
  steps: SeedStep[];
};

const COLLECTIONS: Record<string, { icon: string; description: string }> = {
  "Weeknight Dinners": { icon: "🍝", description: "Fast, reliable meals for busy evenings" },
  "Comfort Food": { icon: "🫕", description: "Cosy, slow-cooked favourites" },
  "Quick & Easy": { icon: "⚡", description: "On the table in 30 minutes or less" },
  Baking: { icon: "🧁", description: "Breads, cakes and sweet things" },
};

const RECIPES: SeedRecipe[] = [
  {
    title: "Classic Beef Bolognese",
    description:
      "A rich, slow-simmered ragù with beef and pork, built on a proper soffritto. Worth the time.",
    cuisine: "Italian",
    prep: 25,
    cook: 180,
    servings: 8,
    difficulty: "medium",
    tags: ["pasta", "beef", "slow-cooked", "family"],
    favourite: true,
    collections: ["Comfort Food"],
    ingredients: [
      { name: "olive oil", amount: "45", unit: "ml" },
      { name: "unsalted butter", amount: "40", unit: "g" },
      { name: "onions", amount: "2", prep: "finely chopped", group: "Soffritto" },
      { name: "carrots", amount: "2", prep: "finely chopped", group: "Soffritto" },
      { name: "celery sticks", amount: "4", prep: "finely chopped", group: "Soffritto" },
      { name: "garlic cloves", amount: "6", prep: "minced", group: "Soffritto" },
      { name: "beef mince", amount: "500", unit: "g" },
      { name: "pork mince", amount: "500", unit: "g" },
      { name: "dry red wine", amount: "480", unit: "ml" },
      { name: "chopped tomatoes", amount: "800", unit: "g" },
      { name: "tomato paste", amount: "40", unit: "g" },
      { name: "whole milk", amount: "240", unit: "ml" },
      { name: "bay leaves", amount: "2" },
      { name: "salt", prep: "to taste" },
      { name: "black pepper", prep: "to taste" },
    ],
    steps: [
      {
        text:
          "Heat the olive oil and butter in a large, heavy pot over a medium-low heat. Add the finely chopped onion, carrot and celery along with a pinch of salt, and cook gently for 10–15 minutes until soft, sweet and translucent with no browning. Add the garlic and cook for a further 30–60 seconds until fragrant, then remove the soffritto and set aside, leaving the fat behind.",
        uses: [0, 1, 2, 3, 4, 5, 13],
        duration: 15,
        timer: "Soften soffritto",
      },
      {
        text:
          "Raise the heat and brown the beef and pork mince in the same pot, breaking it up well. Take your time — a deep brown crust is where the flavour lives.",
        uses: [6, 7],
        duration: 12,
        timer: "Brown the mince",
      },
      {
        text:
          "Return the soffritto to the pot. Pour in the red wine and let it bubble until almost fully reduced, scraping up the browned bits.",
        uses: [8],
        duration: 8,
      },
      {
        text:
          "Stir in the chopped tomatoes, tomato paste, milk and bay leaves. Season, bring to a bare simmer, then cook uncovered on the lowest heat for 2–3 hours, stirring occasionally.",
        uses: [9, 10, 11, 12],
        duration: 150,
        timer: "Simmer the ragù",
      },
      {
        text: "Taste and adjust the salt and pepper. Discard the bay leaves before serving over fresh pasta.",
        uses: [13, 14, 12],
      },
    ],
  },
  {
    title: "Weeknight Chicken Stir-Fry",
    description: "Fast, fresh and endlessly adaptable — on the table in 20 minutes.",
    cuisine: "Chinese",
    prep: 15,
    cook: 10,
    servings: 4,
    difficulty: "easy",
    tags: ["chicken", "quick", "vegetables"],
    collections: ["Quick & Easy", "Weeknight Dinners"],
    ingredients: [
      { name: "chicken breasts", amount: "3", prep: "sliced thin" },
      { name: "broccoli florets", amount: "300", unit: "g" },
      { name: "red peppers", amount: "2", prep: "sliced" },
      { name: "carrots", amount: "2", prep: "julienned" },
      { name: "garlic cloves", amount: "3", prep: "minced" },
      { name: "fresh ginger", amount: "20", unit: "g", prep: "grated" },
      { name: "soy sauce", amount: "60", unit: "ml" },
      { name: "sesame oil", amount: "15", unit: "ml" },
      { name: "vegetable oil", amount: "30", unit: "ml" },
      { name: "spring onions", amount: "4", prep: "sliced" },
    ],
    steps: [
      {
        text: "Heat the vegetable oil in a wok over high heat. Sear the chicken until golden and just cooked through, then remove.",
        uses: [0, 8],
        duration: 5,
        timer: "Sear chicken",
      },
      {
        text: "Add the broccoli, peppers and carrot to the hot wok and stir-fry until crisp-tender.",
        uses: [1, 2, 3],
        duration: 4,
      },
      {
        text: "Add the garlic and ginger, toss for 30 seconds, then return the chicken with the soy sauce and sesame oil.",
        uses: [4, 5, 0, 6, 7],
      },
      { text: "Finish with sliced spring onions and serve over rice.", uses: [9] },
    ],
  },
  {
    title: "Creamy Tomato Soup",
    description: "Velvety, deeply tomatoey and ready for grilled cheese dunking.",
    cuisine: "American",
    prep: 10,
    cook: 30,
    servings: 4,
    difficulty: "easy",
    tags: ["soup", "vegetarian", "comfort"],
    favourite: true,
    collections: ["Comfort Food", "Quick & Easy"],
    ingredients: [
      { name: "onions", amount: "1", prep: "diced" },
      { name: "garlic cloves", amount: "4", prep: "minced" },
      { name: "chopped tomatoes", amount: "800", unit: "g" },
      { name: "vegetable stock", amount: "500", unit: "ml" },
      { name: "double cream", amount: "120", unit: "ml" },
      { name: "fresh basil", amount: "1", unit: "handful" },
      { name: "olive oil", amount: "30", unit: "ml" },
      { name: "salt", prep: "to taste" },
    ],
    steps: [
      { text: "Soften the onion in olive oil over medium heat, then add the garlic for a minute.", uses: [0, 6, 1], duration: 8 },
      { text: "Pour in the tomatoes and stock, season, and simmer for 20 minutes.", uses: [2, 3, 7], duration: 20, timer: "Simmer soup" },
      { text: "Blitz smooth, stir through the cream and torn basil, and serve.", uses: [4, 5] },
    ],
  },
  {
    title: "Spaghetti Carbonara",
    description: "The real thing — eggs, cheese, guanciale and pasta water. No cream.",
    cuisine: "Italian",
    prep: 10,
    cook: 15,
    servings: 4,
    difficulty: "medium",
    tags: ["pasta", "quick", "eggs"],
    collections: ["Weeknight Dinners"],
    ingredients: [
      { name: "spaghetti", amount: "400", unit: "g" },
      { name: "guanciale", amount: "150", unit: "g", prep: "diced" },
      { name: "egg yolks", amount: "4" },
      { name: "whole eggs", amount: "1" },
      { name: "pecorino romano", amount: "80", unit: "g", prep: "grated" },
      { name: "black pepper", prep: "freshly ground" },
    ],
    steps: [
      { text: "Boil the spaghetti in well-salted water until al dente, reserving a mug of pasta water.", uses: [0], duration: 10, timer: "Cook pasta" },
      { text: "Crisp the guanciale slowly in a cold pan until the fat renders and it turns golden.", uses: [1], duration: 8 },
      { text: "Whisk the egg yolks, whole egg, pecorino and lots of black pepper into a paste.", uses: [2, 3, 4, 5] },
      { text: "Toss the drained pasta with the guanciale off the heat, then stir in the egg mixture with splashes of pasta water until glossy.", uses: [0, 1, 2] },
    ],
  },
  {
    title: "Thai Green Curry",
    description: "Fragrant, coconut-rich and as hot as you dare to make it.",
    cuisine: "Thai",
    prep: 20,
    cook: 25,
    servings: 4,
    difficulty: "medium",
    tags: ["curry", "chicken", "spicy", "coconut"],
    collections: ["Weeknight Dinners"],
    ingredients: [
      { name: "green curry paste", amount: "60", unit: "g" },
      { name: "coconut milk", amount: "800", unit: "ml" },
      { name: "chicken thighs", amount: "600", unit: "g", prep: "sliced" },
      { name: "thai aubergines", amount: "200", unit: "g", prep: "quartered" },
      { name: "bamboo shoots", amount: "150", unit: "g" },
      { name: "fish sauce", amount: "30", unit: "ml" },
      { name: "palm sugar", amount: "15", unit: "g" },
      { name: "thai basil", amount: "1", unit: "handful" },
      { name: "kaffir lime leaves", amount: "4" },
    ],
    steps: [
      { text: "Fry the curry paste in the thick top of the coconut milk until split and aromatic.", uses: [0, 1], duration: 5 },
      { text: "Add the chicken and seal, then pour in the rest of the coconut milk.", uses: [2, 1], duration: 5 },
      { text: "Add the aubergines, bamboo shoots and lime leaves, and simmer until tender.", uses: [3, 4, 8], duration: 15, timer: "Simmer curry" },
      { text: "Season with fish sauce and palm sugar, finish with thai basil.", uses: [5, 6, 7] },
    ],
  },
  {
    title: "Smash Burgers",
    description: "Thin, lacy-edged patties with maximum crust. A griddle classic.",
    cuisine: "American",
    prep: 15,
    cook: 10,
    servings: 4,
    difficulty: "easy",
    tags: ["beef", "burger", "quick"],
    favourite: true,
    collections: ["Quick & Easy"],
    ingredients: [
      { name: "beef mince", amount: "600", unit: "g", prep: "80/20" },
      { name: "burger buns", amount: "4" },
      { name: "american cheese", amount: "4", unit: "slices" },
      { name: "onions", amount: "1", prep: "thinly sliced" },
      { name: "pickles", amount: "8", unit: "slices" },
      { name: "salt", prep: "to taste" },
      { name: "black pepper", prep: "to taste" },
    ],
    steps: [
      { text: "Roll the beef into loose balls. Get a griddle screaming hot.", uses: [0] },
      { text: "Smash each ball flat on the griddle, season hard, and don't touch for 2 minutes until a crust forms.", uses: [0, 5, 6], duration: 2, timer: "Sear patties" },
      { text: "Flip, top with cheese and onions, and toast the buns alongside.", uses: [2, 3, 1] },
      { text: "Stack with pickles and serve immediately.", uses: [4] },
    ],
  },
  {
    title: "Mushroom Risotto",
    description: "Slow-stirred, creamy and earthy. Meditative cooking.",
    cuisine: "Italian",
    prep: 15,
    cook: 35,
    servings: 4,
    difficulty: "medium",
    tags: ["rice", "vegetarian", "mushrooms"],
    collections: ["Comfort Food"],
    ingredients: [
      { name: "arborio rice", amount: "320", unit: "g" },
      { name: "chestnut mushrooms", amount: "400", unit: "g", prep: "sliced" },
      { name: "onions", amount: "1", prep: "finely diced" },
      { name: "garlic cloves", amount: "2", prep: "minced" },
      { name: "dry white wine", amount: "150", unit: "ml" },
      { name: "vegetable stock", amount: "1.2", unit: "l", prep: "hot" },
      { name: "parmesan", amount: "60", unit: "g", prep: "grated" },
      { name: "unsalted butter", amount: "40", unit: "g" },
    ],
    steps: [
      { text: "Brown the mushrooms in butter until golden, then set aside.", uses: [1, 7], duration: 8 },
      { text: "Soften the onion and garlic, add the rice and toast for a minute until translucent at the edges.", uses: [2, 3, 0], duration: 5 },
      { text: "Deglaze with white wine, then add hot stock a ladle at a time, stirring until each is absorbed.", uses: [4, 5], duration: 20, timer: "Stir risotto" },
      { text: "Stir the mushrooms back in with the parmesan and a knob of butter to finish.", uses: [1, 6, 7] },
    ],
  },
  {
    title: "Greek Salad",
    description: "No lettuce. Just ripe tomatoes, cucumber, feta and good oil.",
    cuisine: "Greek",
    prep: 15,
    cook: 0,
    servings: 4,
    difficulty: "easy",
    tags: ["salad", "vegetarian", "no-cook", "summer"],
    collections: ["Quick & Easy"],
    ingredients: [
      { name: "ripe tomatoes", amount: "4", prep: "cut into wedges" },
      { name: "cucumber", amount: "1", prep: "thickly sliced" },
      { name: "red onion", amount: "1", prep: "thinly sliced" },
      { name: "feta", amount: "200", unit: "g" },
      { name: "kalamata olives", amount: "100", unit: "g" },
      { name: "extra virgin olive oil", amount: "60", unit: "ml" },
      { name: "dried oregano", amount: "1", unit: "tsp" },
    ],
    steps: [
      { text: "Combine the tomatoes, cucumber and red onion in a wide bowl.", uses: [0, 1, 2] },
      { text: "Top with a slab of feta and the olives.", uses: [3, 4] },
      { text: "Drizzle generously with olive oil and shower with oregano. Don't toss.", uses: [5, 6] },
    ],
  },
  {
    title: "Banana Bread",
    description: "Dense, moist and freckled with brown spots. Best the next day.",
    cuisine: "American",
    prep: 15,
    cook: 60,
    servings: 10,
    difficulty: "easy",
    tags: ["baking", "breakfast", "sweet"],
    collections: ["Baking"],
    ingredients: [
      { name: "ripe bananas", amount: "3", prep: "mashed" },
      { name: "plain flour", amount: "250", unit: "g" },
      { name: "caster sugar", amount: "150", unit: "g" },
      { name: "unsalted butter", amount: "115", unit: "g", prep: "melted" },
      { name: "eggs", amount: "2" },
      { name: "baking soda", amount: "1", unit: "tsp" },
      { name: "vanilla extract", amount: "1", unit: "tsp" },
      { name: "walnuts", amount: "80", unit: "g", prep: "chopped", optional: true },
    ],
    steps: [
      { text: "Heat the oven to 175°C and line a loaf tin. Mash the bananas in a large bowl.", uses: [0] },
      { text: "Whisk in the melted butter, sugar, eggs and vanilla.", uses: [3, 2, 4, 6] },
      { text: "Fold in the flour and baking soda until just combined, then the walnuts.", uses: [1, 5, 7] },
      { text: "Pour into the tin and bake for 55–65 minutes until a skewer comes out clean.", uses: [], duration: 60, timer: "Bake banana bread" },
    ],
  },
  {
    title: "Fish Tacos",
    description: "Crisp battered fish, quick slaw and a lime crema in soft tortillas.",
    cuisine: "Mexican",
    prep: 25,
    cook: 15,
    servings: 4,
    difficulty: "medium",
    tags: ["fish", "tacos", "fresh"],
    collections: ["Weeknight Dinners"],
    ingredients: [
      { name: "white fish fillets", amount: "500", unit: "g", prep: "cut into strips" },
      { name: "plain flour", amount: "120", unit: "g" },
      { name: "sparkling water", amount: "180", unit: "ml" },
      { name: "corn tortillas", amount: "8" },
      { name: "white cabbage", amount: "200", unit: "g", prep: "finely shredded" },
      { name: "limes", amount: "2" },
      { name: "soured cream", amount: "120", unit: "ml" },
      { name: "fresh coriander", amount: "1", unit: "handful" },
    ],
    steps: [
      { text: "Whisk the flour and sparkling water into a loose batter.", uses: [1, 2] },
      { text: "Dip the fish strips and fry until crisp and golden, then drain.", uses: [0], duration: 6, timer: "Fry fish" },
      { text: "Toss the cabbage with the juice of one lime for a quick slaw, and mix the soured cream with the rest.", uses: [4, 5, 6] },
      { text: "Warm the tortillas, fill with fish, slaw and crema, and finish with coriander.", uses: [3, 7] },
    ],
  },
  {
    title: "Shakshuka",
    description: "Eggs poached in a spiced pepper and tomato sauce. Brunch hero.",
    cuisine: "Middle Eastern",
    prep: 10,
    cook: 25,
    servings: 4,
    difficulty: "easy",
    tags: ["eggs", "breakfast", "vegetarian"],
    collections: ["Comfort Food"],
    ingredients: [
      { name: "eggs", amount: "6" },
      { name: "chopped tomatoes", amount: "800", unit: "g" },
      { name: "red peppers", amount: "2", prep: "sliced" },
      { name: "onions", amount: "1", prep: "diced" },
      { name: "garlic cloves", amount: "3", prep: "minced" },
      { name: "ground cumin", amount: "1", unit: "tsp" },
      { name: "smoked paprika", amount: "1", unit: "tsp" },
      { name: "feta", amount: "100", unit: "g", optional: true },
    ],
    steps: [
      { text: "Soften the onion and peppers in oil, then add the garlic and spices.", uses: [3, 2, 4, 5, 6], duration: 8 },
      { text: "Pour in the tomatoes and simmer until thick and jammy.", uses: [1], duration: 12, timer: "Reduce sauce" },
      { text: "Make wells and crack in the eggs. Cover and cook until the whites set.", uses: [0], duration: 6, timer: "Poach eggs" },
      { text: "Crumble over feta and serve with bread.", uses: [7] },
    ],
  },
  {
    title: "Chocolate Chip Cookies",
    description: "Crisp edges, chewy middles, puddles of dark chocolate.",
    cuisine: "American",
    prep: 20,
    cook: 12,
    servings: 24,
    difficulty: "easy",
    tags: ["baking", "sweet", "dessert"],
    favourite: true,
    collections: ["Baking"],
    ingredients: [
      { name: "plain flour", amount: "300", unit: "g" },
      { name: "unsalted butter", amount: "170", unit: "g", prep: "softened" },
      { name: "brown sugar", amount: "200", unit: "g" },
      { name: "caster sugar", amount: "100", unit: "g" },
      { name: "eggs", amount: "2" },
      { name: "dark chocolate", amount: "200", unit: "g", prep: "chopped" },
      { name: "baking soda", amount: "1", unit: "tsp" },
      { name: "vanilla extract", amount: "2", unit: "tsp" },
      { name: "sea salt", prep: "flaky, to finish" },
    ],
    steps: [
      { text: "Cream the butter with both sugars until pale and fluffy.", uses: [1, 2, 3], duration: 4 },
      { text: "Beat in the eggs and vanilla, then fold in the flour and baking soda.", uses: [4, 7, 0, 6] },
      { text: "Fold through the chopped chocolate and chill the dough for 30 minutes.", uses: [5], duration: 30, timer: "Chill dough" },
      { text: "Scoop onto trays, sprinkle with sea salt, and bake at 180°C for 11–13 minutes.", uses: [8], duration: 12, timer: "Bake cookies" },
    ],
  },
];

const NOTES: Array<{ title: string; body: string; recipeTitle?: string }> = [
  {
    title: "Family favourites",
    body: "Kids ask for the smash burgers every Friday. Double the bolognese batch and freeze half — it's even better reheated.",
  },
  {
    title: "Bolognese tweaks",
    body: "Swap the milk for an extra splash of cream if you want it richer. A parmesan rind in the simmer adds real depth. Don't rush the soffritto — that's the whole dish.",
    recipeTitle: "Classic Beef Bolognese",
  },
  {
    title: "Shopping reminders",
    body: "Get guanciale from the Italian deli, not the supermarket — the difference is night and day for carbonara.",
  },
];

function getMondayOfWeek(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

/**
 * Seed a household with dummy content. Idempotent — returns early if the
 * household already has any recipes. Returns true if it seeded, false if skipped.
 */
export async function seedHousehold(householdId: string, memberId: string): Promise<boolean> {
  const existing = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(eq(recipes.householdId, householdId))
    .limit(1);
  if (existing.length > 0) return false;

  // ─── Collections ───────────────────────────────────────────────────────────
  const collectionIds = new Map<string, string>();
  for (const [name, meta] of Object.entries(COLLECTIONS)) {
    const [row] = await db
      .insert(collections)
      .values({ householdId, name, icon: meta.icon, description: meta.description })
      .returning({ id: collections.id });
    collectionIds.set(name, row!.id);
  }

  // ─── Recipes (+ ingredients, steps, tags, collection links) ──────────────────
  const recipeIdByTitle = new Map<string, string>();
  for (const r of RECIPES) {
    const [recipe] = await db
      .insert(recipes)
      .values({
        householdId,
        createdById: memberId,
        title: r.title,
        description: r.description,
        cuisine: r.cuisine,
        prepTimeMinutes: r.prep,
        cookTimeMinutes: r.cook,
        servings: String(r.servings),
        difficulty: r.difficulty,
        isAiGenerated: r.aiGenerated ?? false,
        isFavourite: r.favourite ?? false,
      })
      .returning({ id: recipes.id });
    const recipeId = recipe!.id;
    recipeIdByTitle.set(r.title, recipeId);

    // Ingredients — keep the inserted IDs so steps can reference them.
    const ingredientIds: string[] = [];
    for (let i = 0; i < r.ingredients.length; i++) {
      const ing = r.ingredients[i]!;
      const [inserted] = await db
        .insert(recipeIngredients)
        .values({
          recipeId,
          position: i,
          ingredientName: ing.name,
          amount: ing.amount ?? null,
          unit: ing.unit ?? null,
          preparation: ing.prep ?? null,
          isOptional: ing.optional ?? false,
          groupLabel: ing.group ?? null,
        })
        .returning({ id: recipeIngredients.id });
      ingredientIds.push(inserted!.id);
    }

    // Steps — map ingredient indices to their inserted IDs for highlighting.
    for (let i = 0; i < r.steps.length; i++) {
      const step = r.steps[i]!;
      await db.insert(recipeSteps).values({
        recipeId,
        position: i,
        instruction: step.text,
        durationMinutes: step.duration ?? null,
        timerLabel: step.timer ?? null,
        ingredientIds: (step.uses ?? []).map((idx) => ingredientIds[idx]!).filter(Boolean),
      });
    }

    if (r.tags.length > 0) {
      await db.insert(recipeTags).values(r.tags.map((tag) => ({ recipeId, tag })));
    }

    for (const c of r.collections) {
      const collectionId = collectionIds.get(c);
      if (collectionId) {
        await db.insert(recipeCollections).values({ collectionId, recipeId });
      }
    }
  }

  // ─── Meal plan for the current week ──────────────────────────────────────────
  const weekStartDate = getMondayOfWeek();
  const [plan] = await db
    .insert(mealPlans)
    .values({ householdId, createdById: memberId, weekStartDate, status: "active" })
    .returning({ id: mealPlans.id });
  const planId = plan!.id;

  // day 0=Mon … 6=Sun
  const planned: Array<{ title: string; day: number; meal: "breakfast" | "lunch" | "dinner" }> = [
    { title: "Weeknight Chicken Stir-Fry", day: 0, meal: "dinner" },
    { title: "Spaghetti Carbonara", day: 1, meal: "dinner" },
    { title: "Thai Green Curry", day: 2, meal: "dinner" },
    { title: "Smash Burgers", day: 3, meal: "dinner" },
    { title: "Fish Tacos", day: 4, meal: "dinner" },
    { title: "Classic Beef Bolognese", day: 5, meal: "dinner" },
    { title: "Shakshuka", day: 6, meal: "breakfast" },
    { title: "Greek Salad", day: 6, meal: "lunch" },
    { title: "Mushroom Risotto", day: 6, meal: "dinner" },
  ];
  for (const p of planned) {
    const recipeId = recipeIdByTitle.get(p.title);
    if (recipeId) {
      await db.insert(mealPlanEntries).values({
        mealPlanId: planId,
        recipeId,
        dayOfWeek: p.day,
        mealType: p.meal,
      });
    }
  }

  // ─── Active shopping list ────────────────────────────────────────────────────
  const [list] = await db
    .insert(shoppingLists)
    .values({ householdId, createdById: memberId, name: "This Week", status: "active" })
    .returning({ id: shoppingLists.id });
  const listId = list!.id;

  const shoppingItems: Array<{
    name: string;
    amount?: string;
    unit?: string;
    category: string;
    checked?: boolean;
  }> = [
    { name: "Chicken breasts", amount: "3", category: "Meat & Fish" },
    { name: "Beef mince", amount: "600", unit: "g", category: "Meat & Fish" },
    { name: "White fish fillets", amount: "500", unit: "g", category: "Meat & Fish" },
    { name: "Onions", amount: "6", category: "Produce", checked: true },
    { name: "Carrots", amount: "4", category: "Produce" },
    { name: "Broccoli", amount: "1", unit: "head", category: "Produce" },
    { name: "Red peppers", amount: "4", category: "Produce" },
    { name: "Garlic", amount: "2", unit: "bulbs", category: "Produce", checked: true },
    { name: "Chopped tomatoes", amount: "4", unit: "tins", category: "Pantry" },
    { name: "Coconut milk", amount: "2", unit: "tins", category: "Pantry" },
    { name: "Spaghetti", amount: "400", unit: "g", category: "Pantry" },
    { name: "Soy sauce", amount: "1", unit: "bottle", category: "Pantry" },
    { name: "Burger buns", amount: "4", category: "Bakery" },
    { name: "Corn tortillas", amount: "8", category: "Bakery" },
    { name: "Double cream", amount: "300", unit: "ml", category: "Dairy" },
    { name: "Feta", amount: "300", unit: "g", category: "Dairy", checked: true },
    { name: "Eggs", amount: "12", category: "Dairy" },
  ];
  await db.insert(shoppingListItems).values(
    shoppingItems.map((item, i) => ({
      listId,
      ingredientName: item.name,
      amount: item.amount ?? null,
      unit: item.unit ?? null,
      category: item.category,
      isChecked: item.checked ?? false,
      position: i,
    }))
  );

  // ─── Notes ───────────────────────────────────────────────────────────────────
  for (const note of NOTES) {
    await db.insert(notes).values({
      householdId,
      authorId: memberId,
      recipeId: note.recipeTitle ? recipeIdByTitle.get(note.recipeTitle) ?? null : null,
      title: note.title,
      body: note.body,
    });
  }

  return true;
}
