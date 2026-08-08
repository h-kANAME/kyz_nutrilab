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

const STOP_WORDS = new Set([
  'de',
  'del',
  'la',
  'el',
  'los',
  'las',
  'un',
  'una',
  'unos',
  'unas',
  'con',
  'y',
  'sin',
  'al',
  'a',
  'en',
  'por',
  'para',
  'the',
]);

/** Forma de producto: bloquea match a bases cocidas/genéricas. */
const FORM_TOKENS = new Set([
  'tostada',
  'tostadas',
  'galleta',
  'galletas',
  'snack',
  'barrita',
  'barritas',
  'cake',
  'cakes',
  'cracker',
  'crackers',
]);

/** Alias de 1 token demasiado genéricos: solo match exacto / query ≈ alias. */
const GENERIC_SINGLE_TOKENS = new Set([
  'arroz',
  'pollo',
  'queso',
  'pan',
  'salmon',
  'cafe',
  'te',
  'agua',
  'huevo',
  'pasta',
  'fideos',
  'carne',
  'pescado',
  'fruta',
  'verdura',
  'aceite',
  'leche',
  'yogur',
  'yogurt',
  'mani',
  'pizza',
  'empanada',
  'helado',
  'quinoa',
  'avena',
]);

const BASE_GRAINS = new Set(['arroz', 'trigo', 'maiz', 'avena', 'quinoa']);

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

function contentTokens(normalized: string): string[] {
  return normalized.split(' ').filter((t) => t && !STOP_WORDS.has(t));
}

function aliasScore(normalizedQuery: string, normalizedAlias: string): number {
  if (!normalizedAlias) return 0;
  if (normalizedQuery === normalizedAlias) return 100;

  const qContent = contentTokens(normalizedQuery);
  const aTokens = normalizedAlias.split(' ').filter(Boolean);
  const aContent = aTokens.filter((t) => !STOP_WORDS.has(t));
  if (aContent.length === 0) return 0;

  const qHasForm = qContent.some((t) => FORM_TOKENS.has(t));
  const aHasForm = aContent.some((t) => FORM_TOKENS.has(t));

  // "tostadas de arroz" no debe matchear arroz cocido / quinoa / etc.
  if (qHasForm && !aHasForm && aContent.some((t) => BASE_GRAINS.has(t))) {
    return 0;
  }

  // Alias de un solo token de contenido
  if (aContent.length === 1) {
    const aTok = aContent[0]!;
    const generic = GENERIC_SINGLE_TOKENS.has(aTok) || aTok.length <= 4;

    // Query ≈ solo ese token (ignora stop words)
    if (qContent.length === 1 && qContent[0] === aTok) return 100;

    if (generic) {
      // Genéricos cortos: prohibido containsAsTokens en queries con más contenido
      if (qContent.length > 1) return 0;
      if (normalizedQuery === aTok) return 100;
      return 0;
    }

    // No genérico de 1 token (ej. "medialuna"): allow containment
    if (containsAsTokens(normalizedQuery, aTok)) {
      if (qContent.length > 1) {
        // Prefer not to steal compound queries unless alias is distinctive (>= 6)
        if (aTok.length < 6) return 0;
        return 55 + Math.min(10, aTok.length);
      }
      return 90;
    }
    return 0;
  }

  // Multi-palabra: alias contenido en query (preferir aliases largos)
  if (containsAsTokens(normalizedQuery, normalizedAlias)) {
    const coverage = normalizedAlias.length / Math.max(normalizedQuery.length, 1);
    return 80 + Math.min(15, normalizedAlias.length) + Math.round(coverage * 4);
  }

  // Query contenido en alias (query corta)
  if (
    containsAsTokens(normalizedAlias, normalizedQuery) &&
    normalizedQuery.length >= 4 &&
    qContent.length >= 1
  ) {
    // "queso" no debe matchear "queso untable light" por contención inversa
    if (qContent.length === 1 && GENERIC_SINGLE_TOKENS.has(qContent[0]!)) {
      if (aContent.length === 1 && aContent[0] === qContent[0]) return 100;
      return 0;
    }
    return 60 + Math.min(19, normalizedQuery.length);
  }

  // Token overlap
  const qSet = new Set(qContent);
  const hit = aContent.filter((t) => qSet.has(t)).length;
  if (hit === 0) return 0;
  const ratio = hit / aContent.length;
  if (ratio < 0.7) return 0;
  if (aContent.length === 1 && aContent[0]!.length < 4) return 0;
  // Exigir que no sea solo un genérico compartido en queries compuestas
  if (qHasForm && !aHasForm && hit === 1 && aContent.some((t) => BASE_GRAINS.has(t))) {
    return 0;
  }
  return Math.round(45 * ratio + Math.min(10, aContent.join(' ').length / 2));
}

function bestAliasScoreForFood(food: CatalogFood, normalizedQuery: string): number {
  const candidates = [food.id.replace(/_/g, ' '), food.displayName, ...food.aliases];
  let best = 0;
  let bestAliasLen = 0;
  for (const alias of candidates) {
    const na = normalizeFoodKey(alias);
    const score = aliasScore(normalizedQuery, na);
    if (score > best || (score === best && na.length > bestAliasLen)) {
      best = score;
      bestAliasLen = na.length;
    }
  }
  return best;
}

/** Hint del LLM solo si el raw_name se parece al alimento del id. */
export function catalogHintPlausible(food: CatalogFood, rawName: string): boolean {
  const q = normalizeFoodKey(rawName);
  if (!q) return false;
  return bestAliasScoreForFood(food, q) >= 45;
}

export type CatalogMatch = {
  food: CatalogFood;
  score: number;
  via: 'id' | 'alias';
};

/**
 * Resuelve un alimento del catálogo por id hint o por nombre libre.
 * Prefiere match por id exacto (validado); si no, el mejor alias por score.
 */
export function matchCatalogFood(
  rawName: string,
  catalogHint?: string | null,
): CatalogMatch | null {
  const q = normalizeFoodKey(rawName);
  if (!q) return null;

  if (catalogHint) {
    const byId = getCatalogFoodById(catalogHint.trim());
    if (byId && catalogHintPlausible(byId, rawName)) {
      return { food: byId, score: 100, via: 'id' };
    }
  }

  let best: CatalogMatch | null = null;
  let bestAliasLen = 0;
  for (const food of catalog.foods) {
    const candidates = [food.id.replace(/_/g, ' '), food.displayName, ...food.aliases];
    for (const alias of candidates) {
      const na = normalizeFoodKey(alias);
      const score = aliasScore(q, na);
      if (score <= 0) continue;
      if (
        !best ||
        score > best.score ||
        (score === best.score && na.length > bestAliasLen)
      ) {
        best = { food, score, via: 'alias' };
        bestAliasLen = na.length;
      }
    }
  }

  if (!best || best.score < 50) return null;
  return best;
}

/** Lista compacta de ids + aliases para el prompt de parse. */
export function catalogHintListForPrompt(): string {
  return catalog.foods
    .map((f) => `- ${f.id}: ${f.displayName} (aliases: ${f.aliases.slice(0, 3).join(', ')})`)
    .join('\n');
}
