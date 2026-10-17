import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  collections,
  notes,
  pantryStaples,
  pantryStock,
  recipes,
  recipeTags,
} from "@dishes/db/schema";
import { db } from "@/lib/db";
import type { Session } from "@/lib/session";
import type { GeneratedRecipe } from "@/lib/ai/recipe-generation";
import * as recipeService from "@/lib/services/recipes";
import { listMeals } from "@/lib/services/meals";
import { getStatsReport, parseRange } from "@/lib/services/stats";
import { getGrocerySpend } from "@/lib/deliveries/spend";
import { getWrappedReport } from "@/lib/services/wrapped";
import { listIncomingLibraryShares, listOutgoingLibraryShares } from "@/lib/services/library-shares";
import { getSharedLibrary, getSharedRecipeDetail } from "@/lib/services/library-browse";
import { splitIngredientsText, parseStepsText } from "@/lib/recipe-parser";
import * as pantry from "@/app/actions/pantry";
import * as deliveries from "@/app/actions/deliveries";
import * as meals from "@/app/actions/meals";
import * as notesActions from "@/app/actions/notes";
import * as taste from "@/app/actions/taste-profile";
import * as library from "@/app/actions/library-shares";
import * as sharing from "@/app/actions/sharing";
import * as settings from "@/app/actions/settings";
import * as timeline from "@/app/actions/meal-timeline";
import * as ai from "@/app/actions/ai";
import * as recipeActions from "@/app/actions/recipes";

/**
 * The website's features for the iOS app, through one route:
 * `POST /api/v1/actions/{name}` with `{ "args": [...] }` (API.md, "Actions").
 *
 * Each entry adapts one of the web's own server actions or page loaders, so
 * the app gets exactly the web's behaviour. Nothing here takes a household id
 * from the caller: entries that need one use the session's. Server actions are
 * already callable by any signed-in browser, so this exposes nothing new;
 * what it adds is bearer auth (the actions use resolveIdentity / requireSession).
 */

type Handler = (session: Session, args: unknown[]) => Promise<unknown>;

const str = (v: unknown) => z.string().parse(v);
const optStr = (v: unknown) => z.string().nullish().parse(v) ?? undefined;
const ids = (v: unknown) => z.array(z.string()).parse(v);

/** A plain object posted where the web posts a form. */
function form(fields: Record<string, unknown>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "boolean") {
      if (v) fd.append(k, "on");
    } else {
      fd.append(k, String(v));
    }
  }
  return fd;
}

const obj = (v: unknown) => z.record(z.string(), z.unknown()).parse(v ?? {});

/** A stored recipe in the shape the AI tools take, as the recipe page builds it. */
async function asGenerated(session: Session, recipeId: string): Promise<GeneratedRecipe> {
  const r = await recipeService.getRecipe(session, recipeId);
  const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
  return {
    title: r.title,
    description: r.description ?? "",
    cuisine: r.cuisine ?? "",
    difficulty: (r.difficulty ?? "medium") as GeneratedRecipe["difficulty"],
    prepTimeMinutes: r.prepTimeMinutes,
    cookTimeMinutes: r.cookTimeMinutes,
    servings: r.servings ?? "4",
    servingsUnit: r.servingsUnit ?? "servings",
    mealRole: r.mealRole as GeneratedRecipe["mealRole"],
    mealTypes: r.mealTypes ?? [],
    tags: r.tags,
    ingredients: r.ingredients.map((i) => ({
      ingredientName: i.ingredientName,
      amount: i.amount ?? "",
      unit: i.unit ?? "",
      preparation: i.preparation ?? "",
      isOptional: i.isOptional ?? false,
      groupLabel: i.groupLabel ?? "",
    })),
    steps: r.steps.map((s) => ({
      instruction: s.instruction,
      durationMinutes: s.durationMinutes ? String(s.durationMinutes) : "",
      timerLabel: s.timerLabel ?? "",
      groupLabel: s.groupLabel ?? "",
    })),
    notes: r.notes,
    nutrition: {
      calories: r.calories,
      proteinG: num(r.proteinG),
      carbsG: num(r.carbsG),
      fatG: num(r.fatG),
      saturatedFatG: num(r.saturatedFatG),
      fiberG: num(r.fiberG),
      sugarG: num(r.sugarG),
      sodiumMg: num(r.sodiumMg),
    },
  } as GeneratedRecipe;
}

