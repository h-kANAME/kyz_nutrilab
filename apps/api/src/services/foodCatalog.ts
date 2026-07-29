import catalogJson from '../data/food-catalog.json' with { type: 'json' };

export type FoodUnit = 'g' | 'ml' | 'unit' | 'serving';

export type CatalogFood = {
  id: string;
  aliases: string[];
  displayName: string;
  defaultQty: number;
  unit: FoodUnit;
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  quality_score: number;
  quality_note: string | null;
  /** Si está, escalar desde este alimento (ej. omelette → huevo_duro). */
  scaleBaseId?: string;
};

type CatalogFile = {
  version: string;
  foods: CatalogFood[];
};

const catalog = catalogJson as CatalogFile;

export const FOOD_CATALOG_VERSION = catalog.version;

export function listCatalogFoods(): CatalogFood[] {
  return catalog.foods;
}

export function getCatalogFoodById(id: string): CatalogFood | undefined {
  return catalog.foods.find((f) => f.id === id);
}

/** Normaliza para match: minúsculas, sin acentos, colapsa espacios. */
export function normalizeFoodKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9+\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsAsTokens(haystack: string, needle: string): boolean {
  if (!needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

function aliasScore(normalizedQuery: string, normalizedAlias: string): number {
  if (!normalizedAlias) return 0;
  if (normalizedQuery === normalizedAlias) return 100;
  if (containsAsTokens(normalizedQuery, normalizedAlias)) {
    return 80 + Math.min(19, normalizedAlias.length);
  }
  if (containsAsTokens(normalizedAlias, normalizedQuery) && normalizedQuery.length >= 4) {
    return 60 + Math.min(19, normalizedQuery.length);
  }
  // token overlap
  const qTokens = new Set(normalizedQuery.split(' ').filter(Boolean));
  const aTokens = normalizedAlias.split(' ').filter(Boolean);
  if (aTokens.length === 0) return 0;
  const hit = aTokens.filter((t) => qTokens.has(t)).length;
  if (hit === 0) return 0;
  const ratio = hit / aTokens.length;
  if (ratio < 0.7) return 0;
  // Require at least 2 tokens for multi-word aliases, or exact token for single
  if (aTokens.length === 1 && aTokens[0]!.length < 4) return 0;
  return Math.round(45 * ratio);
}

export type CatalogMatch = {
  food: CatalogFood;
  score: number;
  via: 'id' | 'alias';
};

/**
 * Resuelve un alimento del catálogo por id hint o por nombre libre.
 * Prefiere match por id exacto; si no, el mejor alias por score.
 */
export function matchCatalogFood(
  rawName: string,
  catalogHint?: string | null,
): CatalogMatch | null {
  if (catalogHint) {
    const byId = getCatalogFoodById(catalogHint.trim());
    if (byId) return { food: byId, score: 100, via: 'id' };
  }

  const q = normalizeFoodKey(rawName);
  if (!q) return null;

  let best: CatalogMatch | null = null;
  for (const food of catalog.foods) {
    // Also score displayName and id as soft aliases
    const candidates = [food.id.replace(/_/g, ' '), food.displayName, ...food.aliases];
    for (const alias of candidates) {
      const score = aliasScore(q, normalizeFoodKey(alias));
      if (score <= 0) continue;
      if (!best || score > best.score) {
        best = { food, score, via: 'alias' };
      }
    }
  }

  // Umbral: evitar falsos positivos en queries cortas/genéricas
  if (!best || best.score < 50) return null;
  return best;
}

/** Lista compacta de ids + aliases para el prompt de parse. */
export function catalogHintListForPrompt(): string {
  return catalog.foods
    .map((f) => `- ${f.id}: ${f.displayName} (aliases: ${f.aliases.slice(0, 3).join(', ')})`)
    .join('\n');
}
