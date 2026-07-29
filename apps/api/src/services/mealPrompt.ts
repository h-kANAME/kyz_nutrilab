import { catalogHintListForPrompt } from './foodCatalog.js';

/**
 * Prompt canónico compartido por todos los proveedores LLM.
 * Las porciones/kcal viven en food-catalog.json; el LLM solo identifica ítems.
 */
export const MEAL_PROMPT_VERSION = '2026-07-29-v5-parse';

/** Prompt de identificación (sin kcal): el cálculo lo hace el catálogo. */
export function buildParseSystemPrompt(): string {
  const catalogList = catalogHintListForPrompt();
  return `Sos el parser de comidas de KYZ NutriLab.
Tu ÚNICO trabajo es identificar alimentos y cantidades. NO estimés kcal ni macros.

Respondé SOLO JSON válido (sin markdown) con exactamente esta forma:
{"items":[{"raw_name":"string","catalog_hint":"string|null","quantity":number|null,"unit":"g"|"ml"|"unit"|"serving"|null}]}

REGLAS DURAS:
1) Un ítem por alimento/plato descrito. No inventes extras no mencionados.
2) Si el texto nombra varios alimentos, devolvé un item por cada uno.
3) quantity/unit: solo si el usuario indica cantidad explícita (ej. "300 ml", "200 g", "2 huevos"). Si no indica, quantity=null y unit=null.
4) catalog_hint: si el alimento coincide con el catálogo abajo, poné el id exacto. Si no estás seguro, null.
5) raw_name: nombre corto en español del alimento mencionado.
6) Para omelette de N huevos: catalog_hint="omelette", quantity=N, unit="unit".
7) Unidades: g (gramos), ml, unit (unidades/fetas/scoops/huevos), serving (plato/porción genérica).

CATÁLOGO (ids válidos para catalog_hint):
${catalogList}`;
}

/** Prompt de fallback solo cuando el alimento no está en catálogo. */
export const FALLBACK_ESTIMATE_PROMPT = `Sos el estimador nutricional de respaldo de KYZ NutriLab.
Objetivo del usuario: cuerpo atlético y tonificado (alta proteína, baja ultraprocesación).
Respondé SOLO JSON válido (sin markdown) con exactamente esta forma:
{"items":[{"name":"string","kcal":number,"protein":number|null,"carbs":number|null,"fat":number|null,"quality_score":1-5,"quality_note":"string|null"}],"confidence":0-1,"notes":"string|null"}

REGLAS:
1) Un ítem por alimento. No inventes extras.
2) Si no hay cantidad, asumí una porción típica argentina y documentala en notes.
3) Redondeá kcal al entero. Macros en g enteros o un decimal.
4) quality_score 1-5: 5=magro/alta proteína/limpia; 4=bueno; 3=neutro; 2=fritura/refinado; 1=ultraprocesado.
5) Estimá con densidades típicas (kcal/100 g). Un solo número de kcal (sin rangos).
confidence: 0.55–0.75.`;

/** Temperatura fija para máxima consistencia entre proveedores. */
export const MEAL_LLM_TEMPERATURE = 0;

/** @deprecated Usar buildParseSystemPrompt; se mantiene alias para imports antiguos. */
export const SYSTEM_PROMPT = FALLBACK_ESTIMATE_PROMPT;
