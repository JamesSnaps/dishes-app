"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, ReceiptText } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@dishes/ui";
import { toast } from "@/hooks/use-toast";
import { saveDeliveryOrder } from "@/app/actions/deliveries";

/** iOS Safari renders time inputs natively; keep them inside narrow dialogs. */
const TIME_INPUT =
  "appearance-none min-w-0 max-w-full text-left [&::-webkit-date-and-time-value]:text-left [&::-webkit-date-and-time-value]:min-h-[1.25rem]";

export interface OrderDetails {
  slot: string | null;
  total: string | null;
  orderReference: string | null;
}

/**
 * Enter or fix an order's slot, total and order number by hand — for when
 * the retailer's email was misread or never forwarded. Saving marks the
 * delivery ordered.
 */
export function OrderDetailsDialog({
  date,
  label,
  initial,
  open,
  onOpenChange,
  onSaved,
}: {
  date: string;
  /** "Mon 19 Oct". */
  label: string;
  initial: OrderDetails;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [saving, startSave] = useTransition();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [total, setTotal] = useState("");
  const [reference, setReference] = useState("");

  // Reset to the saved values each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    const [s, e] = initial.slot?.split("-") ?? [];
    setStart(s ?? "");
    setEnd(e ?? "");
    setTotal(initial.total ?? "");
    setReference(initial.orderReference ?? "");
  }, [open, initial.slot, initial.total, initial.orderReference]);

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (Boolean(start) !== Boolean(end)) {
      toast({ variant: "destructive", title: "Give the slot a start and an end, or neither" });
      return;
    }
    const cleanTotal = total.replace(/[£,\s]/g, "");
    const amount = cleanTotal ? Number(cleanTotal) : null;
    if (amount !== null && !Number.isFinite(amount)) {
      toast({ variant: "destructive", title: "Total must be a number of pounds" });
      return;
    }
    startSave(async () => {
      try {
        await saveDeliveryOrder(date, {
          slot: start && end ? `${start}-${end}` : null,
          total: amount,
          orderReference: reference.trim() || null,
        });
        toast({ title: "Order details saved" });
        onOpenChange(false);
        onSaved();
      } catch (err) {
        toast({
          variant: "destructive",
          title: "Couldn't save the order",
          description: err instanceof Error ? err.message : undefined,
        });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ReceiptText className="h-5 w-5 text-emerald-600" />
            {label} order
          </DialogTitle>
          <DialogDescription>
            Fill in or correct what the email would have told us. Saving marks this delivery
            as ordered. Leave anything you don&apos;t know blank.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={save} className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Delivery slot</p>
            <div className="flex items-center gap-2">
              <Input
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                aria-label="Slot start"
                className={`flex-1 ${TIME_INPUT}`}
              />
              <span className="text-muted-foreground">to</span>
              <Input
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                aria-label="Slot end"
                className={`flex-1 ${TIME_INPUT}`}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5">
              <span className="text-sm font-medium">Total (£)</span>
              <Input
                inputMode="decimal"
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                placeholder="94.20"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium">Order number</span>
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                maxLength={100}
                placeholder="Optional"
              />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            The order number links later emails (amendments, cancellations) to this delivery.
          </p>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="bg-muted hover:bg-muted/70 text-foreground border shadow-sm"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="gap-1.5 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 text-white border-0 shadow-md"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save order
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
