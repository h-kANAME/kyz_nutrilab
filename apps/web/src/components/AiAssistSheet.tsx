import { useState } from 'react';
import { api } from '../lib/api';
import { MEAL_TYPES } from '../lib/types';
import { translateAiError } from '../lib/aiErrors';
import { AlertModal } from './AlertModal';

type Props = {
  mealType: string;
  date: string;
  onClose: () => void;
  onDone: () => void;
};

export function AiAssistSheet({ mealType, date, onClose, onDone }: Props) {
  const [type, setType] = useState(mealType);
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [alert, setAlert] = useState<ReturnType<typeof translateAiError> | null>(null);

  const showError = (raw: string) => {
    setAlert(translateAiError(raw));
  };

  const submit = async () => {
    if (!text.trim() && !file) {
      showError('Escribí la comida o subí una foto');
      return;
    }
    setBusy(true);
    try {
      if (file) {
        const form = new FormData();
        form.append('file', file);
        form.append('mealType', type);
        form.append('date', date);
        if (text.trim()) form.append('text', text.trim());
        await api.parseMealImage(form);
      } else {
        await api.parseMeal({ mealType: type, text: text.trim(), date });
      }
      onDone();
    } catch (e) {
      showError((e as Error).message || 'Error desconocido');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="sheet-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
        <div className="sheet" onClick={(e) => e.stopPropagation()}>
          <div className="row">
            <h2 style={{ fontSize: 18 }}>Asistente AI</h2>
            <button type="button" className="ghost" onClick={onClose}>
              Cerrar
            </button>
          </div>
          <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>
            Describí tu comida o subí una foto. Estima kcal y califica la calidad (1–5) según
            densidad proteica y procesamiento — pechuga ≠ milanesa empanada.
          </p>

          <div className="field">
            <label>Tipo</label>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {MEAL_TYPES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Descripción</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Ej: 2 huevos revueltos, una tostada integral con palta y un café con leche"
              rows={4}
            />
          </div>

          <div className="field">
            <label>Foto (opcional)</label>
            <div className="file-picker">
              <input
                id="ai-meal-photo"
                className="file-picker-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  if (preview) URL.revokeObjectURL(preview);
                  setPreview(f ? URL.createObjectURL(f) : null);
                }}
              />
              <label htmlFor="ai-meal-photo" className="file-picker-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M14 3h7v7" />
                  <path d="M10 14 21 3" />
                  <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
                </svg>
                {file ? 'Cambiar foto' : 'Adjuntar foto'}
              </label>
              <span className={`file-picker-name${file ? ' has-file' : ''}`}>
                {file ? file.name : 'Sin archivo seleccionado'}
              </span>
              {file && (
                <button
                  type="button"
                  className="file-picker-clear"
                  aria-label="Quitar foto"
                  onClick={() => {
                    setFile(null);
                    if (preview) URL.revokeObjectURL(preview);
                    setPreview(null);
                    const input = document.getElementById('ai-meal-photo') as HTMLInputElement | null;
                    if (input) input.value = '';
                  }}
                >
                  ×
                </button>
              )}
            </div>
            {preview && (
              <img className="file-picker-preview" src={preview} alt="Vista previa" />
            )}
          </div>

          <button
            className="primary"
            type="button"
            style={{ width: '100%', marginTop: 16, padding: 13 }}
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? 'Analizando…' : 'Registrar con AI'}
          </button>
        </div>
      </div>

      {alert && (
        <AlertModal
          title={alert.title}
          body={alert.body}
          hint={alert.hint}
          onClose={() => setAlert(null)}
        />
      )}
    </>
  );
}
