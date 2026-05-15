"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Wand2, Copy, Save } from "lucide-react";
import {
  Button,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Textarea,
} from "@dishes/ui";
import { improveRecipe, type GeneratedRecipe } from "@/app/actions/ai";
import { saveRecipeAsCopy, applyTweakToRecipe } from "@/app/actions/recipes";

interface Props {
  recipeId: string;
  recipe: GeneratedRecipe;
}

type Phase = "idle" | "loading" | "result";

export function TweakRecipeButton({ recipeId, recipe }: Props) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [prompt, setPrompt] = useState("");
  const [refinePrompt, setRefinePrompt] = useState("");
  const [tweaked, setTweaked] = useState<GeneratedRecipe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refineError, setRefineError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [refining, setRefining] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleOpen() {
    setOpen(true);
    setPhase("idle");
    setPrompt("");
    setRefinePrompt("");
    setTweaked(null);
    setError(null);
    setRefineError(null);
    setSaveError(null);
  }

  function handleStartOver() {
    setPhase("idle");
    setPrompt("");
    setRefinePrompt("");
    setTweaked(null);
    setError(null);
    setRefineError(null);
    setSaveError(null);
  }

  async function handleTweak() {
    if (!prompt.trim()) return;
    setPhase("loading");
    setError(null);
    const result = await improveRecipe(recipe, prompt);
    if (result.error || !result.recipe) {
      setError(result.error ?? "Something went wrong.");
      setPhase("idle");
    } else {
      setTweaked(result.recipe);
      setPhase("result");
    }
  }

  async function handleRefine() {
    if (!refinePrompt.trim() || !tweaked) return;
    setRefining(true);
    setRefineError(null);
    const result = await improveRecipe(tweaked, refinePrompt);
    setRefining(false);
    if (result.error || !result.recipe) {
      setRefineError(result.error ?? "Something went wrong.");
    } else {
      setTweaked(result.recipe);
      setRefinePrompt("");
      setSaveError(null);
    }
  }

  function handleSaveAsCopy() {
    if (!tweaked) return;
    setSaveError(null);
    startTransition(async () => {
      const result = await saveRecipeAsCopy(recipeId, tweaked);
      if (result.error) {
        setSaveError(result.error);
      } else if (result.recipeId) {
        setOpen(false);
        router.push(`/recipes/${result.recipeId}`);
      }
    });
  }

  function handleUpdateOriginal() {
    if (!tweaked) return;
    setSaveError(null);
    startTransition(async () => {
      const result = await applyTweakToRecipe(recipeId, tweaked);
      if (result.error) {
        setSaveError(result.error);
      } else {
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <Button variant="outline" size="lg" className="w-full sm:w-auto" onClick={handleOpen}>
        <Wand2 className="mr-2 h-5 w-5" />
        Tweak for tonight
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="h-[90dvh] flex flex-col p-0 overflow-hidden">
          <SheetHeader className="px-4 pt-5 pb-3 border-b shrink-0 pr-12">
            <SheetTitle className="flex items-center gap-2">
              <Wand2 className="h-4 w-4" />
              Tweak for tonight
            </SheetTitle>
            <p className="text-sm text-muted-foreground">
              {phase === "result"
                ? "Temporary — nothing is saved yet"
                : "Describe what you'd like to change for this occasion"}
            </p>
          </SheetHeader>

          {phase === "idle" && (
            <div className="flex flex-col gap-4 p-4 flex-1 overflow-y-auto">
              {error && (
                <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
                  {error}
                </p>
              )}
              <Textarea
                placeholder='e.g. "Make it dairy-free", "Scale for 8 people", "Swap chicken for tofu"'
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="min-h-[100px] resize-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleTweak();
                }}
              />
              <Button onClick={handleTweak} disabled={!prompt.trim()} className="w-full">
                <Wand2 className="mr-2 h-4 w-4" />
                Tweak recipe
              </Button>
            </div>
          )}

          {phase === "loading" && (
            <div className="flex flex-1 items-center justify-center gap-3 text-muted-foreground">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              <span className="text-sm">Tweaking recipe…</span>
            </div>
          )}

          {phase === "result" && tweaked && (
            <>
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
                {tweaked.title !== recipe.title && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                      Title
                    </p>
                    <p className="font-semibold text-lg">{tweaked.title}</p>
                  </div>
                )}

                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Ingredients
                  </p>
                  <ul className="space-y-2">
                    {tweaked.ingredients.map((ing, i) => (
                      <li key={i} className="text-sm flex gap-2">
                        <span className="text-muted-foreground shrink-0 min-w-[4rem] text-right">
                          {[ing.amount, ing.unit].filter(Boolean).join(" ")}
                        </span>
                        <span>
                          {ing.ingredientName}
                          {ing.preparation ? `, ${ing.preparation}` : ""}
                          {ing.isOptional && (
                            <span className="text-muted-foreground ml-1">(optional)</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Steps
                  </p>
                  <ol className="space-y-3">
                    {tweaked.steps.map((step, i) => (
                      <li key={i} className="text-sm flex gap-3">
                        <span className="shrink-0 font-medium text-muted-foreground w-5 text-right">
                          {i + 1}.
                        </span>
                        <span>{step.instruction}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                {tweaked.notes && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                      Notes
                    </p>
                    <p className="text-sm">{tweaked.notes}</p>
                  </div>
                )}
              </div>

              <div className="shrink-0 border-t px-4 pt-3 pb-4 space-y-3">
                {/* Refine input */}
                <div className="flex gap-2">
                  <Textarea
                    placeholder='Adjust further, e.g. "Also remove the nuts"'
                    value={refinePrompt}
                    onChange={(e) => setRefinePrompt(e.target.value)}
                    className="min-h-[60px] resize-none text-sm"
                    disabled={refining || pending}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleRefine();
                    }}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-auto shrink-0 self-stretch"
                    disabled={!refinePrompt.trim() || refining || pending}
                    onClick={handleRefine}
                    title="Refine"
                  >
                    {refining ? (
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    ) : (
                      <Wand2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                {refineError && (
                  <p className="text-sm text-destructive">{refineError}</p>
                )}

                {/* Save actions */}
                {saveError && (
                  <p className="text-sm text-destructive">{saveError}</p>
                )}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    disabled={pending || refining}
                    onClick={handleSaveAsCopy}
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    Save as copy
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    disabled={pending || refining}
                    onClick={handleUpdateOriginal}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    Update original
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    className="flex-1 text-muted-foreground"
                    disabled={pending || refining}
                    onClick={() => setOpen(false)}
                  >
                    Dismiss — use as reference
                  </Button>
                  <Button
                    variant="ghost"
                    className="flex-1 text-muted-foreground"
                    disabled={pending || refining}
                    onClick={handleStartOver}
                  >
                    Start over
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
