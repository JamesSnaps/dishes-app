"use client";

import { useRef, useState, useEffect } from "react";
import { Plus, Trash2, ImagePlus, X, Sparkles, CheckCircle2, Wand2, Tag, Star } from "lucide-react";
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
import { improveRecipe, generateRecipeImageUrl, type GeneratedRecipe } from "@/app/actions/ai";
import { addPendingImageJob } from "@/components/providers/jobs-provider";
import { toast } from "@/hooks/use-toast";
import { PasteImportModal } from "./paste-import-modal";
import type { ParsedIngredient, ParsedStep } from "@/lib/recipe-parser";

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
  thumbnailUrl?: string | null;
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
  heading?: string;
  mode?: "create" | "edit";
  recipeId?: string;
}

export function RecipeForm({
  action,
  defaults = {},
  submitLabel = "Save Recipe",
  heading = "Edit Recipe",
  mode = "edit",
  recipeId,
}: RecipeFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Controlled field state ──────────────────────────────────────────────────

  const [title, setTitle] = useState(defaults.title ?? "");
  const [description, setDescription] = useState(defaults.description ?? "");
  const [cuisine, setCuisine] = useState(defaults.cuisine ?? "");
  const [prepTimeMinutes, setPrepTimeMinutes] = useState(
    defaults.prepTimeMinutes?.toString() ?? ""
  );
  const [cookTimeMinutes, setCookTimeMinutes] = useState(
    defaults.cookTimeMinutes?.toString() ?? ""
  );
  const [servings, setServings] = useState(
    defaults.servings ? String(parseFloat(defaults.servings)) : ""
  );
  const [servingsUnit, setServingsUnit] = useState(
    defaults.servingsUnit ?? "servings"
  );
  const [sourceUrl, setSourceUrl] = useState(defaults.sourceUrl ?? "");
  const [tags, setTags] = useState<string[]>(defaults.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [notes, setNotes] = useState(defaults.notes ?? "");

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
  const [thumbnailUrl, setThumbnailUrl] = useState<string>(defaults.thumbnailUrl ?? "");
  const [imageUploading, setImageUploading] = useState(false);
  const [imageGenerating, setImageGenerating] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [genMsgIdx, setGenMsgIdx] = useState(0);

  const GEN_MESSAGES = [
    "Conjuring your image…",
    "Painting with pixels…",
    "Adding a pinch of magic…",
    "Almost ready…",
  ];

  useEffect(() => {
    if (!imageGenerating) return;
    setGenMsgIdx(0);
    const id = setInterval(() => {
      setGenMsgIdx((i) => (i + 1) % GEN_MESSAGES.length);
    }, 2200);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageGenerating]);

  // ── AI improve state ────────────────────────────────────────────────────────

  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiApplied, setAiApplied] = useState(false);

  async function handleAiImprove() {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setAiError(null);
    setAiApplied(false);

    const current: GeneratedRecipe = {
      title,
      description,
      cuisine,
      difficulty: (difficulty as GeneratedRecipe["difficulty"]) || "easy",
      prepTimeMinutes: prepTimeMinutes ? Number(prepTimeMinutes) : null,
      cookTimeMinutes: cookTimeMinutes ? Number(cookTimeMinutes) : null,
      servings,
      servingsUnit,
      tags,
      ingredients: ingredients.map(({ key: _key, ...rest }) => rest),
      steps: steps.map(({ key: _key, ...rest }) => rest),
      notes: notes || null,
    };

    const result = await improveRecipe(current, aiPrompt);
    setAiLoading(false);

    if (result.error) {
      setAiError(result.error);
      return;
    }

    const r = result.recipe!;
    setTitle(r.title);
    setDescription(r.description);
    setCuisine(r.cuisine);
    setDifficulty(r.difficulty);
    setPrepTimeMinutes(r.prepTimeMinutes?.toString() ?? "");
    setCookTimeMinutes(r.cookTimeMinutes?.toString() ?? "");
    setServings(r.servings);
    setServingsUnit(r.servingsUnit);
    setTags(r.tags);
    setNotes(r.notes ?? "");
    setIngredients(r.ingredients.map((i) => ({ ...i, key: nextKey() })));
    setSteps(r.steps.map((s) => ({ ...s, key: nextKey() })));
    setAiApplied(true);
    setAiPrompt("");
  }

  // ── Image upload ────────────────────────────────────────────────────────────

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageError(null);
    setImageUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = (await res.json()) as { url?: string; thumbnailUrl?: string | null; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setImageUrl(data.url!);
      setThumbnailUrl(data.thumbnailUrl ?? "");
    } catch (err) {
      setImageError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setImageUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleGenerateImage() {
    setImageError(null);

    if (recipeId) {
      // Background job — fire-and-forget so the user can navigate away
      try {
        const res = await fetch(`/api/recipes/${recipeId}/generate-image`, { method: "POST" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? "Failed to start image generation");
        }
        const { jobId } = (await res.json()) as { jobId: string };
        addPendingImageJob({ jobId, recipeId, recipeTitle: title || "Recipe" });
        toast({
          title: "Generating image",
          description: "You can navigate away — we’ll notify you when it’s ready.",
        });
        window.dispatchEvent(new Event("dishes-notification-added"));
      } catch (err) {
        setImageError(err instanceof Error ? err.message : "Something went wrong");
      }
      return;
    }

    // Create mode — synchronous, URL stored in form state
    setImageGenerating(true);
    const result = await generateRecipeImageUrl(title || "Recipe", description || null);
    setImageGenerating(false);
    if (result.error) {
      setImageError(result.error);
      return;
    }
    setImageUrl(result.url!);
    setThumbnailUrl(result.thumbnailUrl ?? "");
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

  function handlePasteImport(
    parsedIngredients: ParsedIngredient[],
    parsedSteps: ParsedStep[]
  ) {
    if (parsedIngredients.length > 0) {
      setIngredients(
        parsedIngredients.map(({ ...rest }) => ({ ...rest, key: nextKey() }))
      );
    }
    if (parsedSteps.length > 0) {
      setSteps(
        parsedSteps.map(({ ...rest }) => ({ ...rest, key: nextKey() }))
      );
    }
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = formRef.current!;
    const formData = new FormData(form);

    formData.set("title", title);
    formData.set("description", description);
    formData.set("cuisine", cuisine);
    formData.set("prepTimeMinutes", prepTimeMinutes);
    formData.set("cookTimeMinutes", cookTimeMinutes);
    formData.set("servings", servings);
    formData.set("servingsUnit", servingsUnit);
    formData.set("sourceUrl", sourceUrl);
    formData.set("tags", tags.join(", "));
    formData.set("notes", notes);
    formData.set(
      "ingredients",
      JSON.stringify(ingredients.map(({ key: _key, ...rest }) => rest))
    );
    formData.set(
      "steps",
      JSON.stringify(steps.map(({ key: _key, ...rest }) => rest))
    );
    formData.set("difficulty", difficulty);
    formData.set("imageUrl", imageUrl);
    formData.set("thumbnailUrl", thumbnailUrl);

    await action(formData);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const photoSection = (
    <section className="space-y-3">
      {imageUrl ? (
        <div className="relative w-full overflow-hidden rounded-lg border bg-muted aspect-video">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="Recipe photo" className="h-full w-full object-cover" />
          <button
            type="button"
            onClick={() => { setImageUrl(""); setThumbnailUrl(""); }}
            className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-background/80 text-foreground hover:bg-background"
            title="Remove photo"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : imageGenerating ? (
        <div className="relative w-full aspect-video overflow-hidden rounded-lg border bg-gradient-to-br from-violet-950/60 via-purple-900/40 to-fuchsia-950/60">
          {/* sweeping shimmer */}
          <div
            className="absolute inset-0 opacity-30"
            style={{
              background: "linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.18) 50%, transparent 70%)",
              animation: "shimmer 2s linear infinite",
              backgroundSize: "200% 100%",
            }}
          />
          {/* floating sparkle dots */}
          <div className="absolute top-5 left-8 h-1.5 w-1.5 rounded-full bg-violet-400 animate-ping" style={{ animationDelay: "0s", animationDuration: "1.6s" }} />
          <div className="absolute top-10 right-10 h-1 w-1 rounded-full bg-fuchsia-400 animate-ping" style={{ animationDelay: "0.5s", animationDuration: "2s" }} />
          <div className="absolute bottom-8 left-14 h-1.5 w-1.5 rounded-full bg-purple-300 animate-ping" style={{ animationDelay: "1s", animationDuration: "1.8s" }} />
          <div className="absolute bottom-5 right-6 h-1 w-1 rounded-full bg-pink-400 animate-ping" style={{ animationDelay: "0.3s", animationDuration: "2.2s" }} />
          <Star className="absolute top-4 right-4 h-3 w-3 text-violet-400/60 animate-pulse" style={{ animationDelay: "0.8s" }} />
          <Star className="absolute bottom-6 left-5 h-2.5 w-2.5 text-fuchsia-400/60 animate-pulse" style={{ animationDelay: "0.2s" }} />
          {/* centre content */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-violet-500/30 blur-lg animate-pulse scale-150" />
              <Wand2 className="relative h-8 w-8 text-violet-300 drop-shadow-[0_0_6px_rgba(167,139,250,0.8)]" style={{ animation: "wand-rock 1.8s ease-in-out infinite" }} />
              <Sparkles className="absolute -top-2 -right-2 h-4 w-4 text-fuchsia-300 animate-spin" style={{ animationDuration: "3s" }} />
            </div>
            <p
              key={genMsgIdx}
              className="text-sm font-medium text-violet-200/90 tracking-wide"
              style={{ animation: "fadeSlideIn 0.4s ease-out" }}
            >
              {GEN_MESSAGES[genMsgIdx]}
            </p>
          </div>
          <style>{`
            @keyframes shimmer { 0% { background-position: -200% 0 } 100% { background-position: 200% 0 } }
            @keyframes wand-rock { 0%, 100% { transform: rotate(-12deg) } 50% { transform: rotate(12deg) } }
            @keyframes fadeSlideIn { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: translateY(0) } }
          `}</style>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={imageUploading}
            className="flex w-full aspect-video items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input bg-muted/30 text-sm text-muted-foreground hover:border-primary hover:text-foreground transition-colors disabled:opacity-50"
          >
            <ImagePlus className="h-5 w-5" />
            {imageUploading ? "Uploading…" : "Upload photo"}
          </button>
          <button
            type="button"
            onClick={() => void handleGenerateImage()}
            disabled={imageUploading}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-input bg-muted/30 py-2 text-sm text-muted-foreground hover:border-primary hover:text-foreground transition-colors disabled:opacity-50"
          >
            <Wand2 className="h-4 w-4" />
            Generate with AI
          </button>
        </div>
      )}

      {imageUrl && !imageUploading && (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="flex-1"
          >
            <ImagePlus className="mr-1.5 h-4 w-4" />
            Change photo
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => { setImageUrl(""); setThumbnailUrl(""); }}
            className="flex-1"
          >
            <X className="mr-1.5 h-4 w-4" />
            Remove
          </Button>
        </div>
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
  );

  const detailsSection = (
    <section className="space-y-4">
      <h2 className="text-base font-semibold">Recipe Details</h2>

      <div className="space-y-2">
        <Label htmlFor="title">Title *</Label>
        <Input
          id="title"
          name="title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Spaghetti Carbonara"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          name="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="A short summary of the dish…"
          rows={2}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="cuisine">Cuisine</Label>
          <Input
            id="cuisine"
            name="cuisine"
            value={cuisine}
            onChange={(e) => setCuisine(e.target.value)}
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
            value={prepTimeMinutes}
            onChange={(e) => setPrepTimeMinutes(e.target.value)}
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
            value={cookTimeMinutes}
            onChange={(e) => setCookTimeMinutes(e.target.value)}
            placeholder="0"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="servings">Servings</Label>
          <Input
            id="servings"
            name="servings"
            value={servings}
            onChange={(e) => setServings(e.target.value)}
            placeholder="4"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="servingsUnit">Unit</Label>
          <Input
            id="servingsUnit"
            name="servingsUnit"
            value={servingsUnit}
            onChange={(e) => setServingsUnit(e.target.value)}
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
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://…"
        />
      </div>
    </section>
  );

  const ingredientsSection = (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Ingredients</h2>
        <PasteImportModal onImport={handlePasteImport} />
      </div>

      {/* Column headers — visible on sm+ */}
      <div className="hidden sm:grid sm:grid-cols-[2fr_1fr_1fr_2fr_auto_auto] gap-2 px-1">
        <span className="text-xs font-medium text-muted-foreground">Ingredient</span>
        <span className="text-xs font-medium text-muted-foreground">Amount</span>
        <span className="text-xs font-medium text-muted-foreground">Unit</span>
        <span className="text-xs font-medium text-muted-foreground">Preparation</span>
        <span className="text-xs font-medium text-muted-foreground">Opt.</span>
        <span />
      </div>

      <div className="space-y-2">
        {ingredients.map((row, idx) => (
          <div
            key={row.key}
            className="grid grid-cols-[auto_1fr] gap-2 items-start"
          >
            <span className="flex h-9 w-5 items-center justify-center text-xs text-muted-foreground">
              {idx + 1}
            </span>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-[2fr_1fr_1fr_2fr_auto_auto]">
              <Input
                value={row.ingredientName}
                onChange={(e) =>
                  updateIngredient(row.key, "ingredientName", e.target.value)
                }
                placeholder="Ingredient *"
                className="col-span-2 sm:col-span-1 h-9 text-sm"
              />
              <Input
                value={row.amount}
                onChange={(e) =>
                  updateIngredient(row.key, "amount", e.target.value)
                }
                placeholder="Amount"
                className="h-9 text-sm"
              />
              <Input
                value={row.unit}
                onChange={(e) =>
                  updateIngredient(row.key, "unit", e.target.value)
                }
                placeholder="Unit"
                className="h-9 text-sm"
              />
              <Input
                value={row.preparation}
                onChange={(e) =>
                  updateIngredient(row.key, "preparation", e.target.value)
                }
                placeholder="Preparation"
                className="col-span-2 sm:col-span-1 h-9 text-sm"
              />
              <div className="flex items-center justify-center">
                <input
                  type="checkbox"
                  checked={row.isOptional}
                  onChange={(e) =>
                    updateIngredient(row.key, "isOptional", e.target.checked)
                  }
                  className="h-4 w-4"
                  title="Optional"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeIngredient(row.key)}
                disabled={ingredients.length === 1}
                className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
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
  );

  const stepsSection = (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">Steps</h2>

      <div className="space-y-3">
        {steps.map((row, idx) => (
          <div key={row.key} className="flex gap-2 items-start">
            <span className="flex h-8 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
              {idx + 1}
            </span>

            <div className="flex-1 space-y-1.5">
              <Textarea
                value={row.instruction}
                onChange={(e) =>
                  updateStep(row.key, "instruction", e.target.value)
                }
                placeholder="Describe this step…"
                rows={2}
                className="text-sm"
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
                  className="w-28 h-8 text-sm"
                />
                <Input
                  value={row.timerLabel}
                  onChange={(e) =>
                    updateStep(row.key, "timerLabel", e.target.value)
                  }
                  placeholder='Label (e.g. "Simmer")'
                  className="h-8 text-sm"
                />
              </div>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => removeStep(row.key)}
              disabled={steps.length === 1}
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
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
  );

  const notesSection = (
    <section className="space-y-2">
      <Label htmlFor="notes" className="text-base font-semibold">Notes</Label>
      <Textarea
        id="notes"
        name="notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Any extra notes, variations, substitutions…"
        rows={3}
        className="text-sm"
      />
    </section>
  );

  const tagsSection = (
    <section className="space-y-2">
      <Label className="text-base font-semibold">Tags</Label>
      <div className="rounded-md border border-input bg-background px-3 py-2 min-h-10 flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-medium"
          >
            <Tag className="h-3 w-3" />
            {tag}
            <button
              type="button"
              onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
              className="ml-0.5 rounded-full hover:bg-primary/20 p-0.5"
              aria-label={`Remove ${tag}`}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        <input
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              const val = tagInput.trim().replace(/,$/, "");
              if (val && !tags.includes(val)) {
                setTags((prev) => [...prev, val]);
              }
              setTagInput("");
            } else if (e.key === "Backspace" && !tagInput && tags.length > 0) {
              setTags((prev) => prev.slice(0, -1));
            }
          }}
          onBlur={() => {
            const val = tagInput.trim().replace(/,$/, "");
            if (val && !tags.includes(val)) {
              setTags((prev) => [...prev, val]);
            }
            setTagInput("");
          }}
          placeholder={tags.length === 0 ? "Type a tag and press Enter…" : ""}
          className="flex-1 min-w-24 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
    </section>
  );

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="space-y-6 pb-20 lg:pb-8"
    >
      {/* ── Page header: title + actions (desktop) ── */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">{heading}</h1>
        <div className="hidden lg:flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => window.history.back()}
          >
            Cancel
          </Button>
          <Button type="submit">{submitLabel}</Button>
        </div>
      </div>

      {/* ── AI Improve (edit mode only) ── */}
      {mode === "edit" && (
        <section className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary shrink-0" />
            <h2 className="text-sm font-semibold">Improve with AI</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Describe a change and the AI will update the recipe for you to review before saving.
          </p>
          <div className="flex gap-2">
            <Input
              value={aiPrompt}
              onChange={(e) => {
                setAiPrompt(e.target.value);
                setAiApplied(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleAiImprove();
                }
              }}
              placeholder='e.g. "Make it healthier", "Rearrange the steps logically"'
              disabled={aiLoading}
              className="flex-1 text-sm"
            />
            <Button
              type="button"
              onClick={() => void handleAiImprove()}
              disabled={aiLoading || !aiPrompt.trim()}
              size="sm"
              className="shrink-0"
            >
              {aiLoading ? "Improving…" : "Improve"}
            </Button>
          </div>
          {aiError && <p className="text-sm text-destructive">{aiError}</p>}
          {aiApplied && (
            <p className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Recipe updated — review the changes below and save when ready.
            </p>
          )}
        </section>
      )}

      {/* ── Photo + Details row ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr] lg:items-start">
        <div className="space-y-4 lg:sticky lg:top-6">
          <h2 className="text-base font-semibold">Photo</h2>
          {photoSection}
        </div>
        <div>
          {detailsSection}
        </div>
      </div>

      {/* ── Ingredients, Steps, Notes, Tags ── */}
      <div className="space-y-6 border-t border-border pt-6">
        {ingredientsSection}
        <div className="border-t border-border pt-6">
          {stepsSection}
        </div>
        <div className="border-t border-border pt-6">
          {notesSection}
        </div>
        <div className="border-t border-border pt-6">
          {tagsSection}
        </div>
      </div>

      {/* ── Submit (mobile only — desktop uses header buttons) ── */}
      <div className="flex gap-3 pt-2 lg:hidden">
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
