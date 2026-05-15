"use client";

import { useState, useMemo } from "react";
import { ClipboardPaste, CheckCircle2, AlertCircle } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Textarea,
} from "@dishes/ui";
import {
  parseIngredientsText,
  parseStepsText,
  type ParsedIngredient,
  type ParsedStep,
} from "@/lib/recipe-parser";

interface PasteImportModalProps {
  onImport: (
    ingredients: ParsedIngredient[],
    steps: ParsedStep[]
  ) => void;
}

function IngredientPreview({ items }: { items: ParsedIngredient[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2 rounded-md border bg-muted/40 p-3 space-y-1 max-h-52 overflow-y-auto">
      {items.map((item, i) => (
        <div key={i} className="text-xs flex gap-2">
          <span className="text-muted-foreground w-4 shrink-0 text-right">{i + 1}.</span>
          <span>
            {[item.amount, item.unit].filter(Boolean).join(" ")}
            {(item.amount || item.unit) ? " " : ""}
            <span className="font-medium">{item.ingredientName}</span>
            {item.preparation && (
              <span className="text-muted-foreground">, {item.preparation}</span>
            )}
            {item.isOptional && (
              <span className="text-muted-foreground italic"> (optional)</span>
            )}
            {item.groupLabel && (
              <span className="text-muted-foreground"> [{item.groupLabel}]</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function StepPreview({ items }: { items: ParsedStep[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2 rounded-md border bg-muted/40 p-3 space-y-2 max-h-52 overflow-y-auto">
      {items.map((item, i) => (
        <div key={i} className="text-xs flex gap-2">
          <span className="text-muted-foreground w-4 shrink-0 text-right">{i + 1}.</span>
          <span>{item.instruction}</span>
        </div>
      ))}
    </div>
  );
}

export function PasteImportModal({ onImport }: PasteImportModalProps) {
  const [open, setOpen] = useState(false);
  const [ingredientText, setIngredientText] = useState("");
  const [stepText, setStepText] = useState("");

  const parsedIngredients = useMemo(
    () => (ingredientText.trim() ? parseIngredientsText(ingredientText) : []),
    [ingredientText]
  );

  const parsedSteps = useMemo(
    () => (stepText.trim() ? parseStepsText(stepText) : []),
    [stepText]
  );

  const hasIngredients = parsedIngredients.length > 0;
  const hasSteps = parsedSteps.length > 0;
  const canImport = hasIngredients || hasSteps;

  function handleImport() {
    onImport(parsedIngredients, parsedSteps);
    setOpen(false);
    setIngredientText("");
    setStepText("");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1.5">
          <ClipboardPaste className="h-4 w-4" />
          Import from text
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import recipe from text</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground -mt-1">
          Paste your ingredient list and/or method below. The parser handles
          most common formats automatically — check the preview before importing.
        </p>

        {/* Ingredients */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Ingredients</label>
            {hasIngredients && (
              <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {parsedIngredients.length} found
              </span>
            )}
            {ingredientText.trim() && !hasIngredients && (
              <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                <AlertCircle className="h-3.5 w-3.5" />
                Nothing parsed
              </span>
            )}
          </div>
          <Textarea
            value={ingredientText}
            onChange={(e) => setIngredientText(e.target.value)}
            placeholder={`2 cups plain flour
1 tsp baking powder
250ml whole milk
3 large eggs, beaten
pinch of salt`}
            rows={5}
            className="text-sm font-mono resize-none"
          />
          <IngredientPreview items={parsedIngredients} />
        </div>

        {/* Steps */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Method / Steps</label>
            {hasSteps && (
              <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {parsedSteps.length} found
              </span>
            )}
            {stepText.trim() && !hasSteps && (
              <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                <AlertCircle className="h-3.5 w-3.5" />
                Nothing parsed
              </span>
            )}
          </div>
          <Textarea
            value={stepText}
            onChange={(e) => setStepText(e.target.value)}
            placeholder={`1. Sift the flour and baking powder into a large bowl.
2. Make a well in the centre and crack in the eggs.
3. Gradually whisk in the milk until you have a smooth batter.`}
            rows={5}
            className="text-sm font-mono resize-none"
          />
          <StepPreview items={parsedSteps} />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canImport}
            onClick={handleImport}
          >
            Import into recipe
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
