import {
  getCatalogFoodById,
  matchCatalogFood,
  type CatalogFood,
  type FoodUnit,
} from './foodCatalog.js';
import type { MealEstimate } from './llm.js';

export type ParsedMealItem = {
  raw_name: string;
  catalog_hint?: string | null;
  quantity?: number | null;
  unit?: string | null;
};

export type ResolvedItem = MealEstimate['items'][number] & {
  source: 'catalog' | 'unresolved';
  catalog_id?: string;
  macro_coherence_ok: boolean;
};

function roundMacro(n: number | null | undefined): number | null {
  if (n == null || Number.isNaN(n)) return null;
  return Math.round(n * 10) / 10;
}

function scaleValue(
  base: number | null | undefined,
  qty: number,
  defaultQty: number,
): number | null {
  if (base == null) return null;
  if (defaultQty <= 0) return base;
  return (base * qty) / defaultQty;
}

function normalizeUnit(unit: string | null | undefined): FoodUnit | null {
  if (!unit) return null;
  const u = unit.trim().toLowerCase();
  if (u === 'g' || u === 'gr' || u === 'gramo' || u === 'gramos') return 'g';
  if (u === 'ml' || u === 'cc') return 'ml';
  if (
    u === 'unit' ||
    u === 'unidad' ||
    u === 'unidades' ||
    u === 'u' ||
    u === 'huevo' ||
    u === 'huevos' ||
    u === 'feta' ||
    u === 'fetas' ||
    u === 'scoop' ||
    u === 'scoops' ||
    u === 'porcion' ||
    u === 'porción'
  ) {
    return 'unit';
  }
  if (u === 'serving' || u === 'plato' || u === 'taza') return 'serving';
  return null;
}

/** Extrae cantidad del texto libre si el LLM no la mandó en campos separados. */
export function extractQuantityFromText(
  text: string,
): { quantity: number; unit: FoodUnit } | null {
  const t = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

  const ml = t.match(/(\d+(?:[.,]\d+)?)\s*ml\b/);
  if (ml) return { quantity: Number(ml[1]!.replace(',', '.')), unit: 'ml' };

  const g = t.match(/(\d+(?:[.,]\d+)?)\s*(?:g|gr|gramos?)\b/);
  if (g) return { quantity: Number(g[1]!.replace(',', '.')), unit: 'g' };

  const eggs = t.match(/(\d+)\s*huevos?\b/);
  if (eggs) return { quantity: Number(eggs[1]), unit: 'unit' };

  const omelette = t.match(/omelette\s+de\s+(\d+)/);
  if (omelette) return { quantity: Number(omelette[1]), unit: 'unit' };

  const fetas = t.match(/(\d+)\s*fetas?\b/);
  if (fetas) return { quantity: Number(fetas[1]), unit: 'unit' };

  return null;
}

function unitsCompatible(foodUnit: FoodUnit, parsed: FoodUnit | null): boolean {
  if (!parsed) return true;
  if (foodUnit === parsed) return true;
  // unit/serving are interchangeable for piece-like foods
  if (
    (foodUnit === 'unit' || foodUnit === 'serving') &&
    (parsed === 'unit' || parsed === 'serving')
  ) {
    return true;
  }
  return false;
}

function macroCoherenceOk(
  kcal: number,
  protein: number | null,
  carbs: number | null,
  fat: number | null,
): boolean {
  if (protein == null || carbs == null || fat == null) return true;
  const expected = 4 * protein + 4 * carbs + 9 * fat;
  if (expected <= 0) return true;
  return Math.abs(kcal - expected) / Math.max(kcal, expected) <= 0.25;
}

function applyScale(food: CatalogFood, qty: number): ResolvedItem {
  const kcal = Math.round(scaleValue(food.kcal, qty, food.defaultQty) ?? food.kcal);
  const protein = roundMacro(scaleValue(food.protein, qty, food.defaultQty));
  const carbs = roundMacro(scaleValue(food.carbs, qty, food.defaultQty));
  const fat = roundMacro(scaleValue(food.fat, qty, food.defaultQty));
  return {
    name: food.displayName,
    kcal,
    protein,
    carbs,
    fat,
    quality_score: food.quality_score,
    quality_note: food.quality_note,
    source: 'catalog',
    catalog_id: food.id,
    macro_coherence_ok: macroCoherenceOk(kcal, protein, carbs, fat),
  };
}

