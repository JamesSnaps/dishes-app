import Link from "next/link";
import { desc, eq, isNotNull, and, count } from "drizzle-orm";
import { Plus, ChefHat, CalendarDays, ShoppingCart, Sparkles, UtensilsCrossed } from "lucide-react";
import { db } from "@/lib/db";
import { recipes } from "@dishes/db/schema";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { Badge, Button, Card } from "@dishes/ui";
import { RecipeCard } from "../recipes/_components/recipe-card";

export const metadata = { title: "Home" };

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default async function HomePage() {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const [recentRecipes, cuisineRows, [{ total }]] = await Promise.all([
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
      .where(eq(recipes.householdId, householdId))
      .orderBy(desc(recipes.createdAt))
      .limit(8),
    db
      .selectDistinct({ cuisine: recipes.cuisine })
      .from(recipes)
      .where(and(eq(recipes.householdId, householdId), isNotNull(recipes.cuisine)))
      .orderBy(recipes.cuisine),
    db
      .select({ total: count() })
      .from(recipes)
      .where(eq(recipes.householdId, householdId)),
  ]);

  const cuisines = cuisineRows
    .map((r) => r.cuisine)
    .filter((c): c is string => Boolean(c));

  return (
    <div className="p-4 lg:p-8 space-y-10">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{greeting()}</h1>
          <p className="mt-1 text-muted-foreground">
            {total === 0
              ? "Start building your recipe collection."
              : `You have ${total} recipe${total === 1 ? "" : "s"} in your collection.`}
          </p>
        </div>
        <Button asChild size="sm" className="shrink-0">
          <Link href="/recipes/new">
            <Plus className="mr-1.5 h-4 w-4" />
            Add Recipe
          </Link>
        </Button>
      </div>

      {/* Recent recipes */}
      {recentRecipes.length > 0 && (
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recently Added</h2>
            <Link
              href="/recipes"
              className="text-sm text-primary hover:underline"
            >
              View all
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {recentRecipes.map((recipe) => (
              <RecipeCard key={recipe.id} {...recipe} />
            ))}
          </div>
        </section>
      )}

      {/* Cuisine pills */}
      {cuisines.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Browse by Cuisine</h2>
          <div className="flex flex-wrap gap-2">
            {cuisines.map((c) => (
              <Link key={c} href={`/recipes?cuisine=${encodeURIComponent(c)}`}>
                <Badge
                  variant="secondary"
                  className="cursor-pointer px-3 py-1 text-sm hover:bg-primary hover:text-primary-foreground transition-colors"
                >
                  {c}
                </Badge>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Tools */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">Tools & Planning</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <ToolCard
            href="/ai-concierge"
            icon={<Sparkles className="h-6 w-6 text-violet-500" />}
            title="AI Concierge"
            description="Generate recipes just for you"
          />
          <ToolCard
            href="/meal-plan"
            icon={<CalendarDays className="h-6 w-6 text-blue-500" />}
            title="Meal Planner"
            description="Plan your week"
          />
          <ToolCard
            href="/shopping"
            icon={<ShoppingCart className="h-6 w-6 text-green-500" />}
            title="Shopping List"
            description="View and edit your list"
          />
          <ToolCard
            href="/recipes/new"
            icon={<UtensilsCrossed className="h-6 w-6 text-orange-500" />}
            title="Add Recipe"
            description="Create a new recipe"
          />
        </div>
      </section>

      {/* Empty state CTA */}
      {recentRecipes.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <UtensilsCrossed className="mb-4 h-12 w-12 text-muted-foreground/30" />
          <h3 className="mb-1 font-semibold">No recipes yet</h3>
          <p className="mb-6 text-sm text-muted-foreground">
            Add your first recipe to get started.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild>
              <Link href="/recipes/new">Add a recipe</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/ai-concierge">
                <Sparkles className="mr-1.5 h-4 w-4" />
                Generate with AI
              </Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolCard({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link href={href} className="group block">
      <Card className="flex flex-col gap-3 p-4 transition-shadow hover:shadow-md h-full">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
          {icon}
        </div>
        <div>
          <div className="font-medium leading-tight group-hover:text-primary transition-colors">
            {title}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
        </div>
      </Card>
    </Link>
  );
}
