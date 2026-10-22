"use server";

import { db } from "@/lib/db";
import { notes, recipes } from "@dishes/db/schema";
import { eq, and } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { resolveIdentity } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";

export async function createNote(formData: FormData) {
  const user = await resolveIdentity();
  const { householdId } = await requireHousehold(user);

  const title = (formData.get("title") as string)?.trim();
  const body = (formData.get("body") as string)?.trim() ?? "";
  const recipeId = (formData.get("recipeId") as string)?.trim() || null;

  if (!title) throw new Error("Note title is required");

  // Only this household's recipes can be linked: the link shows the recipe's
  // title, so a foreign id would leak it.
  if (recipeId) {
    const [own] = await db
      .select({ id: recipes.id })
      .from(recipes)
      .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
      .limit(1);
    if (!own) throw new Error("Recipe not found");
  }

  const [note] = await db
    .insert(notes)
    .values({ householdId, title, body, recipeId })
    .returning({ id: notes.id });

  revalidatePath("/notes");
  if (recipeId) revalidatePath(`/recipes/${recipeId}`);

  redirect(`/notes/${note.id}`);
}

export async function updateNote(noteId: string, formData: FormData) {
  const user = await resolveIdentity();
  const { householdId } = await requireHousehold(user);

  const title = (formData.get("title") as string)?.trim();
  const body = (formData.get("body") as string)?.trim() ?? "";

  if (!title) throw new Error("Note title is required");

  const [note] = await db
    .update(notes)
    .set({ title, body })
    .where(and(eq(notes.id, noteId), eq(notes.householdId, householdId)))
    .returning({ recipeId: notes.recipeId });

  revalidatePath("/notes");
  revalidatePath(`/notes/${noteId}`);
  if (note?.recipeId) revalidatePath(`/recipes/${note.recipeId}`);
}

export async function deleteNote(noteId: string) {
  const user = await resolveIdentity();
  const { householdId } = await requireHousehold(user);

  const [note] = await db
    .delete(notes)
    .where(and(eq(notes.id, noteId), eq(notes.householdId, householdId)))
    .returning({ recipeId: notes.recipeId });

  revalidatePath("/notes");
  if (note?.recipeId) revalidatePath(`/recipes/${note.recipeId}`);

  redirect("/notes");
}
