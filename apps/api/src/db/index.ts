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
}> = [
  { weekday: 0, mid_label: '-', late_label: 'Descanso', activity_keys: [] },
  { weekday: 1, mid_label: 'Musculación 12:30', late_label: 'Kickboxing 18:30', activity_keys: ['kcal_gym', 'kcal_kick'] },
  { weekday: 2, mid_label: '-', late_label: 'Caminata 30 min', activity_keys: ['kcal_walk'] },
  { weekday: 3, mid_label: 'Musculación 12:30', late_label: 'Kickboxing 18:30', activity_keys: ['kcal_gym', 'kcal_kick'] },
  { weekday: 4, mid_label: '-', late_label: 'Caminata 30 min', activity_keys: ['kcal_walk'] },
  { weekday: 5, mid_label: 'Musculación 12:30', late_label: 'Kickboxing 18:30', activity_keys: ['kcal_gym', 'kcal_kick'] },
  { weekday: 6, mid_label: '-', late_label: 'Descanso', activity_keys: [] },
];

export function ensureUserDefaults(db: Db, userId: string, defaultLlm = 'gemini'): void {
  const settings = db.prepare('SELECT user_id FROM user_settings WHERE user_id = ?').get(userId);
  if (!settings) {
    db.prepare(`INSERT INTO user_settings (user_id, llm_provider) VALUES (?, ?)`).run(
      userId,
      defaultLlm,
    );
  }

  const planCount = db.prepare('SELECT COUNT(*) AS c FROM plan_days WHERE user_id = ?').get(userId) as {
    c: number;
  };
  if (planCount.c === 0) {
    const insert = db.prepare(
      `INSERT INTO plan_days (user_id, weekday, mid_label, late_label, activity_keys)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const day of DEFAULT_PLAN) {
      insert.run(userId, day.weekday, day.mid_label, day.late_label, JSON.stringify(day.activity_keys));
    }
  }
}

export function newId(): string {
  return randomUUID();
}
