import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { ACTIVITY_FACTOR_PRESETS, computeLocalFormula } from '../lib/formula';
import type { Settings } from '../lib/types';

type Props = {
  onDone: (settings: Settings) => void;
  toast: (msg: string) => void;
};

const STEPS = ['Tu cuerpo', 'Tu día a día', 'Ritmo de baja'] as const;

const DEFICIT_PRESETS = [
  { value: 200, label: 'Suave', hint: '~0,2 kg/sem' },
  { value: 300, label: 'Moderado', hint: '~0,3 kg/sem' },
  { value: 500, label: 'Intenso', hint: '~0,5 kg/sem' },
] as const;

const EMPTY: Settings = {
  edad: 0,
  peso: 0,
  altura: 0,
  sexo: 'M',
  deficit: 300,
  minimo: 1800,
  activity_factor: 1.2,
  kcal_gym: 300,
  kcal_kick: 400,
  kcal_walk: 150,
  kcal_bike: 250,
  theme: 'dark',
  llm_provider: 'openai',
  peso_objetivo: null,
  peso_objetivo_desde: null,
};

export function OnboardingWizard({ onDone, toast }: Props) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Settings>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void api
      .getSettings()
      .then((r) => {
        const preferred =
          r.llmProviders?.find((p) => p.id === r.settings.llm_provider && p.configured) ??
          r.llmProviders?.find((p) => p.configured);
        setForm({
          edad: 0,
          peso: 0,
          altura: 0,
          sexo: 'M',
          deficit: 300,
          minimo: 1800,
          activity_factor: 1.2,
          kcal_gym: 300,
          kcal_kick: 400,
          kcal_walk: 150,
          kcal_bike: 250,
          theme: r.settings.theme || 'dark',
          llm_provider: preferred?.id ?? 'openai',
          peso_objetivo: null,
          peso_objetivo_desde: null,
        });
        setLoaded(true);
      })
      .catch((e) => toast((e as Error).message));
  }, [toast]);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setError('');
  };

  const formula = useMemo(() => computeLocalFormula(form, []), [form]);
  const suggestedMin = Math.max(form.sexo === 'F' ? 1500 : 1800, Math.round(formula.tmb) || 1800);
  const paceKg = form.deficit / 7700;

  const validateStep = (s: number): string | null => {
    if (s === 0) {
      if (!form.edad || form.edad < 10 || form.edad > 120) return 'Ingresá una edad válida';
      if (!form.peso || form.peso < 30 || form.peso > 400) return 'Ingresá tu peso en kg';
      if (!form.altura || form.altura < 100 || form.altura > 250) return 'Ingresá tu altura en cm';
    }
    if (s === 1) {
      if (form.activity_factor < 1 || form.activity_factor > 2.5) return 'Elegí un nivel de movimiento';
      if (
        form.kcal_gym < 0 ||
        form.kcal_kick < 0 ||
        form.kcal_walk < 0 ||
        (form.kcal_bike ?? 0) < 0
      ) {
        return 'Las kcal de entrenamiento no pueden ser negativas';
      }
    }
    if (s === 2) {
      if (form.deficit < 0 || form.deficit > 2000) return 'Revisá el ritmo de baja';
      if (form.minimo < 800 || form.minimo > 6000) return 'Revisá el mínimo de seguridad';
    }
    return null;
  };

  const next = () => {
    const err = validateStep(step);
    if (err) {
      setError(err);
      return;
    }
    if (step === 0 && form.minimo === 1800) {
      // sugerir piso al pasar de cuerpo
      setForm((f) => ({
        ...f,
        minimo: Math.max(f.sexo === 'F' ? 1500 : 1800, Math.round(10 * f.peso + 6.25 * f.altura - 5 * f.edad + (f.sexo === 'M' ? 5 : -161))),
      }));
    }
    setStep((x) => Math.min(x + 1, STEPS.length - 1));
  };

  const back = () => {
    setError('');
    setStep((x) => Math.max(x - 1, 0));
  };

  const finish = async () => {
    const err = validateStep(2);
    if (err) {
      setError(err);
      return;
    }
    setSaving(true);
    try {
      const { settings } = await api.completeOnboarding(form);
      onDone(settings);
      toast('Perfil listo');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return <div className="loading">Preparando…</div>;

  return (
    <div className="onboarding">
      <div className="onboarding-brand">
        <img src="/favicon.svg" alt="" width={48} height={48} />
        <div>
          <div className="eyebrow">KYZ NutriLab</div>
          <h1>Empecemos</h1>
        </div>
      </div>

      <div className="onboarding-steps" aria-label="Progreso">
        {STEPS.map((label, i) => (
          <div key={label} className={`onboarding-step${i === step ? ' on' : ''}${i < step ? ' done' : ''}`}>
            <span className="onboarding-step-num">{i + 1}</span>
            <span className="onboarding-step-label">{label}</span>
          </div>
        ))}
      </div>

      <div className="card onboarding-card">
        {step === 0 && (
          <>
            <div className="card-title">Tu cuerpo</div>
            <p className="field-hint">Para estimar tu metabolismo en reposo (TMB).</p>
            <div className="field-grid">
              <div className="field" style={{ marginTop: 0 }}>
                <label>Edad</label>
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder="ej. 32"
                  value={form.edad || ''}
                  onChange={(e) => set('edad', Number(e.target.value) || 0)}
                />
              </div>
              <div className="field" style={{ marginTop: 0 }}>
                <label>Peso (kg)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  placeholder="ej. 72.5"
                  value={form.peso || ''}
                  onChange={(e) => set('peso', Number(e.target.value) || 0)}
                />
              </div>
              <div className="field" style={{ marginTop: 0 }}>
                <label>Altura (cm)</label>
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder="ej. 175"
                  value={form.altura || ''}
                  onChange={(e) => set('altura', Number(e.target.value) || 0)}
                />
              </div>
            </div>
            <div className="field">
              <label>Sexo</label>
              <div className="seg">
                <button type="button" className={form.sexo === 'M' ? 'on' : ''} onClick={() => set('sexo', 'M')}>
                  Masculino
                </button>
                <button type="button" className={form.sexo === 'F' ? 'on' : ''} onClick={() => set('sexo', 'F')}>
                  Femenino
                </button>
              </div>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div className="card-title">Tu día a día</div>
            <p className="field-hint">
              Movimiento habitual fuera del gym. El calendario de entrenos lo armás después en Plan.
            </p>
            <div className="field" style={{ marginTop: 0 }}>
              <label>Nivel de movimiento</label>
              <select
                value={form.activity_factor}
                onChange={(e) => set('activity_factor', Number(e.target.value))}
              >
                {ACTIVITY_FACTOR_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="card-title" style={{ marginTop: 18 }}>
              Entrenamientos (kcal por sesión)
            </div>
            <p className="field-hint">Se suman solo los días que marques en Plan.</p>
            <div className="field" style={{ marginTop: 0 }}>
              <label>Gym</label>
              <input
                type="number"
                value={form.kcal_gym}
                onChange={(e) => set('kcal_gym', Number(e.target.value))}
              />
            </div>
            <div className="field">
              <label>Kickboxing / HIIT</label>
              <input
                type="number"
                value={form.kcal_kick}
                onChange={(e) => set('kcal_kick', Number(e.target.value))}
              />
            </div>
            <div className="field">
              <label>Caminata</label>
              <input
                type="number"
                value={form.kcal_walk}
                onChange={(e) => set('kcal_walk', Number(e.target.value))}
              />
            </div>
            <div className="field">
              <label>Bici</label>
              <input
                type="number"
                value={form.kcal_bike ?? 250}
                onChange={(e) => set('kcal_bike', Number(e.target.value))}
              />
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="card-title">Ritmo de baja</div>
            <p className="field-hint">
              Cuánto querés comer por debajo de tu gasto. Más déficit = baja más rápido.
            </p>
            <div className="chip-row">
              {DEFICIT_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className={`chip${form.deficit === p.value ? ' on' : ''}`}
                  onClick={() => set('deficit', p.value)}
                >
                  <span className="chip-label">{p.label}</span>
                  <span className="chip-meta">
                    −{p.value} · {p.hint}
                  </span>
                </button>
              ))}
            </div>
            <div className="field">
              <label>Personalizado (kcal/día)</label>
              <input
                type="number"
                value={form.deficit}
                onChange={(e) => set('deficit', Number(e.target.value))}
              />
            </div>

            <div className="card-title" style={{ marginTop: 18 }}>
              Límite de seguridad
            </div>
            <p className="field-hint">El objetivo diario nunca baja de este piso.</p>
            <div className="field" style={{ marginTop: 0 }}>
              <label>Mínimo (kcal/día)</label>
              <input
                type="number"
                value={form.minimo}
                onChange={(e) => set('minimo', Number(e.target.value))}
              />
            </div>
            <button
              type="button"
              className="ghost"
              style={{ width: '100%', marginTop: 8 }}
              onClick={() => set('minimo', suggestedMin)}
            >
              Usar sugerido ({suggestedMin} kcal)
            </button>

            {form.peso > 0 && form.altura > 0 && form.edad > 0 && (
              <div className="onboarding-preview">
                <div className="row">
                  <span className="muted">TMB estimado</span>
                  <span className="mono">{formula.tmb}</span>
                </div>
                <div className="row">
                  <span className="muted">Base (× movimiento)</span>
                  <span className="mono">{formula.base}</span>
                </div>
                <div className="row">
                  <span className="muted">Ritmo ≈</span>
                  <span className="mono">~{paceKg.toFixed(1).replace('.', ',')} kg/sem</span>
                </div>
                <div className="row formula-result">
                  <span>Meta en día de descanso</span>
                  <span className="mono">{formula.goal} kcal</span>
                </div>
              </div>
            )}
          </>
        )}

        {error && <p className="onboarding-error">{error}</p>}
      </div>

      <div className="onboarding-actions">
        {step > 0 ? (
          <button type="button" className="ghost" onClick={back}>
            Atrás
          </button>
        ) : (
          <span />
        )}
        {step < STEPS.length - 1 ? (
          <button type="button" className="primary" onClick={next}>
            Continuar
          </button>
        ) : (
          <button type="button" className="primary" disabled={saving} onClick={() => void finish()}>
            {saving ? 'Guardando…' : 'Empezar a trackear'}
          </button>
        )}
      </div>

      <p className="muted onboarding-foot">
        Después podés ajustar todo en Ajustes y armar tu Plan semanal.
      </p>
    </div>
  );
}
