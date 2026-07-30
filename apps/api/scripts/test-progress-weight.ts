/**
 * Batería de tests del módulo Progreso (peso).
 * Uso: npx tsx scripts/test-progress-weight.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrate, openDb, ensureUserDefaults, newId } from '../src/db/index.js';
import {
  buildProjection,
  daysSpanInclusive,
  estimateEtaDays,
  getWeightProgress,
  observedKgPerWeek,
  planKgPerWeek,
  KCAL_PER_KG,
} from '../src/services/progressWeight.js';
import { resolveWeightGoalFields, updateSettings, type Settings } from '../src/services/tracker.js';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}`);
    throw e;
  }
}

function baseSettings(over: Partial<Settings> = {}): Settings {
  return {
    edad: 30,
    peso: 80,
    altura: 175,
    sexo: 'M',
    deficit: 770,
    minimo: 1800,
    activity_factor: 1.2,
    kcal_gym: 300,
    kcal_kick: 400,
    kcal_walk: 150,
    kcal_bike: 250,
    theme: 'dark',
    llm_provider: 'gemini',
    peso_objetivo: null,
    peso_objetivo_desde: null,
    ...over,
  };
}

console.log('progressWeight — math');

test('planKgPerWeek usa 7700 (déficit 770 → −0.1 kg/sem)', () => {
  assert.equal(planKgPerWeek(770), -0.1);
  assert.equal(KCAL_PER_KG, 7700);
});

test('observedKgPerWeek null con <2 puntos', () => {
  assert.equal(observedKgPerWeek([]), null);
  assert.equal(observedKgPerWeek([{ date: '2026-07-01', weight: 80 }]), null);
});

test('observedKgPerWeek detecta baja lineal ~0.5 kg/sem', () => {
  // 80 → 79 en 14 días = −0.5 kg/sem
  const rate = observedKgPerWeek([
    { date: '2026-07-01', weight: 80 },
    { date: '2026-07-15', weight: 79 },
  ]);
  assert.ok(rate != null);
  assert.ok(Math.abs(rate! - -0.5) < 0.02, `got ${rate}`);
});

test('estimateEtaDays: ya en meta → 0', () => {
  assert.equal(estimateEtaDays(75, 75, -0.5), 0);
  assert.equal(estimateEtaDays(75.02, 75, -0.5), 0);
});

test('estimateEtaDays: baja hacia meta', () => {
  // gap −5 kg, ritmo −0.5/sem → 10 semanas → 70 días
  const days = estimateEtaDays(80, 75, -0.5);
  assert.equal(days, 70);
});

test('estimateEtaDays: ritmo en dirección incorrecta → null', () => {
  assert.equal(estimateEtaDays(80, 75, 0.5), null);
  assert.equal(estimateEtaDays(70, 75, -0.5), null);
});

test('buildProjection combina plan + observado', () => {
  const points = [
    { date: '2026-07-01', weight: 80 },
    { date: '2026-07-15', weight: 79 },
  ];
  const p = buildProjection(79, 75, 770, points, '2026-07-15');
  assert.equal(p.plan_kg_per_week, -0.1);
  assert.ok(p.observed_kg_per_week != null);
  assert.ok(p.eta_plan_days != null && p.eta_plan_days > 0);
  assert.ok(p.eta_plan_date);
});

test('daysSpanInclusive', () => {
  assert.equal(daysSpanInclusive('2026-07-01', '2026-07-01'), 1);
  assert.equal(daysSpanInclusive('2026-07-01', '2026-07-30'), 30);
  assert.equal(daysSpanInclusive('2026-07-30', '2026-07-01'), -1);
});

console.log('\nresolveWeightGoalFields');

test('limpia meta y desde', () => {
  const r = resolveWeightGoalFields(baseSettings({ peso_objetivo: null }), {
    peso_objetivo: 75,
    peso_objetivo_desde: '2026-01-01',
  });
  assert.equal(r.peso_objetivo, null);
  assert.equal(r.peso_objetivo_desde, null);
});

test('nueva meta setea desde', () => {
  const r = resolveWeightGoalFields(baseSettings({ peso_objetivo: 75 }), {
    peso_objetivo: null,
    peso_objetivo_desde: null,
  });
  assert.equal(r.peso_objetivo, 75);
  assert.ok(r.peso_objetivo_desde);
  assert.match(r.peso_objetivo_desde!, /^\d{4}-\d{2}-\d{2}$/);
});

test('misma meta conserva desde previo', () => {
  const r = resolveWeightGoalFields(baseSettings({ peso_objetivo: 75 }), {
    peso_objetivo: 75,
    peso_objetivo_desde: '2026-03-01',
  });
  assert.equal(r.peso_objetivo_desde, '2026-03-01');
});

console.log('\ngetWeightProgress — sqlite');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nutrilab-progress-'));
const dbPath = path.join(tmpDir, 'test.db');
const db = openDb(dbPath);
migrate(db);
const userId = 'user-progress-test';
db.prepare(
  `INSERT INTO users (id, google_sub, email, name, picture) VALUES (?, ?, ?, ?, ?)`,
).run(userId, 'google-progress-test', 'progress@test.local', 'Progress Test', '');
ensureUserDefaults(db, userId);

db.prepare(
  `INSERT INTO day_logs (id, user_id, date, weight, training, notes) VALUES (?, ?, ?, ?, NULL, '')`,
).run(newId(), userId, '2026-07-01', 82);
db.prepare(
  `INSERT INTO day_logs (id, user_id, date, weight, training, notes) VALUES (?, ?, ?, ?, NULL, '')`,
).run(newId(), userId, '2026-07-08', 81);
db.prepare(
  `INSERT INTO day_logs (id, user_id, date, weight, training, notes) VALUES (?, ?, ?, ?, NULL, '')`,
).run(newId(), userId, '2026-07-15', 80);

updateSettings(db, userId, baseSettings({ peso: 80, deficit: 770, peso_objetivo: 75 }));

test('serie ordenada y stats delta', () => {
  const prog = getWeightProgress(db, userId, '2026-07-01', '2026-07-15');
  assert.equal(prog.points.length, 3);
  assert.equal(prog.stats.start_weight, 82);
  assert.equal(prog.stats.end_weight, 80);
  assert.equal(prog.stats.delta_kg, -2);
  assert.equal(prog.peso_objetivo, 75);
  assert.equal(prog.peso_actual, 80);
  assert.equal(prog.stats.gap_to_goal_kg, -5);
  assert.equal(prog.projection.plan_kg_per_week, -0.1);
  assert.ok(prog.projection.observed_kg_per_week != null);
});

test('rango sin puntos → n=0', () => {
  const prog = getWeightProgress(db, userId, '2025-01-01', '2025-01-31');
  assert.equal(prog.points.length, 0);
  assert.equal(prog.stats.n, 0);
  assert.equal(prog.stats.delta_kg, null);
});

test('peso_objetivo_desde se persiste al setear meta', () => {
  const row = db
    .prepare('SELECT peso_objetivo, peso_objetivo_desde FROM user_settings WHERE user_id = ?')
    .get(userId) as { peso_objetivo: number; peso_objetivo_desde: string };
  assert.equal(row.peso_objetivo, 75);
  assert.ok(row.peso_objetivo_desde);
});

db.close();
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log('\nAll progress-weight tests passed.');
