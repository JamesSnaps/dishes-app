import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Clock, ListChecks, Timer, Users, UtensilsCrossed } from "lucide-react";
import { Badge } from "@dishes/ui";
import { requireSession } from "@/lib/session";
import { getSharedRecipeDetail } from "@/lib/services/library-browse";
import { LibraryShareInvalidError } from "@/lib/services/library-share-scope";
import { AddThisRecipeButton } from "../../_components/add-this-recipe-button";

export const metadata = { title: "Shared recipe" };

interface Props {
  params: Promise<{ shareId: string; id: string }>;
}

function formatMinutes(total: number): string {
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * One recipe from someone else's library, read-only.
 *
 * The scope predicate is enforced in `getSharedRecipeDetail`, not just on the
 * list page — otherwise guessing an id would reach a recipe the owner
 * deliberately excluded.
 */
export default async function SharedRecipePage({ params }: Props) {
  const { shareId, id } = await params;
  const session = await requireSession();

  let recipe;
  try {
    recipe = await getSharedRecipeDetail(session, shareId, id);
  } catch (err) {
    if (err instanceof LibraryShareInvalidError) notFound();
    throw err;
  }

  const totalTime = (recipe.prepTimeMinutes ?? 0) + (recipe.cookTimeMinutes ?? 0);

  const ingredientGroups: { label: string | null; items: typeof recipe.ingredients }[] = [];
  for (const ing of recipe.ingredients) {
    const label = ing.groupLabel ?? null;
    const existing = ingredientGroups.find((g) => g.label === label);
    if (existing) existing.items.push(ing);
    else ingredientGroups.push({ label, items: [ing] });
  }

  return (
    <div className="mx-auto max-w-4xl p-4 lg:p-8">
      <Link
        href={`/shared/${shareId}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to the library
      </Link>

      <div className="overflow-hidden rounded-2xl bg-muted">
        {recipe.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={recipe.imageUrl}
            alt={recipe.title}
            className="max-h-80 w-full object-cover"
          />
        ) : (
          <div className="flex h-48 items-center justify-center">
            <UtensilsCrossed className="h-12 w-12 text-muted-foreground/30" />
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight">{recipe.title}</h1>
          {recipe.description && (
            <p className="mt-2 max-w-prose text-sm text-muted-foreground">
              {recipe.description}
            </p>
          )}
        </div>
        {session.role !== "child" && (
          <AddThisRecipeButton shareId={shareId} recipeId={recipe.id} />
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {recipe.cuisine && <Badge variant="secondary">{recipe.cuisine}</Badge>}
        {recipe.difficulty && (
          <Badge variant="outline" className="capitalize">
            {recipe.difficulty}
          </Badge>
        )}
        {totalTime > 0 && (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            {formatMinutes(totalTime)}
          </span>
        )}
        {recipe.servings && (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <Users className="h-4 w-4" />
            {parseFloat(recipe.servings)} {recipe.servingsUnit ?? "servings"}
          </span>
        )}
      </div>

      {recipe.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {recipe.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section>
          <div className="rounded-2xl border bg-gradient-to-br from-primary/[0.07] via-card to-card p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <ListChecks className="h-5 w-5" />
              </div>
              <h2 className="text-lg font-semibold leading-tight">Ingredients</h2>
            </div>

            {ingredientGroups.map((group, gi) => (
              <div key={gi} className={gi > 0 ? "mt-5" : ""}>
                {group.label && (
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary/80">
                    {group.label}
                  </h3>
                )}
                <ul className="divide-y divide-border/60">
                  {group.items.map((ing) => (
                    <li key={ing.id} className="flex items-baseline gap-3 py-2">
                      <span className="min-w-[4.5rem] shrink-0 text-sm font-semibold tabular-nums text-primary">
                        {ing.amount ? `${ing.amount}${ing.unit ? " " + ing.unit : ""}` : ""}
                      </span>
                      <span className="text-sm leading-relaxed">
                        {ing.ingredientName}
                        {ing.preparation && (
                          <span className="text-muted-foreground">, {ing.preparation}</span>
                        )}
                        {ing.isOptional && (
                          <span className="ml-1 text-xs text-muted-foreground">(optional)</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {recipe.steps.length > 0 && (
          <section>
            <h2 className="mb-4 text-xl font-bold tracking-tight">Method</h2>
            <ol className="space-y-4">
              {recipe.steps.map((step, i) => (
                <li
                  key={step.id}
                  className="flex gap-4 rounded-2xl border bg-card/60 p-4 shadow-sm"
                >
                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/75 text-sm font-bold text-primary-foreground shadow-md shadow-primary/25">
                    {i + 1}
                  </span>
                  <div className="flex-1 pt-1">
                    <p className="leading-relaxed">{step.instruction}</p>
                    {step.durationMinutes && (
                      <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                        <Timer className="h-3.5 w-3.5" />
                        {step.timerLabel ?? `${step.durationMinutes} min`}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </div>
  );
}
