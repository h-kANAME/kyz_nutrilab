import { z } from 'zod';
import type { Db } from '../db/index.js';
import { newId } from '../db/index.js';

export const MEAL_TYPES = [
  'Desayuno',
  'Media mañana',
  'Almuerzo',
  'Merienda',
  'Cena',
  'Extra',
] as const;

export const settingsSchema = z.object({
  edad: z.number().int().min(10).max(120),
  peso: z.number().positive().max(400),
  altura: z.number().int().min(80).max(250),
  sexo: z.enum(['M', 'F']),
  deficit: z.number().int().min(0).max(2000),
  minimo: z.number().int().min(800).max(6000),
  activity_factor: z.number().min(1).max(2.5),
  kcal_gym: z.number().int().min(0).max(3000),
  kcal_kick: z.number().int().min(0).max(3000),
  kcal_walk: z.number().int().min(0).max(3000),
  theme: z.enum(['dark', 'light']),
  llm_provider: z.enum(['gemini', 'openai', 'deepseek']),
});

export type Settings = z.infer<typeof settingsSchema>;

export const planDaySchema = z.object({
  weekday: z.number().int().min(0).max(6),
  mid_label: z.string().max(120),
  late_label: z.string().max(120),
  activity_keys: z.array(z.enum(['kcal_gym', 'kcal_kick', 'kcal_walk'])),
});

export const planSchema = z.object({
  days: z.array(planDaySchema).length(7),
});

export function getSettings(db: Db, userId: string): Settings {
  const row = db
    .prepare(
      `SELECT edad, peso, altura, sexo, deficit, minimo, activity_factor,
              kcal_gym, kcal_kick, kcal_walk, theme, llm_provider
       FROM user_settings WHERE user_id = ?`,
    )
    .get(userId) as Settings & { llm_provider?: string; activity_factor?: number };
  return {
    ...row,
    activity_factor: row.activity_factor ?? 1.2,
    llm_provider: (row.llm_provider as Settings['llm_provider']) || 'gemini',
  };
}

export function updateSettings(db: Db, userId: string, data: Settings): Settings {
  db.prepare(
    `UPDATE user_settings SET
      edad = ?, peso = ?, altura = ?, sexo = ?, deficit = ?, minimo = ?, activity_factor = ?,
      kcal_gym = ?, kcal_kick = ?, kcal_walk = ?, theme = ?, llm_provider = ?,
      updated_at = datetime('now')
     WHERE user_id = ?`,
  ).run(
    data.edad,
    data.peso,
    data.altura,
    data.sexo,
    data.deficit,
    data.minimo,
    data.activity_factor,
    data.kcal_gym,
    data.kcal_kick,
    data.kcal_walk,
    data.theme,
    data.llm_provider,
    userId,
  );
  return getSettings(db, userId);
}

export function getPlan(db: Db, userId: string) {
  const rows = db
    .prepare(
      `SELECT weekday, mid_label, late_label, activity_keys
       FROM plan_days WHERE user_id = ? ORDER BY weekday`,
    )
    .all(userId) as Array<{
    weekday: number;
    mid_label: string;
    late_label: string;
    activity_keys: string;
  }>;

  return rows.map((r) => ({
    weekday: r.weekday,
    mid_label: r.mid_label,
    late_label: r.late_label,
    activity_keys: JSON.parse(r.activity_keys) as string[],
  }));
}

export function updatePlan(
  db: Db,
  userId: string,
  days: z.infer<typeof planSchema>['days'],
) {
  const upsert = db.prepare(
    `INSERT INTO plan_days (user_id, weekday, mid_label, late_label, activity_keys)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, weekday) DO UPDATE SET
       mid_label = excluded.mid_label,
       late_label = excluded.late_label,
       activity_keys = excluded.activity_keys`,
  );
  const tx = db.transaction(() => {
    for (const d of days) {
      upsert.run(userId, d.weekday, d.mid_label, d.late_label, JSON.stringify(d.activity_keys));
    }
  });
  tx();
  return getPlan(db, userId);
}

export function computeTmb(s: Settings): number {
  return 10 * s.peso + 6.25 * s.altura - 5 * s.edad + (s.sexo === 'M' ? 5 : -161);
}

export function computeBase(s: Settings): number {
  return computeTmb(s) * (s.activity_factor ?? 1.2);
}

export function kcalForKeys(s: Settings, keys: string[]): number {
  let sum = 0;
  for (const k of keys) {
    if (k === 'kcal_gym') sum += s.kcal_gym;
    if (k === 'kcal_kick') sum += s.kcal_kick;
    if (k === 'kcal_walk') sum += s.kcal_walk;
  }
  return sum;
}

export function objetivoDia(s: Settings, activityKeys: string[]): number {
  const gasto = computeBase(s) + kcalForKeys(s, activityKeys);
  return Math.max(s.minimo, Math.round(gasto - s.deficit));
}

export function formulaBreakdown(s: Settings, activityKeys: string[] = []) {
  const tmb = computeTmb(s);
  const factor = s.activity_factor ?? 1.2;
  const base = tmb * factor;
  const activity = kcalForKeys(s, activityKeys);
  const beforeFloor = Math.round(base + activity - s.deficit);
  const goal = Math.max(s.minimo, beforeFloor);
  return {
    tmb: Math.round(tmb),
    activity_factor: factor,
    base: Math.round(base),
    activity_kcal: activity,
    deficit: s.deficit,
    minimo: s.minimo,
    before_floor: beforeFloor,
    goal,
    floored: goal === s.minimo && beforeFloor < s.minimo,
  };
}