/**
 * Resuelve un ítem parseado contra el catálogo.
 * Devuelve null si no hay match (caller debe hacer fallback LLM).
 */
export function resolveParsedItem(item: ParsedMealItem): ResolvedItem | null {
  const match = matchCatalogFood(item.raw_name, item.catalog_hint);
  if (!match) return null;

  let food = match.food;
  const fromText =
    item.quantity == null || item.unit == null
      ? extractQuantityFromText(item.raw_name)
      : null;
  const parsedUnit = normalizeUnit(item.unit ?? fromText?.unit ?? null);
  let qty =
    item.quantity != null && Number.isFinite(item.quantity) && item.quantity > 0
      ? item.quantity
      : fromText?.quantity != null
        ? fromText.quantity
        : food.defaultQty;

  // Omelette / derivados: escalar desde alimento base (huevo)
  if (food.scaleBaseId) {
    const base = getCatalogFoodById(food.scaleBaseId);
    if (base) {
      const displayName =
        item.quantity != null || fromText?.quantity != null
          ? `Omelette de ${qty} huevos sin aceite`
          : match.food.displayName;
      return applyScale(
        {
          ...base,
          displayName,
          quality_score: match.food.quality_score,
          quality_note: match.food.quality_note,
          id: match.food.id,
        },
        qty,
      );
    }
  }

  if (parsedUnit && !unitsCompatible(food.unit, parsedUnit)) {
    // Cantidad en unidad incompatible: usar default del catálogo
    qty = food.defaultQty;
  }

  return applyScale(food, qty);
}

export type ResolveBatchResult = {
  resolved: ResolvedItem[];
  unresolved: ParsedMealItem[];
  confidence: number;
  notes: string | null;
};

export function resolveParsedItems(items: ParsedMealItem[]): ResolveBatchResult {
  const resolved: ResolvedItem[] = [];
  const unresolved: ParsedMealItem[] = [];

  for (const item of items) {
    const r = resolveParsedItem(item);
    if (r) resolved.push(r);
    else unresolved.push(item);
  }

  const allCatalog = unresolved.length === 0 && resolved.length > 0;
  const partial = resolved.length > 0 && unresolved.length > 0;
  const confidence = allCatalog ? 0.95 : partial ? 0.75 : 0.55;

  const incoherents = resolved.filter((r) => !r.macro_coherence_ok);
  const notesParts: string[] = [];
  if (allCatalog) notesParts.push('kcal desde catálogo canónico AR');
  if (incoherents.length > 0) {
    notesParts.push(
      `aviso coherencia macros en: ${incoherents.map((i) => i.name).join(', ')}`,
    );
  }

  return {
    resolved,
    unresolved,
    confidence,
    notes: notesParts.length ? notesParts.join('; ') : null,
  };
}

/** Convierte ítems resueltos + fallbacks en MealEstimate final. */
export function buildMealEstimate(
  catalogItems: ResolvedItem[],
  fallbackItems: MealEstimate['items'],
  opts: { catalogConfidence: number; notes: string | null; hadFallback: boolean },
): MealEstimate {
  const items = [
    ...catalogItems.map(({ source: _s, catalog_id: _c, macro_coherence_ok: _m, ...rest }) => rest),
    ...fallbackItems,
  ];

  const confidence = opts.hadFallback
    ? Math.min(opts.catalogConfidence, 0.7)
    : opts.catalogConfidence;

  const noteParts = [opts.notes];
  if (opts.hadFallback) noteParts.push('algunos ítems estimados por LLM (fuera de catálogo)');

  return {
    items,
    confidence,
    notes: noteParts.filter(Boolean).join('; ') || null,
  };
}
