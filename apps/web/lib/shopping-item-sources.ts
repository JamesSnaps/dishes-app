import { db } from "@/lib/db";
import { shoppingListItemRecipes, recipes } from "@dishes/db/schema";
import { eq, inArray, asc } from "drizzle-orm";

/** Map of shopping item id → titles of every recipe that contributed to it. */
export async function getItemRecipeTitles(
  itemIds: string[]
): Promise<Map<string, string[]>> {
  if (itemIds.length === 0) return new Map();

  const rows = await db
    .select({
      itemId: shoppingListItemRecipes.itemId,
      title: recipes.title,
    })
    .from(shoppingListItemRecipes)
    .innerJoin(recipes, eq(shoppingListItemRecipes.recipeId, recipes.id))
    .where(inArray(shoppingListItemRecipes.itemId, itemIds))
    .orderBy(asc(recipes.title));

  const map = new Map<string, string[]>();
  for (const row of rows) {
    const list = map.get(row.itemId) ?? [];
    list.push(row.title);
    map.set(row.itemId, list);
  }
  return map;
}

/** All contributing titles with the primary (linked) recipe first. */
export function orderTitles(
  primaryTitle: string | null,
  titles: string[] | undefined
): string[] {
  const list = titles ?? (primaryTitle ? [primaryTitle] : []);
  if (!primaryTitle) return list;
  return [primaryTitle, ...list.filter((t) => t !== primaryTitle)];
}
