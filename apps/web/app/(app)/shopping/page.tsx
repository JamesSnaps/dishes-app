import { Package, Plus } from "lucide-react";
import Link from "next/link";
import { db } from "@/lib/db";
import { shoppingLists, shoppingListItems, recipes } from "@dishes/db/schema";
import { eq, and, asc, desc, sql } from "drizzle-orm";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { getItemRecipeTitles, orderTitles } from "@/lib/shopping-item-sources";
import { Button } from "@dishes/ui";
import { GenerateFromRecipeButton } from "./_components/generate-from-recipe-button";
import { ShoppingListClient } from "./_components/shopping-list-client";
import { createList } from "@/app/actions/shopping";
import type { ShoppingItem } from "@/hooks/use-shopping-list";

export const metadata = { title: "Shopping" };

export default async function ShoppingPage() {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const [activeList] = await db
    .select({ id: shoppingLists.id, name: shoppingLists.name })
    .from(shoppingLists)
    .where(
      and(
        eq(shoppingLists.householdId, householdId),
        eq(shoppingLists.status, "active")
      )
    )
    .limit(1);

  const [items, allRecipes, mostOrdered] = await Promise.all([
    activeList
      ? db
          .select({
            id: shoppingListItems.id,
            listId: shoppingListItems.listId,
            ingredientName: shoppingListItems.ingredientName,
            amount: shoppingListItems.amount,
            unit: shoppingListItems.unit,
            notes: shoppingListItems.notes,
            isChecked: shoppingListItems.isChecked,
            category: shoppingListItems.category,
            position: shoppingListItems.position,
            recipeId: shoppingListItems.recipeId,
            recipeTitle: recipes.title,
          })
          .from(shoppingListItems)
          .leftJoin(recipes, eq(shoppingListItems.recipeId, recipes.id))
          .where(eq(shoppingListItems.listId, activeList.id))
          .orderBy(asc(shoppingListItems.position))
      : Promise.resolve([] as ShoppingItem[]),
    db
      .select({
        id: recipes.id,
        title: recipes.title,
        cuisine: recipes.cuisine,
        servings: recipes.servings,
        servingsUnit: recipes.servingsUnit,
      })
      .from(recipes)
      .where(eq(recipes.householdId, householdId))
      .orderBy(recipes.title),
    db
      .select({
        ingredientName: shoppingListItems.ingredientName,
        timesOrdered: sql<number>`cast(count(*) as int)`,
      })
      .from(shoppingListItems)
      .innerJoin(shoppingLists, eq(shoppingListItems.listId, shoppingLists.id))
      .where(eq(shoppingLists.householdId, householdId))
      .groupBy(shoppingListItems.ingredientName)
      .orderBy(desc(sql`count(*)`))
      .limit(10),
  ]);

  const titlesByItem = await getItemRecipeTitles(items.map((i) => i.id));

  const initialItems: ShoppingItem[] = items.map((i) => ({
    ...i,
    recipeTitle: i.recipeTitle ?? null,
    recipeTitles: orderTitles(i.recipeTitle ?? null, titlesByItem.get(i.id)),
  }));

  const checkedCount = initialItems.filter((i) => i.isChecked).length;

  // Key changes when items are deleted (clearChecked/archive), triggering a clean re-mount
  const syncKey = activeList ? `${activeList.id}-${initialItems.length}` : "empty";

  return (
    <div className="p-4 lg:p-8">
      <div className="lg:flex lg:gap-8 lg:justify-center lg:items-start">
        {/* Main list column */}
        <div className="w-full max-w-2xl lg:flex-1 lg:max-w-[672px]">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">Shopping List</h1>
              {activeList && (
                <p className="text-sm text-muted-foreground mt-0.5">
                  {activeList.name} · {initialItems.length} item{initialItems.length !== 1 ? "s" : ""}
                  {checkedCount > 0 && `, ${checkedCount} checked`}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/pantry"
                className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Package className="h-4 w-4" />
                Pantry
              </Link>
              <GenerateFromRecipeButton recipes={allRecipes} />
            </div>
          </div>

          {!activeList ? (
            <div className="flex flex-col items-center gap-4 py-16 text-center">
              <p className="text-muted-foreground">No active shopping list.</p>
              <form action={createList}>
                <Button type="submit">
                  <Plus className="mr-1.5 h-4 w-4" />
                  New list
                </Button>
              </form>
            </div>
          ) : (
            <ShoppingListClient
              key={syncKey}
              listId={activeList.id}
              initialItems={initialItems}
              mostOrdered={mostOrdered}
            />
          )}

        </div>
      </div>
    </div>
  );
}