export type MealRow = {
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

/** Promedio ponderado por kcal de quality_score (ignora comidas sin score). */
export function weightedQuality(meals: MealRow[]): number | null {
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

function getOrCreateDayLog(db: Db, userId: string, date: string): string {
  const existing = db
    .prepare('SELECT id FROM day_logs WHERE user_id = ? AND date = ?')
    .get(userId, date) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = newId();
  db.prepare(
    `INSERT INTO day_logs (id, user_id, date, weight, training, notes) VALUES (?, ?, ?, NULL, NULL, '')`,
  ).run(id, userId, date);
  return id;
}

export function getDay(db: Db, userId: string, date: string) {
  const log = db
    .prepare(
      `SELECT id, date, weight, training, notes FROM day_logs WHERE user_id = ? AND date = ?`,
    )
    .get(userId, date) as
    | { id: string; date: string; weight: number | null; training: number | null; notes: string }
    | undefined;

  if (!log) {
    return {
      date,
      weight: null as number | null,
      training: null as boolean | null,
      notes: '',
      meals: [] as MealRow[],
    };
  }

  const meals = db
    .prepare(
      `SELECT id, meal_type, label, kcal, protein, carbs, fat, quality_score, quality_note,
              source, raw_prompt, image_path, created_at
       FROM meals WHERE day_log_id = ? ORDER BY created_at`,
    )
    .all(log.id) as MealRow[];

  return {
    date: log.date,
    weight: log.weight,
    training: log.training === null ? null : Boolean(log.training),
    notes: log.notes,
    meals,
  };
}

export function getDaysRange(db: Db, userId: string, from: string, to: string) {
  const dates: string[] = [];
  const start = new Date(from + 'T12:00:00');
  const end = new Date(to + 'T12:00:00');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates.map((date) => getDay(db, userId, date));
}

export function updateDay(
  db: Db,
  userId: string,
  date: string,
  data: { weight?: number | null; training?: boolean | null; notes?: string },
) {
  const id = getOrCreateDayLog(db, userId, date);
  const current = db
    .prepare('SELECT weight, training, notes FROM day_logs WHERE id = ?')
    .get(id) as { weight: number | null; training: number | null; notes: string };

  const weight = data.weight !== undefined ? data.weight : current.weight;
  const training =
    data.training !== undefined
      ? data.training === null
        ? null
        : data.training
          ? 1
          : 0
      : current.training;
  const notes = data.notes !== undefined ? data.notes : current.notes;

  db.prepare(
    `UPDATE day_logs SET weight = ?, training = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(weight, training, notes, id);

  return getDay(db, userId, date);
}

export function addMeal(
  db: Db,
  userId: string,
  input: {
    date: string;
    meal_type: string;
    label: string;
    kcal: number;
    protein?: number | null;
    carbs?: number | null;
    fat?: number | null;
    quality_score?: number | null;
    quality_note?: string | null;
    source?: 'manual' | 'ai_text' | 'ai_image';
    raw_prompt?: string | null;
    image_path?: string | null;
  },
) {
  const dayLogId = getOrCreateDayLog(db, userId, input.date);
  const id = newId();
  db.prepare(
    `INSERT INTO meals (id, day_log_id, meal_type, label, kcal, protein, carbs, fat,
      quality_score, quality_note, source, raw_prompt, image_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    dayLogId,
    input.meal_type,
    input.label,
    input.kcal,
    input.protein ?? null,
    input.carbs ?? null,
    input.fat ?? null,
    input.quality_score ?? null,
    input.quality_note ?? null,
    input.source ?? 'manual',
    input.raw_prompt ?? null,
    input.image_path ?? null,
  );
  return getDay(db, userId, input.date);
}

export function updateMeal(
  db: Db,
  userId: string,
  mealId: string,
  patch: { label?: string; kcal?: number; meal_type?: string },
) {
  const row = db
    .prepare(
      `SELECT m.id, d.date, d.user_id FROM meals m
       JOIN day_logs d ON d.id = m.day_log_id
       WHERE m.id = ?`,
    )
    .get(mealId) as { id: string; date: string; user_id: string } | undefined;

  if (!row || row.user_id !== userId) return null;

  const current = db
    .prepare('SELECT label, kcal, meal_type FROM meals WHERE id = ?')
    .get(mealId) as { label: string; kcal: number; meal_type: string };

  db.prepare(`UPDATE meals SET label = ?, kcal = ?, meal_type = ? WHERE id = ?`).run(
    patch.label ?? current.label,
    patch.kcal ?? current.kcal,
    patch.meal_type ?? current.meal_type,
    mealId,
  );
  return getDay(db, userId, row.date);
}

export function deleteMeal(db: Db, userId: string, mealId: string) {
  const row = db
    .prepare(
      `SELECT m.id, d.date, d.user_id, m.image_path FROM meals m
       JOIN day_logs d ON d.id = m.day_log_id
       WHERE m.id = ?`,
    )
    .get(mealId) as
    | { id: string; date: string; user_id: string; image_path: string | null }
    | undefined;

  if (!row || row.user_id !== userId) return null;
  db.prepare('DELETE FROM meals WHERE id = ?').run(mealId);
  return { day: getDay(db, userId, row.date), image_path: row.image_path };
}
