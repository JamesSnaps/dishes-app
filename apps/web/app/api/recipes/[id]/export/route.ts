import { NextRequest, NextResponse } from "next/server";
import { eq, and, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { recipes, recipeIngredients, recipeSteps, recipeTags } from "@dishes/db/schema";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  if (!recipe) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  function formatTime(minutes: number): string {
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  const lines: string[] = [];

  // Title
  lines.push(recipe.title);
  lines.push("=".repeat(recipe.title.length));
  lines.push("");

  // Description
  if (recipe.description) {
    lines.push(recipe.description);
    lines.push("");
  }

  // Meta
  const meta: string[] = [];
  if (recipe.cuisine) meta.push(`Cuisine: ${recipe.cuisine}`);
  if (recipe.difficulty) meta.push(`Difficulty: ${recipe.difficulty}`);
  if (recipe.prepTimeMinutes) meta.push(`Prep: ${formatTime(recipe.prepTimeMinutes)}`);
  if (recipe.cookTimeMinutes) meta.push(`Cook: ${formatTime(recipe.cookTimeMinutes)}`);
  const total = (recipe.prepTimeMinutes ?? 0) + (recipe.cookTimeMinutes ?? 0);
  if (total > 0) meta.push(`Total: ${formatTime(total)}`);
  if (recipe.servings) meta.push(`Serves: ${parseFloat(recipe.servings)} ${recipe.servingsUnit ?? ""}`);
  if (meta.length) {
    lines.push(meta.join("  |  "));
    lines.push("");
  }

  // Tags
  if (tags.length) {
    lines.push(`Tags: ${tags.map((t) => t.tag).join(", ")}`);
    lines.push("");
  }

  // Ingredients
  if (ingredients.length) {
    lines.push("INGREDIENTS");
    lines.push("-----------");
    let currentGroup: string | null | undefined = undefined;
    for (const ing of ingredients) {
      if (ing.groupLabel !== currentGroup) {
        currentGroup = ing.groupLabel;
        if (currentGroup) {
          lines.push(`\n${currentGroup}:`);
        }
      }
      const parts: string[] = [];
      if (ing.amount) parts.push(ing.amount);
      if (ing.unit) parts.push(ing.unit);
      parts.push(ing.ingredientName);
      if (ing.preparation) parts.push(`(${ing.preparation})`);
      const suffix = ing.isOptional ? " [optional]" : "";
      lines.push(`• ${parts.join(" ")}${suffix}`);
    }
    lines.push("");
  }

  // Steps
  if (steps.length) {
    lines.push("INSTRUCTIONS");
    lines.push("------------");
    steps.forEach((step, i) => {
      lines.push(`${i + 1}. ${step.instruction}`);
      if (step.durationMinutes) {
        const timer = step.timerLabel ? ` (${step.timerLabel})` : "";
        lines.push(`   ⏱ ${formatTime(step.durationMinutes)}${timer}`);
      }
    });
    lines.push("");
  }

  // Notes
  if (recipe.notes) {
    lines.push("NOTES");
    lines.push("-----");
    lines.push(recipe.notes);
    lines.push("");
  }

  // Source
  if (recipe.sourceUrl) {
    lines.push(`Source: ${recipe.sourceUrl}`);
    lines.push("");
  }

  const slug = recipe.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}.txt"`,
    },
  });
}
