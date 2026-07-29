import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { DIAS_FULL, type PlanDay } from '../lib/types';

type Props = { toast: (msg: string) => void };

const KEY_OPTS = [
  { value: 'kcal_gym', label: 'Gym' },
  { value: 'kcal_kick', label: 'Kick' },
  { value: 'kcal_walk', label: 'Caminata' },
] as const;

export function PlanTab({ toast }: Props) {
  const [days, setDays] = useState<PlanDay[]>([]);
  const [derived, setDerived] = useState({ tmb: 0, base: 0, floor: 0 });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api
      .getPlan()
      .then((r) => {
        setDays(r.days);
        setDerived(r.derived);
      })
      .catch((e) => toast((e as Error).message));
  }, []);

  const updateDay = (weekday: number, patch: Partial<PlanDay>) => {
    setDays((prev) => prev.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)));
  };

  const toggleKey = (weekday: number, key: (typeof KEY_OPTS)[number]['value']) => {
    setDays((prev) =>
      prev.map((d) => {
        if (d.weekday !== weekday) return d;
        const has = d.activity_keys.includes(key);
        return {
          ...d,
          activity_keys: has
            ? d.activity_keys.filter((k) => k !== key)
            : [...d.activity_keys, key],
        };
      }),
    );
  };

  const save = async () => {
    setSaving(true);
    try {
      const { days: next } = await api.putPlan(
        days.map(({ weekday, mid_label, late_label, activity_keys }) => ({
          weekday,
          mid_label,
          late_label,
          activity_keys,
        })),
      );
      setDays(next);
      toast('Plan guardado');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="screen">
      <div className="card">
        <div className="card-title">Rutina editable</div>
        {days.map((d) => (
          <div className="plan-row" key={d.weekday}>
            <div className="row">
              <strong>{DIAS_FULL[d.weekday]}</strong>
              <span className="mono muted">{d.objetivo ?? '—'} kcal</span>
            </div>
            <input
              type="text"
              value={d.mid_label}
              onChange={(e) => updateDay(d.weekday, { mid_label: e.target.value })}
              placeholder="Mediodía"
            />
            <input
              type="text"
              value={d.late_label}
              onChange={(e) => updateDay(d.weekday, { late_label: e.target.value })}
              placeholder="Tarde / noche"
            />
            <div className="actions-row">
              {KEY_OPTS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`meal-btn${d.activity_keys.includes(opt.value) ? ' active' : ''}`}
                  style={{ padding: '6px 10px', fontSize: 12 }}
                  onClick={() => toggleKey(d.weekday, opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        ))}
        <button
          className="primary"
          type="button"
          style={{ width: '100%', marginTop: 12, padding: 13 }}
          disabled={saving}
          onClick={() => void save()}
        >
          Guardar plan
        </button>
      </div>

      <div className="card">
        <div className="card-title">Referencia</div>
        <div className="row">
          <span className="muted">TMB</span>
          <span className="mono">{derived.tmb}</span>
        </div>
        <div className="row">
          <span className="muted">Kcal base (sedentario)</span>
          <span className="mono">{derived.base}</span>
        </div>
        <div className="row">
          <span className="muted">Piso de seguridad</span>
          <span className="mono">{derived.floor}</span>
        </div>
      </div>
    </div>
  );
}
