"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  PencilLine,
  Loader2,
  Settings2,
  SkipForward,
  Truck,
  Undo2,
} from "lucide-react";
import { Button } from "@dishes/ui";
import { toast } from "@/hooks/use-toast";
import { setDelivery, type NextDeliveryView } from "@/app/actions/deliveries";
import { OrderDetailsDialog } from "./order-details-dialog";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function Row({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0 text-success" />
      ) : (
        <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0 text-warning" />
      )}
      <span className={ok ? "text-muted-foreground" : "font-medium"}>{children}</span>
    </li>
  );
}

/**
 * The next grocery order that's still open: what it has to cover, what's
 * still to do before it closes, and one-tap "ordered" / "skip".
 */
export function NextDeliveryCard({
  next,
  canEdit,
  onChanged,
}: {
  next: NextDeliveryView;
  canEdit: boolean;
  /** Called after a change; defaults to refreshing the page. */
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const ordered = next.status === "ordered";

  function change(target: "ordered" | "scheduled" | "skipped" | "default", success: string) {
    startTransition(async () => {
      try {
        await setDelivery(next.date, target);
        toast({ title: success });
        if (onChanged) onChanged();
        else router.refresh();
      } catch (err) {
        toast({
          variant: "destructive",
          title: "Couldn't update the delivery",
          description: err instanceof Error ? err.message : undefined,
        });
      }
    });
  }

  return (
    <div
      className={`rounded-xl border p-4 shadow-sm ${
        ordered
          ? "bg-success-tint border-transparent"
          : "bg-success-tint border-transparent"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 flex-shrink-0 rounded-full bg-success text-card flex items-center justify-center shadow-md">
          <Truck className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-success">
            {next.day}&apos;s delivery · {next.label}
          </p>
          <p className="font-bold leading-snug">
            {ordered ? (
              <>
                Ordered
                {next.slot ? ` · ${next.slot}` : ""}
                {next.total ? ` · £${next.total}` : ""}
              </>
            ) : (
              <>Order by {next.cutoffLabel}</>
            )}
          </p>
          <p className="text-xs text-muted-foreground">Covers {next.coverageLabel}</p>
        </div>
        <Link
          href="/settings/deliveries"
          aria-label="Delivery settings"
          className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-background/60"
        >
          <Settings2 className="h-4 w-4" />
        </Link>
      </div>

      <ul className="mt-3 space-y-1.5">
        {ordered && next.belowMinimum && (
          <Row ok={false}>
            £{next.total} is under your {next.belowMinimum} minimum: top it up before{" "}
            {next.cutoffLabel}
          </Row>
        )}
        {ordered ? (
          next.addedSinceOrder.length > 0 ? (
            <Row ok={false}>
              {plural(next.addedSinceOrder.length, "item")} added since you ordered: amend before{" "}
              {next.cutoffLabel} ({next.addedSinceOrder.slice(0, 4).join(", ")}
              {next.addedSinceOrder.length > 4 ? "…" : ""})
            </Row>
          ) : (
            <Row ok>Nothing added since the order. You can still amend until {next.cutoffLabel}.</Row>
          )
        ) : (
          <>
            <Row ok={next.unplannedCount === 0}>
              {next.unplannedCount === 0
                ? "Every dinner is planned"
                : `${plural(next.unplannedCount, "dinner")} not planned: ${next.unplannedDinners}`}
            </Row>
            <Row ok={next.mealsNotOnList === 0}>
              {next.mealsNotOnList === 0
                ? "Planned meals are on the list"
                : `${plural(next.mealsNotOnList, "planned meal")} not added to the list`}
            </Row>
            <Row ok={next.unticked === 0}>
              {next.unticked === 0
                ? "Everything on the list is ticked off"
                : `${plural(next.unticked, "item")} not in the basket yet`}
            </Row>
          </>
        )}
      </ul>

      {canEdit && (
        <div className="mt-3 flex flex-wrap gap-2">
          {ordered ? (
            <>
              <Button
                size="sm"
                disabled={pending}
                onClick={() => setEditing(true)}
                className="gap-1.5 bg-success text-card border-0 shadow-md"
              >
                <PencilLine className="h-4 w-4" />
                {next.slot || next.total ? "Edit order" : "Add slot & total"}
              </Button>
              <Button
                size="sm"
                disabled={pending}
                onClick={() => change("scheduled", "Order unmarked")}
                className="gap-1.5 bg-background/70 hover:bg-background text-foreground border shadow-sm"
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
                Not ordered yet
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                disabled={pending}
                onClick={() => change("ordered", "Marked as ordered")}
                className="gap-1.5 bg-success text-card border-0 shadow-md"
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Mark as ordered
              </Button>
              <Button
                size="sm"
                disabled={pending}
                onClick={() =>
                  change(next.regular ? "skipped" : "default", `${next.day}'s delivery skipped`)
                }
                className="gap-1.5 bg-warning-tint hover:bg-warning-tint text-warning border border-transparent shadow-sm"
              >
                <SkipForward className="h-4 w-4" />
                Skip this one
              </Button>
            </>
          )}
        </div>
      )}
      {canEdit && (
        <OrderDetailsDialog
          date={next.date}
          label={next.label}
          initial={next}
          open={editing}
          onOpenChange={setEditing}
          onSaved={() => (onChanged ? onChanged() : router.refresh())}
        />
      )}
    </div>
  );
}
