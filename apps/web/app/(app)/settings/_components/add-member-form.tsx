"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@dishes/ui";
import { Input } from "@dishes/ui";
import { addMember } from "@/app/actions/settings";

export function AddMemberForm() {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await addMember(formData);
        formRef.current?.reset();
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to add member");
      }
    });
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        + Add member
      </Button>
    );
  }

  return (
    <form ref={formRef} action={handleSubmit} className="rounded-lg border bg-card p-4">
      <h3 className="mb-1 font-semibold">Add household member</h3>
      <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
        This creates a profile in your household — it does not create a login.
        Sign-in accounts live in Authelia and only your server administrator can
        create them. A profile with no matching Authelia account still works for
        meal planning and taste preferences; the person just can&apos;t sign in
        until the administrator adds that exact username.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Authelia username</label>
          <Input name="autheliaUser" placeholder="jane.doe" disabled={isPending} required />
          <p className="text-[11px] leading-snug text-muted-foreground">
            Must match their Authelia username exactly. A typo means they get an
            empty household of their own instead of joining yours.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Display name</label>
          <Input name="displayName" placeholder="Jane" disabled={isPending} required />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Role</label>
          <select
            name="role"
            defaultValue="adult"
            disabled={isPending}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="admin">Admin</option>
            <option value="adult">Adult</option>
            <option value="child">Child</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Birth year</label>
          <Input
            name="birthYear"
            type="number"
            inputMode="numeric"
            placeholder="e.g. 2023"
            min={1900}
            max={new Date().getFullYear()}
            disabled={isPending}
          />
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Adding…" : "Add member"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() => { setOpen(false); setError(null); }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
