"use client";

import { useTransition } from "react";
import { revokeIntegrationToken } from "@/app/actions/integrations";

type Token = {
  id: string;
  name: string;
  scopes: string[];
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

function TokenRow({ token }: { token: Token }) {
  const [pending, startTransition] = useTransition();
  const expired = isExpired(token.expiresAt);

  function revoke() {
    startTransition(async () => {
      await revokeIntegrationToken(token.id);
    });
  }

  return (
    <div className="flex flex-col gap-1 rounded-lg border px-4 py-3">
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
                className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
        <button
          onClick={revoke}
          disabled={pending}
          className="shrink-0 rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
        >
          {pending ? "Revoking…" : "Revoke"}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Last used: {relativeDate(token.lastUsedAt)}
        {token.expiresAt && (
          <>
            {" · "}
            Expires: {new Date(token.expiresAt).toLocaleDateString()}
          </>
        )}
      </p>
    </div>
  );
}

export function TokenList({ tokens }: { tokens: Token[] }) {
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
        <TokenRow key={t.id} token={t} />
      ))}
    </div>
  );
}
