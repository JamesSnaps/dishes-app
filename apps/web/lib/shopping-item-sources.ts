import { db } from "@/lib/db";
import { shoppingListItemRecipes, recipes } from "@dishes/db/schema";
import { eq, inArray, asc } from "drizzle-orm";

/** One contributing recipe: enough to link to it from the shopping list. */
export type RecipeSource = { id: string; title: string };

/** Map of shopping item id → every recipe that contributed to it. */
export async function getItemRecipeSources(
  itemIds: string[]
): Promise<Map<string, RecipeSource[]>> {
  if (itemIds.length === 0) return new Map();

  const rows = await db
    .select({
      itemId: shoppingListItemRecipes.itemId,
      id: shoppingListItemRecipes.recipeId,
      title: recipes.title,
    })
    .from(shoppingListItemRecipes)
    .innerJoin(recipes, eq(shoppingListItemRecipes.recipeId, recipes.id))
    .where(inArray(shoppingListItemRecipes.itemId, itemIds))
    .orderBy(asc(recipes.title));

  const map = new Map<string, RecipeSource[]>();
  for (const row of rows) {
    const list = map.get(row.itemId) ?? [];
    list.push({ id: row.id, title: row.title });
    map.set(row.itemId, list);
  }
  return map;
}

/** All contributing recipes with the primary (linked) one first, deduped by id. */
export function orderSources(
  primary: RecipeSource | null,
  sources: RecipeSource[] | undefined
): RecipeSource[] {
  const list = sources ?? (primary ? [primary] : []);
  if (!primary) return list;
  return [primary, ...list.filter((s) => s.id !== primary.id)];
}
