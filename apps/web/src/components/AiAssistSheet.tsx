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

type EstimateItem = {
  name: string;
  kcal: number;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  quality_score: number;
  quality_note?: string | null;
  source?: 'catalog' | 'llm';
  catalog_id?: string | null;
  raw_name?: string | null;
  match_score?: number | null;
};

type PendingSave = {
  date: string;
  meal_type: string;
  source: 'ai_text' | 'ai_image';
  raw_prompt?: string | null;
  image_path?: string | null;
};

type DraftItem = EstimateItem & { keep: boolean };

function namesDiverge(item: EstimateItem): boolean {
  if (!item.raw_name) return false;
  const a = item.raw_name.trim().toLowerCase();
  const b = item.name.trim().toLowerCase();
  if (!a || !b) return false;
  return a !== b && !b.includes(a) && !a.includes(b);
}

export function AiAssistSheet({ mealType, date, onClose, onDone }: Props) {
  const [type, setType] = useState(mealType);
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [alert, setAlert] = useState<ReturnType<typeof translateAiError> | null>(null);
  const [drafts, setDrafts] = useState<DraftItem[] | null>(null);
  const [pending, setPending] = useState<PendingSave | null>(null);
  const [notes, setNotes] = useState<string | null>(null);

  const showError = (raw: string) => {
    setAlert(translateAiError(raw));
  };

  const analyze = async () => {
    if (!text.trim() && !file) {
      showError('Escribí la comida o subí una foto');
      return;
    }
    setBusy(true);
    try {
      let res: {
        estimate: { items: EstimateItem[]; notes?: string | null; confidence?: number };
        pendingSave: PendingSave;
      };
      if (file) {
        const form = new FormData();
        form.append('file', file);
        form.append('mealType', type);
        form.append('date', date);
        if (text.trim()) form.append('text', text.trim());
        res = (await api.parseMealImage(form)) as typeof res;
      } else {
        res = (await api.parseMeal({
          mealType: type,
          text: text.trim(),
          date,
        })) as typeof res;
      }
      const items = (res.estimate?.items ?? []).map((it) => ({ ...it, keep: true }));
      if (items.length === 0) {
        showError('El asistente no pudo interpretar bien tu descripción.');
        return;
      }
      setDrafts(items);
      setPending(res.pendingSave);
      setNotes(res.estimate?.notes ?? null);
    } catch (e) {
      showError((e as Error).message || 'Error desconocido');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!drafts || !pending) return;
    const toSave = drafts.filter((d) => d.keep);
    if (toSave.length === 0) {
      showError('Seleccioná al menos un ítem para guardar');
      return;
    }
    setBusy(true);
    try {
      for (let i = 0; i < toSave.length; i++) {
        const item = toSave[i]!;
        await api.addMeal({
          date: pending.date,
          meal_type: pending.meal_type,
          label: item.name,
          kcal: Math.round(item.kcal),
          protein: item.protein ?? null,
          carbs: item.carbs ?? null,
          fat: item.fat ?? null,
          quality_score: item.quality_score,
          quality_note: item.quality_note ?? null,
          source: pending.source,
          raw_prompt: pending.raw_prompt ?? null,
          image_path: i === 0 ? (pending.image_path ?? null) : null,
        });
      }
      onDone();
    } catch (e) {
      showError((e as Error).message || 'Error desconocido');
    } finally {
      setBusy(false);
    }
  };

  const updateDraft = (idx: number, patch: Partial<DraftItem>) => {
    setDrafts((prev) => {
      if (!prev) return prev;
      return prev.map((d, i) => (i === idx ? { ...d, ...patch } : d));
    });
  };

  const reviewMode = drafts != null;

  return (
    <>
      <div className="sheet-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
        <div className="sheet" onClick={(e) => e.stopPropagation()}>
          <div className="row">
            <h2 style={{ fontSize: 18 }}>{reviewMode ? 'Revisar estimación' : 'Asistente AI'}</h2>
            <button type="button" className="ghost" onClick={onClose}>
              Cerrar
            </button>
          </div>

          {!reviewMode ? (
            <>
              <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>
                Describí tu comida o subí una foto. Vas a poder revisar qué interpretó antes de
                guardar.
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
                  placeholder="Ej: tostadas de arroz con queso untable light y un café con leche"
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
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden
                    >
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
                        const input = document.getElementById(
                          'ai-meal-photo',
                        ) as HTMLInputElement | null;
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
                onClick={() => void analyze()}
              >
                {busy ? 'Analizando…' : 'Analizar'}
              </button>
            </>
          ) : (
            <>
              <p className="muted" style={{ fontSize: 13, margin: '8px 0 12px' }}>
                Revisá cada ítem. Si el nombre no coincide con lo que comiste, editá o desmarcá
                antes de guardar.
              </p>
              {notes && (
                <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
                  {notes}
                </p>
              )}

              <ul className="ai-review-list">
                {drafts.map((item, idx) => {
                  const diverge = namesDiverge(item);
                  return (
                    <li
                      key={idx}
                      className={`ai-review-item${item.keep ? '' : ' dimmed'}${diverge ? ' warn' : ''}`}
                    >
                      <label className="ai-review-keep">
                        <input
                          type="checkbox"
                          checked={item.keep}
                          onChange={(e) => updateDraft(idx, { keep: e.target.checked })}
                        />
                        <span>Guardar</span>
                      </label>
                      <div className="field" style={{ margin: 0 }}>
                        <label>Interpretado como</label>
                        <input
                          value={item.name}
                          onChange={(e) => updateDraft(idx, { name: e.target.value })}
                          disabled={!item.keep}
                        />
                      </div>
                      {item.raw_name && (
                        <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
                          Texto: {item.raw_name}
                          {item.source === 'catalog' ? ' · catálogo' : item.source === 'llm' ? ' · estimación AI' : ''}
                          {diverge ? ' · revisar nombre' : ''}
                        </p>
                      )}
                      <div className="ai-review-kcal row" style={{ gap: 8, marginTop: 8 }}>
                        <div className="field" style={{ flex: 1, margin: 0 }}>
                          <label>kcal</label>
                          <input
                            type="number"
                            min={1}
                            value={item.kcal}
                            disabled={!item.keep}
                            onChange={(e) =>
                              updateDraft(idx, { kcal: Number(e.target.value) || 0 })
                            }
                          />
                        </div>
                        <div className="field" style={{ width: 72, margin: 0 }}>
                          <label>Calidad</label>
                          <input
                            type="number"
                            min={1}
                            max={5}
                            value={item.quality_score}
                            disabled={!item.keep}
                            onChange={(e) =>
                              updateDraft(idx, {
                                quality_score: Math.min(
                                  5,
                                  Math.max(1, Number(e.target.value) || 3),
                                ),
                              })
                            }
                          />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="row" style={{ gap: 8, marginTop: 16 }}>
                <button
                  type="button"
                  className="ghost"
                  style={{ flex: 1, padding: 12 }}
                  disabled={busy}
                  onClick={() => {
                    setDrafts(null);
                    setPending(null);
                    setNotes(null);
                  }}
                >
                  Volver
                </button>
                <button
                  type="button"
                  className="primary"
                  style={{ flex: 2, padding: 12 }}
                  disabled={busy}
                  onClick={() => void confirm()}
                >
                  {busy ? 'Guardando…' : 'Confirmar y guardar'}
                </button>
              </div>
            </>
          )}
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
