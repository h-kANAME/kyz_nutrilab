import { useEffect, useMemo, useState } from 'react';
import { api, mealImageUrl } from '../lib/api';
import {
  MEAL_TYPES,
  DIAS_FULL,
  todayKey,
  QUALITY_LABELS,
  qualityTone,
  weightedQualityAvg,
  type DayLog,
  type Meal,
} from '../lib/types';
import { AiAssistSheet } from './AiAssistSheet';

type Props = {
  toast: (msg: string) => void;
};

function groupMealsByType(meals: Meal[]): Array<{ type: string; meals: Meal[]; kcal: number }> {
  const order = new Map(MEAL_TYPES.map((t, i) => [t, i]));
  const map = new Map<string, Meal[]>();
  for (const m of meals) {
    const list = map.get(m.meal_type) ?? [];
    list.push(m);
    map.set(m.meal_type, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (order.get(a as (typeof MEAL_TYPES)[number]) ?? 99) - (order.get(b as (typeof MEAL_TYPES)[number]) ?? 99))
    .map(([type, items]) => ({
      type,
      meals: items,
      kcal: items.reduce((s, m) => s + m.kcal, 0),
    }));
}

export function HoyTab({ toast }: Props) {
  const date = todayKey();
  const [day, setDay] = useState<DayLog | null>(null);
  const [mealType, setMealType] = useState<(typeof MEAL_TYPES)[number]>('Desayuno');
  const [kcal, setKcal] = useState('');
  const [aiOpen, setAiOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Categorías expandidas; vacío = todas colapsadas (default tras cargar). */
  const [openTypes, setOpenTypes] = useState<Set<string>>(() => new Set());

  const load = async () => {
    const { day } = await api.getDay(date);
    setDay(day);
  };

  useEffect(() => {
    void load().catch((e) => toast((e as Error).message));
  }, [date]);

  const groups = useMemo(() => (day ? groupMealsByType(day.meals) : []), [day]);

  const toggleType = (type: string) => {
    setOpenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  if (!day) return <div className="loading">Cargando…</div>;

  const consumed = day.consumed ?? day.meals.reduce((s, m) => s + m.kcal, 0);
  const goal = day.goal ?? 0;
  const qualityAvg = day.quality_avg ?? weightedQualityAvg(day.meals);
  const ratio = goal > 0 ? Math.min(consumed / goal, 1) : 0;
  const circumference = 2 * Math.PI * 82;
  const dash = circumference * ratio;

  const addManual = async () => {
    const value = Number(kcal);
    if (!value || value <= 0) {
      toast('Ingresá las kcal');
      return;
    }
    setSaving(true);
    try {
      const { day: next } = await api.addMeal({
        date,
        meal_type: mealType,
        label: mealType,
        kcal: value,
      });
      setDay(next);
      setKcal('');
      setOpenTypes((prev) => {
        const nextOpen = new Set(prev);
        nextOpen.delete(mealType);
        return nextOpen;
      });
      toast('Comida registrada');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      const { day: next } = await api.deleteMeal(id);
      setDay(next);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const saveMeta = async (patch: {
    weight?: number | null;
    training?: boolean | null;
    notes?: string;
  }) => {
    try {
      const { day: next } = await api.putDay(date, patch);
      setDay({ ...day, ...next, consumed: day.consumed, goal: day.goal, plan: day.plan });
      // refresh full
      await load();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const dow = new Date(date + 'T12:00:00').getDay();

  return (
    <div className="screen">
      <div className="ring-wrap">
        <div className="ring-center">
          <svg viewBox="0 0 190 190">
            <circle cx="95" cy="95" r="82" fill="none" stroke="var(--surface-alt)" strokeWidth="14" />
            <circle
              cx="95"
              cy="95"
              r="82"
              fill="none"
              stroke="var(--teal)"
              strokeWidth="14"
              strokeLinecap="round"
              transform="rotate(-90 95 95)"
              strokeDasharray={`${dash} ${circumference}`}
              style={{ transition: 'stroke-dasharray 0.4s ease' }}
            />
          </svg>
          <div className="ring-labels">
            <div className="big mono">{Math.round(consumed)}</div>
            <div className="small">
              de <span className="mono">{goal || '—'}</span> kcal
            </div>
            {qualityAvg != null && (
              <div className={`quality-day tone-${qualityTone(qualityAvg)}`}>
                Calidad {qualityAvg}/5
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Registrar comida</div>
        <div className="meal-grid">
          {MEAL_TYPES.map((m) => (
            <button
              key={m}
              type="button"
              className={`meal-btn${mealType === m ? ' active' : ''}`}
              onClick={() => setMealType(m)}
            >
              {m}
            </button>
          ))}
        </div>
        <div className="add-row">
          <input
            type="number"
            inputMode="numeric"
            placeholder="kcal"
            value={kcal}
            onChange={(e) => setKcal(e.target.value)}
          />
          <button className="primary" type="button" disabled={saving} onClick={() => void addManual()}>
            Sumar
          </button>
        </div>
        <div className="actions-row">
          <button className="ghost" type="button" onClick={() => setAiOpen(true)}>
            Asistente AI
          </button>
        </div>
        <div className="meal-list">
          {groups.map((g) => {
            const open = openTypes.has(g.type);
            return (
              <div className={`meal-group${open ? ' open' : ''}`} key={g.type}>
                <button
                  type="button"
                  className="meal-group-head"
                  aria-expanded={open}
                  onClick={() => toggleType(g.type)}
                >
                  <span className="meal-group-chevron" aria-hidden>
                    {open ? '▾' : '▸'}
                  </span>
                  <span className="meal-group-title">{g.type}</span>
                  <span className="muted meal-group-count">
                    {g.meals.length} {g.meals.length === 1 ? 'ítem' : 'ítems'}
                  </span>
                  <span className="mono meal-group-kcal">{Math.round(g.kcal)}</span>
                </button>
                {open && (
                  <div className="meal-group-body">
                    {g.meals.map((m) => {
                      const img = mealImageUrl(m.image_path);
                      const q = m.quality_score;
                      return (
                        <div className="meal-item" key={m.id}>
                          {img && <img className="meal-thumb" src={img} alt="" />}
                          <div className="meta" style={{ flex: 1 }}>
                            <strong>{m.label}</strong>
                            <span className="muted">
                              {m.source !== 'manual' ? m.source : 'manual'}
                            </span>
                            {q != null && (
                              <span
                                className={`quality-chip tone-${qualityTone(q)}`}
                                title={m.quality_note ?? undefined}
                              >
                                {q}/5 · {QUALITY_LABELS[q] ?? '—'}
                              </span>
                            )}
                          </div>
                          <span className="mono">{Math.round(m.kcal)}</span>
                          <button
                            type="button"
                            className="remove"
                            aria-label="Eliminar"
                            onClick={() => void remove(m.id)}
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {day.meals.length === 0 && <p className="muted">Sin comidas todavía.</p>}
        </div>
      </div>

      <div className="card">
        <div className="card-title">Datos del día · {DIAS_FULL[dow]}</div>
        <div className="row">
          <span>Peso (kg)</span>
          <input
            type="number"
            step="0.1"
            style={{ width: 90, textAlign: 'right' }}
            value={day.weight ?? ''}
            placeholder="—"
            onChange={(e) =>
              setDay({ ...day, weight: e.target.value === '' ? null : Number(e.target.value) })
            }
            onBlur={(e) =>
              void saveMeta({
                weight: e.target.value === '' ? null : Number(e.target.value),
              })
            }
          />
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <span>Entrenamiento</span>
          <div className="seg" style={{ width: 120 }}>
            <button
              type="button"
              className={day.training === true ? 'on' : ''}
              onClick={() => void saveMeta({ training: true })}
            >
              Sí
            </button>
            <button
              type="button"
              className={day.training === false ? 'on' : ''}
              onClick={() => void saveMeta({ training: false })}
            >
              No
            </button>
          </div>
        </div>
        <div className="field">
          <label>Notas</label>
          <textarea
            value={day.notes}
            placeholder="Cómo viniste hoy, apetito, sueño…"
            onChange={(e) => setDay({ ...day, notes: e.target.value })}
            onBlur={(e) => void saveMeta({ notes: e.target.value })}
          />
        </div>
        {day.plan && (
          <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>
            Plan: {day.plan.mid_label} / {day.plan.late_label}
          </p>
        )}
      </div>

      {aiOpen && (
        <AiAssistSheet
          mealType={mealType}
          date={date}
          onClose={() => setAiOpen(false)}
          onDone={async () => {
            setAiOpen(false);
            await load();
            setOpenTypes(new Set());
            toast('Registro AI guardado');
          }}
        />
      )}
    </div>
  );
}
