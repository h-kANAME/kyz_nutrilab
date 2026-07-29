import {
  mealEstimateSchema,
  type LlmProvider,
  type MealEstimate,
  type ParseImageInput,
  type ParseTextInput,
} from './llm.js';
import { buildMealEstimate, resolveParsedItems, type ParsedMealItem } from './mealResolve.js';

async function fallbackEstimateItems(
  provider: LlmProvider,
  mealType: string,
  unresolved: ParsedMealItem[],
): Promise<MealEstimate['items']> {
  if (unresolved.length === 0) return [];

  const lines = unresolved.map((u) => {
    const qty =
      u.quantity != null && u.unit
        ? `${u.quantity} ${u.unit}`
        : u.quantity != null
          ? String(u.quantity)
          : 'porción típica';
    return `- ${u.raw_name} (${qty})`;
  });

  const estimate = await provider.parseMealText({
    mealType,
    text: `Estimá solo estos alimentos (uno por línea):\n${lines.join('\n')}`,
  });

  return estimate.items;
}

/**
 * Seam canónico: parse LLM → catálogo determinístico → fallback LLM por ítem.
 */
export async function estimateMealText(
  provider: LlmProvider,
  input: ParseTextInput,
): Promise<MealEstimate> {
  const parsed = await provider.parseMealStructure(input);
  const batch = resolveParsedItems(parsed.items);

  const fallbackItems = await fallbackEstimateItems(provider, input.mealType, batch.unresolved);

  if (batch.resolved.length === 0 && fallbackItems.length === 0) {
    // Último recurso: estimación completa del texto original
    return provider.parseMealText(input);
  }

  if (batch.resolved.length === 0) {
    return mealEstimateSchema.parse({
      items: fallbackItems,
      confidence: 0.6,
      notes: 'estimación LLM (sin match de catálogo)',
    });
  }

  return mealEstimateSchema.parse(
    buildMealEstimate(batch.resolved, fallbackItems, {
      catalogConfidence: batch.confidence,
      notes: batch.notes,
      hadFallback: fallbackItems.length > 0,
    }),
  );
}

export async function estimateMealImage(
  provider: LlmProvider,
  input: ParseImageInput,
): Promise<MealEstimate> {
  const parsed = await provider.parseMealStructureFromImage(input);
  const batch = resolveParsedItems(parsed.items);

  const fallbackItems = await fallbackEstimateItems(
    provider,
    input.mealType,
    batch.unresolved,
  );

  if (batch.resolved.length === 0 && fallbackItems.length === 0) {
    return provider.parseMealImage(input);
  }

  if (batch.resolved.length === 0) {
    return mealEstimateSchema.parse({
      items: fallbackItems,
      confidence: 0.55,
      notes: 'estimación LLM desde imagen (sin match de catálogo)',
    });
  }

  return mealEstimateSchema.parse(
    buildMealEstimate(batch.resolved, fallbackItems, {
      catalogConfidence: batch.confidence,
      notes: batch.notes,
      hadFallback: fallbackItems.length > 0,
    }),
  );
}
