"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Wand2 } from "lucide-react";
import { Button } from "@dishes/ui";
import { generateAndSaveRecipeImage } from "@/app/actions/ai";

export function GenerateImageButton({ recipeId }: { recipeId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    const result = await generateAndSaveRecipeImage(recipeId);
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="mb-6">
      <Button
        variant="outline"
        size="sm"
        onClick={() => void handleClick()}
        disabled={loading}
      >
        <Wand2 className="mr-1.5 h-4 w-4" />
        {loading ? "Generating image…" : "Generate image with AI"}
      </Button>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
