import { z } from 'zod';
import type { Env } from '../config/env.js';

export const mealEstimateSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        kcal: z.coerce.number().positive().max(10000),
        protein: z.coerce.number().min(0).max(1000).optional().nullable(),
        carbs: z.coerce.number().min(0).max(1000).optional().nullable(),
        fat: z.coerce.number().min(0).max(1000).optional().nullable(),
        quality_score: z.coerce.number().int().min(1).max(5),
        quality_note: z.string().max(240).optional().nullable(),
      }),
    )
    .min(1)
    .max(20),
  confidence: z.coerce.number().min(0).max(1).optional(),
  notes: z.string().max(500).optional().nullable(),
});

export type MealEstimate = z.infer<typeof mealEstimateSchema>;

export type ParseTextInput = {
  mealType: string;
  text: string;
};

export type ParseImageInput = {
  mealType: string;
  text?: string;
  mimeType: string;
  base64: string;
};

export interface LlmProvider {
  name: string;
  model: string;
  parseMealText(input: ParseTextInput): Promise<MealEstimate>;
  parseMealImage(input: ParseImageInput): Promise<MealEstimate>;
}

const SYSTEM_PROMPT = `Sos un nutricionista asistente orientado a composición corporal esbelta y tonificada.
Dado un alimento o comida en español, estimá valores nutricionales de la porción descrita Y discriminá la calidad de esas calorías (no todas las kcal son iguales).

Respondé SOLO JSON válido con esta forma:
{"items":[{"name":"string","kcal":number,"protein":number|null,"carbs":number|null,"fat":number|null,"quality_score":1-5,"quality_note":"string|null"}],"confidence":0-1,"notes":"string|null"}

quality_score (obligatorio por ítem), criterio para cuerpo esbelto/tonificado:
5 = magro + denso en proteína, mínima ultraprocesación (ej. pechuga a la plancha, pescado, claras, verduras).
4 = bueno: proteína sólida, preparación limpia, poco aceite/fritura.
3 = neutro/mixto: aceptable pero no óptimo (ej. arroz con guarnición frita parcial, yogurt azucarado moderado).
2 = poco favorable: empanado, fritura, refinados, azúcares, embutidos grasos (ej. milanesa con pan rallado frita).
1 = dañino para el objetivo: ultraprocesado, fritura profunda + harinas, gaseosas, snacks, alcohol calórico.

quality_note: 1 frase corta en español explicando por qué (ej. "frita y empanada: más grasa inflamatoria y menos densidad proteica").
Misma kcal puede tener scores muy distintos: pechuga seca ≠ milanesa empanada.
No inventes unidades raras. Si la porción es ambigua, asumí una porción típica y aclaralo en notes.`;

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1].trim() : trimmed;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('LLM did not return JSON');
  return JSON.parse(raw.slice(start, end + 1));
}

function parseEstimate(raw: unknown): MealEstimate {
  return mealEstimateSchema.parse(raw);
}

async function geminiGenerate(
  apiKey: string,
  model: string,
  parts: Array<Record<string, unknown>>,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini error ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text) throw new Error('Empty Gemini response');
  return text;
}

function createGemini(env: Env): LlmProvider {
  const model = env.GEMINI_MODEL;
  return {
    name: 'gemini',
    model,
    async parseMealText(input) {
      const prompt = `Tipo de comida: ${input.mealType}\nDescripción del usuario:\n${input.text}`;
      const text = await geminiGenerate(env.GEMINI_API_KEY, model, [{ text: prompt }]);
      return parseEstimate(extractJson(text));
    },
    async parseMealImage(input) {
      const prompt = `Tipo de comida: ${input.mealType}\nContexto: ${input.text ?? 'Analizá la imagen de la porción.'}`;
      const text = await geminiGenerate(env.GEMINI_API_KEY, model, [
        { text: prompt },
        { inlineData: { mimeType: input.mimeType, data: input.base64 } },
      ]);
      return parseEstimate(extractJson(text));
    },
  };
}

async function openAiChat(
  apiKey: string,
  baseUrl: string,
  model: string,
  messages: Array<{ role: string; content: unknown }>,
): Promise<string> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI-compatible error ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error('Empty LLM response');
  return text;
}

function createOpenAiCompatible(
  name: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  supportsVision: boolean,
): LlmProvider {
  return {
    name,
    model,
    async parseMealText(input) {
      const text = await openAiChat(apiKey, baseUrl, model, [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Tipo de comida: ${input.mealType}\nDescripción:\n${input.text}`,
        },
      ]);
      return parseEstimate(extractJson(text));
    },
    async parseMealImage(input) {
      if (!supportsVision) {
        throw new Error(`${name} no soporta visión en esta configuración`);
      }
      const text = await openAiChat(apiKey, baseUrl, model, [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Tipo de comida: ${input.mealType}\nContexto: ${input.text ?? 'Analizá la porción de la imagen.'}`,
            },
            {
              type: 'image_url',
              image_url: { url: `data:${input.mimeType};base64,${input.base64}` },
            },
          ],
        },
      ]);
      return parseEstimate(extractJson(text));
    },
  };
}

export type LlmProviderName = 'gemini' | 'openai' | 'deepseek';

export type AvailableLlm = {
  id: LlmProviderName;
  label: string;
  configured: boolean;
  supportsVision: boolean;
};

export function listAvailableLlms(env: Env): AvailableLlm[] {
  return [
    {
      id: 'gemini',
      label: 'Google Gemini',
      configured: Boolean(env.GEMINI_API_KEY),
      supportsVision: true,
    },
    {
      id: 'openai',
      label: 'OpenAI',
      configured: Boolean(env.OPENAI_API_KEY),
      supportsVision: true,
    },
    {
      id: 'deepseek',
      label: 'DeepSeek',
      configured: Boolean(env.DEEPSEEK_API_KEY),
      supportsVision: false,
    },
  ];
}

export function createLlmProvider(env: Env, providerName?: LlmProviderName): LlmProvider {
  const name = providerName ?? env.LLM_PROVIDER;
  switch (name) {
    case 'gemini':
      if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY no configurada');
      return createGemini(env);
    case 'openai':
      if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY no configurada');
      return createOpenAiCompatible(
        'openai',
        env.OPENAI_API_KEY,
        'https://api.openai.com/v1',
        env.OPENAI_MODEL,
        true,
      );
    case 'deepseek':
      if (!env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY no configurada');
      return createOpenAiCompatible(
        'deepseek',
        env.DEEPSEEK_API_KEY,
        'https://api.deepseek.com/v1',
        env.DEEPSEEK_MODEL,
        false,
      );
    default:
      throw new Error(`Proveedor LLM desconocido: ${name}`);
  }
}

/** Mensaje seguro para el cliente (sin keys). */
export function publicAiError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/429|quota|rate.?limit/i.test(raw)) {
    return 'Cuota del proveedor LLM agotada. Probá otro LLM en Ajustes o esperá un rato.';
  }
  if (/401|403|invalid.?api.?key|incorrect api key/i.test(raw)) {
    return 'API key del proveedor LLM inválida o sin permiso.';
  }
  if (/no soporta visión/i.test(raw)) {
    return raw;
  }
  if (/ZodError|Validation/i.test(raw) || (err as { name?: string })?.name === 'ZodError') {
    return 'El modelo devolvió un formato inesperado. Reintentá con otra descripción.';
  }
  if (/did not return JSON|Empty /i.test(raw)) {
    return 'El modelo no devolvió una respuesta usable. Reintentá.';
  }
  return raw.length > 180 ? `${raw.slice(0, 180)}…` : raw;
}
