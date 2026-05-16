"use client";

import { useState, useTransition, useEffect } from "react";
import { Share2, Copy, Check, Mail, Trash2, Link } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Button,
  DropdownMenuItem,
} from "@dishes/ui";
import {
  createShareToken,
  revokeShareToken,
  getRecipeShareTokens,
  sendRecipeEmail,
} from "@/app/actions/sharing";

interface ShareToken {
  id: string;
  url: string;
  active: boolean;
  createdAt: Date;
  createdBy: string | null;
}

interface Props {
  recipeId: string;
  recipeTitle: string;
  hasSmtp: boolean;
}

export function ShareRecipeSheet({ recipeId, recipeTitle, hasSmtp }: Props) {
  const [open, setOpen] = useState(false);
  const [tokens, setTokens] = useState<ShareToken[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    startTransition(async () => {
      const result = await getRecipeShareTokens(recipeId);
      setTokens(result.filter((t) => t.active) as ShareToken[]);
    });
  }, [open, recipeId]);

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      try {
        const url = await createShareToken(recipeId);
        const result = await getRecipeShareTokens(recipeId);
        setTokens(result.filter((t) => t.active) as ShareToken[]);
        copyToClipboard(url, "new");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create link");
      }
    });
  }

  function handleRevoke(tokenId: string) {
    startTransition(async () => {
      await revokeShareToken(tokenId);
      setTokens((prev) => prev.filter((t) => t.id !== tokenId));
    });
  }

  function copyToClipboard(url: string, id: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  function handleSendEmail() {
    setError(null);
    setEmailSent(false);
    startTransition(async () => {
      try {
        await sendRecipeEmail(recipeId, email);
        setEmailSent(true);
        setEmail("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to send email");
      }
    });
  }

  const activeTokens = tokens.filter((t) => t.active);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <DropdownMenuItem
          className="flex items-center gap-2"
          onSelect={(e) => {
            e.preventDefault();
            setOpen(true);
          }}
        >
          <Share2 className="h-4 w-4" />
          Share recipe
        </DropdownMenuItem>
      </SheetTrigger>

      <SheetContent
        side="bottom"
        className="px-4 pb-8 sm:left-1/2 sm:-translate-x-1/2 sm:max-w-sm sm:rounded-2xl"
      >
        <SheetHeader className="mb-6">
          <SheetTitle>Share &ldquo;{recipeTitle}&rdquo;</SheetTitle>
        </SheetHeader>

        <div className="space-y-6">
          {/* Active share links */}
          {activeTokens.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Active links</p>
              {activeTokens.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-2 rounded-lg border border-border p-2"
                >
                  <Link className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate text-xs text-muted-foreground">
                    {t.url}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => copyToClipboard(t.url, t.id)}
                  >
                    {copied === t.id ? (
                      <Check className="h-3.5 w-3.5 text-green-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                    onClick={() => handleRevoke(t.id)}
                    disabled={isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No active share links. Create one below.
            </p>
          )}

          {/* Create new link */}
          <Button
            className="w-full"
            variant="outline"
            onClick={handleCreate}
            disabled={isPending}
          >
            <Link className="h-4 w-4 mr-2" />
            {copied === "new" ? "Link copied!" : "Create & copy link"}
          </Button>

          {/* Email */}
          {hasSmtp && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Send via email</p>
              <div className="flex gap-2">
                <input
                  type="email"
                  placeholder="recipient@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  onKeyDown={(e) => e.key === "Enter" && handleSendEmail()}
                />
                <Button
                  onClick={handleSendEmail}
                  disabled={isPending || !email}
                  size="sm"
                >
                  <Mail className="h-4 w-4" />
                </Button>
              </div>
              {emailSent && (
                <p className="text-sm text-green-600">Email sent!</p>
              )}
            </div>
          )}

          {!hasSmtp && (
            <p className="text-xs text-muted-foreground">
              Configure SMTP in{" "}
              <a href="/settings/email" className="underline">
                Settings → Email
              </a>{" "}
              to enable sending recipes by email.
            </p>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
