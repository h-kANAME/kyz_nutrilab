import type { Settings } from './types';

export type FormulaBreakdown = {
  tmb: number;
  activity_factor: number;
  base: number;
  activity_kcal: number;
  deficit: number;
  minimo: number;
  before_floor: number;
  goal: number;
  floored: boolean;
};

export function computeLocalFormula(
  s: Settings,
  activityKeys: Array<'kcal_gym' | 'kcal_kick' | 'kcal_walk' | string> = [],
): FormulaBreakdown {
  const tmb = 10 * s.peso + 6.25 * s.altura - 5 * s.edad + (s.sexo === 'M' ? 5 : -161);
  const factor = s.activity_factor ?? 1.2;
  const base = tmb * factor;
  let activity = 0;
  for (const k of activityKeys) {
    if (k === 'kcal_gym') activity += s.kcal_gym;
    if (k === 'kcal_kick') activity += s.kcal_kick;
    if (k === 'kcal_walk') activity += s.kcal_walk;
  }
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

export const ACTIVITY_FACTOR_PRESETS = [
  { value: 1.2, label: 'Sedentario (1.2)' },
  { value: 1.375, label: 'Ligero (1.375)' },
  { value: 1.55, label: 'Moderado (1.55)' },
  { value: 1.725, label: 'Activo (1.725)' },
  { value: 1.9, label: 'Muy activo (1.9)' },
] as const;
