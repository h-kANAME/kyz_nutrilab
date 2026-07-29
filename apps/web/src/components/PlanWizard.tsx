import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import {
  DIAS_FULL,
  type ActivitySlot,
  type PlanDay,
  type UserActivity,
} from '../lib/types';

type Props = {
  onDone: () => void;
  toast: (msg: string) => void;
};

const STEPS = ['Actividades', 'Semana'] as const;

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

function emptyWeek(): PlanDay[] {
  return Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    mid_label: '-',
    late_label: 'Descanso',
    activity_keys: [],
    activity_slots: [],
  }));
}

export function PlanWizard({ onDone, toast }: Props) {
  const [step, setStep] = useState(0);
  const [activities, setActivities] = useState<UserActivity[]>([]);
  const [days, setDays] = useState<PlanDay[]>(emptyWeek);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [customLabel, setCustomLabel] = useState('');
  const [customKcal, setCustomKcal] = useState('200');

  useEffect(() => {
    void Promise.all([api.getActivities(), api.getPlan()])
      .then(([act, plan]) => {
        setActivities(act.activities);
        setDays(
          plan.days.length === 7
            ? plan.days.map((d) => withSlots(d, slotsOf(d)))
            : emptyWeek(),
        );
        setLoaded(true);
      })
      .catch((e) => toast((e as Error).message));
  }, [toast]);

  const patchActivity = async (id: string, kcal: number) => {
    try {
      const { activities: next } = await api.updateActivity(id, { kcal });
      setActivities(next);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const addCustom = async () => {
    const label = customLabel.trim();
    const kcal = Number(customKcal);
    if (!label) {
      setError('Poné un nombre para la actividad');
      return;
    }
    if (!Number.isFinite(kcal) || kcal < 0) {
      setError('Kcal inválidas');
      return;
    }
    setError('');
    try {
      const { activities: next } = await api.createActivity({ label, kcal });
      setActivities(next);
      setCustomLabel('');
      setCustomKcal('200');
      toast('Actividad agregada');
    } catch (e) {
      setError((e as Error).message);
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

  const toggleDay = (weekday: number, key: string, catalogLabel: string) => {
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

  const finish = async () => {
    setSaving(true);
    setError('');
    try {
      await api.completePlanOnboarding(
        days.map(({ weekday, activity_keys, activity_slots }) => ({
          weekday,
          mid_label: '-',
          late_label: 'Descanso',
          activity_keys,
          activity_slots: activity_slots ?? [],
        })),
      );
      onDone();
      toast('Plan listo');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return <div className="loading">Preparando plan…</div>;

  return (
    <div className="onboarding">
      <div className="onboarding-brand">
        <img src="/favicon.svg" alt="" width={48} height={48} />
        <div>
          <div className="eyebrow">KYZ NutriLab</div>
          <h1>Tu plan semanal</h1>
        </div>
      </div>

      <div className="onboarding-steps" aria-label="Progreso" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {STEPS.map((label, i) => (
          <div
            key={label}
            className={`onboarding-step${i === step ? ' on' : ''}${i < step ? ' done' : ''}`}
          >
            <span className="onboarding-step-num">{i + 1}</span>
            <span className="onboarding-step-label">{label}</span>
          </div>
        ))}
      </div>

      <div className="card onboarding-card">
        {step === 0 && (
          <>
            <div className="card-title">Actividades</div>
            <p className="field-hint">
              Etiquetas genéricas + las tuyas. Las custom solo las ves vos en este perfil.
            </p>
            <div className="activity-edit-list">
              {activities.map((a) => (
                <div className="activity-edit-row" key={a.id}>
                  <div className="activity-edit-meta">
                    <strong>{a.label}</strong>
                    <span className="muted">{a.is_builtin ? 'Base' : 'Custom'}</span>
                  </div>
                  <input
                    type="number"
                    style={{ width: 88 }}
                    value={a.kcal}
                    onChange={(e) => {
                      const kcal = Number(e.target.value);
                      setActivities((prev) =>
                        prev.map((x) => (x.id === a.id ? { ...x, kcal } : x)),
                      );
                    }}
                    onBlur={(e) => void patchActivity(a.id, Number(e.target.value) || 0)}
                  />
                  {!a.is_builtin && (
                    <button
                      type="button"
                      className="remove"
                      aria-label="Eliminar"
                      onClick={() => void removeCustom(a.id)}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="card-title" style={{ marginTop: 16 }}>
              Agregar otra
            </div>
            <div className="add-row">
              <input
                type="text"
                placeholder="ej. Natación"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
              />
              <input
                type="number"
                style={{ width: 88 }}
                placeholder="kcal"
                value={customKcal}
                onChange={(e) => setCustomKcal(e.target.value)}
              />
              <button type="button" className="ghost" onClick={() => void addCustom()}>
                +
              </button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div className="card-title">Semana</div>
            <p className="field-hint">Un campo por tag: nombre libre + horario. Sin tags = descanso.</p>
            {days.map((d) => {
              const slots = slotsOf(d);
              return (
                <div className="plan-row" key={d.weekday} style={{ marginBottom: 12 }}>
                  <div className="row">
                    <strong>{DIAS_FULL[d.weekday]}</strong>
                    <span className="muted">
                      {slots.length === 0
                        ? 'Descanso'
                        : slots
                            .map((s) => (s.time ? `${s.label} ${s.time}` : s.label))
                            .join(' · ')}
                    </span>
                  </div>
                  {slots.length > 0 && (
                    <div className="slot-list">
                      {slots.map((s) => (
                        <div className="slot-row" key={s.key}>
                          <input
                            type="text"
                            value={s.label}
                            placeholder="Nombre"
                            onChange={(e) =>
                              patchSlot(d.weekday, s.key, { label: e.target.value })
                            }
                          />
                          <input
                            type="time"
                            value={s.time}
                            aria-label={`Horario ${s.label}`}
                            onChange={(e) =>
                              patchSlot(d.weekday, s.key, { time: e.target.value })
                            }
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="actions-row">
                    {activities.map((a) => (
                      <button
                        key={a.key}
                        type="button"
                        className={`meal-btn${slots.some((s) => s.key === a.key) ? ' active' : ''}`}
                        style={{ padding: '6px 10px', fontSize: 12 }}
                        onClick={() => toggleDay(d.weekday, a.key, a.label)}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {error && <p className="onboarding-error">{error}</p>}
      </div>

      <div className="onboarding-actions">
        {step > 0 ? (
          <button type="button" className="ghost" onClick={() => setStep(0)}>
            Atrás
          </button>
        ) : (
          <span />
        )}
        {step === 0 ? (
          <button type="button" className="primary" onClick={() => setStep(1)}>
            Continuar
          </button>
        ) : (
          <button type="button" className="primary" disabled={saving} onClick={() => void finish()}>
            {saving ? 'Guardando…' : 'Guardar plan'}
          </button>
        )}
      </div>
    </div>
  );
}
