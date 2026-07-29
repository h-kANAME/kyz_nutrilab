import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import {
  DIAS_FULL,
  type ActivitySlot,
  type PlanDay,
  type UserActivity,
} from '../lib/types';

type Props = { toast: (msg: string) => void };

function slotsOf(d: PlanDay): ActivitySlot[] {
  if (d.activity_slots?.length) return d.activity_slots;
  return (d.activity_keys ?? []).map((key) => ({ key, label: key, time: '' }));
}

function withSlots(d: PlanDay, slots: ActivitySlot[]): PlanDay {
  return {
    ...d,
    activity_slots: slots,
    activity_keys: slots.map((s) => s.key),
  };
}

export function PlanTab({ toast }: Props) {
  const [days, setDays] = useState<PlanDay[]>([]);
  const [activities, setActivities] = useState<UserActivity[]>([]);
  const [derived, setDerived] = useState({ tmb: 0, base: 0, floor: 0 });
  const [saving, setSaving] = useState(false);
  const [customLabel, setCustomLabel] = useState('');
  const [customKcal, setCustomKcal] = useState('200');

  const load = async () => {
    const r = await api.getPlan();
    setDays(r.days.map((d) => withSlots(d, slotsOf(d))));
    setDerived(r.derived);
    setActivities(r.activities ?? (await api.getActivities()).activities);
  };

  useEffect(() => {
    void load().catch((e) => toast((e as Error).message));
  }, []);

  const toggleKey = (weekday: number, key: string, catalogLabel: string) => {
    setDays((prev) =>
      prev.map((d) => {
        if (d.weekday !== weekday) return d;
        const slots = slotsOf(d);
        const has = slots.some((s) => s.key === key);
        const next = has
          ? slots.filter((s) => s.key !== key)
          : [...slots, { key, label: catalogLabel, time: '' }];
        return withSlots(d, next);
      }),
    );
  };

  const patchSlot = (weekday: number, key: string, patch: Partial<ActivitySlot>) => {
    setDays((prev) =>
      prev.map((d) => {
        if (d.weekday !== weekday) return d;
        return withSlots(
          d,
          slotsOf(d).map((s) => (s.key === key ? { ...s, ...patch } : s)),
        );
      }),
    );
  };

  const save = async () => {
    setSaving(true);
    try {
      const { days: next, activities: acts } = await api.putPlan(
        days.map(({ weekday, activity_slots, activity_keys }) => ({
          weekday,
          mid_label: '-',
          late_label: 'Descanso',
          activity_keys,
          activity_slots: activity_slots ?? [],
        })),
      );
      setDays(next.map((d) => withSlots(d, slotsOf(d))));
      if (acts) setActivities(acts);
      toast('Plan guardado');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const addCustom = async () => {
    const label = customLabel.trim();
    const kcal = Number(customKcal);
    if (!label) {
      toast('Nombre requerido');
      return;
    }
    try {
      const { activities: next } = await api.createActivity({ label, kcal });
      setActivities(next);
      setCustomLabel('');
      toast('Actividad agregada');
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const removeCustom = async (id: string) => {
    try {
      const { activities: next } = await api.deleteActivity(id);
      setActivities(next);
      const allowed = new Set(next.map((a) => a.key));
      setDays((prev) =>
        prev.map((d) => withSlots(d, slotsOf(d).filter((s) => allowed.has(s.key)))),
      );
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <div className="screen">
      <div className="card">
        <div className="card-title">Tus actividades</div>
        <p className="field-hint">Gym, Kick, Caminata, Bici + custom solo de tu perfil.</p>
        <div className="activity-edit-list">
          {activities.map((a) => (
            <div className="activity-edit-row" key={a.id}>
              <div className="activity-edit-meta">
                <strong>{a.label}</strong>
                <span className="muted">{a.kcal} kcal · {a.is_builtin ? 'base' : 'custom'}</span>
              </div>
              {!a.is_builtin && (
                <button type="button" className="remove" onClick={() => void removeCustom(a.id)}>
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="add-row">
          <input
            type="text"
            placeholder="Nueva actividad"
            value={customLabel}
            onChange={(e) => setCustomLabel(e.target.value)}
          />
          <input
            type="number"
            style={{ width: 88 }}
            value={customKcal}
            onChange={(e) => setCustomKcal(e.target.value)}
          />
          <button type="button" className="ghost" onClick={() => void addCustom()}>
            +
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Rutina semanal</div>
        <p className="field-hint">Un campo por tag: nombre libre + horario.</p>
        {days.map((d) => {
          const slots = slotsOf(d);
          return (
            <div className="plan-row" key={d.weekday}>
              <div className="row">
                <strong>{DIAS_FULL[d.weekday]}</strong>
                <span className="mono muted">{d.objetivo ?? '—'} kcal</span>
              </div>
              {slots.length > 0 ? (
                <div className="slot-list">
                  {slots.map((s) => (
                    <div className="slot-row" key={s.key}>
                      <input
                        type="text"
                        value={s.label}
                        placeholder="Nombre"
                        onChange={(e) => patchSlot(d.weekday, s.key, { label: e.target.value })}
                      />
                      <input
                        type="time"
                        value={s.time}
                        aria-label={`Horario ${s.label}`}
                        onChange={(e) => patchSlot(d.weekday, s.key, { time: e.target.value })}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  Descanso — elegí tags abajo
                </p>
              )}
              <div className="actions-row">
                {activities.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    className={`meal-btn${slots.some((s) => s.key === opt.key) ? ' active' : ''}`}
                    style={{ padding: '6px 10px', fontSize: 12 }}
                    onClick={() => toggleKey(d.weekday, opt.key, opt.label)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
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
          <span className="muted">Kcal base</span>
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
