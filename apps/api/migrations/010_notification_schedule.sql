-- Horarios configurables por usuario (HH:MM, zona Argentina)
ALTER TABLE notification_prefs ADD COLUMN meal_times TEXT NOT NULL DEFAULT '["08:00","13:00","17:00","21:00"]';
ALTER TABLE notification_prefs ADD COLUMN training_time TEXT NOT NULL DEFAULT '21:00';
ALTER TABLE notification_prefs ADD COLUMN weight_time TEXT NOT NULL DEFAULT '09:00';
