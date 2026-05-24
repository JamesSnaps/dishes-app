import Link from "next/link";
import { desc, eq, isNotNull, and, count } from "drizzle-orm";
import { CalendarDays, FolderOpen, Heart, ShoppingCart, Sparkles, UtensilsCrossed, ChefHat, Clock, Moon, Sun, Sunrise, Cookie, IceCreamCone, Info } from "lucide-react";
import { db } from "@/lib/db";
import { recipes, mealPlans, mealPlanEntries, householdMembers, cookHistory, collections, recipeCollections } from "@dishes/db/schema";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { Badge, Button, Card } from "@dishes/ui";
import { RecipeCard } from "../recipes/_components/recipe-card";
import { HomeSearchBar } from "./_components/home-search-bar";
import { NotificationsBell } from "@/components/notifications/notifications-bell";
import { getSuggestedRecipes, type SuggestedRecipe } from "@/app/actions/taste-profile";

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

function photoTilt(id: string, index: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  h ^= index * 2654435761;
  return ((Math.abs(h) % 71) - 35) * 0.08; // -2.8 to +2.8 deg
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
  const { householdId, memberId } = await requireHousehold(user);

  const weekStartDate = getMondayOfToday();
  const todayDayIndex = getTodayDayIndex();

  const [recentRecipes, cuisineRows, todayPlan, memberRow, suggestedRecipes, recentPhotos, favouriteRecipes, userCollections] = await Promise.all([
    db
      .select({
        id: recipes.id,
        title: recipes.title,
        description: recipes.description,
        cuisine: recipes.cuisine,
        prepTimeMinutes: recipes.prepTimeMinutes,
        cookTimeMinutes: recipes.cookTimeMinutes,
        imageUrl: recipes.imageUrl,
        thumbnailUrl: recipes.thumbnailUrl,
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
    db
      .select({ avatarUrl: householdMembers.avatarUrl })
      .from(householdMembers)
      .where(eq(householdMembers.id, memberId))
      .limit(1),
    getSuggestedRecipes(householdId).catch(() => [] as SuggestedRecipe[]),
    db
      .select({ id: cookHistory.id, photoUrl: cookHistory.photoUrl })
      .from(cookHistory)
      .where(and(eq(cookHistory.householdId, householdId), isNotNull(cookHistory.photoUrl)))
      .orderBy(desc(cookHistory.cookedAt))
      .limit(8),
    db
      .select({
        id: recipes.id,
        title: recipes.title,
        description: recipes.description,
        cuisine: recipes.cuisine,
        prepTimeMinutes: recipes.prepTimeMinutes,
        cookTimeMinutes: recipes.cookTimeMinutes,
        imageUrl: recipes.imageUrl,
        thumbnailUrl: recipes.thumbnailUrl,
        isFavourite: recipes.isFavourite,
        isAiGenerated: recipes.isAiGenerated,
      })
      .from(recipes)
      .where(and(eq(recipes.householdId, householdId), eq(recipes.isFavourite, true)))
      .orderBy(recipes.title)
      .limit(4),
    db
      .select({
        id: collections.id,
        name: collections.name,
        icon: collections.icon,
        recipeCount: count(recipeCollections.recipeId),
      })
      .from(collections)
      .leftJoin(recipeCollections, eq(recipeCollections.collectionId, collections.id))
      .where(eq(collections.householdId, householdId))
      .groupBy(collections.id, collections.name, collections.icon)
      .orderBy(collections.name)
      .limit(4),
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
            thumbnailUrl: recipes.thumbnailUrl,
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
            className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground overflow-hidden"
            title="Settings"
          >
            {memberRow[0]?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={memberRow[0].avatarUrl} alt={user.displayName} className="h-full w-full object-cover" />
            ) : (
              initials(user.displayName)
            )}
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {todayMeals.map((entry) => {
              const mealType = entry.mealType as MealType;
              const total =
                (entry.recipe.prepTimeMinutes ?? 0) + (entry.recipe.cookTimeMinutes ?? 0);
              const timeLabel = total === 0 ? null : total < 60 ? `${total}m` : `${Math.floor(total / 60)}h${total % 60 > 0 ? ` ${total % 60}m` : ""}`;
              return (
                <div key={entry.id} className="group relative block">
                  <Link href={`/recipes/${entry.recipe.id}`} className="absolute inset-0 z-0" aria-label={entry.recipe.title} />
                  <div className="rounded-xl border bg-card overflow-hidden transition-shadow hover:shadow-md h-full flex flex-col">
                    {/* Image */}
                    <div className="relative aspect-[4/3] bg-muted flex items-center justify-center">
                      {entry.recipe.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={entry.recipe.thumbnailUrl ?? entry.recipe.imageUrl}
                          alt={entry.recipe.title}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <UtensilsCrossed className="h-10 w-10 text-muted-foreground/30" />
                      )}
                      {/* Meal type badge */}
                      <div
                        className={`absolute top-2 left-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${MEAL_BG[mealType]} ${MEAL_COLOR[mealType]}`}
                      >
                        {MEAL_ICON[mealType]}
                        <span className="text-xs font-semibold">{MEAL_LABELS[mealType]}</span>
                      </div>
                    </div>
                    {/* Content */}
                    <div className="p-3 flex flex-col flex-1">
                      <h3 className="font-semibold leading-tight line-clamp-2 text-sm group-hover:text-primary transition-colors">
                        {entry.recipe.title}
                      </h3>
                      <div className="mt-auto pt-2 flex items-center justify-between gap-2">
                        {timeLabel && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {timeLabel}
                          </span>
                        )}
                        <Link
                          href={`/recipes/${entry.recipe.id}/cook`}
                          className="relative z-10 ml-auto flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                          <ChefHat className="h-3 w-3" />
                          Cook
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Favourites */}
      {favouriteRecipes.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold flex items-center gap-1.5">
              <Heart className="h-4 w-4 text-red-500 fill-red-400" />
              Favourites
            </h2>
            <Link href="/favourites" className="text-sm text-primary hover:underline">See all</Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {favouriteRecipes.map((recipe) => (
              <RecipeCard key={recipe.id} {...recipe} />
            ))}
          </div>
        </section>
      )}

      {/* Suggested for you */}
      {suggestedRecipes.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-500" />
              Suggested for you
            </h2>
            <Link href="/settings/taste" className="text-sm text-primary hover:underline">
              Your profile
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {suggestedRecipes.map((recipe) => (
              <SuggestedRecipeCard key={recipe.id} recipe={recipe} />
            ))}
          </div>
        </section>
      )}

      {/* Memories strip */}
      {recentPhotos.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold flex items-center gap-1.5">
              <span className="text-base leading-none">✨</span>
              Memories
            </h2>
            <Link href="/memories" className="text-sm text-primary hover:underline">See all</Link>
          </div>
          {/* Horizontal polaroid strip — extend to screen edges */}
          <div className="overflow-x-auto -mx-4 px-4 scrollbar-hide">
            <div className="flex gap-4 py-4 w-max">
              {recentPhotos.map((photo, i) => (
                <Link
                  key={photo.id}
                  href="/memories"
                  className="block shrink-0 hover:scale-105 transition-transform duration-150"
                  style={{ transform: `rotate(${photoTilt(photo.id, i)}deg)`, transformOrigin: "center 35%" }}
                >
                  <div
                    className="bg-white rounded-sm"
                    style={{ width: 90, boxShadow: "0 3px 8px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.04)" }}
                  >
                    <div className="p-1.5 pb-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo.photoUrl!}
                        alt=""
                        className="w-full aspect-square object-cover"
                        style={{ filter: "sepia(0.2) saturate(1.15)" }}
                      />
                    </div>
                    <div className="h-5" />
                  </div>
                </Link>
              ))}
              {/* View all tile */}
              <Link
                href="/memories"
                className="shrink-0 flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-muted-foreground/20 text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
                style={{ width: 90, height: 90 + 8 + 20 }}
              >
                <span className="text-xl">✨</span>
                <span className="text-xs font-medium">View all</span>
              </Link>
            </div>
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

      {/* Collections */}
      {userCollections.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold flex items-center gap-1.5">
              <FolderOpen className="h-4 w-4 text-primary" strokeWidth={1.75} />
              Collections
            </h2>
            <Link href="/collections" className="text-sm text-primary hover:underline">See all</Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {userCollections.map((col) => (
              <Link
                key={col.id}
                href={`/collections/${col.id}`}
                className="group flex items-center gap-3 rounded-xl border bg-card p-4 hover:border-primary/40 hover:shadow-sm transition-all"
              >
                <span className="text-2xl shrink-0 leading-none">
                  {col.icon ?? "📁"}
                </span>
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                    {col.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {Number(col.recipeCount)} recipe{Number(col.recipeCount) !== 1 ? "s" : ""}
                  </div>
                </div>
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

function SuggestedRecipeCard({ recipe }: { recipe: SuggestedRecipe }) {
  const total = (recipe.prepTimeMinutes ?? 0) + (recipe.cookTimeMinutes ?? 0);
  const timeLabel = total === 0 ? null : total < 60 ? `${total}m` : `${Math.floor(total / 60)}h${total % 60 > 0 ? ` ${total % 60}m` : ""}`;

  return (
    <div className="group relative flex flex-col">
      <Link href={`/recipes/${recipe.id}`} className="block">
        <Card className="overflow-hidden transition-shadow hover:shadow-md">
          <div className="relative aspect-[4/3] bg-muted flex items-center justify-center">
            {recipe.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={recipe.thumbnailUrl ?? recipe.imageUrl}
                alt={recipe.title}
                className="h-full w-full object-cover"
              />
            ) : (
              <UtensilsCrossed className="h-10 w-10 text-muted-foreground/30" />
            )}
          </div>
          <div className="p-3">
            <h3 className="font-semibold leading-tight line-clamp-2 text-sm group-hover:text-primary transition-colors">
              {recipe.title}
            </h3>
            <div className="mt-1.5 flex items-center gap-1.5">
              {timeLabel && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {timeLabel}
                </span>
              )}
            </div>
          </div>
        </Card>
      </Link>
      <p className="mt-1.5 flex items-start gap-1 px-0.5 text-xs text-muted-foreground">
        <Info className="h-3 w-3 mt-0.5 shrink-0 text-violet-400" />
        <span className="line-clamp-2">{recipe.whyText}</span>
      </p>
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
