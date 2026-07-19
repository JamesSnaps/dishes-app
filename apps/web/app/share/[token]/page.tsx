import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import {
  ChefHat,
  Clock,
  Dumbbell,
  Flame,
  ListChecks,
  Timer,
  Users,
  UtensilsCrossed,
  Wheat,
} from "lucide-react";
import { getSharedRecipe } from "@/app/actions/sharing";

interface Props {
  params: Promise<{ token: string }>;
}

// Dedupe the fetch between generateMetadata and the page render.
const getShared = cache(getSharedRecipe);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const data = await getShared(token);
  if (!data) return { title: "Recipe not found — Dishes" };

  const { recipe } = data;
  const description =
    recipe.description ?? "A recipe shared from Dishes, the family recipe app.";

  return {
    title: `${recipe.title} — Dishes`,
    description,
    openGraph: {
      title: recipe.title,
      description,
      type: "article",
      ...(recipe.imageUrl ? { images: [{ url: recipe.imageUrl }] } : {}),
    },
    twitter: {
      card: recipe.imageUrl ? "summary_large_image" : "summary",
      title: recipe.title,
      description,
    },
  };
}

function formatMinutes(total: number): string {
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function MetaChip({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border bg-card/80 px-3.5 py-2.5 shadow-sm backdrop-blur-sm">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div className="leading-tight">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold">{value}</p>
      </div>
    </div>
  );
}

export default async function SharedRecipePage({ params }: Props) {
  const { token } = await params;
  const data = await getShared(token);

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

  // Group steps by groupLabel (contiguous), with a continuous 1..N number
  const stepGroups: { label: string | null; items: typeof steps }[] = [];
  for (const step of steps) {
    const label = step.groupLabel ?? null;
    const last = stepGroups[stepGroups.length - 1];
    if (last && last.label === label) {
      last.items.push(step);
    } else {
      stepGroups.push({ label, items: [step] });
    }
  }

  const macros = [
    recipe.proteinG != null && { label: "Protein", value: `${parseFloat(recipe.proteinG)}g`, icon: Dumbbell },
    recipe.carbsG != null && { label: "Carbs", value: `${parseFloat(recipe.carbsG)}g`, icon: Wheat },
    recipe.fatG != null && { label: "Fat", value: `${parseFloat(recipe.fatG)}g`, icon: Flame },
  ].filter(Boolean) as { label: string; value: string; icon: React.ElementType }[];

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/[0.06] via-background to-background text-foreground">
      {/* Top brand band */}
      <header className="mx-auto flex max-w-6xl items-center gap-2 px-4 pt-6 sm:px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-md shadow-primary/25">
          <UtensilsCrossed className="h-4 w-4" />
        </div>
        <span className="text-lg font-semibold tracking-tight">Dishes</span>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pb-12 pt-8 sm:px-6 lg:pt-12">
        <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
          {/* Image — first on mobile, right on desktop */}
          <div className="relative order-first lg:order-last">
            {recipe.imageUrl ? (
              <>
                {/* soft glow behind the photo */}
                <div className="absolute -inset-4 rounded-[2rem] bg-primary/15 blur-2xl" aria-hidden />
                <div className="relative aspect-[4/3] overflow-hidden rounded-3xl shadow-2xl ring-1 ring-black/10 lg:aspect-[4/5] lg:max-h-[34rem]">
                  <Image
                    src={recipe.imageUrl}
                    alt={recipe.title}
                    fill
                    priority
                    sizes="(min-width: 1024px) 40rem, 100vw"
                    className="object-cover"
                  />
                </div>
              </>
            ) : (
              <div className="flex aspect-[4/3] items-center justify-center rounded-3xl bg-gradient-to-br from-primary/15 via-primary/5 to-transparent ring-1 ring-primary/10 lg:aspect-[4/5] lg:max-h-[34rem]">
                <UtensilsCrossed className="h-16 w-16 text-primary/30" />
              </div>
            )}
          </div>

          {/* Title block */}
          <div>
            {recipe.cuisine && (
              <p className="mb-3 inline-block rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-primary">
                {recipe.cuisine}
              </p>
            )}
            <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
              {recipe.title}
            </h1>
            {recipe.description && (
              <p className="mt-4 max-w-prose text-base leading-relaxed text-muted-foreground sm:text-lg">
                {recipe.description}
              </p>
            )}

            <div className="mt-6 flex flex-wrap gap-2.5">
              {totalTime > 0 && (
                <MetaChip icon={Clock} label="Time" value={formatMinutes(totalTime)} />
              )}
              {recipe.servings && (
                <MetaChip
                  icon={Users}
                  label="Serves"
                  value={`${parseFloat(recipe.servings)} ${recipe.servingsUnit ?? ""}`.trim()}
                />
              )}
              {recipe.difficulty && (
                <MetaChip
                  icon={ChefHat}
                  label="Difficulty"
                  value={recipe.difficulty.charAt(0).toUpperCase() + recipe.difficulty.slice(1)}
                />
              )}
              {recipe.calories != null && (
                <MetaChip icon={Flame} label="Per serving" value={`${recipe.calories} kcal`} />
              )}
            </div>

            {macros.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
                {macros.map((m) => (
                  <span key={m.label} className="flex items-center gap-1.5">
                    <m.icon className="h-3.5 w-3.5 text-primary/70" />
                    {m.value} {m.label.toLowerCase()}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Content */}
      <div className="mx-auto grid max-w-6xl gap-8 px-4 pb-16 sm:px-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-12">
        {/* Ingredients */}
        <section className="lg:sticky lg:top-8 lg:self-start">
          <div className="rounded-2xl border bg-gradient-to-br from-primary/[0.07] via-card to-card p-5 shadow-sm sm:p-6">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <ListChecks className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold leading-tight">Ingredients</h2>
                {recipe.servings && (
                  <p className="text-xs text-muted-foreground">
                    for {parseFloat(recipe.servings)} {recipe.servingsUnit ?? "servings"}
                  </p>
                )}
              </div>
            </div>

            {groups.map((group, gi) => (
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
                        {ing.amount
                          ? `${ing.amount}${ing.unit ? " " + ing.unit : ""}`
                          : ""}
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

        {/* Method */}
        {steps.length > 0 && (
          <section>
            <h2 className="mb-6 text-2xl font-bold tracking-tight">Method</h2>
            {(() => {
              let counter = 0;
              return stepGroups.map((group, gi) => (
                <div key={gi} className={gi > 0 ? "mt-8" : ""}>
                  {group.label && (
                    <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-primary/80">
                      {group.label}
                    </h3>
                  )}
                  <ol className="space-y-4">
                    {group.items.map((step) => {
                      counter += 1;
                      return (
                        <li
                          key={step.id}
                          className="flex gap-4 rounded-2xl border bg-card/60 p-4 shadow-sm sm:p-5"
                        >
                          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/75 text-sm font-bold text-primary-foreground shadow-md shadow-primary/25">
                            {counter}
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
                      );
                    })}
                  </ol>
                </div>
              ));
            })()}
          </section>
        )}
      </div>

      {/* Branded footer */}
      <footer className="border-t bg-gradient-to-b from-transparent to-primary/[0.05]">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-4 py-10 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
            <UtensilsCrossed className="h-5 w-5" />
          </div>
          <p className="text-sm font-semibold">Made with Dishes</p>
          <p className="text-xs text-muted-foreground">
            The self-hosted family recipe &amp; meal planning app
          </p>
        </div>
      </footer>
    </div>
  );
}
