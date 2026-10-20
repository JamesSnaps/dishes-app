/**
 * Checks the recipe web import: reading schema.org Recipe JSON-LD in the shapes
 * real sites emit, the no-recipe-data fallback, and the URL guard that stops
 * the importer fetching addresses inside the server's network.
 *
 * Usage (from apps/web): npx tsx scripts/check-recipe-web-import.ts
 * Pure apart from the guard's DNS lookups, which are only made for literal IPs
 * and dotless names here — so no network is needed.
 */

import assert from "node:assert/strict";
import {
  cleanSourceUrl,
  extractRecipeFromHtml,
  normaliseFractions,
  parseDurationMinutes,
  parseIngredientLines,
  parseYield,
  webRecipeAsText,
  webRecipeToDefaults,
} from "../lib/recipe-web-import";
import { assertPublicUrl, isPrivateAddress, UnsafeUrlError } from "../lib/safe-fetch";

const page = (head: string, body = "") =>
  `<!doctype html><html><head><title>Fallback title</title>${head}</head><body>${body}</body></html>`;
const ld = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;

// ── 1. Yoast-style @graph, HowToStep list, ImageObject, total time only ─────
{
  const html = page(
    ld({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebSite", name: "Veg box" },
        {
          "@type": "Recipe",
          name: "Creamy Cavolo Nero, Pancetta &amp; Ricotta Strozzapreti",
          description: "<p>A quick, <b>comforting</b> pasta.</p>",
          image: { "@type": "ImageObject", url: "/images/strozzapreti.jpg" },
          recipeYield: "2",
          totalTime: "PT25M",
          recipeIngredient: [
            "200g strozzapreti",
            "1 bag of cavolo nero, stripped and shredded",
            "½ tsp chilli flakes",
            "1½ tbsp olive oil",
            "For the sauce:",
            "100g ricotta",
            "Salt and pepper (optional)",
          ],
          recipeInstructions: [
            { "@type": "HowToStep", text: "Boil the pasta for 10 mins." },
            { "@type": "HowToStep", name: "Fry", text: "Fry the pancetta until crisp." },
          ],
        },
      ],
    }),
    `<meta property="og:image" content="https://cdn.example.com/og.jpg">`
  );
  const out = extractRecipeFromHtml(html, "https://www.example.co.uk/recipes/strozzapreti?utm_source=x");
  const r = out.recipe!;
  assert.ok(r, "finds the Recipe inside @graph");
  assert.equal(r.title, "Creamy Cavolo Nero, Pancetta & Ricotta Strozzapreti");
  assert.equal(r.description, "A quick, comforting pasta.");
  assert.equal(r.servings, "2");
  assert.equal(r.servingsUnit, "servings");
  assert.equal(r.prepTimeMinutes, null);
  assert.equal(r.cookTimeMinutes, 25, "a lone totalTime becomes cook time");
  assert.deepEqual(out.imageUrls, [
    "https://www.example.co.uk/images/strozzapreti.jpg",
    "https://cdn.example.com/og.jpg",
  ]);

  assert.equal(r.ingredients.length, 6, "the section heading is not an ingredient");
  assert.deepEqual(
    r.ingredients.map((i) => [i.amount, i.unit, i.ingredientName, i.preparation, i.isOptional, i.groupLabel]),
    [
      ["200", "g", "strozzapreti", "", false, ""],
      ["1", "bag", "cavolo nero", "stripped and shredded", false, ""],
      ["1/2", "tsp", "chilli flakes", "", false, ""],
      ["1 1/2", "tbsp", "olive oil", "", false, ""],
      ["100", "g", "ricotta", "", false, "For the sauce"],
      ["", "", "Salt and pepper", "", true, "For the sauce"],
    ]
  );
  assert.deepEqual(
    r.steps.map((s) => s.instruction),
    ["Boil the pasta for 10 mins.", "Fry the pancetta until crisp."],
    "HowToStep text wins over its name"
  );

  const defaults = webRecipeToDefaults(r);
  assert.equal(defaults.servings, "2");
  assert.equal(defaults.calories, null);
  assert.match(webRecipeAsText(r), /- ½ tsp chilli flakes/, "the AI sees the site's own lines");
}

