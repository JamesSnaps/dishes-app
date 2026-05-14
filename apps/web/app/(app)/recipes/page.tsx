import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";

export const metadata = { title: "Recipes" };

export default async function RecipesPage() {
  const user = await getAutheliaUser();
  await requireHousehold(user);

  return (
    <div className="p-4 lg:p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Recipes</h1>
        <a
          href="/recipes/new"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          + New Recipe
        </a>
      </div>
      <p className="text-muted-foreground">No recipes yet. Add your first one!</p>
    </div>
  );
}
