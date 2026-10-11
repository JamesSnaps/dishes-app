"use client";

import { useTransition } from "react";
import type { MealRole } from "@dishes/shared";
import type { AddGroupInput, UpdateGroupInput } from "@/lib/services/meal-plan";
import {
  addMealEntry,
  addMealGroup,
  removeMealEntry,
  removeMealGroup,
  replaceMealEntryRecipe,
  setMealEntryGroup,
  updateMealEntryServings,
  updateMealGroup,
} from "@/app/actions/meal-plan";
import type { MealPlanMutations } from "./week-planner";

type MealType = Parameters<MealPlanMutations["addEntry"]>[3];

/**
 * The plan writes the meal-group UI needs, routed the same way `EntryCard`
 * routes its own: through `mutations` (sync engine, optimistic, offline-safe)
 * when `WeekPlannerLocal` supplies them, otherwise through the server actions.
 */
export function usePlanWriter(mutations?: MealPlanMutations) {
  const [pending, startTransition] = useTransition();

  function viaServer(fn: () => Promise<unknown>) {
    startTransition(async () => {
      await fn();
    });
  }

  return {
    pending,

    addEntry(
      weekStartDate: string,
      recipeId: string,
      dayOfWeek: number,
      mealType: MealType,
      opts?: { groupId?: string; mealRole?: MealRole }
    ) {
      if (mutations) mutations.addEntry(weekStartDate, recipeId, dayOfWeek, mealType, opts);
      else viaServer(() => addMealEntry(weekStartDate, recipeId, dayOfWeek, mealType, null, opts));
    },

    deleteEntry(entryId: string) {
      if (mutations) mutations.deleteEntry(entryId);
      else viaServer(() => removeMealEntry(entryId));
    },

    replaceEntryRecipe(entryId: string, recipeId: string) {
      if (mutations) mutations.replaceEntryRecipe(entryId, recipeId);
      else viaServer(() => replaceMealEntryRecipe(entryId, recipeId));
    },

    setEntryGroup(entryId: string, groupId: string | null, mealRole?: MealRole) {
      if (mutations) mutations.setEntryGroup(entryId, groupId, mealRole);
      else viaServer(() => setMealEntryGroup(entryId, groupId, mealRole));
    },

    updateEntryServings(entryId: string, servings: number | null) {
      if (mutations) mutations.updateEntryServings(entryId, servings);
      else viaServer(() => updateMealEntryServings(entryId, servings));
    },

    addGroup(input: AddGroupInput) {
      if (mutations) mutations.addGroup(input);
      else viaServer(() => addMealGroup(input));
    },

    updateGroup(groupId: string, input: UpdateGroupInput) {
      if (mutations) mutations.updateGroup(groupId, input);
      else viaServer(() => updateMealGroup(groupId, input));
    },

    deleteGroup(groupId: string, keepRecipes = false) {
      if (mutations) mutations.deleteGroup(groupId, keepRecipes);
      else viaServer(() => removeMealGroup(groupId, { keepRecipes }));
    },
  };
}

export type PlanWriter = ReturnType<typeof usePlanWriter>;
