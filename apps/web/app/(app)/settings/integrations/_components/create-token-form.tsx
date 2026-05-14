"use client";

import { useRef, useState, useTransition } from "react";
import { createIntegrationToken } from "@/app/actions/integrations";
import { ALL_SCOPES } from "@/app/actions/integration-constants";

const SCOPE_LABELS: Record<string, string> = {
  "read:meal_plan": "Read meal plan",
  "write:meal_plan": "Write meal plan (AI generation)",
  "read:shopping_list": "Read shopping list",
  "write:shopping_list": "Add shopping list items",
};

export function CreateTokenForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setNewToken(null);

    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        const result = await createIntegrationToken(fd);
        setNewToken(result.rawToken);
        formRef.current?.reset();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create token");
      }
    });
  }

  async function copyToken() {
    if (!newToken) return;
    await navigator.clipboard.writeText(newToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-4 font-semibold">Create new token</h3>

      {newToken && (
        <div className="mb-4 rounded-md border border-green-200 bg-green-50 p-3 dark:border-green-900 dark:bg-green-950">
          <p className="mb-1 text-sm font-medium text-green-800 dark:text-green-200">
            Token created — copy it now. It won&apos;t be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-white px-2 py-1 text-xs dark:bg-black">
              {newToken}
            </code>
            <button
              onClick={copyToken}
              className="shrink-0 rounded border px-2 py-1 text-xs hover:bg-accent"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      )}

      <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">Token name</label>
          <input
            name="name"
            required
            placeholder="e.g. n8n automation"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">Scopes</p>
          <div className="space-y-2">
            {ALL_SCOPES.map((scope) => (
              <label key={scope} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name={scope} className="rounded" />
                <span>{SCOPE_LABELS[scope]}</span>
                <code className="ml-auto text-xs text-muted-foreground">{scope}</code>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">
            Expires in (days) — leave blank for no expiry
          </label>
          <input
            name="expiresInDays"
            type="number"
            min="1"
            placeholder="Never"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create token"}
        </button>
      </form>
    </div>
  );
}
