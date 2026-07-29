-- Plan onboarding + catálogo de actividades por usuario
ALTER TABLE user_settings ADD COLUMN plan_onboarding_done INTEGER NOT NULL DEFAULT 0;

-- Usuarios existentes: no forzar wizard de plan (se puede resetear a mano).
UPDATE user_settings SET plan_onboarding_done = 1;

CREATE TABLE IF NOT EXISTS user_activities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  kcal INTEGER NOT NULL DEFAULT 0 CHECK (kcal >= 0 AND kcal <= 5000),
  is_builtin INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_user_activities_user ON user_activities(user_id);
