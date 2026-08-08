"use client";

import { useState } from "react";
import { Sparkles, Wand2, MessageCircleQuestion, ChevronDown } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@dishes/ui";
import type { GeneratedRecipe } from "@/app/actions/ai";
import { AskRecipeSheet } from "./ask-recipe-sheet";
import { TweakRecipeButton } from "./tweak-recipe-button";
import { SimilarRecipesButton } from "./similar-recipes-button";

interface Props {
  recipeId: string;
  recipeTitle: string;
  recipe: GeneratedRecipe;
  cookContext?: string;
}

// One entry point for every AI action on the recipe page. The individual
// sheets still own their own flows — this only decides which one is open.
export function RecipeAiMenu({ recipeId, recipeTitle, recipe, cookContext }: Props) {
  const [askOpen, setAskOpen] = useState(false);
  const [tweakOpen, setTweakOpen] = useState(false);
  const [similarOpen, setSimilarOpen] = useState(false);

  const items = [
    {
      icon: MessageCircleQuestion,
      label: "Ask about this recipe",
      hint: "Sides, timings, make-ahead, substitutions",
      onSelect: () => setAskOpen(true),
    },
    {
      icon: Wand2,
      label: "Tweak for tonight",
      hint: "Adapt it for this occasion",
      onSelect: () => setTweakOpen(true),
    },
    {
      icon: Sparkles,
      label: "Find similar recipes",
      hint: "Five new ideas inspired by this one",
      onSelect: () => setSimilarOpen(true),
    },
  ];

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="lg"
            className="w-full border-violet-300 bg-gradient-to-r from-violet-50 to-orange-50 text-violet-700 hover:from-violet-100 hover:to-orange-100 dark:border-violet-800 dark:from-violet-950/60 dark:to-orange-950/40 dark:text-violet-300 sm:w-auto"
          >
            <Sparkles className="mr-2 h-5 w-5" />
            Ask AI
            <ChevronDown className="ml-1.5 h-4 w-4 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          {items.map(({ icon: Icon, label, hint, onSelect }) => (
            <DropdownMenuItem
              key={label}
              onSelect={onSelect}
              className="flex items-start gap-2.5 py-2.5"
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium leading-none">{label}</span>
                <span className="text-xs text-muted-foreground">{hint}</span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <AskRecipeSheet
        recipeId={recipeId}
        recipeTitle={recipeTitle}
        open={askOpen}
        onOpenChange={setAskOpen}
      />
      <TweakRecipeButton
        recipeId={recipeId}
        recipe={recipe}
        cookContext={cookContext}
        open={tweakOpen}
        onOpenChange={setTweakOpen}
        hideTrigger
      />
      <SimilarRecipesButton
        recipeId={recipeId}
        open={similarOpen}
        onOpenChange={setSimilarOpen}
        hideTrigger
      />
    </>
  );
}
