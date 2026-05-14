import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { db } from "@/lib/db";
import { recipes } from "@dishes/db/schema";
import { eq, and, ilike, isNotNull } from "drizzle-orm";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { Button, Input } from "@dishes/ui";
import { RecipeCard } from "./_components/recipe-card";

export const metadata = { title: "Recipes" };

interface Props {
  searchParams: Promise<{ q?: string; cuisine?: string; favourites?: string }>;
}

export default async function RecipesPage({ searchParams }: Props) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const { q, cuisine, favourites } = await searchParams;

  // Build where conditions
  const conditions = [eq(recipes.householdId, householdId)];
  if (q?.trim()) conditions.push(ilike(recipes.title, `%${q.trim()}%`));
  if (cuisine?.trim()) conditions.push(eq(recipes.cuisine, cuisine.trim()));

  const [allRecipes, cuisineRows] = await Promise.all([
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
      .from(recipes)
      .where(and(...conditions))
      .orderBy(recipes.createdAt),
    db
      .selectDistinct({ cuisine: recipes.cuisine })
      .from(recipes)
      .where(
        and(eq(recipes.householdId, householdId), isNotNull(recipes.cuisine))
      )
      .orderBy(recipes.cuisine),
  ]);

  const displayed =
    favourites === "1"
      ? allRecipes.filter((r) => r.isFavourite)
      : allRecipes;

  const cuisines = cuisineRows
    .map((r) => r.cuisine)
    .filter((c): c is string => Boolean(c));

  return (
    <div className="p-4 lg:p-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Recipes</h1>
        <Button asChild size="sm">
          <Link href="/recipes/new">
            <Plus className="mr-1 h-4 w-4" />
            New Recipe
          </Link>
        </Button>
      </div>

      {/* Search + filters */}
      <form method="GET" className="mb-6 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search recipes…"
            className="pl-9"
          />
        </div>

        <select
          name="cuisine"
          defaultValue={cuisine ?? ""}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">All cuisines</option>
          {cuisines.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="favourites"
            value="1"
            defaultChecked={favourites === "1"}
            className="h-4 w-4 rounded border-input"
          />
          Favourites only
        </label>

        <Button type="submit" variant="secondary" size="sm" className="shrink-0">
          Filter
        </Button>

        {(q || cuisine || favourites) && (
          <Button asChild variant="ghost" size="sm" className="shrink-0">
            <Link href="/recipes">Clear</Link>
          </Button>
        )}
      </form>

      {/* Results */}
      {displayed.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="text-muted-foreground">
            {q || cuisine || favourites
              ? "No recipes match your filters."
              : "No recipes yet. Add your first one!"}
          </p>
          {!q && !cuisine && !favourites && (
            <Button asChild className="mt-4">
              <Link href="/recipes/new">Add a recipe</Link>
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {displayed.map((recipe) => (
            <RecipeCard key={recipe.id} {...recipe} />
          ))}
        </div>
      )}
    </div>
  );
}
