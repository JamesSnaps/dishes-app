"use client";

import { useTransition } from "react";
import Link from "next/link";
import { Button, Input, Label, Textarea } from "@dishes/ui";

interface Props {
  action: (formData: FormData) => Promise<void>;
  initialTitle?: string;
  initialBody?: string;
  linkedRecipe?: { id: string; title: string } | null;
  submitLabel?: string;
}

export function NoteForm({
  action,
  initialTitle = "",
  initialBody = "",
  linkedRecipe,
  submitLabel = "Save note",
}: Props) {
  const [pending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      await action(formData);
    });
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-5">
      {linkedRecipe && (
        <input type="hidden" name="recipeId" value={linkedRecipe.id} />
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          name="title"
          defaultValue={initialTitle}
          placeholder="Note title"
          required
          autoFocus
        />
      </div>

      {linkedRecipe && (
        <div className="rounded-lg border bg-muted/40 px-4 py-2.5 text-sm">
          <span className="text-muted-foreground">Linked to: </span>
          <Link href={`/recipes/${linkedRecipe.id}`} className="font-medium hover:underline">
            {linkedRecipe.title}
          </Link>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="body">Notes</Label>
        <Textarea
          id="body"
          name="body"
          defaultValue={initialBody}
          placeholder="Write your notes here…"
          rows={12}
          className="resize-none"
        />
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
