-- Dedupe de envíos diarios (un push por usuario/fecha/kind)
CREATE TABLE IF NOT EXISTS notification_sends (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  kind TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, date, kind)
);

CREATE INDEX IF NOT EXISTS idx_notification_sends_user_date
  ON notification_sends(user_id, date);
