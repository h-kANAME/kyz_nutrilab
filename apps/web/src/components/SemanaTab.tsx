import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import {
  DIAS,
  MEAL_TYPES,
  addDays,
  formatPlanDay,
  formatWeekLabel,
  todayKey,
  weekEnd,
  weekStart,
  weightedQualityAvg,
  qualityTone,
  type DayLog,
  type Meal,
} from '../lib/types';

type Props = { toast: (msg: string) => void };

function sortMeals(meals: Meal[]): Meal[] {
  const order = new Map(MEAL_TYPES.map((t, i) => [t, i]));
  return [...meals].sort(
    (a, b) =>
      (order.get(a.meal_type as (typeof MEAL_TYPES)[number]) ?? 99) -
        (order.get(b.meal_type as (typeof MEAL_TYPES)[number]) ?? 99) ||
      a.created_at.localeCompare(b.created_at),
  );
}

export function SemanaTab({ toast }: Props) {
  const [mode, setMode] = useState<'week' | 'range'>('week');
  const [anchor, setAnchor] = useState(() => weekStart(todayKey()));
  const [from, setFrom] = useState(() => weekStart(todayKey()));
  const [to, setTo] = useState(() => weekEnd(weekStart(todayKey())));
  const [days, setDays] = useState<DayLog[]>([]);
  const [openDays, setOpenDays] = useState<Set<string>>(() => new Set());
  const touchX = useRef<number | null>(null);

  const rangeFrom = mode === 'week' ? anchor : from;
  const rangeTo = mode === 'week' ? weekEnd(anchor) : to;

  const load = async () => {
    if (rangeFrom > rangeTo) {
      toast('Desde debe ser ≤ Hasta');
      return;
    }
    try {
      const { days: next } = await api.getDays(rangeFrom, rangeTo);
      setDays(next);
      setOpenDays(new Set(next.filter((d) => d.meals.length > 0).map((d) => d.date)));
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const toggleDay = (date: string) => {
    setOpenDays((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  useEffect(() => {
    void load();
  }, [rangeFrom, rangeTo, mode]);

  const onTouchStart = (e: React.TouchEvent) => {
    touchX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current == null || mode !== 'week') return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) < 50) return;
    setAnchor((a) => addDays(a, dx < 0 ? 7 : -7));
  };

  const avgCons =
    days.length === 0 ? 0 : days.reduce((s, d) => s + (d.consumed ?? 0), 0) / days.length;
  const avgGoal =
    days.length === 0 ? 0 : days.reduce((s, d) => s + (d.goal ?? 0), 0) / days.length;
  const balance = days.reduce((s, d) => s + ((d.consumed ?? 0) - (d.goal ?? 0)), 0);

  const qualityDays = days
    .map((d) => d.quality_avg ?? weightedQualityAvg(d.meals))
    .filter((q): q is number => q != null);
  const avgQuality =
    qualityDays.length === 0
      ? null
      : Math.round((qualityDays.reduce((s, q) => s + q, 0) / qualityDays.length) * 10) / 10;

  return (
    <div className="screen">
      <div className="card">
        <div className="card-title">Período</div>
        <div className="seg">
          <button type="button" className={mode === 'week' ? 'on' : ''} onClick={() => setMode('week')}>
            Semana
          </button>
          <button type="button" className={mode === 'range' ? 'on' : ''} onClick={() => setMode('range')}>
            Rango
          </button>
        </div>

        {mode === 'week' ? (
          <div
            className="week-carousel"
            style={{ marginTop: 12 }}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            <div className="week-nav">
              <button type="button" className="ghost" onClick={() => setAnchor((a) => addDays(a, -7))}>
                ←
              </button>
              <div className="label">{formatWeekLabel(anchor)}</div>
              <button type="button" className="ghost" onClick={() => setAnchor((a) => addDays(a, 7))}>
                →
              </button>
            </div>
            <p className="muted" style={{ fontSize: 12, textAlign: 'center', margin: 0 }}>
              Deslizá o usá las flechas
            </p>
          </div>
        ) : (
          <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
            <div className="field" style={{ marginTop: 0 }}>
              <label>Desde</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="field" style={{ marginTop: 0 }}>
              <label>Hasta</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">Consumo vs objetivo</div>
        {days.map((d) => {
          const dow = new Date(d.date + 'T12:00:00').getDay();
          const cons = d.consumed ?? 0;
          const goal = d.goal ?? 1;
          const pct = Math.min((cons / goal) * 100, 100);
          const q = d.quality_avg ?? weightedQualityAvg(d.meals);
          const activity = d.plan ? formatPlanDay(d.plan) : null;
          const meta: string[] = [];
          if (d.training === true) meta.push('Entrenó');
          if (d.training === false) meta.push('Sin entrenamiento');
          if (d.weight != null) meta.push(`${d.weight} kg`);
          const open = openDays.has(d.date);
          const meals = sortMeals(d.meals);
          return (
            <div className={`week-day-block${open ? ' open' : ''}`} key={d.date}>
              <button
                type="button"
                className="week-day-head"
                aria-expanded={open}
                onClick={() => toggleDay(d.date)}
              >
                <span className={`chevron${open ? ' open' : ''}`} aria-hidden />
                <div className="week-row">
                  <div className="week-day">{DIAS[dow]}</div>
                  <div className="week-bar-track">
                    <div className="week-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="week-kcal mono">
                    {Math.round(cons)}/{Math.round(goal)}
                    {q != null && (
                      <span className={`quality-mini tone-${qualityTone(q)}`}> · {q}</span>
                    )}
                  </div>
                </div>
              </button>
              {(activity || meta.length > 0) && (
                <div className="week-activity">
                  {activity && <span className="week-activity-plan">{activity}</span>}
                  {meta.map((m) => (
                    <span className="week-activity-meta" key={m}>
                      {m}
                    </span>
                  ))}
                </div>
              )}
              {open && (
                <div className="week-meals">
                  {meals.length === 0 ? (
                    <p className="muted week-meals-empty">Sin comidas cargadas</p>
                  ) : (
                    meals.map((m) => (
                      <div className="week-meal" key={m.id}>
                        <div className="week-meal-main">
                          <strong>{m.meal_type}</strong>
                          <span className="muted">{m.label}</span>
                          {m.quality_score != null && (
                            <span
                              className={`quality-mini tone-${qualityTone(m.quality_score)}`}
                              title={m.quality_note ?? undefined}
                            >
                              {m.quality_score}/5
                            </span>
                          )}
                        </div>
                        <span className="mono week-meal-kcal">{Math.round(m.kcal)}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
        {days.length === 0 && <p className="muted">Sin datos en el período.</p>}
      </div>

      <div className="card">
        <div className="card-title">Balance</div>
        <div className="row">
          <span className="muted">Promedio consumido</span>
          <span className="mono">{Math.round(avgCons)}</span>
        </div>
        <div className="row">
          <span className="muted">Promedio objetivo</span>
          <span className="mono">{Math.round(avgGoal)}</span>
        </div>
        <div className="row">
          <span className="muted">Calidad media (AI)</span>
          <span className={`mono tone-${qualityTone(avgQuality)}`}>
            {avgQuality != null ? `${avgQuality}/5` : '—'}
          </span>
        </div>
        <div className="row">
          <span className="muted">Balance acumulado</span>
          <span className="mono" style={{ color: balance > 0 ? 'var(--coral)' : 'var(--teal)' }}>
            {balance > 0 ? '+' : ''}
            {Math.round(balance)}
          </span>
        </div>
        <p className="field-hint" style={{ marginTop: 10 }}>
          Misma kcal, distinta calidad: subí el score priorizando proteína magra y menos frituras /
          ultraprocesados.
        </p>
      </div>
    </div>
  );
}
