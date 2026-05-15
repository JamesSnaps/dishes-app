import Link from "next/link";
import Image from "next/image";
import { desc, eq, isNotNull, and } from "drizzle-orm";
import { CalendarDays, ShoppingCart, Sparkles, UtensilsCrossed, ChefHat, Clock, Moon, Sun, Sunrise, Cookie, IceCreamCone } from "lucide-react";
import { db } from "@/lib/db";
import { recipes, mealPlans, mealPlanEntries } from "@dishes/db/schema";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { Badge, Button, Card } from "@dishes/ui";
import { RecipeCard } from "../recipes/_components/recipe-card";
import { HomeSearchBar } from "./_components/home-search-bar";
import { NotificationsBell } from "@/components/notifications/notifications-bell";

export const metadata = { title: "Home" };

type MealType = "breakfast" | "lunch" | "dinner" | "dessert" | "snack";

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  dessert: "Dessert",
  snack: "Snack",
};

const MEAL_ICON: Record<MealType, React.ReactNode> = {
  breakfast: <Sunrise className="h-3.5 w-3.5" />,
  lunch: <Sun className="h-3.5 w-3.5" />,
  dinner: <Moon className="h-3.5 w-3.5" />,
  dessert: <IceCreamCone className="h-3.5 w-3.5" />,
  snack: <Cookie className="h-3.5 w-3.5" />,
};

const MEAL_COLOR: Record<MealType, string> = {
  breakfast: "text-amber-600 dark:text-amber-400",
  lunch: "text-violet-600 dark:text-violet-400",
  dinner: "text-indigo-600 dark:text-indigo-400",
  dessert: "text-pink-600 dark:text-pink-400",
  snack: "text-muted-foreground",
};

const MEAL_BG: Record<MealType, string> = {
  breakfast: "bg-amber-50 dark:bg-amber-950/20",
  lunch: "bg-violet-50 dark:bg-violet-950/20",
  dinner: "bg-indigo-50 dark:bg-indigo-950/20",
  dessert: "bg-pink-50 dark:bg-pink-950/20",
  snack: "bg-muted/30",
};

function getMondayOfToday(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function getTodayDayIndex(): number {
  const day = new Date().getDay();
  return day === 0 ? 6 : day - 1;
}

function timeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default async function HomePage() {
  const user = await getAutheliaUser();
  const firstName = user.displayName.split(" ")[0];
  const { householdId } = await requireHousehold(user);

  const weekStartDate = getMondayOfToday();
  const todayDayIndex = getTodayDayIndex();

  const [recentRecipes, cuisineRows, todayPlan] = await Promise.all([
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
      .select({ id: mealPlans.id })
      .from(mealPlans)
      .where(and(eq(mealPlans.householdId, householdId), eq(mealPlans.weekStartDate, weekStartDate)))
      .limit(1),
  ]);

  const todayMeals = todayPlan[0]
    ? await db
        .select({
          id: mealPlanEntries.id,
          mealType: mealPlanEntries.mealType,
          recipe: {
            id: recipes.id,
            title: recipes.title,
            prepTimeMinutes: recipes.prepTimeMinutes,
            cookTimeMinutes: recipes.cookTimeMinutes,
            imageUrl: recipes.imageUrl,
          },
        })
        .from(mealPlanEntries)
        .innerJoin(recipes, eq(mealPlanEntries.recipeId, recipes.id))
        .where(and(eq(mealPlanEntries.mealPlanId, todayPlan[0].id), eq(mealPlanEntries.dayOfWeek, todayDayIndex)))
        .orderBy(mealPlanEntries.mealType)
    : [];

  const cuisines = cuisineRows
    .map((r) => r.cuisine)
    .filter((c): c is string => Boolean(c));

  return (
    <div className="p-4 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 pt-1">
        <div>
          <h1 className="text-2xl font-bold leading-tight">
            {timeGreeting()}, {firstName}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            What shall we cook today?
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <NotificationsBell />
          <Link
            href="/settings"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
            title="Settings"
          >
            {initials(user.displayName)}
          </Link>
        </div>
      </div>

      {/* Search bar */}
      <HomeSearchBar cuisines={cuisines} />

      {/* Today's meals */}
      {todayMeals.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <ChefHat className="h-4 w-4 text-primary" />
              Today&apos;s Meals
            </h2>
            <Link href="/meal-plan" className="text-sm text-primary hover:underline">
              Full plan
            </Link>
          </div>
          <div className="flex flex-col gap-2">
            {todayMeals.map((entry) => {
              const mealType = entry.mealType as MealType;
              const totalTime =
                (entry.recipe.prepTimeMinutes ?? 0) + (entry.recipe.cookTimeMinutes ?? 0);
              return (
                <div
                  key={entry.id}
                  className="flex items-center gap-3 rounded-xl border bg-card shadow-sm overflow-hidden"
                >
                  {entry.recipe.imageUrl ? (
                    <Image
                      src={entry.recipe.imageUrl}
                      alt={entry.recipe.title}
                      width={64}
                      height={64}
                      className="h-16 w-16 object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="h-16 w-16 flex-shrink-0 bg-muted flex items-center justify-center">
                      <span className="text-2xl text-muted-foreground/30">🍽</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0 py-2">
                    <div
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full w-fit mb-1 ${MEAL_BG[mealType]} ${MEAL_COLOR[mealType]}`}
                    >
                      {MEAL_ICON[mealType]}
                      <span className="text-xs font-semibold">{MEAL_LABELS[mealType]}</span>
                    </div>
                    <p className="font-semibold text-sm leading-snug line-clamp-1">
                      {entry.recipe.title}
                    </p>
                    {totalTime > 0 && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Clock className="h-3 w-3" />
                        {totalTime < 60
                          ? `${totalTime}m`
                          : `${Math.floor(totalTime / 60)}h${totalTime % 60 > 0 ? ` ${totalTime % 60}m` : ""}`}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 pr-3 flex-shrink-0">
                    <Link
                      href={`/recipes/${entry.recipe.id}/cook`}
                      className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      <ChefHat className="h-3.5 w-3.5" />
                      Cook
                    </Link>
                    <Link
                      href={`/recipes/${entry.recipe.id}`}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      View
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Recent recipes */}
      {recentRecipes.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">Recently Added</h2>
            <Link
              href="/recipes"
              className="text-sm text-primary hover:underline"
            >
              See all
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
          <h2 className="mb-3 text-base font-semibold">Browse by Cuisine</h2>
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
        <h2 className="mb-3 text-base font-semibold">Tools & Planning</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <ToolCard
            href="/ai-concierge"
            icon={<Sparkles className="h-6 w-6 text-violet-500" />}
            title="AI Concierge"
            description="Generate recipes"
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
            description="View & edit list"
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
