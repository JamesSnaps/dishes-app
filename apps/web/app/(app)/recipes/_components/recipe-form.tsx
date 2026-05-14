"use client";

import { useRef, useState } from "react";
import { Plus, Trash2, ImagePlus, X } from "lucide-react";
import {
  Button,
  Input,
  Label,
  Textarea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dishes/ui";

// ── Types ─────────────────────────────────────────────────────────────────────

type IngredientRow = {
  key: string;
  ingredientName: string;
  amount: string;
  unit: string;
  preparation: string;
  isOptional: boolean;
  groupLabel: string;
};

type StepRow = {
  key: string;
  instruction: string;
  durationMinutes: string;
  timerLabel: string;
};

export type RecipeFormDefaults = {
  title?: string;
  description?: string;
  cuisine?: string;
  prepTimeMinutes?: number | null;
  cookTimeMinutes?: number | null;
  servings?: string | null;
  servingsUnit?: string;
  difficulty?: "easy" | "medium" | "hard" | null;
  sourceUrl?: string | null;
  notes?: string | null;
  imageUrl?: string | null;
  ingredients?: Omit<IngredientRow, "key">[];
  steps?: Omit<StepRow, "key">[];
  tags?: string[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

let keyCounter = 0;
function nextKey() {
  return String(++keyCounter);
}

function emptyIngredient(): IngredientRow {
  return {
    key: nextKey(),
    ingredientName: "",
    amount: "",
    unit: "",
    preparation: "",
    isOptional: false,
    groupLabel: "",
  };
}

function emptyStep(): StepRow {
  return {
    key: nextKey(),
    instruction: "",
    durationMinutes: "",
    timerLabel: "",
  };
}

// ── Main component ────────────────────────────────────────────────────────────

interface RecipeFormProps {
  action: (formData: FormData) => Promise<void>;
  defaults?: RecipeFormDefaults;
  submitLabel?: string;
}

export function RecipeForm({
  action,
  defaults = {},
  submitLabel = "Save Recipe",
}: RecipeFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [ingredients, setIngredients] = useState<IngredientRow[]>(() =>
    defaults.ingredients?.length
      ? defaults.ingredients.map((i) => ({ ...i, key: nextKey() }))
      : [emptyIngredient()]
  );

  const [steps, setSteps] = useState<StepRow[]>(() =>
    defaults.steps?.length
      ? defaults.steps.map((s) => ({ ...s, key: nextKey() }))
      : [emptyStep()]
  );

  const [difficulty, setDifficulty] = useState<string>(
    defaults.difficulty ?? ""
  );

  const [imageUrl, setImageUrl] = useState<string>(defaults.imageUrl ?? "");
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageError(null);
    setImageUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setImageUrl(data.url!);
    } catch (err) {
      setImageError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setImageUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // ── Ingredient helpers ──────────────────────────────────────────────────────

  function updateIngredient(
    key: string,
    field: keyof Omit<IngredientRow, "key">,
    value: string | boolean
  ) {
    setIngredients((prev) =>
      prev.map((row) => (row.key === key ? { ...row, [field]: value } : row))
    );
  }

  function addIngredient() {
    setIngredients((prev) => [...prev, emptyIngredient()]);
  }

  function removeIngredient(key: string) {
    setIngredients((prev) => prev.filter((row) => row.key !== key));
  }

  // ── Step helpers ────────────────────────────────────────────────────────────

  function updateStep(
    key: string,
    field: keyof Omit<StepRow, "key">,
    value: string
  ) {
    setSteps((prev) =>
      prev.map((row) => (row.key === key ? { ...row, [field]: value } : row))
    );
  }

  function addStep() {
    setSteps((prev) => [...prev, emptyStep()]);
  }

  function removeStep(key: string) {
    setSteps((prev) => prev.filter((row) => row.key !== key));
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = formRef.current!;
    const formData = new FormData(form);

    // Inject serialized state
    formData.set(
      "ingredients",
      JSON.stringify(
        ingredients.map(({ key: _key, ...rest }) => rest)
      )
    );
    formData.set(
      "steps",
      JSON.stringify(steps.map(({ key: _key, ...rest }) => rest))
    );
    formData.set("difficulty", difficulty);
    formData.set("imageUrl", imageUrl);

    await action(formData);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="space-y-8 pb-20 lg:pb-8"
    >
      {/* ── Photo ── */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Photo</h2>

        {imageUrl ? (
          <div className="relative w-full max-w-sm overflow-hidden rounded-lg border bg-muted aspect-video">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="Recipe photo" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => setImageUrl("")}
              className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-background/80 text-foreground hover:bg-background"
              title="Remove photo"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={imageUploading}
            className="flex h-32 w-full max-w-sm items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input bg-muted/30 text-sm text-muted-foreground hover:border-primary hover:text-foreground transition-colors disabled:opacity-50"
          >
            <ImagePlus className="h-5 w-5" />
            {imageUploading ? "Uploading…" : "Add a photo"}
          </button>
        )}

        {imageUrl && !imageUploading && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <ImagePlus className="mr-1.5 h-4 w-4" />
            Change photo
          </Button>
        )}

        {imageError && (
          <p className="text-sm text-destructive">{imageError}</p>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={handleImageChange}
        />
      </section>

      {/* ── Basic info ── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Basic info</h2>

        <div className="space-y-2">
          <Label htmlFor="title">Title *</Label>
          <Input
            id="title"
            name="title"
            required
            defaultValue={defaults.title}
            placeholder="e.g. Spaghetti Carbonara"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            name="description"
            defaultValue={defaults.description ?? ""}
            placeholder="A short summary of the dish…"
            rows={2}
          />
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="cuisine">Cuisine</Label>
            <Input
              id="cuisine"
              name="cuisine"
              defaultValue={defaults.cuisine ?? ""}
              placeholder="e.g. Italian"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="difficulty">Difficulty</Label>
            <Select value={difficulty} onValueChange={setDifficulty}>
              <SelectTrigger id="difficulty">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="easy">Easy</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="hard">Hard</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="prepTimeMinutes">Prep (min)</Label>
            <Input
              id="prepTimeMinutes"
              name="prepTimeMinutes"
              type="number"
              min={0}
              defaultValue={defaults.prepTimeMinutes ?? ""}
              placeholder="0"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cookTimeMinutes">Cook (min)</Label>
            <Input
              id="cookTimeMinutes"
              name="cookTimeMinutes"
              type="number"
              min={0}
              defaultValue={defaults.cookTimeMinutes ?? ""}
              placeholder="0"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="servings">Servings</Label>
            <Input
              id="servings"
              name="servings"
              defaultValue={defaults.servings ?? ""}
              placeholder="4"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="servingsUnit">Servings unit</Label>
            <Input
              id="servingsUnit"
              name="servingsUnit"
              defaultValue={defaults.servingsUnit ?? "servings"}
              placeholder="servings"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="sourceUrl">Source URL</Label>
          <Input
            id="sourceUrl"
            name="sourceUrl"
            type="url"
            defaultValue={defaults.sourceUrl ?? ""}
            placeholder="https://…"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="tags">Tags</Label>
          <Input
            id="tags"
            name="tags"
            defaultValue={defaults.tags?.join(", ") ?? ""}
            placeholder="pasta, quick, family-friendly (comma-separated)"
          />
        </div>
      </section>

      {/* ── Ingredients ── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Ingredients</h2>

        <div className="space-y-2">
          {ingredients.map((row, idx) => (
            <div
              key={row.key}
              className="grid grid-cols-[auto_1fr] gap-2 items-start"
            >
              {/* Row number */}
              <span className="flex h-10 w-6 items-center justify-center text-xs text-muted-foreground">
                {idx + 1}
              </span>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-[2fr_1fr_1fr_2fr_auto_auto]">
                <Input
                  value={row.ingredientName}
                  onChange={(e) =>
                    updateIngredient(row.key, "ingredientName", e.target.value)
                  }
                  placeholder="Ingredient *"
                  className="col-span-2 sm:col-span-1"
                />
                <Input
                  value={row.amount}
                  onChange={(e) =>
                    updateIngredient(row.key, "amount", e.target.value)
                  }
                  placeholder="Amount"
                />
                <Input
                  value={row.unit}
                  onChange={(e) =>
                    updateIngredient(row.key, "unit", e.target.value)
                  }
                  placeholder="Unit"
                />
                <Input
                  value={row.preparation}
                  onChange={(e) =>
                    updateIngredient(row.key, "preparation", e.target.value)
                  }
                  placeholder="Preparation"
                />
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={row.isOptional}
                    onChange={(e) =>
                      updateIngredient(row.key, "isOptional", e.target.checked)
                    }
                    className="h-4 w-4"
                  />
                  Optional
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeIngredient(row.key)}
                  disabled={ingredients.length === 1}
                  className="h-10 w-10 shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addIngredient}
          className="gap-1"
        >
          <Plus className="h-4 w-4" />
          Add ingredient
        </Button>
      </section>

      {/* ── Steps ── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Steps</h2>

        <div className="space-y-3">
          {steps.map((row, idx) => (
            <div key={row.key} className="flex gap-3 items-start">
              <span className="flex h-10 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                {idx + 1}
              </span>

              <div className="flex-1 space-y-2">
                <Textarea
                  value={row.instruction}
                  onChange={(e) =>
                    updateStep(row.key, "instruction", e.target.value)
                  }
                  placeholder="Describe this step…"
                  rows={2}
                />
                <div className="flex gap-2">
                  <Input
                    value={row.durationMinutes}
                    onChange={(e) =>
                      updateStep(row.key, "durationMinutes", e.target.value)
                    }
                    type="number"
                    min={0}
                    placeholder="Timer (min)"
                    className="w-32"
                  />
                  <Input
                    value={row.timerLabel}
                    onChange={(e) =>
                      updateStep(row.key, "timerLabel", e.target.value)
                    }
                    placeholder='Timer label (e.g. "Simmer")'
                  />
                </div>
              </div>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeStep(row.key)}
                disabled={steps.length === 1}
                className="h-10 w-10 shrink-0 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addStep}
          className="gap-1"
        >
          <Plus className="h-4 w-4" />
          Add step
        </Button>
      </section>

      {/* ── Notes ── */}
      <section className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          name="notes"
          defaultValue={defaults.notes ?? ""}
          placeholder="Any extra notes, variations, substitutions…"
          rows={3}
        />
      </section>

      {/* ── Submit ── */}
      <div className="flex gap-3">
        <Button type="submit">{submitLabel}</Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => window.history.back()}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
