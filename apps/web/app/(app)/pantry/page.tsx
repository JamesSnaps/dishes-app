import { db } from "@/lib/db";
import { pantryStaples, pantryStock } from "@dishes/db/schema";
import { eq, asc } from "drizzle-orm";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { StaplesSection } from "./_components/staples-section";
import { StockSection } from "./_components/stock-section";

export const metadata = { title: "Pantry" };

export default async function PantryPage() {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const [staples, stock] = await Promise.all([
    db
      .select({
        id: pantryStaples.id,
        ingredientName: pantryStaples.ingredientName,
      })
      .from(pantryStaples)
      .where(eq(pantryStaples.householdId, householdId))
      .orderBy(asc(pantryStaples.ingredientName)),
    db
      .select({
        id: pantryStock.id,
        ingredientName: pantryStock.ingredientName,
        amount: pantryStock.amount,
        unit: pantryStock.unit,
        addedAt: pantryStock.addedAt,
      })
      .from(pantryStock)
      .where(eq(pantryStock.householdId, householdId))
      .orderBy(asc(pantryStock.ingredientName)),
  ]);

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Pantry</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {staples.length} staple{staples.length !== 1 ? "s" : ""} · {stock.length} stocked item{stock.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="flex flex-col gap-10">
        <StaplesSection staples={staples} />
        <StockSection items={stock} />
      </div>
    </div>
  );
}
