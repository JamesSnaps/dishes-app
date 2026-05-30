import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ChevronLeft,
  Clock,
  Users,
  Heart,
  ChefHat,
  CalendarDays,
  FileText,
  Plus,
} from "lucide-react";
import { eq, and, ne, or, inArray, asc, count, max, lte, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  recipes,
  recipeIngredients,
  recipeSteps,
  recipeTags,
  mealPlans,
  mealPlanEntries,
  notes,
} from "@dishes/db/schema";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { aiConfigurations } from "@dishes/db/schema";
import type { ImageStyleValue } from "@/lib/image-styles";
import { Badge } from "@dishes/ui";
import { RecipeActionsMenu } from "./_components/recipe-actions-menu";
import { RecipeTabs } from "./_components/recipe-tabs";
import { StartCookingButton } from "./_components/start-cooking-button";
import { TweakRecipeButton } from "./_components/tweak-recipe-button";
import { SimilarRecipesButton } from "./_components/similar-recipes-button";
import { RateRecipeSheet } from "./_components/rate-recipe-sheet";
import { AddCookReviewSheet } from "./_components/add-cook-review-sheet";
import { MemoryCard } from "./_components/memory-card";
import { GenerateImageButton } from "./_components/generate-image-button";
import { toggleFavourite } from "@/app/actions/recipes";
import { getCookStats, getRecipeCookHistory, getAverageDuration } from "@/app/actions/cook-history";
import { getSmtpConfig } from "@/app/actions/sharing";
import { isStorageAvailable } from "@/lib/storage";
import type { GeneratedRecipe } from "@/app/actions/ai";

export const metadata = { title: "Recipe" };

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ pendingReview?: string; from?: string; week?: string; back?: string }>;
}