export const actions: Record<string, Handler> = {
  // ── Pantry ────────────────────────────────────────────────────────────────
  "pantry.list": async (s) => {
    const [staples, stock] = await Promise.all([
      db.select({ id: pantryStaples.id, ingredientName: pantryStaples.ingredientName })
        .from(pantryStaples).where(eq(pantryStaples.householdId, s.householdId))
        .orderBy(asc(pantryStaples.ingredientName)),
      db.select({ id: pantryStock.id, ingredientName: pantryStock.ingredientName, amount: pantryStock.amount,
                  unit: pantryStock.unit, addedAt: pantryStock.addedAt })
        .from(pantryStock).where(eq(pantryStock.householdId, s.householdId))
        .orderBy(asc(pantryStock.ingredientName)),
    ]);
    return { staples, stock };
  },
  "pantry.addStaple": (_s, [name]) => pantry.addStaple(str(name)),
  "pantry.removeStaples": (_s, [list]) => pantry.removeStaples(ids(list)),
  "pantry.addStock": (_s, [fields]) => pantry.addStockItem(form(obj(fields))),
  "pantry.removeStock": (_s, [list]) => pantry.removeStockItems(ids(list)),
  "pantry.updateStock": (_s, [id, values]) =>
    pantry.updateStockItem(str(id), z.object({
      ingredientName: z.string(), amount: z.string().nullable(), unit: z.string().nullable(),
    }).parse(values)),
  "pantry.addCheckedFromList": (_s, [listId]) => pantry.addCheckedItemsToStock(str(listId)),

  // ── Deliveries ────────────────────────────────────────────────────────────
  "deliveries.overview": () => deliveries.getDeliveryOverview(),
  "deliveries.weekPanel": (_s, [week]) => deliveries.getWeekDeliveryPanel(str(week)),
  "deliveries.setReminders": (_s, [on]) => deliveries.setMyDeliveryReminders(z.boolean().parse(on)),
  "deliveries.saveSettings": (_s, [input]) => deliveries.saveDeliverySettings(obj(input) as never),
  "deliveries.addAway": (_s, [input]) => deliveries.addAwayPeriod(obj(input) as never),
  "deliveries.updateAway": (_s, [original, input]) =>
    deliveries.updateAwayPeriod(obj(original) as never, obj(input) as never),
  "deliveries.removeAway": (_s, [from, to]) => deliveries.removeAwayPeriod(str(from), str(to)),
  "deliveries.set": (_s, [date, target]) => deliveries.setDelivery(str(date), str(target) as never),
  "deliveries.saveOrder": (_s, [date, input]) => deliveries.saveDeliveryOrder(str(date), obj(input) as never),

  // ── Saved meals and meal schedules ────────────────────────────────────────
  "meals.list": (s) => listMeals(s),
  "meals.create": (_s, [input]) => meals.createSavedMeal(obj(input) as never),
  "meals.update": (_s, [id, input]) => meals.updateSavedMeal(str(id), obj(input) as never),
  "meals.delete": (_s, [id]) => meals.deleteSavedMeal(str(id)),
  "meals.saveFromGroup": (_s, [groupId, title]) => meals.saveMealGroupAsMeal(str(groupId), optStr(title)),
  "meals.updateFromGroup": (_s, [groupId]) => meals.updateSavedMealFromGroup(str(groupId)),
  "timeline.get": (_s, [groupId]) => timeline.getMealSchedule(str(groupId)),
  "timeline.setServeAt": (_s, [groupId, at]) => timeline.setMealServeAt(str(groupId), z.string().nullable().parse(at)),
  "timeline.planWithAi": (_s, [groupId]) => timeline.planMealTimelineWithAi(str(groupId)),
  "timeline.clear": (_s, [groupId]) => timeline.clearMealTimeline(str(groupId)),

  // ── Recipes: import and AI tools ──────────────────────────────────────────
  /** The web's paste import: ingredient lines and method text, parsed. */
  "import.parse": async (_s, [ingredientText, methodText]) => {
    const { ingredients, leftoverText } = splitIngredientsText(optStr(ingredientText) ?? "");
    const steps = parseStepsText(optStr(methodText) || leftoverText);
    return { ingredients, steps };
  },
  "ai.improve": async (s, [recipeId, instruction]) => ai.improveRecipe(await asGenerated(s, str(recipeId)), str(instruction)),
  "ai.heartHealthy": async (s, [recipeId]) => ai.makeRecipeHeartHealthy(await asGenerated(s, str(recipeId))),
  "ai.applyTweak": (_s, [recipeId, tweaked]) => recipeActions.applyTweakToRecipe(str(recipeId), obj(tweaked) as never),
  "ai.saveTweakAsCopy": (_s, [recipeId, tweaked]) => recipeActions.saveRecipeAsCopy(str(recipeId), obj(tweaked) as never),
  "ai.estimateNutrition": (_s, [recipeId]) => ai.estimateNutrition(str(recipeId)),
  "ai.similar": (_s, [recipeId, note]) => ai.generateSimilarConcepts(str(recipeId), optStr(note)),
  "ai.sides": (_s, [recipeIds, note]) => ai.generateSideConcepts(ids(recipeIds), optStr(note)),
  "ai.recipeImage": (_s, [recipeId]) => ai.generateAndSaveRecipeImage(str(recipeId)),
  "ai.suggestMealComponents": (_s, [input]) => ai.suggestMealComponents(obj(input) as never),

  // ── Stats, Wrapped, taste, notes ──────────────────────────────────────────
  "stats.report": async (s, [range, personId]) => {
    const report = await getStatsReport(s.householdId, parseRange(optStr(range)), optStr(personId));
    const spend = await getGrocerySpend(s.householdId, report.from, report.to);
    return { report, spend };
  },
  "wrapped.report": (s, [year]) => getWrappedReport(s.householdId, z.number().int().optional().parse(year ?? undefined)),
  "wrapped.recap": (_s, [year, regenerate]) => ai.generateWrappedRecap(z.number().int().parse(year), regenerate === true),
  "taste.get": async (s) => ({
    profile: await taste.getTasteProfile(s.householdId).catch(() => null),
    suggested: await taste.getSuggestedRecipes(s.householdId).catch(() => []),
  }),
  "taste.refresh": (s) => taste.refreshTasteProfile(s.householdId),
  "taste.clear": () => taste.clearTasteProfile(),
  "notes.list": (s) =>
    db.select({ id: notes.id, title: notes.title, body: notes.body, updatedAt: notes.updatedAt,
                recipeId: notes.recipeId, recipeTitle: recipes.title })
      .from(notes).leftJoin(recipes, eq(notes.recipeId, recipes.id))
      .where(eq(notes.householdId, s.householdId)).orderBy(desc(notes.updatedAt)),
  "notes.create": (_s, [fields]) => notesActions.createNote(form(obj(fields))),
  "notes.update": (_s, [id, fields]) => notesActions.updateNote(str(id), form(obj(fields))),
  "notes.delete": (_s, [id]) => notesActions.deleteNote(str(id)),

  // ── Sharing ───────────────────────────────────────────────────────────────
  "share.tokens": () => sharing.getAllShareTokens(),
  "share.recipeTokens": (_s, [recipeId]) => sharing.getRecipeShareTokens(str(recipeId)),
  "share.create": (_s, [recipeId]) => sharing.createShareToken(str(recipeId)),
  "share.revoke": (_s, [tokenId]) => sharing.revokeShareToken(str(tokenId)),
  "share.email": (_s, [recipeId, to]) => sharing.sendRecipeEmail(str(recipeId), z.string().email().parse(to)),
  "library.list": async (s) => {
    const [outgoing, incoming, cols, tags] = await Promise.all([
      listOutgoingLibraryShares(s),
      listIncomingLibraryShares(s),
      db.select({ id: collections.id, name: collections.name, icon: collections.icon })
        .from(collections).where(eq(collections.householdId, s.householdId)).orderBy(asc(collections.name)),
      db.selectDistinct({ tag: recipeTags.tag }).from(recipeTags)
        .innerJoin(recipes, eq(recipes.id, recipeTags.recipeId))
        .where(eq(recipes.householdId, s.householdId)).orderBy(asc(recipeTags.tag)),
    ]);
    return { outgoing, incoming, collections: cols, tags: tags.map((t) => t.tag), isAdmin: s.role === "admin" };
  },
  "library.browse": (s, [shareId]) => getSharedLibrary(s, str(shareId)),
  "library.recipe": (s, [shareId, recipeId]) => getSharedRecipeDetail(s, str(shareId), str(recipeId)),
  "library.create": (_s, [values]) => library.createLibraryShare(obj(values) as never),
  "library.updateScope": (_s, [id, values]) => library.updateLibraryShareScope(str(id), obj(values) as never),
  "library.rotate": (_s, [id]) => library.rotateLibraryInviteCode(str(id)),
  "library.revoke": (_s, [id]) => library.revokeLibraryShareAsOwner(str(id)),
  "library.leave": (_s, [id]) => library.revokeLibraryShareAsGrantee(str(id)),
  "library.redeem": (_s, [code]) => library.redeemLibraryInvite(str(code)),
  "library.import": (_s, [shareId, recipeIds]) => library.importRecipesFromLibrary(str(shareId), ids(recipeIds)),

  // ── Household and settings ────────────────────────────────────────────────
  "household.get": async (s) => ({
    ...(await settings.getHouseholdWithMembers(s.householdId)),
    me: { memberId: s.memberId, role: s.role },
  }),
  "household.rename": (_s, [name]) => settings.updateHouseholdName(form({ name: str(name) })),
  "household.addMember": (_s, [fields]) => settings.addMember(form(obj(fields))),
  "household.setRole": (_s, [memberId, role]) =>
    settings.updateMemberRole(str(memberId), z.enum(["admin", "adult", "child"]).parse(role)),
  "household.removeMember": (_s, [memberId]) => settings.removeMember(str(memberId)),
  "household.setPreferences": (_s, [memberId, data]) => settings.updateMemberPreferences(str(memberId), obj(data) as never),
  "ai.config": (s) => settings.getAiConfig(s.householdId),
  "ai.saveConfig": (_s, [fields]) => settings.saveAiConfig(form(obj(fields))),
};
