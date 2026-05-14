import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { shoppingLists, shoppingListItems, recipes } from "@dishes/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { Button } from "@dishes/ui";
import { AddItemForm } from "./_components/add-item-form";
import { GenerateFromRecipeButton } from "./_components/generate-from-recipe-button";
import { ShoppingItem } from "./_components/shopping-item";
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

  const [items, allRecipes] = await Promise.all([
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
          })
          .from(shoppingListItems)
          .where(eq(shoppingListItems.listId, activeList.id))
          .orderBy(asc(shoppingListItems.position))
      : Promise.resolve([] as { id: string; ingredientName: string; amount: string | null; unit: string | null; notes: string | null; isChecked: boolean; category: string | null; position: number }[]),
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
  ]);

  // Group items by category
  const grouped = new Map<string | null, typeof items>();
  for (const item of items) {
    const key = item.category ?? null;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(item);
  }

  const sortedGroups = [...grouped.entries()].sort(([a], [b]) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  const hasChecked = items.some((i) => i.isChecked);
  const checkedCount = items.filter((i) => i.isChecked).length;

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
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
        <GenerateFromRecipeButton recipes={allRecipes} />
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
            <div className="flex flex-col gap-4">
              {sortedGroups.map(([category, groupItems]) => (
                <section key={category ?? "__none__"}>
                  {category && (
                    <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {category}
                    </h2>
                  )}
                  <ul className="divide-y rounded-lg border bg-card">
                    {groupItems.map((item) => (
                      <ShoppingItem key={item.id} item={item} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}

          {items.length > 0 && (
            <ListActions
              listId={activeList.id}
              hasChecked={hasChecked}
            />
          )}
        </div>
      )}
    </div>
  );
}
