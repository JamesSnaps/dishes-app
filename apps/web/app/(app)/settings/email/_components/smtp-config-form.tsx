"use client";

import { useTransition, useState } from "react";
import { Button, Input } from "@dishes/ui";
import { saveSmtpConfig, deleteSmtpConfig } from "@/app/actions/sharing";

interface SmtpConfig {
  host: string;
  port: number;
  username: string;
  fromAddress: string;
  fromName: string | null;
  hasPassword: boolean;
}

interface Props {
  existing: SmtpConfig | null;
  isAdmin: boolean;
}

export function SmtpConfigForm({ existing, isAdmin }: Props) {
  const [isPending, startTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await saveSmtpConfig(formData);
        setSaved(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save");
      }
    });
  }

  function handleDelete() {
    if (!confirm("Remove SMTP configuration? Email sharing will be disabled.")) return;
    startDeleteTransition(async () => {
      await deleteSmtpConfig();
    });
  }

  if (!isAdmin) {
    return (
      <p className="text-sm text-muted-foreground">
        Only admins can configure email settings.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2 space-y-1.5">
          <label className="text-sm font-medium" htmlFor="host">
            SMTP host
          </label>
          <Input
            id="host"
            name="host"
            placeholder="smtp.example.com"
            defaultValue={existing?.host ?? ""}
            required
            disabled={isPending}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="port">
            Port
          </label>
          <Input
            id="port"
            name="port"
            type="number"
            placeholder="587"
            defaultValue={existing?.port ?? 587}
            required
            disabled={isPending}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="username">
          Username
        </label>
        <Input
          id="username"
          name="username"
          placeholder="you@example.com"
          defaultValue={existing?.username ?? ""}
          required
          disabled={isPending}
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="password">
          Password
          {existing?.hasPassword && (
            <span className="ml-2 text-xs text-muted-foreground font-normal">
              (leave blank to keep existing)
            </span>
          )}
        </label>
        <Input
          id="password"
          name="password"
          type="password"
          placeholder={existing?.hasPassword ? "••••••••" : "SMTP password"}
          disabled={isPending}
          autoComplete="new-password"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="fromAddress">
          From address
        </label>
        <Input
          id="fromAddress"
          name="fromAddress"
          type="email"
          placeholder="dishes@yourdomain.com"
          defaultValue={existing?.fromAddress ?? ""}
          required
          disabled={isPending}
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="fromName">
          Display name{" "}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <Input
          id="fromName"
          name="fromName"
          placeholder="The Smith Kitchen"
          defaultValue={existing?.fromName ?? ""}
          disabled={isPending}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && <p className="text-sm text-green-600">Settings saved.</p>}

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : "Save"}
        </Button>
        {existing && (
          <Button
            type="button"
            variant="outline"
            disabled={isDeleting}
            onClick={handleDelete}
            className="text-destructive hover:text-destructive"
          >
            {isDeleting ? "Removing…" : "Remove"}
          </Button>
        )}
      </div>
    </form>
  );
}
