import type { ConceptCard, GeneratedRecipe } from "./recipe-generation";
import type { MealPlanSlot } from "@/app/actions/ai";

// What each AI job kind leaves behind, shared by the server actions that start
// them (app/actions/ai.ts) and the client that waits on them (lib/ai-jobs-client.ts).

export type RecipeJobResult = {
  recipe: GeneratedRecipe;
  /** The collection the AI would file it in, when asked for one. */
  collection?: { collectionId?: string; collectionName?: string };
};

export type ConceptsJobResult = { concepts: ConceptCard[] };

/** The ideas written so far, as a concepts job's progress. */
export type ConceptsJobProgress = { concepts: ConceptCard[] };

/** A drafted week (or the redone slots of one) — not yet saved to the planner. */
export type MealPlanJobResult = { slots: MealPlanSlot[] };

/**
 * A week being drafted, as it goes: what the planner is weighing (true facts
 * from the household's data, lib/ai/plan-progress.ts), some of the library's
 * photos to show while it works, then each meal the moment the AI has written
 * it. A job's progress, and the events of the iOS app's stream.
 */
export type MealPlanProgress = { facts: string[]; photos: string[]; slots: MealPlanSlot[] };

/** One line of `POST /api/v1/ai/meal-plan` streamed (`Accept: application/x-ndjson`). */
export type MealPlanEvent =
  | { type: "facts"; facts: string[]; photos: string[] }
  | { type: "slot"; slot: MealPlanSlot }
  | { type: "done"; slots: MealPlanSlot[] }
  | { type: "error"; message: string };

/** What the planner reports while it works (the stream's `facts` and `slot`). */
export type MealPlanUpdate = Extract<MealPlanEvent, { type: "facts" | "slot" }>;

export type BatchJobItem = {
  title: string;
  status: "pending" | "generating" | "done" | "error";
  /** How far the one being written has got. */
  progress?: RecipeProgress;
  recipeId?: string;
  collectionName?: string;
  error?: string;
};

/** A batch reports its items as progress and returns the same list when done. */
export type BatchJobProgress = { items: BatchJobItem[] };

/**
 * A recipe being written, as the AI writes it: which part it's on (the
 * schema's own order — ingredients, then the method, then nutrition), the
 * ingredients so far and how many steps. `grounding` is reading real recipes
 * first (when web grounding is on); `revising` is the heart-healthy second
 * pass, when the first draft missed the targets.
 */
export type RecipeProgress = {
  stage: "grounding" | "ingredients" | "method" | "nutrition";
  ingredients: string[];
  steps: number;
  revising?: boolean;
};

/** One line of `POST /api/v1/ai/recipes` streamed (`Accept: application/x-ndjson`). */
export type RecipeEvent =
  | ({ type: "progress" } & RecipeProgress)
  | { type: "done"; recipeId: string; title: string; collectionName?: string }
  | { type: "error"; message: string };

/** One line of `POST /api/v1/ai/concepts` streamed: each idea as it's written. */
export type ConceptsEvent =
  | { type: "concept"; concept: ConceptCard }
  | { type: "done"; concepts: ConceptCard[] }
  | { type: "error"; message: string };

/**
 * One line of `POST /api/v1/ai/meal-plan/apply` streamed: each new idea being
 * written out as a recipe (by its index in the slots sent), then `done` once
 * the week is in the plan, or `error`.
 */
export type MealPlanApplyEvent =
  | { type: "writing"; index: number; progress: RecipeProgress | null }
  | { type: "written"; index: number; recipeId: string }
  | { type: "failed"; index: number }
  | { type: "done" }
  | { type: "error"; message: string };

/** What adding a draft reports while it writes (all but `done` and `error`). */
export type MealPlanApplyUpdate = Extract<MealPlanApplyEvent, { type: "writing" | "written" | "failed" }>;
