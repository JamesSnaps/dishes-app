import { notFound } from "next/navigation";
import { Clock, Users, ChefHat } from "lucide-react";
import { getSharedRecipe } from "@/app/actions/sharing";

interface Props {
  params: Promise<{ token: string }>;
}

export default async function SharedRecipePage({ params }: Props) {
  const { token } = await params;
  const data = await getSharedRecipe(token);

  if (!data) notFound();

  const { recipe, ingredients, steps } = data;

  const totalTime = (recipe.prepTimeMinutes ?? 0) + (recipe.cookTimeMinutes ?? 0);

  // Group ingredients by groupLabel
  const groups: { label: string | null; items: typeof ingredients }[] = [];
  for (const ing of ingredients) {
    const label = ing.groupLabel ?? null;
    const existing = groups.find((g) => g.label === label);
    if (existing) {
      existing.items.push(ing);
    } else {
      groups.push({ label, items: [ing] });
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Hero */}
      {recipe.imageUrl && (
        <div className="relative w-full aspect-video max-h-72 overflow-hidden">
          <img
            src={recipe.imageUrl}
            alt={recipe.title}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Title + meta */}
        <h1 className="text-3xl font-bold mb-2">{recipe.title}</h1>

        {recipe.description && (
          <p className="text-muted-foreground mb-4">{recipe.description}</p>
        )}

        <div className="flex flex-wrap gap-3 mb-8 text-sm text-muted-foreground">
          {totalTime > 0 && (
            <span className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              {totalTime} min
            </span>
          )}
          {recipe.servings && (
            <span className="flex items-center gap-1">
              <Users className="h-4 w-4" />
              {recipe.servings} {recipe.servingsUnit ?? "servings"}
            </span>
          )}
          {recipe.difficulty && (
            <span className="flex items-center gap-1">
              <ChefHat className="h-4 w-4" />
              {recipe.difficulty.charAt(0).toUpperCase() + recipe.difficulty.slice(1)}
            </span>
          )}
          {recipe.cuisine && (
            <span className="capitalize">{recipe.cuisine}</span>
          )}
        </div>

        {/* Ingredients */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Ingredients</h2>
          {groups.map((group, gi) => (
            <div key={gi} className="mb-4">
              {group.label && (
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  {group.label}
                </h3>
              )}
              <ul className="space-y-1">
                {group.items.map((ing) => (
                  <li key={ing.id} className="flex gap-2">
                    <span className="shrink-0 text-muted-foreground min-w-[4rem]">
                      {ing.amount
                        ? `${ing.amount}${ing.unit ? " " + ing.unit : ""}`
                        : ""}
                    </span>
                    <span>
                      {ing.ingredientName}
                      {ing.preparation && (
                        <span className="text-muted-foreground">, {ing.preparation}</span>
                      )}
                      {ing.isOptional && (
                        <span className="text-muted-foreground text-xs ml-1">(optional)</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        {/* Steps */}
        {steps.length > 0 && (
          <section className="mb-12">
            <h2 className="text-xl font-semibold mb-4">Method</h2>
            <ol className="space-y-6">
              {steps.map((step, i) => (
                <li key={step.id} className="flex gap-4">
                  <span className="flex-none w-7 h-7 rounded-full bg-foreground text-background text-sm font-semibold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <div className="flex-1">
                    <p>{step.instruction}</p>
                    {step.durationMinutes && (
                      <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {step.timerLabel ?? `${step.durationMinutes} min`}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        <hr className="border-border mb-6" />
        <p className="text-xs text-muted-foreground text-center">
          Shared via Dishes — a family recipe app
        </p>
      </div>
    </div>
  );
}
