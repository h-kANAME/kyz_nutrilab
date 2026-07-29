-- Primer login: wizard obligatorio para usuarios nuevos.
ALTER TABLE user_settings ADD COLUMN onboarding_done INTEGER NOT NULL DEFAULT 0;

-- Usuarios ya existentes no se fuerzan a rehacer el wizard.
UPDATE user_settings SET onboarding_done = 1;
