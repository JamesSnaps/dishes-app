import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { notes, recipes } from "@dishes/db/schema";
import { eq, and } from "drizzle-orm";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { NoteForm } from "../_components/note-form";
import { DeleteNoteButton } from "./_components/delete-note-button";
import { updateNote } from "@/app/actions/notes";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const row = await db
    .select({ title: notes.title })
    .from(notes)
    .where(eq(notes.id, id))
    .limit(1);
  return { title: row[0]?.title ?? "Note" };
}

export default async function NoteDetailPage({ params }: Props) {
  const { id } = await params;
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const row = await db
    .select({
      id: notes.id,
      title: notes.title,
      body: notes.body,
      recipeId: notes.recipeId,
      recipeTitle: recipes.title,
    })
    .from(notes)
    .leftJoin(recipes, eq(notes.recipeId, recipes.id))
    .where(and(eq(notes.id, id), eq(notes.householdId, householdId)))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!row) notFound();

  const linkedRecipe =
    row.recipeId && row.recipeTitle
      ? { id: row.recipeId, title: row.recipeTitle }
      : null;

  async function boundUpdateNote(formData: FormData) {
    "use server";
    await updateNote(id, formData);
  }

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <Link
          href={linkedRecipe ? `/recipes/${linkedRecipe.id}` : "/notes"}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          {linkedRecipe ? linkedRecipe.title : "My Notes"}
        </Link>
        <DeleteNoteButton noteId={row.id} noteTitle={row.title} />
      </div>

      <h1 className="text-2xl font-bold mb-6">{row.title}</h1>

      <NoteForm
        action={boundUpdateNote}
        initialTitle={row.title}
        initialBody={row.body}
        linkedRecipe={linkedRecipe}
        submitLabel="Save changes"
      />
    </div>
  );
}
