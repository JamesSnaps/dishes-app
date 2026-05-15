"use client";

import { useRef, useState } from "react";
import { Upload, FileArchive, CheckCircle2, XCircle, Loader2, Package } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@dishes/ui";
import { useRouter } from "next/navigation";
import type { CrumbPreviewItem, CrumbPreviewResponse } from "@/app/api/import/crumb/preview/route";
import type { ParsedCrumbRecipe } from "@/lib/crumb-parser";

type Phase = "idle" | "parsing" | "selecting" | "importing" | "done" | "error";

interface ImportResult {
  imported: { id: string; title: string }[];
  errors: string[];
}

export function CrumbImportModal() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Preview phase
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [fullDataFallback, setFullDataFallback] = useState<ParsedCrumbRecipe[] | null>(null);
  const [previewRecipes, setPreviewRecipes] = useState<CrumbPreviewItem[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Done phase
  const [result, setResult] = useState<ImportResult | null>(null);

  function reset() {
    setPhase("idle");
    setErrorMsg(null);
    setSessionId(null);
    setFullDataFallback(null);
    setPreviewRecipes([]);
    setSelected(new Set());
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    setPhase("parsing");
    setErrorMsg(null);

    try {
      const form = new FormData();
      for (const file of files) form.append("files", file);
      const res = await fetch("/api/import/crumb/preview", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to parse file");

      const preview = data as CrumbPreviewResponse & { fullData?: ParsedCrumbRecipe[] };
      setSessionId(preview.sessionId);
      setFullDataFallback(preview.fullData ?? null);
      setPreviewRecipes(preview.recipes);
      setSelected(new Set(preview.recipes.map((r) => r.index)));
      setPhase("selecting");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setPhase("error");
    }
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(previewRecipes.map((r) => r.index)) : new Set());
  }

  function toggleOne(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function handleImport() {
    if (selected.size === 0) return;
    setPhase("importing");

    try {
      const res = await fetch("/api/import/crumb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          selectedIndices: Array.from(selected),
          fullData: fullDataFallback,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      setResult(data as ImportResult);
      setPhase("done");
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setPhase("error");
    }
  }

  const allSelected = selected.size === previewRecipes.length && previewRecipes.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1.5">
          <Package className="h-4 w-4" />
          Import .crumb
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import from Crouton / .crumb</DialogTitle>
        </DialogHeader>

        {/* Idle — file picker */}
        {phase === "idle" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Upload a single <code className="text-xs">.crumb</code> file or a{" "}
              <code className="text-xs">.zip</code> archive exported from Crouton. Ingredients,
              steps, timings, and images will all be imported.
            </p>
            <label className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-muted-foreground/30 p-8 cursor-pointer hover:border-muted-foreground/60 transition-colors">
              <FileArchive className="h-10 w-10 text-muted-foreground" />
              <span className="text-sm text-muted-foreground text-center">
                Click to choose one or more <strong>.crumb</strong> files,
                or a <strong>.zip</strong> archive
              </span>
              <input
                ref={inputRef}
                type="file"
                accept=".crumb,.zip"
                multiple
                className="sr-only"
                onChange={handleFileChange}
              />
            </label>
          </div>
        )}

        {/* Parsing */}
        {phase === "parsing" && (
          <div className="flex flex-col items-center gap-3 py-10">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Reading recipes…</p>
          </div>
        )}

        {/* Selecting */}
        {phase === "selecting" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground min-w-0">
                {previewRecipes.length === 1
                  ? "1 recipe found — ready to import."
                  : `${previewRecipes.length} recipes found. Choose which to import.`}
              </p>
              {previewRecipes.length > 1 && (
                <button
                  type="button"
                  onClick={() => toggleAll(!allSelected)}
                  className="text-xs text-primary underline-offset-2 hover:underline shrink-0"
                >
                  {allSelected ? "Deselect all" : "Select all"}
                </button>
              )}
            </div>

            <div className="space-y-2 max-h-[50vh] overflow-y-auto overflow-x-hidden">
              {previewRecipes.map((recipe) => {
                const checked = selected.has(recipe.index);
                return (
                  <label
                    key={recipe.index}
                    className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors overflow-hidden ${
                      checked
                        ? "border-primary/60 bg-primary/5"
                        : "border-border bg-background hover:bg-muted/40"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOne(recipe.index)}
                      className="h-4 w-4 rounded accent-primary"
                    />
                    {recipe.thumbnailDataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={recipe.thumbnailDataUrl}
                        alt=""
                        className="h-12 w-12 rounded object-cover shrink-0"
                      />
                    ) : (
                      <div className="h-12 w-12 rounded bg-muted shrink-0 flex items-center justify-center">
                        <Upload className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-tight truncate">{recipe.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {[
                          recipe.ingredientCount
                            ? `${recipe.ingredientCount} ingredient${recipe.ingredientCount !== 1 ? "s" : ""}`
                            : null,
                          recipe.stepCount
                            ? `${recipe.stepCount} step${recipe.stepCount !== 1 ? "s" : ""}`
                            : null,
                          recipe.cookTimeMinutes ? `${recipe.cookTimeMinutes} min` : null,
                          recipe.servings ? `serves ${recipe.servings}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button type="button" disabled={selected.size === 0} onClick={handleImport}>
                Import {selected.size > 0 ? `${selected.size} recipe${selected.size !== 1 ? "s" : ""}` : ""}
              </Button>
            </div>
          </div>
        )}

        {/* Importing */}
        {phase === "importing" && (
          <div className="flex flex-col items-center gap-3 py-10">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Importing recipes…</p>
          </div>
        )}

        {/* Done */}
        {phase === "done" && result && (
          <div className="space-y-4">
            {result.imported.length > 0 && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40 p-4 space-y-2">
                <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span className="text-sm font-medium">
                    {result.imported.length} recipe{result.imported.length !== 1 ? "s" : ""} imported
                  </span>
                </div>
                <ul className="space-y-1 pl-6">
                  {result.imported.map((r) => (
                    <li key={r.id} className="text-xs text-emerald-700 dark:text-emerald-400">
                      {r.title}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.errors.length > 0 && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-2">
                <div className="flex items-center gap-2 text-destructive">
                  <XCircle className="h-4 w-4 shrink-0" />
                  <span className="text-sm font-medium">Some recipes failed</span>
                </div>
                <ul className="space-y-1 pl-6">
                  {result.errors.map((e, i) => (
                    <li key={i} className="text-xs text-destructive">
                      {e}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end">
              <Button type="button" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
            </div>
          </div>
        )}

        {/* Error */}
        {phase === "error" && (
          <div className="space-y-4">
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
              <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <p className="text-sm text-destructive">{errorMsg ?? "Something went wrong"}</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button type="button" variant="outline" onClick={reset}>
                Try again
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
