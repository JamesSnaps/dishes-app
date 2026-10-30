"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Globe } from "lucide-react";
import { ReadingLink } from "@/components/ai-wait";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
} from "@dishes/ui";
import { importRecipeFromUrl } from "@/app/actions/ai";
import type { WebImportResult } from "@/lib/recipe-web-import";
import type { RecipeFormDefaults } from "./recipe-form";

// ── Types ──────────────────────────────────────────────────────────────────────

interface WebImportModalProps {
  onImport: (draft: RecipeFormDefaults, info: Pick<WebImportResult, "via" | "notice">) => void;
  /** A link handed in from outside (share sheet, bookmarklet): import it on mount. */
  initialUrl?: string;
}

type Phase = "idle" | "importing" | "error";

// ── Component ──────────────────────────────────────────────────────────────────

export function WebImportModal({ onImport, initialUrl }: WebImportModalProps) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  // Incremented on close, so a slow import can't fill the form after a cancel.
  const epochRef = useRef(0);

  function handleOpenChange(v: boolean) {
    if (!v) {
      epochRef.current += 1;
      setPhase("idle");
      setError(null);
    }
    setOpen(v);
  }

  async function runImport(target: string) {
    const myEpoch = ++epochRef.current;
    setPhase("importing");
    setError(null);

    let result: WebImportResult;
    try {
      result = await importRecipeFromUrl(target);
    } catch {
      result = { error: "Something went wrong importing that page." };
    }
    if (epochRef.current !== myEpoch) return;

    if (result.error || !result.draft) {
      setError(result.error ?? "Couldn't import that page.");
      setPhase("error");
      return;
    }
    onImport(result.draft, { via: result.via, notice: result.notice });
    setOpen(false);
    setPhase("idle");
    setUrl("");
  }

  // Run once for a link passed in on the URL.
  const startedRef = useRef(false);
  useEffect(() => {
    if (!initialUrl || startedRef.current) return;
    startedRef.current = true;
    // Drop the link from the address bar so a refresh doesn't import it again.
    window.history.replaceState(null, "", window.location.pathname);
    setUrl(initialUrl);
    setOpen(true);
    void runImport(initialUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (url.trim()) void runImport(url.trim());
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="gap-1.5"
        >
          <Globe className="h-4 w-4" />
          Import from web
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Import from a website</DialogTitle>
        </DialogHeader>

        {phase === "importing" ? (
          <div className="flex flex-col items-center justify-center gap-4 py-10">
            <ReadingLink url={url} />
            <div role="status" className="text-center space-y-1">
              <p className="text-sm font-medium">Reading the page…</p>
              <p className="text-xs text-muted-foreground">Finding the ingredients, method and photo.</p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Paste a link to a recipe page. Dishes reads the ingredients, method,
              timings and photo, and fills in the form for you to check before saving.
            </p>

            <Input
              type="text"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.example.com/recipes/…"
              aria-label="Recipe page link"
            />

            {phase === "error" && error && (
              <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
                <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!url.trim()}>
                {phase === "error" ? "Try again" : "Import"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
