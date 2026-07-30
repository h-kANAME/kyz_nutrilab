-- Kcal de Bici configurable en perfil (como gym/kick/walk)
ALTER TABLE user_settings ADD COLUMN kcal_bike INTEGER NOT NULL DEFAULT 250;

-- Conservar el valor ya cargado en user_activities si existe
UPDATE user_settings
SET kcal_bike = (
  SELECT ua.kcal FROM user_activities ua
  WHERE ua.user_id = user_settings.user_id AND ua.key = 'kcal_bike'
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1 FROM user_activities ua
  WHERE ua.user_id = user_settings.user_id AND ua.key = 'kcal_bike'
);
