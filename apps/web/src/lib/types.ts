export type User = {
  id: string;
  email: string;
  name: string;
  picture: string;
};

export type Settings = {
  edad: number;
  peso: number;
  altura: number;
  sexo: 'M' | 'F';
  deficit: number;
  minimo: number;
  activity_factor: number;
  kcal_gym: number;
  kcal_kick: number;
  kcal_walk: number;
  theme: 'dark' | 'light';
  llm_provider: 'gemini' | 'openai' | 'deepseek';
};

export type LlmProviderInfo = {
  id: 'gemini' | 'openai' | 'deepseek';
  label: string;
  configured: boolean;
  supportsVision: boolean;
};

export type PlanDay = {
  weekday: number;
  mid_label: string;
  late_label: string;
  activity_keys: Array<'kcal_gym' | 'kcal_kick' | 'kcal_walk'>;
  objetivo?: number;
};

export type Meal = {
  id: string;
  meal_type: string;
  label: string;
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  quality_score: number | null;
  quality_note: string | null;
  source: string;
  raw_prompt: string | null;
  image_path: string | null;
  created_at: string;
};

export type DayLog = {
  date: string;
  weight: number | null;
  training: boolean | null;
  notes: string;
  meals: Meal[];
  consumed?: number;
  goal?: number;
  quality_avg?: number | null;
  plan?: PlanDay;
};

export const QUALITY_LABELS: Record<number, string> = {
  1: 'Pobre',
  2: 'Baja',
  3: 'Media',
  4: 'Buena',
  5: 'Óptima',
};

export function qualityTone(score: number | null | undefined): 'poor' | 'mid' | 'good' | 'none' {
  if (score == null) return 'none';
  if (score <= 2) return 'poor';
  if (score < 4) return 'mid';
  return 'good';
}

/** Promedio ponderado por kcal; null si no hay scores AI. */
export function weightedQualityAvg(
  meals: Array<{ kcal: number; quality_score: number | null }>,
): number | null {
  let sum = 0;
  let weight = 0;
  for (const m of meals) {
    if (m.quality_score == null || m.kcal <= 0) continue;
    sum += m.quality_score * m.kcal;
    weight += m.kcal;
  }
  if (weight <= 0) return null;
  return Math.round((sum / weight) * 10) / 10;
}

export const MEAL_TYPES = [
  'Desayuno',
  'Media mañana',
  'Almuerzo',
  'Merienda',
  'Cena',
  'Extra',
] as const;

export const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
export const DIAS_FULL = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(dateKey: string, n: number): string {
  const d = new Date(dateKey + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return todayKey(d);
}

/** Monday of the ISO week containing dateKey */
export function weekStart(dateKey: string): string {
  const d = new Date(dateKey + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return todayKey(d);
}

export function weekEnd(start: string): string {
  return addDays(start, 6);
}

export function formatWeekLabel(start: string): string {
  const end = weekEnd(start);
  const a = new Date(start + 'T12:00:00');
  const b = new Date(end + 'T12:00:00');
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  return `${a.toLocaleDateString('es-AR', opts)} – ${b.toLocaleDateString('es-AR', opts)}`;
}
