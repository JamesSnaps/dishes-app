"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { Plus, Trash2, ImagePlus, X, Sparkles, CheckCircle2, Wand2, Tag, Star, Loader2 } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dishes/ui";
import { deleteAllCookAssistThreadsForRecipe } from "@/app/actions/cook-assist-threads";
import { improveRecipe, generateRecipeImageUrl, type GeneratedRecipe } from "@/app/actions/ai";
import { IMAGE_STYLES } from "@/lib/image-styles";
import type { ImageStyleValue } from "@/lib/image-styles";
import { addPendingImageJob } from "@/components/providers/jobs-provider";
import { toast } from "@/hooks/use-toast";
import { useUnsavedChanges } from "@/components/unsaved-changes-context";
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
  calories?: number | null;
  proteinG?: string | null;
  carbsG?: string | null;
  fatG?: string | null;
  fiberG?: string | null;
  sugarG?: string | null;
  sodiumMg?: string | null;
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

// Extract the first integer from a duration string — handles AI ranges like "55-60"
function sanitizeDuration(val: string | undefined | null): string {
  if (!val) return "";
  const match = val.match(/\d+/);
  return match ? match[0] : "";
}

// ── Main component ────────────────────────────────────────────────────────────

interface RecipeFormProps {
  action: (formData: FormData) => Promise<void>;
  defaults?: RecipeFormDefaults;
  submitLabel?: string;
  heading?: string;
  mode?: "create" | "edit";
  recipeId?: string;
  defaultImageStyle?: ImageStyleValue;
  assistThreadCount?: number;
  allTags?: string[];
}

