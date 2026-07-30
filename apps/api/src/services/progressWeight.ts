import { z } from 'zod';
import type { Db } from '../db/index.js';
import { getSettings } from './tracker.js';

export const KCAL_PER_KG = 7700;
export const PROGRESS_MAX_DAYS = 120;

export type WeightPoint = { date: string; weight: number };

export type WeightProjection = {
  plan_kg_per_week: number;
  observed_kg_per_week: number | null;
  eta_plan_days: number | null;
  eta_observed_days: number | null;
  eta_plan_date: string | null;
  eta_observed_date: string | null;
};

export type WeightProgress = {
  from: string;
  to: string;
  points: WeightPoint[];
  peso_objetivo: number | null;
  peso_objetivo_desde: string | null;
  peso_actual: number | null;
  stats: {
    start_weight: number | null;
    end_weight: number | null;
    delta_kg: number | null;
    gap_to_goal_kg: number | null;
    n: number;
  };
  projection: WeightProjection;
};

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

export const progressWeightQuerySchema = z.object({
  from: z.string().regex(dateRe),
  to: z.string().regex(dateRe),
});

function dayIndex(date: string): number {
  return Math.floor(new Date(date + 'T12:00:00').getTime() / 86400000);
}

function addDaysIso(date: string, days: number): string {
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Ritmo observado (kg/semana) vía regresión lineal peso ~ día.
 * Positivo = subiendo; negativo = bajando.
 */
export function observedKgPerWeek(points: WeightPoint[]): number | null {
  if (points.length < 2) return null;
  const xs = points.map((p) => dayIndex(p.date));
  const ys = points.map((p) => p.weight);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - meanX) * (ys[i]! - meanY);
    den += (xs[i]! - meanX) ** 2;
  }
  if (den === 0) return null;
  const slopePerDay = num / den;
  return Math.round(slopePerDay * 7 * 1000) / 1000;
}

export function planKgPerWeek(deficitKcal: number): number {
  return Math.round((-deficitKcal / KCAL_PER_KG) * 1000) / 1000;
}

/**
 * Días estimados para llegar de current → target con ritmo kg/semana.
 * null si ritmo nulo, en dirección incorrecta, o ya en meta (±0.05 kg).
 */
export function estimateEtaDays(
  current: number,
  target: number,
  kgPerWeek: number,
): number | null {
  const gap = target - current;
  if (Math.abs(gap) < 0.05) return 0;
  if (kgPerWeek === 0 || !Number.isFinite(kgPerWeek)) return null;
  // Mismo signo: el ritmo acerca al objetivo
  if (gap * kgPerWeek <= 0) return null;
  const weeks = gap / kgPerWeek;
  if (!Number.isFinite(weeks) || weeks < 0) return null;
  return Math.ceil(weeks * 7);
}

export function buildProjection(
  current: number | null,
  target: number | null,
  deficitKcal: number,
  points: WeightPoint[],
  asOfDate: string,
): WeightProjection {
  const plan = planKgPerWeek(deficitKcal);
  const observed = observedKgPerWeek(points);

  let etaPlan: number | null = null;
  let etaObs: number | null = null;
  if (current != null && target != null) {
    etaPlan = estimateEtaDays(current, target, plan);
    if (observed != null) etaObs = estimateEtaDays(current, target, observed);
  }

  return {
    plan_kg_per_week: plan,
    observed_kg_per_week: observed,
    eta_plan_days: etaPlan,
    eta_observed_days: etaObs,
    eta_plan_date:
      etaPlan != null && etaPlan > 0 ? addDaysIso(asOfDate, etaPlan) : etaPlan === 0 ? asOfDate : null,
    eta_observed_date:
      etaObs != null && etaObs > 0 ? addDaysIso(asOfDate, etaObs) : etaObs === 0 ? asOfDate : null,
  };
}

export function listWeightPoints(db: Db, userId: string, from: string, to: string): WeightPoint[] {
  const rows = db
    .prepare(
      `SELECT date, weight FROM day_logs
       WHERE user_id = ? AND date >= ? AND date <= ? AND weight IS NOT NULL
       ORDER BY date ASC`,
    )
    .all(userId, from, to) as Array<{ date: string; weight: number }>;
  return rows.map((r) => ({ date: r.date, weight: Number(r.weight) }));
}

export function getLatestWeight(db: Db, userId: string): number | null {
  const row = db
    .prepare(
      `SELECT weight FROM day_logs
       WHERE user_id = ? AND weight IS NOT NULL
       ORDER BY date DESC LIMIT 1`,
    )
    .get(userId) as { weight: number } | undefined;
  return row ? Number(row.weight) : null;
}

export function getWeightProgress(
  db: Db,
  userId: string,
  from: string,
  to: string,
): WeightProgress {
  const settings = getSettings(db, userId);
  const points = listWeightPoints(db, userId, from, to);
  const latest = getLatestWeight(db, userId);
  const pesoActual = latest ?? settings.peso;
  const start = points[0]?.weight ?? null;
  const end = points.length ? points[points.length - 1]!.weight : null;
  const delta =
    start != null && end != null ? Math.round((end - start) * 100) / 100 : null;
  const goal = settings.peso_objetivo;
  const gap =
    goal != null && pesoActual != null
      ? Math.round((goal - pesoActual) * 100) / 100
      : null;

  return {
    from,
    to,
    points,
    peso_objetivo: goal,
    peso_objetivo_desde: settings.peso_objetivo_desde,
    peso_actual: pesoActual,
    stats: {
      start_weight: start,
      end_weight: end,
      delta_kg: delta,
      gap_to_goal_kg: gap,
      n: points.length,
    },
    projection: buildProjection(pesoActual, goal, settings.deficit, points, to),
  };
}

/** Span inclusivo en días; -1 si fechas inválidas. */
export function daysSpanInclusive(from: string, to: string): number {
  const a = new Date(from + 'T12:00:00').getTime();
  const b = new Date(to + 'T12:00:00').getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || from > to) return -1;
  return Math.round((b - a) / 86400000) + 1;
}
