"use client";

import { useState } from "react";
import { Loader2, MessagesSquare, Trash2 } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dishes/ui";
import {
  purgeAssistHistory,
  type AssistHistoryStats,
  type PurgeScope,
} from "@/app/actions/assist-history";

const AGE_OPTIONS: { value: string; label: string; days: number | null }[] = [
  { value: "all", label: "Everything", days: null },
  { value: "7", label: "Older than 7 days", days: 7 },
  { value: "30", label: "Older than 30 days", days: 30 },
  { value: "90", label: "Older than 90 days", days: 90 },
  { value: "365", label: "Older than a year", days: 365 },
];

const SCOPE_OPTIONS: { value: PurgeScope; label: string }[] = [
  { value: "all", label: "Both kinds" },
  { value: "recipe", label: "Recipe questions only" },
  { value: "cook", label: "Cooking-mode questions only" },
];

export function AssistHistorySection({ stats }: { stats: AssistHistoryStats }) {
  const [age, setAge] = useState("all");
  const [scope, setScope] = useState<PurgeScope>("all");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const total = stats.recipeThreads + stats.cookThreads;
  const ageOption = AGE_OPTIONS.find((o) => o.value === age)!;
  const scopeLabel = SCOPE_OPTIONS.find((o) => o.value === scope)!.label.toLowerCase();

  async function handlePurge() {
    setPending(true);
    setError(null);
    try {
      const deleted = await purgeAssistHistory(scope, ageOption.days);
      const n = deleted.recipeThreads + deleted.cookThreads;
      setResult(
        n === 0
          ? "Nothing matched — no conversations were deleted."
          : `Deleted ${n} conversation${n === 1 ? "" : "s"} (${deleted.recipeThreads} recipe, ${deleted.cookThreads} cooking mode).`
      );
      setConfirmOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setConfirmOpen(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        AI conversation history
      </h2>
      <div className="space-y-4 rounded-lg border bg-card p-4">
        <div className="flex items-start gap-3">
          <MessagesSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="text-sm">
            <p className="font-medium">
              {total === 0
                ? "No saved conversations"
                : `${total} saved conversation${total === 1 ? "" : "s"}`}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {stats.recipeThreads} recipe question
              {stats.recipeThreads === 1 ? "" : "s"} · {stats.cookThreads} cooking-mode
              question{stats.cookThreads === 1 ? "" : "s"}
              {stats.oldest && (
                <>
                  {" "}
                  · oldest from{" "}
                  {new Date(stats.oldest).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={scope} onValueChange={(v) => setScope(v as PurgeScope)}>
            <SelectTrigger className="sm:flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCOPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={age} onValueChange={setAge}>
            <SelectTrigger className="sm:flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AGE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="destructive"
            onClick={() => setConfirmOpen(true)}
            disabled={total === 0 || pending}
            className="shrink-0"
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            Clear
          </Button>
        </div>

        {result && <p className="text-xs text-muted-foreground">{result}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear AI conversation history?</DialogTitle>
            <DialogDescription>
              {ageOption.days == null
                ? `Every saved conversation (${scopeLabel}) for this household will be deleted.`
                : `Saved conversations (${scopeLabel}) last used more than ${ageOption.days} days ago will be deleted.`}{" "}
              Recipes, cook history and notes are not affected. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={pending} onClick={() => void handlePurge()}>
              {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {pending ? "Clearing…" : "Clear history"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
