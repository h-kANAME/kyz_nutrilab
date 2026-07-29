-- 001_init.sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  picture TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  edad INTEGER NOT NULL DEFAULT 35,
  peso REAL NOT NULL DEFAULT 75.5,
  altura INTEGER NOT NULL DEFAULT 169,
  sexo TEXT NOT NULL DEFAULT 'M' CHECK (sexo IN ('M', 'F')),
  deficit INTEGER NOT NULL DEFAULT 300,
  minimo INTEGER NOT NULL DEFAULT 1850,
  kcal_gym INTEGER NOT NULL DEFAULT 350,
  kcal_kick INTEGER NOT NULL DEFAULT 575,
  kcal_walk INTEGER NOT NULL DEFAULT 150,
  theme TEXT NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark', 'light')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plan_days (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  mid_label TEXT NOT NULL DEFAULT '-',
  late_label TEXT NOT NULL DEFAULT 'Descanso',
  activity_keys TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (user_id, weekday)
);

CREATE TABLE IF NOT EXISTS day_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  weight REAL,
  training INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, date)
);

CREATE TABLE IF NOT EXISTS meals (
  id TEXT PRIMARY KEY,
  day_log_id TEXT NOT NULL REFERENCES day_logs(id) ON DELETE CASCADE,
  meal_type TEXT NOT NULL,
  label TEXT NOT NULL,
  kcal REAL NOT NULL,
  protein REAL,
  carbs REAL,
  fat REAL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai_text', 'ai_image')),
  raw_prompt TEXT,
  image_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_day_logs_user_date ON day_logs(user_id, date);
CREATE INDEX IF NOT EXISTS idx_meals_day_log ON meals(day_log_id);

CREATE TABLE IF NOT EXISTS ai_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  tokens INTEGER,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
