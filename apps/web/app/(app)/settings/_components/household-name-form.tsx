"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@dishes/ui";
import { Input } from "@dishes/ui";
import { updateHouseholdName } from "@/app/actions/settings";

export function HouseholdNameForm({ currentName }: { currentName: string }) {
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleEdit() {
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function handleCancel() {
    setEditing(false);
    setError(null);
  }

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await updateHouseholdName(formData);
        setEditing(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to update name");
      }
    });
  }

  return (
    <div>
      <label className="text-sm font-medium text-muted-foreground">Household name</label>
      {editing ? (
        <form action={handleSubmit} className="mt-1.5 flex items-center gap-2">
          <Input
            ref={inputRef}
            name="name"
            defaultValue={currentName}
            className="max-w-xs"
            disabled={isPending}
            required
          />
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "Saving…" : "Save"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={handleCancel} disabled={isPending}>
            Cancel
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
      ) : (
        <div className="mt-1 flex items-center gap-3">
          <p className="text-lg font-semibold">{currentName}</p>
          <Button type="button" size="sm" variant="outline" onClick={handleEdit}>
            Edit
          </Button>
        </div>
      )}
    </div>
  );
}
