import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 text-center">
      <div className="mb-8 text-6xl">🍽️</div>
      <h1 className="mb-2 text-4xl font-bold tracking-tight">Dishes</h1>
      <p className="mb-8 text-muted-foreground">
        Family recipe and meal planning
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          href="/recipes"
          className="rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Browse Recipes
        </Link>
        <Link
          href="/meal-plan"
          className="rounded-lg border border-border px-6 py-3 text-sm font-medium hover:bg-muted transition-colors"
        >
          Meal Plan
        </Link>
      </div>
    </main>
  );
}
