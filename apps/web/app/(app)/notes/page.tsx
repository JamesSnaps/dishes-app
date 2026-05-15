import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { notes, recipes } from "@dishes/db/schema";
import { eq, desc } from "drizzle-orm";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { Button } from "@dishes/ui";

export const metadata = { title: "My Notes" };

export default async function NotesPage() {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      body: notes.body,
      updatedAt: notes.updatedAt,
      recipeId: notes.recipeId,
      recipeTitle: recipes.title,
    })
    .from(notes)
    .leftJoin(recipes, eq(notes.recipeId, recipes.id))
    .where(eq(notes.householdId, householdId))
    .orderBy(desc(notes.updatedAt));

  return (
    <div className="p-4 lg:p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Notes</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {rows.length} note{rows.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/notes/new">
            <Plus className="mr-1 h-4 w-4" />
            New Note
          </Link>
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
          <FileText className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-muted-foreground">No notes yet.</p>
          <p className="text-sm text-muted-foreground/60">
            Jot down ideas, substitutions, or anything you want to remember.
          </p>
          <Button asChild className="mt-2">
            <Link href="/notes/new">Write a note</Link>
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 max-w-2xl">
          {rows.map((note) => (
            <Link
              key={note.id}
              href={`/notes/${note.id}`}
              className="group rounded-xl border bg-card p-4 hover:border-primary/40 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-tight group-hover:text-primary transition-colors">
                    {note.title}
                  </p>
                  {note.body && (
                    <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                      {note.body}
                    </p>
                  )}
                  {note.recipeTitle && (
                    <p className="mt-1.5 text-xs text-primary/70">
                      Recipe: {note.recipeTitle}
                    </p>
                  )}
                </div>
                <p className="text-xs text-muted-foreground shrink-0 mt-0.5">
                  {new Date(note.updatedAt).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                  })}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
