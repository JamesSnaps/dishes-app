"use client";

import { useState } from "react";
import { Clock, ExternalLink } from "lucide-react";
import { Badge } from "@dishes/ui";
import { AddToShoppingButton } from "./add-to-shopping-button";
import { StarRating } from "./star-rating";
import type { CookHistoryEntry } from "@/app/actions/cook-history";

type Tab = "overview" | "ingredients" | "steps" | "notes" | "history";

interface Ingredient {
  id: string;
  ingredientName: string;
  amount: string | null;
  unit: string | null;
  preparation: string | null;
  isOptional: boolean | null;
}

interface Step {
  id: string;
  instruction: string;
  durationMinutes: number | null;
  timerLabel: string | null;
}

interface RecipeTabsProps {
  recipeId: string;
  description: string | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  servings: string | null;
  servingsUnit: string | null;
  notes: string | null;
  sourceUrl: string | null;
  ingredients: Ingredient[];
  steps: Step[];
  tags: { id: string; tag: string }[];
  cookHistory: CookHistoryEntry[];
}

function formatTime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  const diffDays = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 14) return "Last week";
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

export function RecipeTabs({
  recipeId,
  description,
  prepTimeMinutes,
  cookTimeMinutes,
  servings,
  servingsUnit,
  notes,
  sourceUrl,
  ingredients,
  steps,
  tags,
  cookHistory,
}: RecipeTabsProps) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "ingredients", label: `Ingredients${ingredients.length > 0 ? ` (${ingredients.length})` : ""}` },
    { id: "steps", label: `Steps${steps.length > 0 ? ` (${steps.length})` : ""}` },
    ...(notes ? [{ id: "notes" as Tab, label: "Notes" }] : []),
    ...(cookHistory.length > 0
      ? [{ id: "history" as Tab, label: `History (${cookHistory.length})` }]
      : []),
  ];

  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const totalMinutes = (prepTimeMinutes ?? 0) + (cookTimeMinutes ?? 0);

  return (
    <div>
      {/* Tab bar */}
      <div className="border-b flex gap-0 overflow-x-auto touch-pan-x scrollbar-hide">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="mt-6">
        {activeTab === "overview" && (
          <div className="space-y-6">
            {description && (
              <p className="text-muted-foreground leading-relaxed">{description}</p>
            )}

            {(prepTimeMinutes || cookTimeMinutes) && (
              <div className="flex gap-6 rounded-lg bg-muted/50 px-4 py-3 text-sm">
                {prepTimeMinutes ? (
                  <div>
                    <div className="font-medium">Prep</div>
                    <div className="text-muted-foreground">{formatTime(prepTimeMinutes)}</div>
                  </div>
                ) : null}
                {cookTimeMinutes ? (
                  <div>
                    <div className="font-medium">Cook</div>
                    <div className="text-muted-foreground">{formatTime(cookTimeMinutes)}</div>
                  </div>
                ) : null}
                {totalMinutes > 0 && prepTimeMinutes && cookTimeMinutes ? (
                  <div>
                    <div className="font-medium">Total</div>
                    <div className="text-muted-foreground">{formatTime(totalMinutes)}</div>
                  </div>
                ) : null}
              </div>
            )}

            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <Badge key={t.id} variant="secondary" className="text-xs">
                    {t.tag}
                  </Badge>
                ))}
              </div>
            )}

            {sourceUrl && (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ExternalLink className="h-4 w-4" />
                Original source
              </a>
            )}

            {!description && !prepTimeMinutes && !cookTimeMinutes && tags.length === 0 && !sourceUrl && (
              <p className="text-muted-foreground text-sm">No overview information available.</p>
            )}
          </div>
        )}

        {activeTab === "ingredients" && (
          <div>
            {ingredients.length > 0 ? (
              <>
                <div className="mb-4 flex items-center justify-between gap-4">
                  <span className="text-sm text-muted-foreground">
                    {ingredients.length} ingredient{ingredients.length !== 1 ? "s" : ""}
                  </span>
                  <AddToShoppingButton
                    recipeId={recipeId}
                    recipeServings={servings ? parseFloat(servings) : null}
                    servingsUnit={servingsUnit ?? "servings"}
                  />
                </div>
                <ul className="space-y-2">
                  {ingredients.map((ing) => (
                    <li key={ing.id} className="flex items-baseline gap-2 text-sm">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary mt-1.5" />
                      <span>
                        {ing.amount && (
                          <span className="font-medium">
                            {ing.amount}
                            {ing.unit ? ` ${ing.unit}` : ""}{" "}
                          </span>
                        )}
                        {ing.ingredientName}
                        {ing.preparation && ing.preparation.toLowerCase() !== "none" && (
                          <span className="text-muted-foreground">, {ing.preparation}</span>
                        )}
                        {ing.isOptional && (
                          <span className="ml-1 text-xs text-muted-foreground">(optional)</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">No ingredients listed.</p>
            )}
          </div>
        )}

        {activeTab === "steps" && (
          <div>
            {steps.length > 0 ? (
              <ol className="space-y-8">
                {steps.map((step, idx) => (
                  <li key={step.id} className="flex gap-4">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                      {idx + 1}
                    </span>
                    <div className="flex-1 pt-1">
                      <p className="leading-relaxed">{step.instruction}</p>
                      {step.durationMinutes && (
                        <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {step.timerLabel ? `${step.timerLabel} — ` : ""}
                          {formatTime(step.durationMinutes)}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-muted-foreground text-sm">No steps available.</p>
            )}
          </div>
        )}

        {activeTab === "notes" && notes && (
          <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{notes}</p>
        )}

        {activeTab === "history" && (
          <div className="space-y-4">
            {cookHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground">No cook history yet.</p>
            ) : (
              cookHistory.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-lg border bg-card p-4 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{formatDate(entry.cookedAt)}</span>
                    {entry.rating != null && (
                      <div className="flex items-center gap-2">
                        <StarRating value={entry.rating} readonly size="sm" />
                        <span className="text-xs text-muted-foreground">{entry.rating / 2}/5</span>
                      </div>
                    )}
                  </div>

                  {entry.occasion && (
                    <p className="text-sm text-muted-foreground">
                      {entry.occasion}
                    </p>
                  )}

                  {entry.cookedFor && entry.cookedFor.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Cooked for: {entry.cookedFor.join(", ")}
                    </p>
                  )}

                  {entry.actualDuration && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Took {entry.actualDuration} min
                    </p>
                  )}

                  {entry.photoUrl && (
                    <a
                      href={entry.photoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 rounded-lg overflow-hidden block"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={entry.photoUrl}
                        alt="Dish photo"
                        className="w-full aspect-video object-cover"
                      />
                    </a>
                  )}

                  {entry.notes && (
                    <p className="text-sm text-muted-foreground leading-relaxed border-t pt-2 mt-2">
                      {entry.notes}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
