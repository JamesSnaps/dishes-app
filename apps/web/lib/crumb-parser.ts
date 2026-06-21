import type { ParsedIngredient, ParsedStep } from "./recipe-parser";

// ─── Raw Crumb types ─────────────────────────────────────────────────────────

interface CrumbQuantity {
  amount?: number;
  quantityType?: string;
}

interface CrumbIngredient {
  order: number;
  uuid: string;
  ingredient: { uuid: string; name: string };
  quantity?: CrumbQuantity;
}

interface CrumbStep {
  order: number;
  uuid: string;
  step: string;
  isSection: boolean;
}

interface CrumbFile {
  uuid?: string;
  name: string;
  sourceImage?: string;
  images?: string[];
  ingredients?: CrumbIngredient[];
  steps?: CrumbStep[];
  cookingDuration?: number;
  duration?: number;
  defaultScale?: number;
  serves?: number;
  sourceName?: string;
  webLink?: string;
  tags?: string[];
  neutritionalInfo?: string;
}

// ─── Parsed output ────────────────────────────────────────────────────────────

export interface ParsedCrumbRecipe {
  title: string;
  sourceUrl: string | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  servings: string | null;
  ingredients: ParsedIngredient[];
  steps: ParsedStep[];
  tags: string[];
  notes: string | null;
  /** Base64 JPEG string (no data: prefix) from the first available image */
  imageBase64: string | null;
}

// ─── Unit mapping ─────────────────────────────────────────────────────────────

const UNIT_MAP: Record<string, string> = {
  GRAMS: "g",
  KILOGRAMS: "kg",
  MILLILITERS: "ml",
  MILLILITRES: "ml",
  LITERS: "l",
  LITRES: "l",
  TEASPOON: "tsp",
  TABLESPOON: "tbsp",
  CUP: "cup",
  CUPS: "cup",
  OUNCE: "oz",
  OUNCES: "oz",
  POUND: "lb",
  POUNDS: "lb",
  PINCH: "pinch",
  SLICE: "slice",
  ITEM: "",
  ITEMS: "",
  PIECE: "",
  PIECES: "",
  HANDFUL: "handful",
  BUNCH: "bunch",
  CLOVE: "clove",
  CLOVES: "clove",
  SPRIG: "sprig",
  SPRIGS: "sprig",
  SHEET: "sheet",
  CAN: "can",
  CANS: "can",
  JAR: "jar",
};

function mapUnit(quantityType: string | undefined): string {
  if (!quantityType) return "";
  return UNIT_MAP[quantityType.toUpperCase()] ?? quantityType.toLowerCase();
}

// ─── Ingredient parsing ───────────────────────────────────────────────────────

function parseIngredientName(raw: string): { name: string; preparation: string } {
  // Crumb often bakes prep notes into the name: "egg , beaten" or "garlic, minced"
  const commaIdx = raw.search(/\s*,\s*/);
  if (commaIdx === -1) return { name: raw.trim(), preparation: "" };
  return {
    name: raw.slice(0, commaIdx).trim(),
    preparation: raw.slice(commaIdx).replace(/^\s*,\s*/, "").trim(),
  };
}

function mapIngredients(raw: CrumbIngredient[]): ParsedIngredient[] {
  return [...raw]
    .sort((a, b) => a.order - b.order)
    .map((ci) => {
      const { name, preparation } = parseIngredientName(ci.ingredient.name);
      const amount = ci.quantity?.amount != null ? String(ci.quantity.amount) : "";
      const unit = mapUnit(ci.quantity?.quantityType);
      return {
        ingredientName: name,
        amount,
        unit,
        preparation,
        isOptional: false,
        groupLabel: "",
      };
    });
}

// ─── Step parsing ─────────────────────────────────────────────────────────────

function mapSteps(raw: CrumbStep[]): ParsedStep[] {
  return [...raw]
    .sort((a, b) => a.order - b.order)
    .filter((s) => !s.isSection)
    .map((s) => ({
      instruction: s.step.trim(),
      durationMinutes: "",
      timerLabel: "",
      groupLabel: "",
    }));
}

// ─── Time mapping ─────────────────────────────────────────────────────────────

function mapTimes(crumb: CrumbFile): { prepTimeMinutes: number | null; cookTimeMinutes: number | null } {
  const cook = crumb.cookingDuration ?? null;
  const total = crumb.duration ?? null;
  if (cook != null && total != null && total > cook) {
    return { prepTimeMinutes: total - cook, cookTimeMinutes: cook };
  }
  if (cook != null) return { prepTimeMinutes: null, cookTimeMinutes: cook };
  if (total != null) return { prepTimeMinutes: null, cookTimeMinutes: total };
  return { prepTimeMinutes: null, cookTimeMinutes: null };
}

// ─── Image extraction ─────────────────────────────────────────────────────────

function extractImageBase64(crumb: CrumbFile): string | null {
  // Prefer first entry in images[], fall back to sourceImage
  const raw = crumb.images?.[0] ?? crumb.sourceImage ?? null;
  if (!raw) return null;
  // Strip data URI prefix if present
  return raw.replace(/^data:image\/[^;]+;base64,/, "");
}

// ─── Servings ─────────────────────────────────────────────────────────────────

function mapServings(crumb: CrumbFile): string | null {
  if (crumb.serves == null) return null;
  // defaultScale is a UI preference in Crouton (the default display scale), not a data multiplier.
  // Ingredient amounts in the file are always at 1× scale corresponding to `serves`.
  return String(crumb.serves);
}

// ─── Main parse function ──────────────────────────────────────────────────────

export function parseCrumbFile(json: string): ParsedCrumbRecipe {
  const crumb: CrumbFile = JSON.parse(json);
  const { prepTimeMinutes, cookTimeMinutes } = mapTimes(crumb);

  return {
    title: crumb.name?.trim() ?? "Untitled",
    sourceUrl: crumb.webLink ?? null,
    prepTimeMinutes,
    cookTimeMinutes,
    servings: mapServings(crumb),
    ingredients: mapIngredients(crumb.ingredients ?? []),
    steps: mapSteps(crumb.steps ?? []),
    tags: crumb.tags ?? [],
    notes: crumb.neutritionalInfo?.trim() || null,
    imageBase64: extractImageBase64(crumb),
  };
}
