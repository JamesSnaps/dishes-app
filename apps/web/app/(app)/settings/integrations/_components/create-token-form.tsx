"use client";

import { useRef, useState, useTransition } from "react";
import { createIntegrationToken } from "@/app/actions/integrations";
import { ALL_SCOPES, MEMBER_SCOPES, type TokenScope } from "@/app/actions/integration-constants";
import { SCOPE_DESCRIPTIONS } from "@/lib/integrations-catalog";
import { TOKEN_CREATED_EVENT } from "./try-it";

export function CreateTokenForm({ members }: { members: { id: string; displayName: string }[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [ticked, setTicked] = useState<Set<TokenScope>>(new Set());
  const needsMember = [...ticked].some((s) => MEMBER_SCOPES.includes(s));

  function toggleScope(scope: TokenScope, on: boolean) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(scope);
      else next.delete(scope);
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setNewToken(null);

    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        const result = await createIntegrationToken(fd);
        setNewToken(result.rawToken);
        window.dispatchEvent(new CustomEvent(TOKEN_CREATED_EVENT, { detail: result.rawToken }));
        formRef.current?.reset();
        setTicked(new Set());
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
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <h3 className="mb-4 font-semibold">Create new token</h3>

      {newToken && (
        <div className="mb-4 rounded-md border border-transparent bg-success-tint p-3">
          <p className="mb-1 text-sm font-medium text-success">
            Token created — copy it now. It won&apos;t be shown again. It&apos;s also been filled into
            the Try it console.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-card px-2 py-1 text-xs dark:bg-black">
              {newToken}
            </code>
            <button
              onClick={copyToken}
              className="shrink-0 rounded-md bg-success px-2.5 py-1 text-xs font-semibold text-card shadow-sm hover:bg-success"
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
                <input
                  type="checkbox"
                  name={scope}
                  className="rounded"
                  onChange={(e) => toggleScope(scope, e.target.checked)}
                />
                <span>{SCOPE_DESCRIPTIONS[scope]}</span>
                <code className="ml-auto text-xs text-muted-foreground">{scope}</code>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="token-member" className="mb-1 block text-sm font-medium">
            Acts as{needsMember ? "" : " — optional"}
          </label>
          <select
            id="token-member"
            name="memberId"
            required={needsMember}
            defaultValue=""
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">{needsMember ? "Choose a member…" : "Nobody — household only"}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            Meals out logged with this token are filed as theirs, with their rating. Needed for{" "}
            <code>write:outside_meals</code>.
          </p>
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
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-md transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create token"}
        </button>
      </form>
    </div>
  );
}
