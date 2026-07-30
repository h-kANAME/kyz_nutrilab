import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type Db = Database.Database;

export function openDb(sqlitePath: string): Db {
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
  const db = new Database(sqlitePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export function migrate(db: Db): void {
  const migrationsDir = path.resolve(__dirname, '../../migrations');
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as { id: string }[]).map((r) => r.id),
  );

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const insert = db.prepare('INSERT INTO schema_migrations (id) VALUES (?)');

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const run = db.transaction(() => {
      db.exec(sql);
      insert.run(file);
    });
    run();
  }
}

export const DEFAULT_PLAN: Array<{
  weekday: number;
  mid_label: string;
  late_label: string;
  activity_keys: string[];
  activity_slots: Array<{ key: string; label: string; time: string }>;
}> = [
  { weekday: 0, mid_label: '-', late_label: 'Descanso', activity_keys: [], activity_slots: [] },
  { weekday: 1, mid_label: '-', late_label: 'Descanso', activity_keys: [], activity_slots: [] },
  { weekday: 2, mid_label: '-', late_label: 'Descanso', activity_keys: [], activity_slots: [] },
  { weekday: 3, mid_label: '-', late_label: 'Descanso', activity_keys: [], activity_slots: [] },
  { weekday: 4, mid_label: '-', late_label: 'Descanso', activity_keys: [], activity_slots: [] },
  { weekday: 5, mid_label: '-', late_label: 'Descanso', activity_keys: [], activity_slots: [] },
  { weekday: 6, mid_label: '-', late_label: 'Descanso', activity_keys: [], activity_slots: [] },
];

/** Defaults genéricos (no perfil de prueba). El wizard los reemplaza en el primer login. */
export const DEFAULT_SETTINGS = {
  edad: 30,
  peso: 70,
  altura: 170,
  sexo: 'M' as const,
  deficit: 300,
  minimo: 1800,
  activity_factor: 1.2,
  kcal_gym: 300,
  kcal_kick: 400,
  kcal_walk: 150,
  kcal_bike: 250,
  theme: 'dark' as const,
  onboarding_done: 0,
  plan_onboarding_done: 0,
};

export const BUILTIN_ACTIVITIES: Array<{
  key: string;
  label: string;
  kcal: number;
  sort_order: number;
}> = [
  { key: 'kcal_gym', label: 'Gym', kcal: 300, sort_order: 10 },
  { key: 'kcal_kick', label: 'Kick', kcal: 400, sort_order: 20 },
  { key: 'kcal_walk', label: 'Caminata', kcal: 150, sort_order: 30 },
  { key: 'kcal_bike', label: 'Bici', kcal: 250, sort_order: 40 },
];

export function ensureUserActivities(
  db: Db,
  userId: string,
  kcalOverrides?: {
    kcal_gym?: number;
    kcal_kick?: number;
    kcal_walk?: number;
    kcal_bike?: number;
  },
): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO user_activities (id, user_id, key, label, kcal, is_builtin, sort_order)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
  );
  for (const a of BUILTIN_ACTIVITIES) {
    let kcal = a.kcal;
    if (a.key === 'kcal_gym' && kcalOverrides?.kcal_gym != null) kcal = kcalOverrides.kcal_gym;
    if (a.key === 'kcal_kick' && kcalOverrides?.kcal_kick != null) kcal = kcalOverrides.kcal_kick;
    if (a.key === 'kcal_walk' && kcalOverrides?.kcal_walk != null) kcal = kcalOverrides.kcal_walk;
    if (a.key === 'kcal_bike' && kcalOverrides?.kcal_bike != null) kcal = kcalOverrides.kcal_bike;
    insert.run(newId(), userId, a.key, a.label, kcal, a.sort_order);
  }
}

export function ensureUserDefaults(db: Db, userId: string, defaultLlm = 'gemini'): void {
  const settings = db.prepare('SELECT user_id FROM user_settings WHERE user_id = ?').get(userId);
  if (!settings) {
    db.prepare(
      `INSERT INTO user_settings (
         user_id, edad, peso, altura, sexo, deficit, minimo, activity_factor,
         kcal_gym, kcal_kick, kcal_walk, theme, llm_provider, onboarding_done, plan_onboarding_done
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
    ).run(
      userId,
      DEFAULT_SETTINGS.edad,
      DEFAULT_SETTINGS.peso,
      DEFAULT_SETTINGS.altura,
      DEFAULT_SETTINGS.sexo,
      DEFAULT_SETTINGS.deficit,
      DEFAULT_SETTINGS.minimo,
      DEFAULT_SETTINGS.activity_factor,
      DEFAULT_SETTINGS.kcal_gym,
      DEFAULT_SETTINGS.kcal_kick,
      DEFAULT_SETTINGS.kcal_walk,
      DEFAULT_SETTINGS.theme,
      defaultLlm,
    );
  }

  const planCount = db.prepare('SELECT COUNT(*) AS c FROM plan_days WHERE user_id = ?').get(userId) as {
    c: number;
  };
  if (planCount.c === 0) {
    const insert = db.prepare(
      `INSERT INTO plan_days (user_id, weekday, mid_label, late_label, activity_keys, activity_slots)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const day of DEFAULT_PLAN) {
      insert.run(
        userId,
        day.weekday,
        day.mid_label,
        day.late_label,
        JSON.stringify(day.activity_keys),
        JSON.stringify(day.activity_slots),
      );
    }
  }

  const row = db
    .prepare('SELECT kcal_gym, kcal_kick, kcal_walk, kcal_bike FROM user_settings WHERE user_id = ?')
    .get(userId) as
    | { kcal_gym: number; kcal_kick: number; kcal_walk: number; kcal_bike?: number }
    | undefined;
  ensureUserActivities(db, userId, row ?? undefined);
}

export function newId(): string {
  return randomUUID();
}