export default async function RecipeDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { pendingReview, from, week, back } = await searchParams;
  // `back` carries the encoded search string from the recipe list (e.g. "q=pasta&sort=az")
  const recipesBack = back && /^[a-zA-Z0-9%&=+._~-]*$/.test(back) ? `/recipes?${back}` : "/recipes";
  const backHref = from === "meal-plan" && week ? `/meal-plan?week=${week}` : recipesBack;
  const backLabel = from === "meal-plan" ? "Meal Plan" : "Recipes";
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const today = new Date().toISOString().split("T")[0];

  const [recipe, ingredients, steps, tags, plannerStats, cookStats, cookHistoryRows, linkedNotes, avgDuration, smtpConfig, aiConfig] = await Promise.all([
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
    db
      .select({ id: notes.id, title: notes.title, body: notes.body, updatedAt: notes.updatedAt })
      .from(notes)
      .where(and(eq(notes.recipeId, id), eq(notes.householdId, householdId)))
      .orderBy(desc(notes.updatedAt)),
    getAverageDuration(id, householdId),
    getSmtpConfig(householdId),
    db
      .select({ imageStyle: aiConfigurations.imageStyle })
      .from(aiConfigurations)
      .where(eq(aiConfigurations.householdId, householdId))
      .limit(1)
      .then((r) => r[0] ?? null),
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

  // Memorable cooks — entries with occasion or notes
  const memorableCooks = cookHistoryRows.filter((e) => e.occasion || e.notes);

  // Cook context string for AI Tweak (last 3 memorable cooks)
  function buildCookContext(): string | undefined {
    if (!memorableCooks.length) return undefined;
    return memorableCooks.slice(0, 3).map((e, i) => {
      const parts: string[] = [];
      const date = new Date(e.cookedAt).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
      if (e.rating != null) parts.push(`rated ${e.rating / 2}/5`);
      if (e.actualDuration) parts.push(`took ${e.actualDuration} min`);
      if (e.cookedFor?.length) parts.push(`cooked for ${e.cookedFor.join(", ")}`);
      const header = `${i + 1}) ${date}${parts.length ? ` (${parts.join(", ")})` : ""}`;
      const lines = [header];
      if (e.occasion) lines.push(`Occasion: ${e.occasion}`);
      if (e.notes) lines.push(`Notes: ${e.notes}`);
      return lines.join(" — ");
    }).join("\n");
  }

  const cookContext = buildCookContext();

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
            href={backHref}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
          >
            <ChevronLeft className="h-4 w-4" />
            {backLabel}
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
      ) : (
        <GenerateImageButton
          recipeId={id}
          recipeTitle={recipe.title}
          defaultStyle={(aiConfig?.imageStyle as ImageStyleValue | undefined) ?? "studio"}
        />
      )}

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

          <RecipeActionsMenu recipeId={id} recipeTitle={recipe.title} hasSmtp={!!smtpConfig} />
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
        {avgDuration && (
          <span className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400">
            <Clock className="h-4 w-4" />
            Usually takes you ~{formatTime(avgDuration)}
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
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <RateRecipeSheet
          recipeId={id}
          recipeTitle={recipe.title}
          currentRating={cookStats.averageRating}
        />
        {cookStats.cookCount > 0 ? (
          <span className="text-sm text-muted-foreground">
            {cookStats.averageRating != null
              ? `${cookStats.averageRating / 2}/5 · `
              : ""}
            Cooked {cookStats.cookCount === 1 ? "once" : `${cookStats.cookCount} times`}
          </span>
        ) : null}
        <AddCookReviewSheet
          recipeId={id}
          recipeTitle={recipe.title}
          pendingCookId={pendingReview ?? null}
          storageAvailable={isStorageAvailable()}
        />
      </div>

      {/* Start Cooking + Tweak + Similar CTAs */}
      {steps.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          <StartCookingButton
            recipeId={id}
            servings={recipe.servings}
            servingsUnit={recipe.servingsUnit ?? null}
          />
          <TweakRecipeButton recipeId={id} recipe={recipeForTweak} cookContext={cookContext} />
          <SimilarRecipesButton recipeId={id} />
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

      {/* Linked notes */}
      <section className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            Notes
            {linkedNotes.length > 0 && (
              <span className="text-sm font-normal text-muted-foreground">({linkedNotes.length})</span>
            )}
          </h2>
          <Link
            href={`/notes/new?recipeId=${id}`}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add note
          </Link>
        </div>
        {linkedNotes.length === 0 ? (
          <p className="text-sm text-muted-foreground/60 py-2">No notes yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {linkedNotes.map((note) => (
              <Link
                key={note.id}
                href={`/notes/${note.id}`}
                className="group rounded-lg border bg-card p-4 hover:border-primary/40 hover:shadow-sm transition-all"
              >
                <p className="font-medium text-sm leading-tight group-hover:text-primary transition-colors">
                  {note.title}
                </p>
                {note.body && (
                  <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{note.body}</p>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Memories */}
      {memorableCooks.length > 0 && (
        <section className="mt-10">
          <h2 className="text-base font-semibold mb-6 flex items-center gap-2">
            <span className="text-lg">✨</span>
            Memories
          </h2>
          {(() => {
            const cards = memorableCooks.map((entry, index) => {
              const date = new Date(entry.cookedAt);
              const diffDays = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
              const relDate =
                diffDays === 0 ? "Today" :
                diffDays === 1 ? "Yesterday" :
                diffDays < 7 ? `${diffDays} days ago` :
                diffDays < 14 ? "Last week" :
                diffDays < 30 ? `${Math.floor(diffDays / 7)} weeks ago` :
                diffDays < 60 ? "Last month" :
                diffDays < 365 ? `${Math.floor(diffDays / 30)} months ago` :
                diffDays < 730 ? "Last year" :
                `${Math.floor(diffDays / 365)} years ago`;
              const fullDate = date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
              return { entry, index, relDate, fullDate };
            });

            const leftCards = cards.filter((_, i) => i % 2 === 0);
            const rightCards = cards.filter((_, i) => i % 2 === 1);

            // Single card: centred
            if (cards.length === 1) {
              const { entry, index, relDate, fullDate } = cards[0]!;
              return (
                <div className="flex justify-center py-4">
                  <div className="w-56">
                    <MemoryCard index={index} entry={{ id: entry.id, photoUrl: entry.photoUrl, relDate, fullDate, rating: entry.rating, notes: entry.notes, occasion: entry.occasion, cookedFor: entry.cookedFor, actualDuration: entry.actualDuration }} />
                  </div>
                </div>
              );
            }

            const renderColumn = (col: typeof leftCards, colOffset?: string) => (
              <div className={`flex-1 flex flex-col ${colOffset ?? ""}`}>
                {col.map(({ entry, index, relDate, fullDate }, colIdx) => (
                  <div
                    key={entry.id}
                    style={{
                      marginTop: colIdx === 0 ? 0 : "-1.25rem",
                      zIndex: cards.length - index,
                      position: "relative",
                    }}
                  >
                    <MemoryCard
                      index={index}
                      entry={{ id: entry.id, photoUrl: entry.photoUrl, relDate, fullDate, rating: entry.rating, notes: entry.notes, occasion: entry.occasion, cookedFor: entry.cookedFor, actualDuration: entry.actualDuration }}
                    />
                  </div>
                ))}
              </div>
            );

            return (
              <div className="flex gap-3 overflow-visible pb-10 pt-2">
                {renderColumn(leftCards)}
                {renderColumn(rightCards, "mt-14")}
              </div>
            );
          })()}
        </section>
      )}

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
