"use client";

import { useState } from "react";
import { createRecipe } from "@/app/actions/recipes";
import { RecipeForm, type RecipeFormDefaults } from "../_components/recipe-form";
import { AiConcierge } from "../_components/ai-concierge";

interface NewRecipeClientProps {
  hasAi: boolean;
}

export function NewRecipeClient({ hasAi }: NewRecipeClientProps) {
  const [defaults, setDefaults] = useState<RecipeFormDefaults>({});
  const [formKey, setFormKey] = useState(0);

  function handleRecipeGenerated(generated: RecipeFormDefaults) {
    setDefaults(generated);
    setFormKey((k) => k + 1);
  }

  return (
    <div className="space-y-6">
      {hasAi && (
        <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-4 py-3">
          <p className="text-sm text-muted-foreground">
            Not sure what to cook? Let AI suggest ideas.
          </p>
          <AiConcierge onRecipeGenerated={handleRecipeGenerated} />
        </div>
      )}

      <RecipeForm
        key={formKey}
        action={createRecipe}
        defaults={defaults}
        submitLabel="Create Recipe"
        mode="create"
      />
    </div>
  );
}
