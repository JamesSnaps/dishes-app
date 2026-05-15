import { createNote } from "@/app/actions/notes";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { db } from "@/lib/db";
import { recipes } from "@dishes/db/schema";
import { eq, and } from "drizzle-orm";
import { NoteForm } from "../_components/note-form";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export const metadata = { title: "New Note" };

interface Props {
  searchParams: Promise<{ recipeId?: string }>;
}

export default async function NewNotePage({ searchParams }: Props) {
  const { recipeId } = await searchParams;
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  let linkedRecipe: { id: string; title: string } | null = null;
  if (recipeId) {
    const row = await db
      .select({ id: recipes.id, title: recipes.title })
      .from(recipes)
      .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
      .limit(1);
    linkedRecipe = row[0] ?? null;
  }

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <Link
        href={linkedRecipe ? `/recipes/${linkedRecipe.id}` : "/notes"}
        className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
      >
        <ChevronLeft className="h-4 w-4" />
        {linkedRecipe ? linkedRecipe.title : "My Notes"}
      </Link>

      <h1 className="text-2xl font-bold mb-6">New note</h1>

      <NoteForm action={createNote} linkedRecipe={linkedRecipe} />
    </div>
  );
}
