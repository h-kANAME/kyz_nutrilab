import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ACTIVITY_FACTOR_PRESETS, computeLocalFormula } from '../lib/formula';
import type { LlmProviderInfo, Settings } from '../lib/types';
import { AlertModal } from './AlertModal';
import { NotificationsCard } from './NotificationsCard';

type Props = {
  toast: (msg: string) => void;
  onTheme: (theme: 'dark' | 'light') => void;
};

const DEFICIT_PRESETS = [
  { value: 200, label: 'Suave', hint: '~0,2 kg/sem' },
  { value: 300, label: 'Moderado', hint: '~0,3 kg/sem' },
  { value: 500, label: 'Intenso', hint: '~0,5 kg/sem' },
] as const;

function InfoButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="info-cta" aria-label={label} onClick={onClick}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 10v6M12 7.5v.5" />
      </svg>
      Info
    </button>
  );
}

export function AjustesTab({ toast, onTheme }: Props) {
  const { user, logout } = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [activities, setActivities] = useState<import('../lib/types').UserActivity[]>([]);
  const [providers, setProviders] = useState<LlmProviderInfo[]>([]);
  const [todayKeys, setTodayKeys] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [factorInfoOpen, setFactorInfoOpen] = useState(false);
  const [goalInfoOpen, setGoalInfoOpen] = useState(false);
  const [showMath, setShowMath] = useState(false);

  useEffect(() => {
    void api
      .getSettings()
      .then((r) => {
        setSettings({
          ...r.settings,
          activity_factor: r.settings.activity_factor ?? 1.2,
          llm_provider: r.settings.llm_provider || 'gemini',
        });
        setActivities(r.activities ?? []);
        setProviders(r.llmProviders ?? []);
        setTodayKeys(r.derived.today_activity_keys ?? []);
        onTheme(r.settings.theme);
      })
      .catch((e) => toast((e as Error).message));
  }, []);

  if (!settings) return <div className="loading">Cargando…</div>;

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings({ ...settings, [key]: value });
  };

  const formula = computeLocalFormula(settings, todayKeys, activities);
  const paceKg = settings.deficit / 7700;
  const suggestedMin = Math.max(
    settings.sexo === 'F' ? 1500 : 1800,
    Math.round(formula.tmb),
  );
  const lifestyleLabel =
    ACTIVITY_FACTOR_PRESETS.find((p) => p.value === settings.activity_factor)?.label ??
    `Personalizado (${settings.activity_factor})`;

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...settings };
      delete (payload as { onboarding_done?: boolean }).onboarding_done;
      delete (payload as { plan_onboarding_done?: boolean }).plan_onboarding_done;
      const { settings: next, llmProviders, derived, activities: acts } = await api.putSettings(payload);
      setSettings({
        ...next,
        activity_factor: next.activity_factor ?? 1.2,
      });
      if (acts) setActivities(acts);
      if (llmProviders) setProviders(llmProviders);
      if (derived.today_activity_keys) setTodayKeys(derived.today_activity_keys);
      onTheme(next.theme);
      localStorage.setItem('nutrilab-theme', next.theme);
      toast('Guardado');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="screen settings-screen">
      <div className="card">
        <div className="profile">
          {user?.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" /> : null}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="name">{user?.name}</div>
            <div className="email">{user?.email}</div>
          </div>
          <button type="button" className="ghost" onClick={() => void logout()}>
            Salir
          </button>
        </div>
        <div className="field" style={{ marginTop: 14 }}>
          <label>Tema</label>
          <div className="seg">
            <button
              type="button"
              className={settings.theme === 'dark' ? 'on' : ''}
              onClick={() => {
                set('theme', 'dark');
                onTheme('dark');
              }}
            >
              Oscuro
            </button>
            <button
              type="button"
              className={settings.theme === 'light' ? 'on' : ''}
              onClick={() => {
                set('theme', 'light');
                onTheme('light');
              }}
            >
              Claro
            </button>
          </div>
        </div>
      </div>

      <NotificationsCard toast={toast} />

      {/* INDICATORS — primary mental model */}
      <div className="card">
        <div className="card-title-row">
          <div className="card-title" style={{ marginBottom: 0 }}>
            Tu objetivo de hoy
          </div>
          <InfoButton label="Cómo se arma el objetivo" onClick={() => setGoalInfoOpen(true)} />
        </div>

        <div className="kpi-grid">
          <div className="kpi">
            <div className="kpi-label">Meta diaria</div>
            <div className="kpi-value">{formula.goal}</div>
            <div className="kpi-unit">kcal</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Ritmo estimado</div>
            <div className="kpi-value">~{paceKg.toFixed(1).replace('.', ',')}</div>
            <div className="kpi-unit">kg / semana</div>
          </div>
          <div className={`kpi${formula.floored ? ' kpi-warn' : ' kpi-ok'}`}>
            <div className="kpi-label">Seguridad</div>
            <div className="kpi-value kpi-value-sm">{formula.floored ? 'Piso' : 'OK'}</div>
            <div className="kpi-unit">
              {formula.floored ? `subió a ${formula.minimo}` : `mín. ${formula.minimo}`}
            </div>
          </div>
        </div>

        <p className="field-hint" style={{ marginTop: 12 }}>
          Esto es lo que vas a ver en la pestaña Hoy. Cambiá los controles de abajo y mirá cómo
          reaccionan estos indicadores.
        </p>
      </div>

      <div className="card">
        <div className="card-title-row">
          <div className="card-title" style={{ marginBottom: 0 }}>
            Ritmo de baja
          </div>
        </div>
        <p className="field-hint">
          Cuánto querés comer por debajo de tu gasto. Más déficit = baja más rápido, pero cuesta
          más sostenerlo.
        </p>
        <div className="chip-row">
          {DEFICIT_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              className={`chip${settings.deficit === p.value ? ' on' : ''}`}
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
            value={settings.deficit}
            onChange={(e) => set('deficit', Number(e.target.value))}
          />
        </div>
      </div>

      <div className="card">
        <div className="card-title-row">
          <div className="card-title" style={{ marginBottom: 0 }}>
            Tu día a día
          </div>
          <InfoButton
            label="Cómo elegir el nivel de movimiento"
            onClick={() => setFactorInfoOpen(true)}
          />
        </div>
        <p className="field-hint">
          Pensá en tu rutina fuera del gym (laburo, caminatas, estar de pie). El entrenamiento del
          Plan se suma aparte.
        </p>
        <div className="field" style={{ marginTop: 0 }}>
          <label>Nivel de movimiento</label>
          <select
            value={settings.activity_factor}
            onChange={(e) => set('activity_factor', Number(e.target.value))}
          >
            {ACTIVITY_FACTOR_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
            {!ACTIVITY_FACTOR_PRESETS.some((p) => p.value === settings.activity_factor) && (
              <option value={settings.activity_factor}>{lifestyleLabel}</option>
            )}
          </select>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Límite de seguridad</div>
        <p className="field-hint">
          El objetivo nunca baja de este número, aunque el ritmo de baja sea agresivo.
        </p>
        <div className="field" style={{ marginTop: 0 }}>
          <label>Mínimo (kcal/día)</label>
          <input
            type="number"
            value={settings.minimo}
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
      </div>

      <div className="card">
        <button
          type="button"
          className="disclosure"
          aria-expanded={showMath}
          onClick={() => setShowMath((v) => !v)}
        >
          <span>{showMath ? 'Ocultar' : 'Ver'} detalle del cálculo</span>
          <span className="disclosure-chevron">{showMath ? '▴' : '▾'}</span>
        </button>
        {showMath && (
          <div className="formula-box" style={{ marginTop: 12 }}>
            <div className="row">
              <span className="muted">Metabolismo basal (TMB)</span>
              <span className="mono">{formula.tmb}</span>
            </div>
            <div className="row">
              <span className="muted">× movimiento ({formula.activity_factor})</span>
              <span className="mono">{formula.base}</span>
            </div>
            <div className="row">
              <span className="muted">+ entrenos de hoy</span>
              <span className="mono">+{formula.activity_kcal}</span>
            </div>
            <div className="row">
              <span className="muted">− ritmo de baja</span>
              <span className="mono">−{formula.deficit}</span>
            </div>
            {formula.floored && (
              <div className="row">
                <span className="muted">Sin piso quedaría</span>
                <span className="mono">{formula.before_floor}</span>
              </div>
            )}
            <div className="row formula-result">
              <span>Meta de hoy</span>
              <span className="mono">{formula.goal} kcal</span>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">Tu cuerpo</div>
        <p className="field-hint">Sirve para estimar cuánta energía gastás en reposo.</p>
        <div className="field-grid">
          <div className="field" style={{ marginTop: 0 }}>
            <label>Edad</label>
            <input
              type="number"
              value={settings.edad}
              onChange={(e) => set('edad', Number(e.target.value))}
            />
          </div>
          <div className="field" style={{ marginTop: 0 }}>
            <label>Peso (kg)</label>
            <input
              type="number"
              step="0.1"
              value={settings.peso}
              onChange={(e) => set('peso', Number(e.target.value))}
            />
          </div>
          <div className="field" style={{ marginTop: 0 }}>
            <label>Altura (cm)</label>
            <input
              type="number"
              value={settings.altura}
              onChange={(e) => set('altura', Number(e.target.value))}
            />
          </div>
        </div>
        <div className="field">
          <label>Sexo</label>
          <div className="seg">
            <button
              type="button"
              className={settings.sexo === 'M' ? 'on' : ''}
              onClick={() => set('sexo', 'M')}
            >
              Masculino
            </button>
            <button
              type="button"
              className={settings.sexo === 'F' ? 'on' : ''}
              onClick={() => set('sexo', 'F')}
            >
              Femenino
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Entrenamientos</div>
        <p className="field-hint">
          Kcal por sesión de las etiquetas base. Bici y actividades custom se gestionan en Plan.
        </p>
        <div className="field" style={{ marginTop: 0 }}>
          <label>Gym por sesión</label>
          <input
            type="number"
            value={settings.kcal_gym}
            onChange={(e) => set('kcal_gym', Number(e.target.value))}
          />
        </div>
        <div className="field">
          <label>Kickboxing por sesión</label>
          <input
            type="number"
            value={settings.kcal_kick}
            onChange={(e) => set('kcal_kick', Number(e.target.value))}
          />
        </div>
        <div className="field">
          <label>Caminata 30′</label>
          <input
            type="number"
            value={settings.kcal_walk}
            onChange={(e) => set('kcal_walk', Number(e.target.value))}
          />
        </div>
        {activities.filter((a) => !a.is_builtin || a.key === 'kcal_bike').length > 0 && (
          <div className="activity-edit-list" style={{ marginTop: 12 }}>
            {activities
              .filter((a) => a.key === 'kcal_bike' || !a.is_builtin)
              .map((a) => (
                <div className="activity-edit-row" key={a.id}>
                  <div className="activity-edit-meta">
                    <strong>{a.label}</strong>
                    <span className="muted">{a.kcal} kcal</span>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">Asistente AI</div>
        <p className="field-hint">Quién estima las kcal cuando describís una comida.</p>
        <div className="field" style={{ marginTop: 0 }}>
          <label>Proveedor</label>
          <select
            value={settings.llm_provider}
            onChange={(e) => set('llm_provider', e.target.value as Settings['llm_provider'])}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.configured}>
                {p.label}
                {!p.configured ? ' (sin key)' : ''}
                {p.supportsVision ? '' : ' · sin fotos'}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="save-bar">
        <button
          className="primary"
          type="button"
          style={{ width: '100%', padding: 13 }}
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>

      {goalInfoOpen && (
        <AlertModal title="Cómo se arma tu meta" onClose={() => setGoalInfoOpen(false)}>
          <p>La app estima cuánto gastás y te propone cuánto comer:</p>
          <ul className="info-list">
            <li>
              <strong>Tu cuerpo</strong> → energía en reposo.
            </li>
            <li>
              <strong>Día a día</strong> → movimiento habitual (laburo, caminar).
            </li>
            <li>
              <strong>Entrenamientos del Plan</strong> → se suman solo si ese día tiene gym/kick/caminata.
            </li>
            <li>
              <strong>Ritmo de baja</strong> → restás kcal para bajar de peso.
            </li>
            <li>
              <strong>Límite de seguridad</strong> → nunca baja de ese piso.
            </li>
          </ul>
          <p className="modal-hint" style={{ marginBottom: 0 }}>
            Tip: mirá los indicadores de arriba mientras tocás los controles. Si “Seguridad” dice
            Piso, el ritmo es demasiado agresivo y la app te protege.
          </p>
        </AlertModal>
      )}

      {factorInfoOpen && (
        <AlertModal title="Nivel de movimiento" onClose={() => setFactorInfoOpen(false)}>
          <p>
            Es tu rutina <strong>fuera</strong> del entrenamiento. El gym del Plan se suma aparte.
          </p>
          <ul className="info-list">
            <li>
              <strong>Sedentario (1.2)</strong> — escritorio, poco movimiento.
            </li>
            <li>
              <strong>Ligero (1.375)</strong> — caminás un poco / tareas de casa.
            </li>
            <li>
              <strong>Moderado (1.55)</strong> — bastante movimiento diario.
            </li>
            <li>
              <strong>Activo (1.725)</strong> — trabajo físico o muy activo.
            </li>
            <li>
              <strong>Muy activo (1.9)</strong> — esfuerzo físico intenso todos los días.
            </li>
          </ul>
          <p className="modal-hint" style={{ marginBottom: 0 }}>
            Si dudás, empezá en Sedentario y ajustá según evolucione tu peso.
          </p>
        </AlertModal>
      )}
    </div>
  );
}