// ── 2. WP Recipe Maker-style sections, keywords, nutrition, array yield ────
{
  const html = page(
    ld({
      "@context": "https://schema.org",
      "@type": ["Recipe", "NewsArticle"],
      name: "Chicken Tikka Masala",
      recipeCuisine: ["Indian"],
      recipeCategory: ["Main Course", "Dinner"],
      keywords: "curry, Indian, family favourite",
      recipeYield: ["4", "4 servings"],
      prepTime: "PT15M",
      cookTime: "PT1H",
      totalTime: "PT1H15M",
      image: ["https://img.example.com/a.jpg", "https://img.example.com/b.jpg"],
      nutrition: {
        "@type": "NutritionInformation",
        calories: "520 kcal",
        proteinContent: "38 g",
        saturatedFatContent: "6.5 g",
        sodiumContent: "0.9 g",
      },
      recipeIngredient: ["2 tbsp &frac12; fat yoghurt", "600 g chicken thighs, diced"],
      recipeInstructions: [
        {
          "@type": "HowToSection",
          name: "Marinade",
          itemListElement: [{ "@type": "HowToStep", text: "Mix the yoghurt and spices." }],
        },
        {
          "@type": "HowToSection",
          name: "Sauce",
          itemListElement: [
            { "@type": "HowToStep", text: "Soften the onions." },
            { "@type": "HowToStep", text: "Simmer for 20 minutes." },
          ],
        },
      ],
    })
  );
  const r = extractRecipeFromHtml(html, "https://example.com/tikka").recipe!;
  assert.equal(r.cuisine, "Indian");
  assert.equal(r.prepTimeMinutes, 15);
  assert.equal(r.cookTimeMinutes, 60);
  assert.equal(r.servings, "4");
  assert.equal(r.mealRole, "main");
  assert.deepEqual(r.mealTypes, ["dinner"]);
  assert.deepEqual(r.tags, ["curry", "family favourite"], "cuisine and categories aren't repeated as tags");
  assert.deepEqual(
    r.steps.map((s) => [s.groupLabel, s.instruction]),
    [
      ["Marinade", "Mix the yoghurt and spices."],
      ["Sauce", "Soften the onions."],
      ["Sauce", "Simmer for 20 minutes."],
    ]
  );
  assert.equal(r.ingredients[0]!.ingredientName, "1/2 fat yoghurt", "entities decode before parsing");
  assert.deepEqual(r.nutrition, {
    calories: 520,
    proteinG: 38,
    carbsG: null,
    fatG: null,
    saturatedFatG: 6.5,
    fiberG: null,
    sugarG: null,
    sodiumMg: 900,
  });
}

// ── 3. Method as one HTML string; JSON with raw newlines ──────────────────
{
  const raw = `{"@context":"https://schema.org","@type":"Recipe","name":"Flapjacks",
  "recipeYield":"Makes 12 squares","recipeIngredient":["250g oats","125g butter"],
  "recipeInstructions":"<ol><li>Melt the butter.</li><li>Stir in the oats.</li><li>Bake for 25 mins.</li></ol>",
  "description":"Line one
line two"}`;
  const r = extractRecipeFromHtml(
    page(`<script type='application/ld+json'>${raw}</script>`),
    "https://example.com/flapjacks"
  ).recipe!;
  assert.ok(r, "tolerates raw newlines inside JSON strings");
  assert.equal(r.servings, "12");
  assert.equal(r.servingsUnit, "squares");
  assert.deepEqual(
    r.steps.map((s) => s.instruction),
    ["Melt the butter.", "Stir in the oats.", "Bake for 25 mins."]
  );
}

