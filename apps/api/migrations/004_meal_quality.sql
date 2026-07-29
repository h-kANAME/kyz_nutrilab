-- Calidad de comida (1–5) orientada a cuerpo esbelto/tonificado.
-- NULL = carga manual sin evaluación AI.
ALTER TABLE meals ADD COLUMN quality_score INTEGER;
ALTER TABLE meals ADD COLUMN quality_note TEXT;
