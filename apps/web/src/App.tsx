import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from './lib/auth';
import { api } from './lib/api';
import { LoginScreen } from './components/LoginScreen';
import { OnboardingWizard } from './components/OnboardingWizard';
import { PlanWizard } from './components/PlanWizard';
import { HoyTab } from './components/HoyTab';
import { SemanaTab } from './components/SemanaTab';
import { PlanTab } from './components/PlanTab';
import { AjustesTab } from './components/AjustesTab';
import { DIAS_FULL, todayKey, type Settings } from './lib/types';

type Tab = 'hoy' | 'semana' | 'plan' | 'ajustes';

function applyTheme(theme: 'dark' | 'light') {
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#2d2e32' : '#f3f5f4');
}

export function App() {
  const { user, loading } = useAuth();
  const [tab, setTab] = useState<Tab>('hoy');
  const [toastMsg, setToastMsg] = useState('');
  const [toastShow, setToastShow] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);
  const [needsPlanOnboarding, setNeedsPlanOnboarding] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('nutrilab-theme') as 'dark' | 'light' | null;
    applyTheme(saved === 'light' ? 'light' : 'dark');
  }, []);

  useEffect(() => {
    if (!user) {
      setNeedsOnboarding(null);
      setNeedsPlanOnboarding(false);
      return;
    }
    setNeedsOnboarding(null);
    void api
      .getSettings()
      .then((r) => {
        setNeedsOnboarding(!r.settings.onboarding_done);
        setNeedsPlanOnboarding(Boolean(r.settings.onboarding_done) && !r.settings.plan_onboarding_done);
        if (r.settings.theme) applyTheme(r.settings.theme);
      })
      .catch(() => {
        setNeedsOnboarding(false);
        setNeedsPlanOnboarding(false);
      });
  }, [user]);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    setToastShow(true);
    window.setTimeout(() => setToastShow(false), 1800);
  }, []);

  const onTheme = (theme: 'dark' | 'light') => {
    applyTheme(theme);
    localStorage.setItem('nutrilab-theme', theme);
  };

  const onOnboardingDone = (settings: Settings) => {
    setNeedsOnboarding(false);
    setNeedsPlanOnboarding(!settings.plan_onboarding_done);
    onTheme(settings.theme);
  };

  const onPlanOnboardingDone = () => {
    setNeedsPlanOnboarding(false);
    setTab('hoy');
  };

  if (loading) return <div className="loading">Cargando…</div>;
  if (!user) return <LoginScreen />;
  if (needsOnboarding === null) return <div className="loading">Cargando…</div>;
  if (needsOnboarding) {
    return (
      <div className="app-shell">
        <OnboardingWizard onDone={onOnboardingDone} toast={toast} />
        <div className={`toast${toastShow ? ' show' : ''}`}>{toastMsg}</div>
      </div>
    );
  }
  if (needsPlanOnboarding) {
    return (
      <div className="app-shell">
        <PlanWizard onDone={onPlanOnboardingDone} toast={toast} />
        <div className={`toast${toastShow ? ' show' : ''}`}>{toastMsg}</div>
      </div>
    );
  }

  const dow = new Date(todayKey() + 'T12:00:00').getDay();
  const titles: Record<Tab, { eyebrow: string; title: string }> = {
    hoy: { eyebrow: 'Hoy', title: DIAS_FULL[dow] },
    semana: { eyebrow: 'Resumen', title: 'Semana' },
    plan: { eyebrow: 'Rutina', title: 'Plan' },
    ajustes: { eyebrow: 'Cuenta', title: 'Ajustes' },
  };

  return (
    <div className="app-shell">
      <header className="top">
        <div>
          <div className="eyebrow">{titles[tab].eyebrow}</div>
          <h1>{titles[tab].title}</h1>
        </div>
        {tab === 'hoy' && (
          <div className="day-pill">
            <span className="dot" />
            <span className="mono">NutriLab</span>
          </div>
        )}
        {tab !== 'hoy' && user.picture && (
          <img
            src={user.picture}
            alt=""
            referrerPolicy="no-referrer"
            width={36}
            height={36}
            style={{ borderRadius: '50%', border: '2px solid var(--teal)' }}
          />
        )}
      </header>

      {tab === 'hoy' && <HoyTab toast={toast} />}
      {tab === 'semana' && <SemanaTab toast={toast} />}
      {tab === 'plan' && <PlanTab toast={toast} />}
      {tab === 'ajustes' && <AjustesTab toast={toast} onTheme={onTheme} />}

      <nav className="tabbar">
        <TabBtn active={tab === 'hoy'} onClick={() => setTab('hoy')} label="Hoy">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 3" />
          </svg>
        </TabBtn>
        <TabBtn active={tab === 'semana'} onClick={() => setTab('semana')} label="Semana">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="17" rx="2" />
            <path d="M3 9h18M8 3v4M16 3v4" />
          </svg>
        </TabBtn>
        <TabBtn active={tab === 'plan'} onClick={() => setTab('plan')} label="Plan">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 3v18M6 3l12 4-12 4" />
          </svg>
        </TabBtn>
        <TabBtn active={tab === 'ajustes'} onClick={() => setTab('ajustes')} label="Ajustes">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09c0 .68.39 1.29 1 1.51.6.25 1.3.12 1.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06c-.45.52-.58 1.22-.33 1.82.22.61.83 1 1.51 1H21a2 2 0 010 4h-.09c-.68 0-1.29.39-1.51 1z" />
          </svg>
        </TabBtn>
      </nav>

      <div className={`toast${toastShow ? ' show' : ''}`}>{toastMsg}</div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button type="button" className={active ? 'active' : ''} onClick={onClick}>
      {children}
      {label}
    </button>
  );
}
