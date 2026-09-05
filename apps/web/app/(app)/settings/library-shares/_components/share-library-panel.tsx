"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  Copy,
  Library,
  Link as LinkIcon,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button, Input } from "@dishes/ui";
import {
  createLibraryShare,
  revokeLibraryShareAsOwner,
  rotateLibraryInviteCode,
  updateLibraryShareScope,
} from "@/app/actions/library-shares";
import type { OutgoingShare } from "@/lib/services/library-shares";

type Collection = { id: string; name: string; icon: string | null };
type BaseScope = "all" | "collections" | "tags";

interface Props {
  shares: OutgoingShare[];
  collections: Collection[];
  tags: string[];
}

type Draft = {
  label: string;
  baseScope: BaseScope;
  collectionIds: string[];
  includeTags: string[];
  excludeTags: string[];
};

const emptyDraft: Draft = {
  label: "",
  baseScope: "all",
  collectionIds: [],
  includeTags: [],
  excludeTags: [],
};

function Pill({
  active,
  onClick,
  children,
  tone = "default",
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tone?: "default" | "danger";
}) {
  const activeClass =
    tone === "danger"
      ? "bg-destructive text-destructive-foreground"
      : "bg-primary text-primary-foreground";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active ? activeClass : "bg-muted text-muted-foreground hover:bg-muted/70"
      }`}
    >
      {children}
    </button>
  );
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** Shared by the create form and the per-share editor. */
function ScopeEditor({
  draft,
  setDraft,
  collections,
  tags,
  showLabel,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  collections: Collection[];
  tags: string[];
  showLabel?: boolean;
}) {
  const emptySelector =
    (draft.baseScope === "collections" && draft.collectionIds.length === 0) ||
    (draft.baseScope === "tags" && draft.includeTags.length === 0);

  return (
    <div className="space-y-4">
      {showLabel && (
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            A name for this share (optional)
          </label>
          <Input
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder="e.g. Sarah &amp; Tom"
            className="mt-1.5"
          />
        </div>
      )}

      <div>
        <p className="text-xs font-medium text-muted-foreground">What to share</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {(
            [
              ["all", "My whole library"],
              ["collections", "Only these collections"],
              ["tags", "Only these tags"],
            ] as const
          ).map(([value, label]) => (
            <Pill
              key={value}
              active={draft.baseScope === value}
              onClick={() => setDraft({ ...draft, baseScope: value })}
            >
              {label}
            </Pill>
          ))}
        </div>
      </div>

      {draft.baseScope === "collections" && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">Collections</p>
          {collections.length === 0 ? (
            <p className="mt-1.5 text-sm text-muted-foreground">
              You haven&apos;t made any collections yet.
            </p>
          ) : (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {collections.map((c) => (
                <Pill
                  key={c.id}
                  active={draft.collectionIds.includes(c.id)}
                  onClick={() =>
                    setDraft({ ...draft, collectionIds: toggle(draft.collectionIds, c.id) })
                  }
                >
                  {c.icon ? `${c.icon} ` : ""}
                  {c.name}
                </Pill>
              ))}
            </div>
          )}
        </div>
      )}

      {draft.baseScope === "tags" && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">Tags to include</p>
          {tags.length === 0 ? (
            <p className="mt-1.5 text-sm text-muted-foreground">
              None of your recipes are tagged yet.
            </p>
          ) : (
            <div className="mt-1.5 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
              {tags.map((t) => (
                <Pill
                  key={t}
                  active={draft.includeTags.includes(t)}
                  onClick={() =>
                    setDraft({ ...draft, includeTags: toggle(draft.includeTags, t) })
                  }
                >
                  {t}
                </Pill>
              ))}
            </div>
          )}
        </div>
      )}

      {tags.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            Always hide anything tagged
          </p>
          <div className="mt-1.5 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
            {tags.map((t) => (
              <Pill
                key={t}
                tone="danger"
                active={draft.excludeTags.includes(t)}
                onClick={() =>
                  setDraft({ ...draft, excludeTags: toggle(draft.excludeTags, t) })
                }
              >
                {t}
              </Pill>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Excluded tags always win, even over a collection you&apos;ve shared.
          </p>
        </div>
      )}

      {emptySelector && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Nothing selected, so this share would expose no recipes at all.
        </p>
      )}
    </div>
  );
}

function CopyableLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2">
      <LinkIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate text-xs text-muted-foreground">{url}</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard blocked — the text is selectable anyway */
          }
        }}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

export function ShareLibraryPanel({ shares, collections, tags }: Props) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [newUrl, setNewUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft);
  const [rotated, setRotated] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function create() {
    setError(null);
    startTransition(async () => {
      const { url, error: err } = await createLibraryShare({
        baseScope: draft.baseScope,
        collectionIds: draft.collectionIds,
        includeTags: draft.includeTags,
        excludeTags: draft.excludeTags,
        label: draft.label,
      });
      if (err || !url) {
        setError(err ?? "Couldn't create that share.");
        return;
      }
      setNewUrl(url);
      setCreating(false);
      setDraft(emptyDraft);
      router.refresh();
    });
  }

  function saveScope(shareId: string) {
    setError(null);
    startTransition(async () => {
      const { error: err } = await updateLibraryShareScope(shareId, {
        baseScope: editDraft.baseScope,
        collectionIds: editDraft.collectionIds,
        includeTags: editDraft.includeTags,
        excludeTags: editDraft.excludeTags,
      });
      if (err) {
        setError(err);
        return;
      }
      setEditing(null);
      router.refresh();
    });
  }

  function revoke(shareId: string) {
    setError(null);
    startTransition(async () => {
      const { error: err } = await revokeLibraryShareAsOwner(shareId);
      if (err) setError(err);
      else router.refresh();
    });
  }

  function rotate(shareId: string) {
    setError(null);
    startTransition(async () => {
      const { url, error: err } = await rotateLibraryInviteCode(shareId);
      if (err || !url) setError(err ?? "Couldn't refresh that invite.");
      else setRotated((prev) => ({ ...prev, [shareId]: url }));
    });
  }

  const live = shares.filter((s) => !s.revokedAt);
  const ended = shares.filter((s) => s.revokedAt);

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {newUrl && (
        <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4">
          <p className="text-sm font-semibold">Invitation ready</p>
          <p className="mb-3 mt-0.5 text-xs text-muted-foreground">
            Send this link to whoever you&apos;re sharing with. It works once, and expires
            in a week if nobody uses it.
          </p>
          <CopyableLink url={newUrl} />
        </div>
      )}

      {/* Create */}
      {creating ? (
        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <h2 className="mb-4 font-semibold">Share your library</h2>
          <ScopeEditor
            draft={draft}
            setDraft={setDraft}
            collections={collections}
            tags={tags}
            showLabel
          />
          <div className="mt-5 flex gap-2">
            <Button onClick={create} disabled={isPending} className="gap-2">
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Create invitation
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setCreating(false);
                setDraft(emptyDraft);
              }}
              disabled={isPending}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button onClick={() => setCreating(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Share with a household
        </Button>
      )}

      {/* Live shares */}
      {live.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Active
          </h2>
          {live.map((share) => (
            <div key={share.id} className="rounded-2xl border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold leading-tight">
                    {share.granteeHouseholdName ?? share.label ?? "Waiting to be accepted"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {share.redeemedAt
                      ? `Accepted ${share.redeemedAt.toLocaleDateString("en-GB")}`
                      : "Invitation not used yet"}
                    {" · "}
                    {share.recipeCount} recipe{share.recipeCount === 1 ? "" : "s"} shared
                    {share.copiedCount > 0 &&
                      ` · ${share.copiedCount} copied so far`}
                  </p>
                  {share.recipeCount === 0 && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      This share currently exposes nothing.
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditing(editing === share.id ? null : share.id);
                      setEditDraft({
                        label: share.label ?? "",
                        baseScope: share.baseScope,
                        collectionIds: share.includeCollectionIds,
                        includeTags: share.includeTags,
                        excludeTags: share.excludeTags,
                      });
                    }}
                    disabled={isPending}
                  >
                    {editing === share.id ? "Close" : "Scope"}
                  </Button>
                  {!share.redeemedAt && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title="New invitation link"
                      onClick={() => rotate(share.id)}
                      disabled={isPending}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    title="Stop sharing"
                    onClick={() => revoke(share.id)}
                    disabled={isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {rotated[share.id] && (
                <div className="mt-3">
                  <CopyableLink url={rotated[share.id]!} />
                </div>
              )}

              {editing === share.id && (
                <div className="mt-4 border-t pt-4">
                  <p className="mb-3 text-xs text-muted-foreground">
                    Changing the scope takes effect immediately. Recipes they&apos;ve
                    already copied stay in their library.
                  </p>
                  <ScopeEditor
                    draft={editDraft}
                    setDraft={setEditDraft}
                    collections={collections}
                    tags={tags}
                  />
                  <Button
                    className="mt-4 gap-2"
                    onClick={() => saveScope(share.id)}
                    disabled={isPending}
                  >
                    {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    Save scope
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {ended.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Ended
          </h2>
          {ended.map((share) => (
            <div
              key={share.id}
              className="flex items-center gap-3 rounded-xl border bg-muted/30 px-4 py-3 text-sm"
            >
              <Library className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                {share.granteeHouseholdName ?? share.label ?? "Unused invitation"}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {share.revokedBy === "grantee" ? "They left" : "You stopped sharing"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
