"use client";

import { useState, useTransition } from "react";
import { revokeIntegrationToken, updateIntegrationToken } from "@/app/actions/integrations";
import { ALL_SCOPES, MEMBER_SCOPES, type TokenScope } from "@/app/actions/integration-constants";
import { SCOPE_DESCRIPTIONS } from "@/lib/integrations-catalog";

type Member = { id: string; displayName: string };

type Token = {
  id: string;
  name: string;
  scopes: string[];
  /** The member it acts as (id and name), or null for household-only. */
  memberId: string | null;
  actsAs: string | null;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
};

function relativeDate(date: Date | null): string {
  if (!date) return "never";
  const diff = Date.now() - new Date(date).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function isExpired(expiresAt: Date | null): boolean {
  return !!expiresAt && new Date(expiresAt) < new Date();
}

/**
 * Edit a token in place: name, scopes and who it acts as. The secret doesn't
 * change, so whatever uses the token keeps working with the new permissions.
 */
function EditTokenForm({ token, members, onDone }: { token: Token; members: Member[]; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<TokenScope>>(
    () => new Set(ALL_SCOPES.filter((s) => token.scopes.includes(s)))
  );
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
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await updateIntegrationToken(token.id, fd);
        onDone();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save the token");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 space-y-4 border-t border-border pt-3">
      <div>
        <label htmlFor={`token-name-${token.id}`} className="mb-1 block text-sm font-medium">
          Token name
        </label>
        <input
          id={`token-name-${token.id}`}
          name="name"
          required
          defaultValue={token.name}
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
                checked={ticked.has(scope)}
                onChange={(e) => toggleScope(scope, e.target.checked)}
              />
              <span>{SCOPE_DESCRIPTIONS[scope]}</span>
              <code className="ml-auto text-xs text-muted-foreground">{scope}</code>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor={`token-member-${token.id}`} className="mb-1 block text-sm font-medium">
          Acts as{needsMember ? "" : " — optional"}
        </label>
        <select
          id={`token-member-${token.id}`}
          name="memberId"
          required={needsMember}
          defaultValue={token.memberId ?? ""}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">{needsMember ? "Choose a member…" : "Nobody — household only"}</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-muted-foreground">
        The token itself doesn&apos;t change: whatever uses it gets the new permissions from its next call.
      </p>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="flex-1 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={pending}
          className="rounded-full bg-muted px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted/80 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function TokenRow({ token, members }: { token: Token; members: Member[] }) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const expired = isExpired(token.expiresAt);

  function revoke() {
    startTransition(async () => {
      await revokeIntegrationToken(token.id);
    });
  }

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">
            {token.name}
            {expired && (
              <span className="ml-2 rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                expired
              </span>
            )}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {token.scopes.map((s) => (
              <span
                key={s}
                className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              disabled={pending}
              className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-foreground hover:bg-muted/80 disabled:opacity-50"
            >
              Edit
            </button>
          )}
          <button
            onClick={revoke}
            disabled={pending}
            className="rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            {pending ? "Revoking…" : "Revoke"}
          </button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {token.actsAs && <>Acts as {token.actsAs} · </>}
        Last used: {relativeDate(token.lastUsedAt)}
        {token.expiresAt && (
          <>
            {" · "}
            Expires: {new Date(token.expiresAt).toLocaleDateString()}
          </>
        )}
      </p>
      {editing && <EditTokenForm token={token} members={members} onDone={() => setEditing(false)} />}
    </div>
  );
}

export function TokenList({ tokens, members }: { tokens: Token[]; members: Member[] }) {
  if (tokens.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        No tokens yet. Create one below.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {tokens.map((t) => (
        <TokenRow key={t.id} token={t} members={members} />
      ))}
    </div>
  );
}
