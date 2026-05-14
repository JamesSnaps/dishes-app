import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { getAiConfig } from "@/app/actions/settings";
import { NewRecipeClient } from "./new-recipe-client";

export const metadata = { title: "New Recipe" };

export default async function NewRecipePage() {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);
  const aiConfig = await getAiConfig(householdId);

  return (
    <div className="mx-auto max-w-screen-xl p-4 lg:p-8">
      <Link
        href="/recipes"
        className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />
        Recipes
      </Link>

      <NewRecipeClient hasAi={!!aiConfig?.hasKey} />
    </div>
  );
}
