import { Package, Plus } from "lucide-react";
import Link from "next/link";
import { db } from "@/lib/db";
import { shoppingLists, shoppingListItems, recipes } from "@dishes/db/schema";
import { eq, and, asc, desc, sql } from "drizzle-orm";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { Button } from "@dishes/ui";
import { AddItemForm } from "./_components/add-item-form";
import { GenerateFromRecipeButton } from "./_components/generate-from-recipe-button";
import { ShoppingListView } from "./_components/shopping-list-view";
import { OrderHistory } from "./_components/order-history";
import { ListActions } from "./_components/list-actions";
import { createList } from "@/app/actions/shopping";

export const metadata = { title: "Shopping" };

const CATEGORY_ORDER = [
  "Produce",
  "Dairy",
  "Meat",
  "Fish",
  "Bakery",
  "Pantry",
  "Frozen",
  "Drinks",
  "Cleaning",
  "Other",
  null,
];

export default async function ShoppingPage() {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const [activeList] = await db
    .select({
      id: shoppingLists.id,
      name: shoppingLists.name,
    })
    .from(shoppingLists)
    .where(
      and(
        eq(shoppingLists.householdId, householdId),
        eq(shoppingLists.status, "active")
      )
    )
    .limit(1);

  type Item = {
    id: string;
    ingredientName: string;
    amount: string | null;
    unit: string | null;
    notes: string | null;
    isChecked: boolean;
    category: string | null;
    position: number;
    recipeId: string | null;
    recipeTitle: string | null;
  };

  const [items, allRecipes, mostOrdered] = await Promise.all([
    activeList
      ? db
          .select({
            id: shoppingListItems.id,
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
      : Promise.resolve([] as Item[]),
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

  // Group items by category
  const grouped = new Map<string | null, Item[]>();
  for (const item of items) {
    const key = item.category ?? null;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(item);
  }

  const groups = [...grouped.entries()]
    .sort(([a], [b]) => {
      const ai = CATEGORY_ORDER.indexOf(a);
      const bi = CATEGORY_ORDER.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    })
    .map(([category, groupItems]) => ({ category, items: groupItems }));

  const hasChecked = items.some((i) => i.isChecked);
  const checkedCount = items.filter((i) => i.isChecked).length;

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
                  {activeList.name} · {items.length} item{items.length !== 1 ? "s" : ""}
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
            <div className="flex flex-col gap-4">
              <AddItemForm />

              {items.length === 0 ? (
                <p className="py-8 text-center text-muted-foreground text-sm">
                  Your list is empty — add an item or pull in a recipe above.
                </p>
              ) : (
                <ShoppingListView groups={groups} />
              )}

              {items.length > 0 && (
                <ListActions
                  listId={activeList.id}
                  hasChecked={hasChecked}
                />
              )}

              {/* Frequently bought — mobile only (desktop gets the sidebar) */}
              <div className="lg:hidden border-t pt-4">
                <OrderHistory items={mostOrdered} />
              </div>
            </div>
          )}
        </div>

        {/* Frequently bought sidebar — desktop only */}
        {activeList && mostOrdered.length > 0 && (
          <aside className="hidden lg:block w-72 shrink-0 sticky top-8">
            <div className="rounded-lg border bg-card p-4">
              <OrderHistory items={mostOrdered} defaultOpen />
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
