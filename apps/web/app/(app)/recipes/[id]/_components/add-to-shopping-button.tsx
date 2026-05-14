"use client";

import { useState, useTransition } from "react";
import { ShoppingCart, Check, Loader2 } from "lucide-react";
import Link from "next/link";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Input,
  Label,
} from "@dishes/ui";
import { generateFromRecipe } from "@/app/actions/shopping";

interface Props {
  recipeId: string;
  recipeServings: number | null;
  servingsUnit: string;
}

export function AddToShoppingButton({
  recipeId,
  recipeServings,
  servingsUnit,
}: Props) {
  const [open, setOpen] = useState(false);
  const [servings, setServings] = useState<string>(
    recipeServings ? String(recipeServings) : ""
  );
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleOpenChange(val: boolean) {
    if (!val) setServings(recipeServings ? String(recipeServings) : "");
    setOpen(val);
  }

  function handleConfirm() {
    const parsed = parseFloat(servings);
    startTransition(async () => {
      await generateFromRecipe(recipeId, isNaN(parsed) ? undefined : parsed);
      setOpen(false);
      setDone(true);
    });
  }

  if (done) {
    return (
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
          <Check className="h-4 w-4" />
          Added to list
        </span>
        <Button asChild variant="ghost" size="sm">
          <Link href="/shopping">View list</Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ShoppingCart className="mr-1.5 h-4 w-4" />
        Add to shopping list
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>How many servings?</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-3">
            <Input
              id="servings-input"
              type="number"
              min="0.5"
              step="0.5"
              value={servings}
              onChange={(e) => setServings(e.target.value)}
              className="w-24"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
            />
            <Label htmlFor="servings-input" className="text-sm text-muted-foreground">
              {servingsUnit || "servings"}
            </Label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={pending}>
              {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Add to list
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
