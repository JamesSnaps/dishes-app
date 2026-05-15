import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ChevronLeft,
  Clock,
  Users,
  Heart,
  ChefHat,
  CalendarDays,
} from "lucide-react";
import { eq, and, ne, or, inArray, asc, count, max, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  recipes,
  recipeIngredients,
  recipeSteps,
  recipeTags,
  mealPlans,
  mealPlanEntries,
} from "@dishes/db/schema";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { Badge, Button } from "@dishes/ui";
import { RecipeActionsMenu } from "./_components/recipe-actions-menu";
import { RecipeTabs } from "./_components/recipe-tabs";
import { TweakRecipeButton } from "./_components/tweak-recipe-button";
import { RateRecipeSheet } from "./_components/rate-recipe-sheet";
import { StarRating } from "./_components/star-rating";
import { toggleFavourite } from "@/app/actions/recipes";
import { getCookStats, getRecipeCookHistory } from "@/app/actions/cook-history";
import type { GeneratedRecipe } from "@/app/actions/ai";

export const metadata = { title: "Recipe" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function RecipeDetailPage({ params }: Props) {
  const { id } = await params;
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const today = new Date().toISOString().split("T")[0];

  const [recipe, ingredients, steps, tags, plannerStats, cookStats, cookHistoryRows] = await Promise.all([
    db
      .select()
      .from(recipes)
      .where(and(eq(recipes.id, id), eq(recipes.householdId, householdId)))
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select()
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, id))
      .orderBy(asc(recipeIngredients.position)),
    db
      .select()
      .from(recipeSteps)
      .where(eq(recipeSteps.recipeId, id))
      .orderBy(asc(recipeSteps.position)),
    db
      .select()
      .from(recipeTags)
      .where(eq(recipeTags.recipeId, id)),
    db
      .select({
        timesPlanned: count(mealPlanEntries.id),
        lastPlannedDate: max(mealPlans.weekStartDate),
      })
      .from(mealPlanEntries)
      .innerJoin(mealPlans, eq(mealPlanEntries.mealPlanId, mealPlans.id))
      .where(
        and(
          eq(mealPlanEntries.recipeId, id),
          eq(mealPlans.householdId, householdId),
          lte(mealPlans.weekStartDate, today)
        )
      )
      .then((r) => r[0] ?? { timesPlanned: 0, lastPlannedDate: null }),
    getCookStats(id, householdId),
    getRecipeCookHistory(id, householdId),
  ]);

  if (!recipe) notFound();

  // Related recipes: same cuisine or shared tags, deduplicated, max 4
  const tagValues = tags.map((t) => t.tag);
  const relatedConditions = [
    ...(recipe.cuisine ? [eq(recipes.cuisine, recipe.cuisine)] : []),
    ...(tagValues.length > 0 ? [inArray(recipeTags.tag, tagValues)] : []),
  ];

  const relatedRecipes =
    relatedConditions.length > 0
      ? await db
          .select({
            id: recipes.id,
            title: recipes.title,
            imageUrl: recipes.imageUrl,
            prepTimeMinutes: recipes.prepTimeMinutes,
            cookTimeMinutes: recipes.cookTimeMinutes,
            cuisine: recipes.cuisine,
          })
          .from(recipes)
          .leftJoin(recipeTags, eq(recipeTags.recipeId, recipes.id))
          .where(
            and(
              eq(recipes.householdId, householdId),
              ne(recipes.id, id),
              or(...relatedConditions)
            )
          )
          .limit(12)
          .then((rows) => {
            const seen = new Set<string>();
            return rows
              .filter((r) => {
                if (seen.has(r.id)) return false;
                seen.add(r.id);
                return true;
              })
              .slice(0, 4);
          })
      : [];

  const totalMinutes =
    (recipe.prepTimeMinutes ?? 0) + (recipe.cookTimeMinutes ?? 0);

  function formatTime(minutes: number): string {
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  function formatWeekDate(dateStr: string): string {
    const date = new Date(dateStr + "T00:00:00");
    const nowMs = new Date(today + "T00:00:00").getTime();
    const diffWeeks = Math.floor((nowMs - date.getTime()) / (7 * 24 * 60 * 60 * 1000));
    if (diffWeeks === 0) return "this week";
    if (diffWeeks === 1) return "last week";
    if (diffWeeks < 8) return `${diffWeeks} weeks ago`;
    return `week of ${date.getDate()} ${date.toLocaleString("default", { month: "short" })}`;
  }

  const toggleAction = toggleFavourite.bind(null, id);

  const recipeForTweak: GeneratedRecipe = {
    title: recipe.title,
    description: recipe.description ?? "",
    cuisine: recipe.cuisine ?? "",
    difficulty: recipe.difficulty ?? "medium",
    prepTimeMinutes: recipe.prepTimeMinutes,
    cookTimeMinutes: recipe.cookTimeMinutes,
    servings: recipe.servings ?? "4",
    servingsUnit: recipe.servingsUnit ?? "servings",
    tags: tags.map((t) => t.tag),
    ingredients: ingredients.map((i) => ({
      ingredientName: i.ingredientName,
      amount: i.amount ?? "",
      unit: i.unit ?? "",
      preparation: i.preparation ?? "",
      isOptional: i.isOptional ?? false,
      groupLabel: i.groupLabel ?? "",
    })),
    steps: steps.map((s) => ({
      instruction: s.instruction,
      durationMinutes: s.durationMinutes ? String(s.durationMinutes) : "",
      timerLabel: s.timerLabel ?? "",
    })),
    notes: recipe.notes,
  };

  return (
    <>
      {/* Sticky back bar */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b">
        <div className="mx-auto max-w-4xl px-4 lg:px-8 py-3">
          <Link
            href="/recipes"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
          >
            <ChevronLeft className="h-4 w-4" />
            Recipes
          </Link>
        </div>
      </div>

    <div className="mx-auto max-w-4xl p-4 lg:p-8">
      {/* Hero image */}
      {recipe.imageUrl ? (
        <div className="mb-6 aspect-video overflow-hidden rounded-xl bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={recipe.imageUrl}
            alt={recipe.title}
            className="h-full w-full object-cover"
          />
        </div>
      ) : null}

      {/* Title + actions */}
      <div className="mb-4 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-bold leading-tight">{recipe.title}</h1>

        <div className="flex shrink-0 items-center gap-1">
          <form action={toggleAction}>
            <button
              type="submit"
              className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground transition-colors"
              title={recipe.isFavourite ? "Remove from favourites" : "Add to favourites"}
            >
              <Heart
                className={`h-5 w-5 ${recipe.isFavourite ? "fill-rose-500 text-rose-500" : ""}`}
              />
            </button>
          </form>

          <RecipeActionsMenu recipeId={id} recipeTitle={recipe.title} />
        </div>
      </div>

      {/* Meta row */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {recipe.cuisine && (
          <Badge variant="secondary">{recipe.cuisine}</Badge>
        )}
        {recipe.difficulty && (
          <Badge variant="outline" className="capitalize">
            {recipe.difficulty}
          </Badge>
        )}
        {recipe.isAiGenerated && (
          <Badge variant="outline">
            <ChefHat className="mr-1 h-3 w-3" />
            AI
          </Badge>
        )}
        {totalMinutes > 0 && (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            {formatTime(totalMinutes)}
          </span>
        )}
        {recipe.servings && (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <Users className="h-4 w-4" />
            {parseFloat(recipe.servings)} {recipe.servingsUnit}
          </span>
        )}
      </div>

      {/* Planner stats */}
      {plannerStats.timesPlanned > 0 && (
        <div className="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground">
          <CalendarDays className="h-4 w-4 shrink-0" />
          <span>
            On the menu {plannerStats.timesPlanned === 1 ? "once" : `${plannerStats.timesPlanned} times`}
            {plannerStats.lastPlannedDate && (
              <> · Last planned {formatWeekDate(plannerStats.lastPlannedDate)}</>
            )}
          </span>
        </div>
      )}

      {/* Rating row */}
      <div className="mb-4 flex items-center gap-3">
        <StarRating value={cookStats.averageRating} readonly size="sm" />
        {cookStats.cookCount > 0 ? (
          <span className="text-sm text-muted-foreground">
            {cookStats.averageRating != null
              ? `${cookStats.averageRating}/10 · `
              : ""}
            Cooked {cookStats.cookCount === 1 ? "once" : `${cookStats.cookCount} times`}
          </span>
        ) : null}
        <div className="ml-auto">
          <RateRecipeSheet recipeId={id} recipeTitle={recipe.title} />
        </div>
      </div>

      {/* Start Cooking + Tweak CTAs */}
      {steps.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          <Button asChild size="lg" className="w-full sm:w-auto">
            <Link href={`/recipes/${id}/cook`}>
              <ChefHat className="mr-2 h-5 w-5" />
              Start Cooking
            </Link>
          </Button>
          <TweakRecipeButton recipeId={id} recipe={recipeForTweak} />
        </div>
      )}

      {/* Tabbed content */}
      <RecipeTabs
        recipeId={id}
        description={recipe.description}
        prepTimeMinutes={recipe.prepTimeMinutes}
        cookTimeMinutes={recipe.cookTimeMinutes}
        servings={recipe.servings}
        servingsUnit={recipe.servingsUnit}
        notes={recipe.notes}
        sourceUrl={recipe.sourceUrl}
        ingredients={ingredients}
        steps={steps}
        tags={tags}
        cookHistory={cookHistoryRows}
      />

      {/* Related recipes */}
      {relatedRecipes.length > 0 && (
        <section className="mt-12">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">You might also like</h2>
            <Link
              href="/recipes"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              View all
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {relatedRecipes.map((r) => {
              const mins = (r.prepTimeMinutes ?? 0) + (r.cookTimeMinutes ?? 0);
              return (
                <Link
                  key={r.id}
                  href={`/recipes/${r.id}`}
                  className="group rounded-lg overflow-hidden border bg-card hover:shadow-md transition-shadow"
                >
                  <div className="aspect-video bg-muted overflow-hidden">
                    {r.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.imageUrl}
                        alt={r.title}
                        className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center text-muted-foreground">
                        <ChefHat className="h-8 w-8 opacity-30" />
                      </div>
                    )}
                  </div>
                  <div className="p-2.5">
                    <p className="text-sm font-medium leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                      {r.title}
                    </p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      {r.cuisine && <span>{r.cuisine}</span>}
                      {r.cuisine && mins > 0 && <span>·</span>}
                      {mins > 0 && (
                        <span className="flex items-center gap-0.5">
                          <Clock className="h-3 w-3" />
                          {formatTime(mins)}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
    </>
  );
}
