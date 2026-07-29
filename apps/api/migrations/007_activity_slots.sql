-- Un slot por actividad del día: texto libre + horario
ALTER TABLE plan_days ADD COLUMN activity_slots TEXT NOT NULL DEFAULT '[]';
