import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ChevronLeft,
  Clock,
  Users,
  Edit,
  Heart,
  ExternalLink,
  ChefHat,
} from "lucide-react";
import { eq, and, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  recipes,
  recipeIngredients,
  recipeSteps,
  recipeTags,
} from "@dishes/db/schema";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { Badge, Button, Separator } from "@dishes/ui";
import { DeleteRecipeButton } from "./_components/delete-recipe-button";
import { AddToShoppingButton } from "./_components/add-to-shopping-button";
import { toggleFavourite } from "@/app/actions/recipes";

export const metadata = { title: "Recipe" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function RecipeDetailPage({ params }: Props) {
  const { id } = await params;
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const [recipe, ingredients, steps, tags] = await Promise.all([
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
  ]);

  if (!recipe) notFound();

  const totalMinutes =
    (recipe.prepTimeMinutes ?? 0) + (recipe.cookTimeMinutes ?? 0);

  function formatTime(minutes: number): string {
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  const toggleAction = toggleFavourite.bind(null, id);

  return (
    <div className="mx-auto max-w-5xl p-4 lg:p-8">
      {/* Back link */}
      <Link
        href="/recipes"
        className="mb-6 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />
        Recipes
      </Link>

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

          <Button asChild variant="ghost" size="sm">
            <Link href={`/recipes/${id}/edit`}>
              <Edit className="mr-1.5 h-4 w-4" />
              Edit
            </Link>
          </Button>

          <DeleteRecipeButton recipeId={id} recipeTitle={recipe.title} />
        </div>
      </div>

      {/* Meta row */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
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

      {/* Start Cooking CTA */}
      {steps.length > 0 && (
        <div className="mb-6">
          <Button asChild size="lg" className="w-full sm:w-auto">
            <Link href={`/recipes/${id}/cook`}>
              <ChefHat className="mr-2 h-5 w-5" />
              Start Cooking
            </Link>
          </Button>
        </div>
      )}

      {/* Description */}
      {recipe.description && (
        <p className="mb-6 text-muted-foreground leading-relaxed">
          {recipe.description}
        </p>
      )}

      {/* Time breakdown */}
      {(recipe.prepTimeMinutes || recipe.cookTimeMinutes) && (
        <div className="mb-6 flex gap-6 rounded-lg bg-muted/50 px-4 py-3 text-sm">
          {recipe.prepTimeMinutes ? (
            <div>
              <div className="font-medium">Prep</div>
              <div className="text-muted-foreground">
                {formatTime(recipe.prepTimeMinutes)}
              </div>
            </div>
          ) : null}
          {recipe.cookTimeMinutes ? (
            <div>
              <div className="font-medium">Cook</div>
              <div className="text-muted-foreground">
                {formatTime(recipe.cookTimeMinutes)}
              </div>
            </div>
          ) : null}
          {totalMinutes > 0 && recipe.prepTimeMinutes && recipe.cookTimeMinutes ? (
            <div>
              <div className="font-medium">Total</div>
              <div className="text-muted-foreground">{formatTime(totalMinutes)}</div>
            </div>
          ) : null}
        </div>
      )}

      <Separator className="mb-6" />

      {/* Ingredients + Steps — side by side on desktop */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[280px_1fr] lg:items-start mb-8">

        {/* Ingredients */}
        {ingredients.length > 0 && (
          <section>
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold">Ingredients</h2>
              <AddToShoppingButton
                recipeId={id}
                recipeServings={recipe.servings ? parseFloat(recipe.servings) : null}
                servingsUnit={recipe.servingsUnit ?? "servings"}
              />
            </div>
            <ul className="space-y-2">
              {ingredients.map((ing) => (
                <li key={ing.id} className="flex items-baseline gap-2 text-sm">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary mt-1.5" />
                  <span>
                    {ing.amount && (
                      <span className="font-medium">
                        {ing.amount}
                        {ing.unit ? ` ${ing.unit}` : ""}{" "}
                      </span>
                    )}
                    {ing.ingredientName}
                    {ing.preparation && ing.preparation.toLowerCase() !== "none" && (
                      <span className="text-muted-foreground">
                        , {ing.preparation}
                      </span>
                    )}
                    {ing.isOptional && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        (optional)
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Steps */}
        {steps.length > 0 && (
          <section>
            <h2 className="mb-4 text-lg font-semibold">Method</h2>
            <ol className="space-y-8">
              {steps.map((step, idx) => (
                <li key={step.id} className="flex gap-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                    {idx + 1}
                  </span>
                  <div className="flex-1 pt-1">
                    <p className="leading-relaxed">{step.instruction}</p>
                    {step.durationMinutes && (
                      <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {step.timerLabel
                          ? `${step.timerLabel} — `
                          : ""}
                        {formatTime(step.durationMinutes)}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

      </div>

      {/* Notes */}
      {recipe.notes && (
        <section className="mb-8">
          <h2 className="mb-2 text-lg font-semibold">Notes</h2>
          <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
            {recipe.notes}
          </p>
        </section>
      )}

      {/* Tags */}
      {tags.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <Badge key={t.id} variant="secondary" className="text-xs">
              {t.tag}
            </Badge>
          ))}
        </div>
      )}

      {/* Source */}
      {recipe.sourceUrl && (
        <a
          href={recipe.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="h-4 w-4" />
          Original source
        </a>
      )}

    </div>
  );
}
