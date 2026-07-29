-- Normalizar a 4 comidas: Desayuno, Almuerzo, Merienda, Cena
UPDATE notification_prefs
SET meal_times = '["08:00","13:00","17:00","21:00"]'
WHERE json_array_length(meal_times) != 4;
