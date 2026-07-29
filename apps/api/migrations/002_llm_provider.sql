-- 002_llm_provider.sql
ALTER TABLE user_settings ADD COLUMN llm_provider TEXT NOT NULL DEFAULT 'gemini';
