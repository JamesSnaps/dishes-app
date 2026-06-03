import { db } from "@/lib/db";
import { cookHistory, recipes } from "@dishes/db/schema";
import { eq, and, isNotNull, desc } from "drizzle-orm";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { MemoryWall } from "./_components/memory-wall";

export const metadata = { title: "Memories" };

export default async function MemoriesPage() {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const rows = await db
    .select({
      id: cookHistory.id,
      cookedAt: cookHistory.cookedAt,
      photoUrl: cookHistory.photoUrl,
      rating: cookHistory.rating,
      notes: cookHistory.notes,
      occasion: cookHistory.occasion,
      cookedFor: cookHistory.cookedFor,
      recipeId: recipes.id,
      recipeName: recipes.title,
    })
    .from(cookHistory)
    .innerJoin(recipes, eq(cookHistory.recipeId, recipes.id))
    .where(
      and(
        eq(cookHistory.householdId, householdId),
        isNotNull(cookHistory.photoUrl)
      )
    )
    .orderBy(desc(cookHistory.cookedAt))
    .limit(200);

  const photos = rows.map(r => ({
    id: r.id,
    cookedAt: r.cookedAt.toISOString(),
    photoUrl: r.photoUrl!,
    rating: r.rating != null ? parseFloat(r.rating) : null,
    notes: r.notes,
    occasion: r.occasion,
    cookedFor: r.cookedFor,
    recipeId: r.recipeId,
    recipeName: r.recipeName,
  }));

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f5f0e8] dark:bg-[#1a1612]">
      <div className="max-w-2xl mx-auto px-4 py-8 pb-28">
        <MemoryWall photos={photos} />
      </div>
    </div>
  );
}
