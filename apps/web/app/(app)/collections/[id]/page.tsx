import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, UtensilsCrossed } from "lucide-react";
import { db } from "@/lib/db";
import { collections, recipeCollections, recipes, cookHistory } from "@dishes/db/schema";
import { eq, and, avg, count } from "drizzle-orm";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { RecipeCard } from "../../recipes/_components/recipe-card";
import { DeleteCollectionButton } from "../_components/delete-collection-button";
import { RemoveFromCollectionButton } from "./_components/remove-from-collection-button";
import { CollectionIconButton } from "./_components/collection-icon-button";
import { AddRecipesDialog } from "./_components/add-recipes-dialog";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const col = await db
    .select({ name: collections.name })
    .from(collections)
    .where(eq(collections.id, id))
    .limit(1);
  return { title: col[0]?.name ?? "Collection" };
}

export default async function CollectionDetailPage({ params }: Props) {
  const { id } = await params;
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const [col, recipeRows, cookStatsRows] = await Promise.all([
    db
      .select({ id: collections.id, name: collections.name, icon: collections.icon, description: collections.description })
      .from(collections)
      .where(and(eq(collections.id, id), eq(collections.householdId, householdId)))
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select({
        id: recipes.id,
        title: recipes.title,
        description: recipes.description,
        cuisine: recipes.cuisine,
        prepTimeMinutes: recipes.prepTimeMinutes,
        cookTimeMinutes: recipes.cookTimeMinutes,
        imageUrl: recipes.imageUrl,
        isFavourite: recipes.isFavourite,
        isAiGenerated: recipes.isAiGenerated,
      })
      .from(recipeCollections)
      .innerJoin(recipes, eq(recipeCollections.recipeId, recipes.id))
      .where(eq(recipeCollections.collectionId, id))
      .orderBy(recipes.title),
    db
      .select({
        recipeId: cookHistory.recipeId,
        averageRating: avg(cookHistory.rating),
        cookCount: count(cookHistory.id),
      })
      .from(cookHistory)
      .where(eq(cookHistory.householdId, householdId))
      .groupBy(cookHistory.recipeId),
  ]);

  if (!col) notFound();

  const cookStatsByRecipe = new Map(
    cookStatsRows.map((r) => [
      r.recipeId,
      {
        averageRating:
          r.averageRating != null
            ? Math.round(parseFloat(r.averageRating) * 10) / 10
            : null,
        cookCount: Number(r.cookCount),
      },
    ])
  );

  return (
    <div className="p-4 lg:p-8">
      {/* Back */}
      <Link
        href="/collections"
        className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
      >
        <ChevronLeft className="h-4 w-4" />
        Collections
      </Link>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <CollectionIconButton collectionId={col.id} initialIcon={col.icon} />
          <div>
            <h1 className="text-2xl font-bold leading-tight">{col.name}</h1>
            {col.description && (
              <p className="text-sm text-muted-foreground mt-0.5">{col.description}</p>
            )}
            <p className="text-sm text-muted-foreground mt-1">
              {recipeRows.length} recipe{recipeRows.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <AddRecipesDialog collectionId={col.id} />
          <DeleteCollectionButton collectionId={col.id} collectionName={col.name} />
        </div>
      </div>

      {recipeRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
          <UtensilsCrossed className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-muted-foreground">No recipes in this collection yet.</p>
          <p className="text-sm text-muted-foreground/60">
            Use the &ldquo;Add recipes&rdquo; button above to search and add recipes.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {recipeRows.map((recipe) => {
            const stats = cookStatsByRecipe.get(recipe.id);
            return (
              <div key={recipe.id} className="group relative">
                <RecipeCard
                  {...recipe}
                  averageRating={stats?.averageRating ?? null}
                  cookCount={stats?.cookCount ?? 0}
                />
                <RemoveFromCollectionButton collectionId={col.id} recipeId={recipe.id} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
