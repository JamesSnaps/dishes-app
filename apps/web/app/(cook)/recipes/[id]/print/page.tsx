import { notFound } from "next/navigation";
import { eq, and, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { recipes, recipeIngredients, recipeSteps, recipeTags } from "@dishes/db/schema";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { AutoPrint, PrintToolbar } from "./_components/auto-print";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const recipe = await db
    .select({ title: recipes.title })
    .from(recipes)
    .where(eq(recipes.id, id))
    .limit(1)
    .then((r) => r[0] ?? null);
  return { title: recipe ? `Print: ${recipe.title}` : "Print Recipe" };
}

export default async function PrintRecipePage({ params }: Props) {
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
    db.select().from(recipeTags).where(eq(recipeTags.recipeId, id)),
  ]);

  if (!recipe) notFound();

  const totalMinutes = (recipe.prepTimeMinutes ?? 0) + (recipe.cookTimeMinutes ?? 0);

  function formatTime(minutes: number): string {
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  // Group ingredients by groupLabel
  const groupedIngredients: { label: string | null; items: typeof ingredients }[] = [];
  for (const ing of ingredients) {
    const label = ing.groupLabel || null;
    const last = groupedIngredients[groupedIngredients.length - 1];
    if (last && last.label === label) {
      last.items.push(ing);
    } else {
      groupedIngredients.push({ label, items: [ing] });
    }
  }

  // Group steps by groupLabel (contiguous), keeping a continuous 1..N number
  const groupedSteps: { label: string | null; items: typeof steps }[] = [];
  for (const step of steps) {
    const label = step.groupLabel || null;
    const last = groupedSteps[groupedSteps.length - 1];
    if (last && last.label === label) {
      last.items.push(step);
    } else {
      groupedSteps.push({ label, items: [step] });
    }
  }

  return (
    <div className="print-page">
      <AutoPrint />

      {/* Screen-only toolbar */}
      <PrintToolbar />

      <div className="recipe-print-body mx-auto max-w-2xl px-8 py-10">
        {/* Header */}
        <h1 className="mb-2 text-3xl font-bold leading-tight">{recipe.title}</h1>

        {/* Meta */}
        <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {recipe.cuisine && <span>{recipe.cuisine}</span>}
          {recipe.difficulty && <span className="capitalize">{recipe.difficulty}</span>}
          {recipe.prepTimeMinutes != null && recipe.prepTimeMinutes > 0 && (
            <span>Prep {formatTime(recipe.prepTimeMinutes)}</span>
          )}
          {recipe.cookTimeMinutes != null && recipe.cookTimeMinutes > 0 && (
            <span>Cook {formatTime(recipe.cookTimeMinutes)}</span>
          )}
          {totalMinutes > 0 && <span>Total {formatTime(totalMinutes)}</span>}
          {recipe.servings && (
            <span>
              Serves {parseFloat(recipe.servings)} {recipe.servingsUnit}
            </span>
          )}
        </div>

        {/* Description */}
        {recipe.description && (
          <p className="mb-6 text-sm leading-relaxed text-muted-foreground">{recipe.description}</p>
        )}

        {/* Ingredients */}
        {ingredients.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-lg font-semibold uppercase tracking-wide">Ingredients</h2>
            {groupedIngredients.map((group, gi) => (
              <div key={gi} className="mb-3">
                {group.label && (
                  <p className="mb-1.5 text-sm font-semibold text-muted-foreground">{group.label}</p>
                )}
                <ul className="space-y-1.5">
                  {group.items.map((ing) => {
                    const parts: string[] = [];
                    if (ing.amount) parts.push(ing.amount);
                    if (ing.unit) parts.push(ing.unit);
                    parts.push(ing.ingredientName);
                    if (ing.preparation) parts.push(`(${ing.preparation})`);
                    return (
                      <li key={ing.id} className="flex items-baseline gap-2 text-sm">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/40" />
                        <span>
                          {parts.join(" ")}
                          {ing.isOptional && (
                            <span className="ml-1 text-xs text-muted-foreground">(optional)</span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
        )}

        {/* Steps */}
        {steps.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-lg font-semibold uppercase tracking-wide">Instructions</h2>
            {(() => {
              let counter = 0;
              return groupedSteps.map((group, gi) => (
                <div key={gi} className={gi > 0 ? "mt-4" : ""}>
                  {group.label && (
                    <p className="mb-1.5 text-sm font-semibold text-muted-foreground">{group.label}</p>
                  )}
                  <ol className="space-y-4">
                    {group.items.map((step) => {
                      counter += 1;
                      return (
                        <li key={step.id} className="flex gap-4 text-sm leading-relaxed">
                          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-xs font-bold">
                            {counter}
                          </span>
                          <div>
                            <p>{step.instruction}</p>
                            {step.durationMinutes != null && step.durationMinutes > 0 && (
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                ⏱ {formatTime(step.durationMinutes)}
                                {step.timerLabel ? ` — ${step.timerLabel}` : ""}
                              </p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ));
            })()}
          </section>
        )}

        {/* Notes */}
        {recipe.notes && (
          <section className="mb-6">
            <h2 className="mb-2 text-lg font-semibold uppercase tracking-wide">Notes</h2>
            <p className="text-sm leading-relaxed">{recipe.notes}</p>
          </section>
        )}

        {/* Tags */}
        {tags.length > 0 && (
          <p className="mb-4 text-xs text-muted-foreground">
            Tags: {tags.map((t) => t.tag).join(", ")}
          </p>
        )}

        {/* Source */}
        {recipe.sourceUrl && (
          <p className="text-xs text-muted-foreground">
            Source:{" "}
            <a href={recipe.sourceUrl} className="underline">
              {recipe.sourceUrl}
            </a>
          </p>
        )}

        {/* Footer */}
        <p className="mt-10 border-t pt-4 text-xs text-muted-foreground/50">Dishes</p>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .recipe-print-body { max-width: 100% !important; padding: 0 !important; }
        }
      `}</style>
    </div>
  );
}
