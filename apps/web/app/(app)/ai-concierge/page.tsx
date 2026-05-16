import Link from "next/link";
import { Suspense } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@dishes/ui";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { getAiConfig } from "@/app/actions/settings";
import { db } from "@/lib/db";
import { recipes, recipeTags, householdMembers } from "@dishes/db/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import { ConciergeClient } from "./_components/concierge-client";

export const metadata = { title: "AI Concierge" };

export default async function AiConciergePage() {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);
  const [aiConfig, cuisineRows, tagRows, memberRows] = await Promise.all([
    getAiConfig(householdId),
    db
      .selectDistinct({ cuisine: recipes.cuisine })
      .from(recipes)
      .where(and(eq(recipes.householdId, householdId), isNotNull(recipes.cuisine)))
      .orderBy(recipes.cuisine),
    db
      .selectDistinct({ tag: recipeTags.tag })
      .from(recipeTags)
      .innerJoin(recipes, eq(recipeTags.recipeId, recipes.id))
      .where(eq(recipes.householdId, householdId))
      .orderBy(recipeTags.tag),
    db
      .select({ id: householdMembers.id, displayName: householdMembers.displayName })
      .from(householdMembers)
      .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.isActive, true)))
      .orderBy(householdMembers.displayName),
  ]);
  const availableCuisines = cuisineRows.map((r) => r.cuisine).filter((c): c is string => c !== null);
  const availableTags = tagRows.map((r) => r.tag);
  const members = memberRows;

  if (!aiConfig?.hasKey) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <Sparkles className="h-8 w-8 text-muted-foreground/50" />
        </div>
        <h1 className="text-xl font-semibold mb-2">AI not configured</h1>
        <p className="text-sm text-muted-foreground mb-6 max-w-sm">
          Add your OpenAI API key in Settings to start generating recipe ideas with the AI Concierge.
        </p>
        <Button asChild>
          <Link href="/settings/ai">Configure AI</Link>
        </Button>
      </div>
    );
  }

  return (
    <Suspense>
      <ConciergeClient availableCuisines={availableCuisines} availableTags={availableTags} members={members} />
    </Suspense>
  );
}
