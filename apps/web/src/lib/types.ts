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
  onboarding_done?: boolean;
  plan_onboarding_done?: boolean;
};

export type UserActivity = {
  id: string;
  key: string;
  label: string;
  kcal: number;
  is_builtin: boolean;
  sort_order: number;
};

export type NotificationPrefs = {
  enabled: boolean;
  remind_meals: boolean;
  remind_training: boolean;
  remind_weight: boolean;
  meal_times: string[];
  training_time: string;
  weight_time: string;
};

export type NotificationStatus = {
  configured: boolean;
  publicKey: string | null;
  subscriptionCount: number;
  prefs: NotificationPrefs;
  schedule?: {
    timezone: string;
    meals: Array<{ time: string; body: string }>;
    training: { time: string; body: string };
    weight: { time: string; body: string };
    tickHint: string;
  };
};

export type LlmProviderInfo = {
  id: 'gemini' | 'openai' | 'deepseek';
  label: string;
  configured: boolean;
  supportsVision: boolean;
};

export type ActivitySlot = {
  key: string;
  label: string;
  time: string;
};

export type PlanDay = {
  weekday: number;
  mid_label: string;
  late_label: string;
  activity_keys: string[];
  activity_slots?: ActivitySlot[];
  objetivo?: number;
};

export function formatActivitySlot(slot: ActivitySlot): string {
  return slot.time ? `${slot.label} ${slot.time}` : slot.label;
}

export function formatPlanDay(plan: PlanDay): string {
  const slots = plan.activity_slots ?? [];
  if (slots.length > 0) return slots.map(formatActivitySlot).join(' · ');
  if (plan.activity_keys.length === 0) return 'Descanso';
  const mid = plan.mid_label && plan.mid_label !== '-' ? plan.mid_label : '';
  const late = plan.late_label || '';
  return [mid, late].filter(Boolean).join(' · ') || 'Descanso';
}

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

/** Fundamentos de quality_score (mismo criterio que mealPrompt del API). */
export const QUALITY_SCALE: ReadonlyArray<{
  score: 1 | 2 | 3 | 4 | 5;
  label: string;
  criteria: string;
  examples: string;
}> = [
  {
    score: 5,
    label: QUALITY_LABELS[5],
    criteria: 'Magro, alta proteína, mínima ultraprocesación.',
    examples: 'Pechuga a la plancha, claras, atún natural, verduras.',
  },
  {
    score: 4,
    label: QUALITY_LABELS[4],
    criteria: 'Proteína sólida o preparación limpia.',
    examples: 'Café con leche descremada, yogur natural, whey, salmón.',
  },
  {
    score: 3,
    label: QUALITY_LABELS[3],
    criteria: 'Neutro o mixto.',
    examples: 'Arroz, banana, leche entera, aceite moderado.',
  },
  {
    score: 2,
    label: QUALITY_LABELS[2],
    criteria: 'Empanado, fritura, refinados o azúcares.',
    examples: 'Milanesa frita, pan, pizza, empanada.',
  },
  {
    score: 1,
    label: QUALITY_LABELS[1],
    criteria: 'Ultraprocesado, fritura profunda o snacks dulces.',
    examples: 'Gaseosa azucarada, medialunas, helado, papas fritas.',
  },
];

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