// ── 4. No recipe data: AI fallback inputs, stub recipes ignored ───────────
{
  const html = page(
    `<meta name="twitter:image" content="https://img.example.com/t.jpg">` +
      `<meta content="Lovely Soup" property="og:title">` +
      ld({ "@type": "Recipe", name: "Stub", image: "https://img.example.com/stub.jpg" }),
    `<nav>Home Shop Recipes</nav><article><h1>Lovely Soup</h1><p>${"Some words. ".repeat(60)}</p>` +
      `<ul><li>1 onion</li><li>2 carrots</li></ul><script>var x = 1;</script></article><footer>© Shop</footer>`
  );
  const out = extractRecipeFromHtml(html, "https://example.com/soup");
  assert.equal(out.recipe, null, "a Recipe with no ingredients or method is not worth pre-filling");
  assert.equal(out.pageTitle, "Lovely Soup");
  assert.deepEqual(out.imageUrls, ["https://img.example.com/stub.jpg", "https://img.example.com/t.jpg"]);
  assert.match(out.pageText, /^Lovely Soup\nSome words\./);
  assert.match(out.pageText, /• 1 onion\n• 2 carrots/);
  assert.doesNotMatch(out.pageText, /Home Shop|var x|© Shop/);
}

// ── 5. UK ingredient formats ───────────────────────────────────────────────
assert.deepEqual(
  parseIngredientLines([
    "600g/1lb 5oz full-fat cream cheese",
    "25ml/1fl oz Irish cream liqueur, such as Baileys",
    "1-2 lemons, juiced",
    "2 x 400g tins chopped tomatoes",
    "3 to 4 tbsp olive oil",
  ]).map((i) => [i.amount, i.unit, i.ingredientName, i.preparation]),
  [
    ["600", "g", "full-fat cream cheese", ""],
    ["25", "ml", "Irish cream liqueur", "such as Baileys"],
    ["1-2", "", "lemons", "juiced"],
    ["2", "", "400g tins chopped tomatoes", ""],
    ["3-4", "tbsp", "olive oil", ""],
  ]
);

// ── 6. Small parsers ───────────────────────────────────────────────────────
assert.equal(parseDurationMinutes("PT1H30M"), 90);
assert.equal(parseDurationMinutes("P0DT0H20M"), 20);
assert.equal(parseDurationMinutes("PT0S"), null);
assert.equal(parseDurationMinutes("1 hour 10 mins"), 70);
assert.equal(parseDurationMinutes(""), null);
assert.deepEqual(parseYield(4), { servings: "4", servingsUnit: "servings" });
assert.deepEqual(parseYield("Serves 4-6"), { servings: "4", servingsUnit: "servings" });
assert.deepEqual(parseYield("6 people"), { servings: "6", servingsUnit: "servings" });
assert.deepEqual(parseYield(undefined), { servings: "", servingsUnit: "servings" });
assert.equal(normaliseFractions("1½ cups and ¼ tsp, 3⁄4 lb"), "1 1/2 cups and 1/4 tsp, 3/4 lb");
assert.equal(
  cleanSourceUrl("https://www.abelandcole.co.uk/recipes/creamy?utm_source=chatgpt.com&page=2#method"),
  "https://www.abelandcole.co.uk/recipes/creamy?page=2"
);

// ── 7. The URL guard ───────────────────────────────────────────────────────
for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:192.168.0.1"]) {
  assert.equal(isPrivateAddress(ip), true, `${ip} is private`);
}
for (const ip of ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946", "::ffff:8.8.8.8"]) {
  assert.equal(isPrivateAddress(ip), false, `${ip} is public`);
}

async function rejects(url: string) {
  await assert.rejects(assertPublicUrl(new URL(url)), UnsafeUrlError, `${url} is refused`);
}
async function main() {
await Promise.all([
  rejects("http://localhost/"),
  rejects("http://dishes-db:5432/"),
  rejects("http://minio/bucket"),
  rejects("http://10.0.0.5/"),
  rejects("http://[::1]/"),
  rejects("http://169.254.169.254/latest/meta-data"),
  rejects("https://example.com:8443/"),
  rejects("https://user:pass@example.com/"),
  rejects("file:///etc/passwd"),
  rejects("ftp://example.com/"),
  rejects("http://homeassistant.local/"),
]);
await assertPublicUrl(new URL("https://93.184.216.34/recipe"));

console.log("recipe web import: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
