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

/** A drafted week (or the redone slots of one) — not yet saved to the planner. */
export type MealPlanJobResult = { slots: MealPlanSlot[] };

export type BatchJobItem = {
  title: string;
  status: "pending" | "generating" | "done" | "error";
  recipeId?: string;
  collectionName?: string;
  error?: string;
};

/** A batch reports its items as progress and returns the same list when done. */
export type BatchJobProgress = { items: BatchJobItem[] };
