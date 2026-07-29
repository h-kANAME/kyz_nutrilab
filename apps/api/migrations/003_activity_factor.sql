-- 003_activity_factor.sql
ALTER TABLE user_settings ADD COLUMN activity_factor REAL NOT NULL DEFAULT 1.2;