export function RecipeForm({
  action,
  defaults = {},
  submitLabel = "Save Recipe",
  heading = "Edit Recipe",
  mode = "edit",
  recipeId,
  defaultImageStyle = "studio",
  assistThreadCount = 0,
  allTags = [],
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
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const tagInputRef = useRef<HTMLInputElement>(null);

  const tagSuggestions = tagInput.trim().length > 0
    ? allTags.filter(
        (t) =>
          t.toLowerCase().includes(tagInput.trim().toLowerCase()) &&
          !tags.includes(t)
      )
    : [];

  const addTag = useCallback((val: string) => {
    const trimmed = val.trim().replace(/,$/, "");
    if (trimmed && !tags.includes(trimmed)) {
      setTags((prev) => [...prev, trimmed]);
    }
    setTagInput("");
    setShowTagSuggestions(false);
    setActiveSuggestionIndex(-1);
  }, [tags]);
  const [notes, setNotes] = useState(defaults.notes ?? "");

  // Nutrition (per serving) — manual entry. Kept as strings for the inputs.
  const numDefault = (v: number | string | null | undefined) =>
    v == null || v === "" ? "" : String(v);
  const [calories, setCalories] = useState(numDefault(defaults.calories));
  const [proteinG, setProteinG] = useState(numDefault(defaults.proteinG));
  const [carbsG, setCarbsG] = useState(numDefault(defaults.carbsG));
  const [fatG, setFatG] = useState(numDefault(defaults.fatG));
  const [fiberG, setFiberG] = useState(numDefault(defaults.fiberG));
  const [sugarG, setSugarG] = useState(numDefault(defaults.sugarG));
  const [sodiumMg, setSodiumMg] = useState(numDefault(defaults.sodiumMg));

  const [ingredients, setIngredients] = useState<IngredientRow[]>(() =>
    defaults.ingredients?.length
      ? defaults.ingredients.map((i) => ({ ...i, key: nextKey() }))
      : [emptyIngredient()]
  );

  const [steps, setSteps] = useState<StepRow[]>(() =>
    defaults.steps?.length
      ? defaults.steps.map((s) => ({ ...s, durationMinutes: sanitizeDuration(s.durationMinutes), key: nextKey() }))
      : [emptyStep()]
  );

  const [difficulty, setDifficulty] = useState<string>(
    defaults.difficulty ?? ""
  );

  const [imageUrl, setImageUrl] = useState<string>(defaults.imageUrl ?? "");
  const [thumbnailUrl, setThumbnailUrl] = useState<string>(defaults.thumbnailUrl ?? "");
  const [imageStyle, setImageStyle] = useState<ImageStyleValue>(defaultImageStyle);
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

  // ── Submit state ────────────────────────────────────────────────────────────

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showHistoryConfirm, setShowHistoryConfirm] = useState(false);
  const pendingFormDataRef = useRef<FormData | null>(null);

  // ── Unsaved-changes guard ────────────────────────────────────────────────────

  const { setDirty } = useUnsavedChanges();

  const hasMeaningfulContent = Boolean(
    title.trim() ||
    description.trim() ||
    ingredients.some((i) => i.ingredientName.trim()) ||
    steps.some((s) => s.instruction.trim()) ||
    imageUrl
  );

  useEffect(() => {
    setDirty(hasMeaningfulContent);
  }, [hasMeaningfulContent, setDirty]);

  // Clear dirty state when the form unmounts (successful submit navigates away)
  useEffect(() => {
    return () => setDirty(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Block browser back/refresh when there's content worth keeping
  useEffect(() => {
    if (!hasMeaningfulContent) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasMeaningfulContent]);

  // ── AI improve state ────────────────────────────────────────────────────────

  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiApplied, setAiApplied] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);

  async function handleAiImprove() {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setAiError(null);
    setAiApplied(false);
    setAiSummary(null);

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
    setSteps(r.steps.map((s) => ({ ...s, durationMinutes: sanitizeDuration(s.durationMinutes), key: nextKey() })));
    if (r.nutrition) {
      const ns = (v: number | null | undefined) => (v == null ? "" : String(v));
      setCalories(ns(r.nutrition.calories));
      setProteinG(ns(r.nutrition.proteinG));
      setCarbsG(ns(r.nutrition.carbsG));
      setFatG(ns(r.nutrition.fatG));
      setFiberG(ns(r.nutrition.fiberG));
      setSugarG(ns(r.nutrition.sugarG));
      setSodiumMg(ns(r.nutrition.sodiumMg));
    }
    setAiApplied(true);
    setAiSummary(result.summary ?? null);
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
        const res = await fetch(`/api/recipes/${recipeId}/generate-image`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ style: imageStyle }),
        });
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
    const result = await generateRecipeImageUrl(title || "Recipe", description || null, imageStyle);
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

  function buildFormData(): FormData {
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
    formData.set("ingredients", JSON.stringify(ingredients.map(({ key: _key, ...rest }) => rest)));
    formData.set("steps", JSON.stringify(steps.map(({ key: _key, ...rest }) => rest)));
    formData.set("difficulty", difficulty);
    formData.set("imageUrl", imageUrl);
    formData.set("thumbnailUrl", thumbnailUrl);
    formData.set("calories", calories);
    formData.set("proteinG", proteinG);
    formData.set("carbsG", carbsG);
    formData.set("fatG", fatG);
    formData.set("fiberG", fiberG);
    formData.set("sugarG", sugarG);
    formData.set("sodiumMg", sodiumMg);
    return formData;
  }

  async function executeSubmit(formData: FormData, clearHistory: boolean) {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      if (clearHistory && recipeId) {
        await deleteAllCookAssistThreadsForRecipe(recipeId);
      }
      await action(formData);
    } catch (err) {
      // next/navigation redirect() throws a special error — let Next.js handle it
      if (
        err &&
        typeof err === "object" &&
        "digest" in err &&
        typeof (err as { digest: unknown }).digest === "string" &&
        (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
      ) {
        throw err;
      }
      const message =
        err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setSubmitError(message);
      setIsSubmitting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isSubmitting) return;

    const formData = buildFormData();

    // In edit mode with existing conversation history, ask what to do with it
    if (mode === "edit" && assistThreadCount > 0) {
      pendingFormDataRef.current = formData;
      setShowHistoryConfirm(true);
      return;
    }

    await executeSubmit(formData, false);
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
          <div className="flex gap-2">
            <select
              value={imageStyle}
              onChange={(e) => setImageStyle(e.target.value as ImageStyleValue)}
              disabled={imageUploading || imageGenerating}
              className="rounded-lg border border-dashed border-input bg-muted/30 px-2 py-2 text-sm text-muted-foreground"
              aria-label="Image style"
            >
              {IMAGE_STYLES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleGenerateImage()}
              disabled={imageUploading || imageGenerating}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-dashed border-input bg-muted/30 py-2 text-sm text-muted-foreground hover:border-primary hover:text-foreground transition-colors disabled:opacity-50"
            >
              <Wand2 className="h-4 w-4" />
              Generate with AI
            </button>
          </div>
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

  const nutritionFieldDefs: { label: string; value: string; set: (v: string) => void; name: string; unit: string }[] = [
    { label: "Calories", value: calories, set: setCalories, name: "calories", unit: "kcal" },
    { label: "Protein", value: proteinG, set: setProteinG, name: "proteinG", unit: "g" },
    { label: "Carbs", value: carbsG, set: setCarbsG, name: "carbsG", unit: "g" },
    { label: "Fat", value: fatG, set: setFatG, name: "fatG", unit: "g" },
    { label: "Fiber", value: fiberG, set: setFiberG, name: "fiberG", unit: "g" },
    { label: "Sugar", value: sugarG, set: setSugarG, name: "sugarG", unit: "g" },
    { label: "Sodium", value: sodiumMg, set: setSodiumMg, name: "sodiumMg", unit: "mg" },
  ];

  const nutritionSection = (
    <section className="space-y-2">
      <Label className="text-base font-semibold">Nutrition</Label>
      <p className="text-xs text-muted-foreground">
        Per serving. Leave blank to use the AI estimate, or enter your own values.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {nutritionFieldDefs.map((f) => (
          <div key={f.name} className="space-y-1">
            <Label htmlFor={`nutrition-${f.name}`} className="text-xs text-muted-foreground">
              {f.label} ({f.unit})
            </Label>
            <Input
              id={`nutrition-${f.name}`}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={f.value}
              onChange={(e) => f.set(e.target.value)}
              placeholder="—"
            />
          </div>
        ))}
      </div>
    </section>
  );

  const tagsSection = (
    <section className="space-y-2">
      <Label className="text-base font-semibold">Tags</Label>
      <div className="relative">
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
            ref={tagInputRef}
            value={tagInput}
            onChange={(e) => {
              setTagInput(e.target.value);
              setShowTagSuggestions(true);
              setActiveSuggestionIndex(-1);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveSuggestionIndex((i) => Math.min(i + 1, tagSuggestions.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveSuggestionIndex((i) => Math.max(i - 1, -1));
              } else if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                if (activeSuggestionIndex >= 0 && tagSuggestions[activeSuggestionIndex]) {
                  addTag(tagSuggestions[activeSuggestionIndex]);
                } else {
                  addTag(tagInput);
                }
              } else if (e.key === "Escape") {
                setShowTagSuggestions(false);
                setActiveSuggestionIndex(-1);
              } else if (e.key === "Backspace" && !tagInput && tags.length > 0) {
                setTags((prev) => prev.slice(0, -1));
              }
            }}
            onFocus={() => {
              if (tagInput.trim()) setShowTagSuggestions(true);
            }}
            onBlur={() => {
              // Delay so click on suggestion fires first
              setTimeout(() => {
                setShowTagSuggestions(false);
                setActiveSuggestionIndex(-1);
                if (tagInput.trim()) addTag(tagInput);
              }, 150);
            }}
            placeholder={tags.length === 0 ? "Type a tag and press Enter…" : ""}
            className="flex-1 min-w-24 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        {showTagSuggestions && tagSuggestions.length > 0 && (
          <ul className="absolute z-50 mt-1 w-full max-h-48 overflow-auto rounded-md border border-input bg-popover shadow-md">
            {tagSuggestions.map((suggestion, idx) => (
              <li key={suggestion}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addTag(suggestion);
                    tagInputRef.current?.focus();
                  }}
                  className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 ${
                    idx === activeSuggestionIndex
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted"
                  }`}
                >
                  <Tag className="h-3 w-3 shrink-0 text-muted-foreground" />
                  {suggestion}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );

  return (
    <>
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="space-y-6 pb-20 lg:pb-8"
    >
      {/* ── Page header: title + actions (desktop) ── */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">{heading}</h1>
        <div className="hidden lg:flex items-center gap-2">
          {submitError && (
            <p className="max-w-xs rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
              {submitError}
            </p>
          )}
          <Button
            type="button"
            variant="ghost"
            disabled={isSubmitting}
            onClick={() => window.history.back()}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {isSubmitting ? "Saving…" : submitLabel}
          </Button>
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
                setAiSummary(null);
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
            <p className="flex items-start gap-1.5 text-sm text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
              {aiSummary ?? "Recipe updated — review the changes below and save when ready."}
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
          {nutritionSection}
        </div>
        <div className="border-t border-border pt-6">
          {notesSection}
        </div>
        <div className="border-t border-border pt-6">
          {tagsSection}
        </div>
      </div>

      {/* ── Submit (mobile only — desktop uses header buttons) ── */}
      <div className="space-y-2 pt-2 lg:hidden">
        {submitError && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {submitError}
          </p>
        )}
        <div className="flex gap-3">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {isSubmitting ? "Saving…" : submitLabel}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={isSubmitting}
            onClick={() => window.history.back()}
          >
            Cancel
          </Button>
        </div>
      </div>
    </form>

      {/* Confirmation dialog when saving with existing conversation history */}
      <Dialog open={showHistoryConfirm} onOpenChange={setShowHistoryConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save changes</DialogTitle>
            <DialogDescription>
              This recipe has {assistThreadCount} saved cooking conversation{assistThreadCount !== 1 ? "s" : ""}.
              Since step numbers or content may have changed, you can clear the history now or keep it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              disabled={isSubmitting}
              onClick={() => setShowHistoryConfirm(false)}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              disabled={isSubmitting}
              onClick={async () => {
                await executeSubmit(pendingFormDataRef.current!, false);
                setShowHistoryConfirm(false);
              }}
            >
              Save &amp; keep history
            </Button>
            <Button
              variant="destructive"
              disabled={isSubmitting}
              onClick={async () => {
                await executeSubmit(pendingFormDataRef.current!, true);
                setShowHistoryConfirm(false);
              }}
            >
              Save &amp; clear history
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
