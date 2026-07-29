import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import {
  getExistingSubscription,
  pushSupported,
  subscribePush,
  subscriptionToJson,
  unsubscribePush,
} from '../lib/push';
import type { NotificationPrefs, NotificationStatus } from '../lib/types';

type Props = { toast: (msg: string) => void };

const DEFAULT_PREFS: NotificationPrefs = {
  enabled: false,
  remind_meals: true,
  remind_training: true,
  remind_weight: true,
  meal_times: ['08:00', '13:00', '17:00', '21:00'],
  training_time: '21:00',
  weight_time: '09:00',
};

const MEAL_LABELS = ['Desayuno', 'Almuerzo', 'Merienda', 'Cena'] as const;

export function NotificationsCard({ toast }: Props) {
  const [status, setStatus] = useState<NotificationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [localSub, setLocalSub] = useState(false);
  const [draft, setDraft] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const supported = pushSupported();

  const load = async () => {
    const s = await api.getNotificationStatus();
    setStatus(s);
    setDraft({
      ...DEFAULT_PREFS,
      ...s.prefs,
      meal_times:
        s.prefs.meal_times?.length === 4
          ? [...s.prefs.meal_times]
          : [...DEFAULT_PREFS.meal_times],
    });
    if (supported) {
      const sub = await getExistingSubscription();
      setLocalSub(Boolean(sub));
    }
  };

  useEffect(() => {
    void load().catch((e) => toast((e as Error).message));
  }, []);

  if (!status) {
    return (
      <div className="card">
        <div className="card-title">Notificaciones</div>
        <p className="muted">Cargando…</p>
      </div>
    );
  }

  const patchPrefs = async (next: NotificationPrefs) => {
    setBusy(true);
    try {
      const r = await api.putNotificationPrefs(next);
      setDraft({
        ...DEFAULT_PREFS,
        ...r.prefs,
        meal_times:
          r.prefs.meal_times?.length === 4
            ? [...r.prefs.meal_times]
            : [...DEFAULT_PREFS.meal_times],
      });
      setStatus((prev) => (prev ? { ...prev, prefs: r.prefs } : prev));
      toast('Horarios guardados');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const enable = async () => {
    if (!status.configured || !status.publicKey) {
      toast('Web Push no configurado en el servidor');
      return;
    }
    setBusy(true);
    try {
      const sub = await subscribePush(status.publicKey);
      const r = await api.subscribePush(subscriptionToJson(sub));
      setLocalSub(true);
      setDraft({
        ...DEFAULT_PREFS,
        ...r.prefs,
        meal_times:
          r.prefs.meal_times?.length === 4
            ? [...r.prefs.meal_times]
            : [...DEFAULT_PREFS.meal_times],
      });
      setStatus((prev) =>
        prev
          ? { ...prev, prefs: r.prefs, subscriptionCount: r.subscriptionCount }
          : prev,
      );
      toast('Notificaciones activadas');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      const endpoint = await unsubscribePush();
      const r = await api.unsubscribePush(endpoint ? { endpoint } : { all: true });
      setLocalSub(false);
      setDraft({
        ...DEFAULT_PREFS,
        ...r.prefs,
        meal_times:
          r.prefs.meal_times?.length === 4
            ? [...r.prefs.meal_times]
            : [...DEFAULT_PREFS.meal_times],
      });
      setStatus((prev) =>
        prev
          ? { ...prev, prefs: r.prefs, subscriptionCount: r.subscriptionCount }
          : prev,
      );
      toast('Notificaciones desactivadas');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    try {
      const r = await api.testPush();
      toast(r.sent > 0 ? 'Prueba enviada — mirá la notificación' : 'Nada enviado');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const active = localSub || status.subscriptionCount > 0;
  const tzLabel = status.schedule?.timezone?.replace('America/', '') ?? 'Argentina/Buenos_Aires';

  return (
    <div className="card">
      <div className="card-title">Notificaciones</div>
      <p className="field-hint">
        Recordatorios en Android (Chrome / PWA). Horarios en {tzLabel}. Solo se envía si falta el
        dato.
      </p>

      {!supported && (
        <p className="muted" style={{ marginBottom: 0 }}>
          Este navegador no soporta Web Push.
        </p>
      )}

      {supported && !status.configured && (
        <p className="muted" style={{ marginBottom: 0 }}>
          Faltan claves VAPID en el servidor. Configuralas para habilitar push.
        </p>
      )}

      {supported && status.configured && (
        <>
          <div className="row" style={{ marginBottom: 12 }}>
            <span className="muted">Estado</span>
            <span className="mono">
              {active ? 'Suscrito' : 'Inactivo'}
              {typeof Notification !== 'undefined' ? ` · ${Notification.permission}` : ''}
            </span>
          </div>

          {active ? (
            <button
              type="button"
              className="ghost"
              style={{ width: '100%', marginBottom: 12 }}
              disabled={busy}
              onClick={() => void disable()}
            >
              Desactivar en este dispositivo
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              style={{ width: '100%', marginBottom: 12 }}
              disabled={busy}
              onClick={() => void enable()}
            >
              Activar notificaciones
            </button>
          )}

          <div className="notif-toggles">
            <label className="notif-row">
              <input
                type="checkbox"
                checked={draft.remind_weight}
                disabled={busy || !active}
                onChange={(e) => setDraft({ ...draft, remind_weight: e.target.checked })}
              />
              <span className="notif-row-label">Peso</span>
              <input
                type="time"
                className="notif-time"
                value={draft.weight_time}
                disabled={busy || !active || !draft.remind_weight}
                onChange={(e) => setDraft({ ...draft, weight_time: e.target.value })}
              />
            </label>

            <div className="notif-block">
              <label className="notif-row">
                <input
                  type="checkbox"
                  checked={draft.remind_meals}
                  disabled={busy || !active}
                  onChange={(e) => setDraft({ ...draft, remind_meals: e.target.checked })}
                />
                <span className="notif-row-label">Comidas</span>
                <span className="notif-time-slot" aria-hidden="true" />
              </label>
              {draft.meal_times.map((t, i) => (
                <div className="notif-row notif-row-sub" key={`meal-${i}`}>
                  <span className="notif-check-slot" aria-hidden="true" />
                  <span className="notif-row-label muted">{MEAL_LABELS[i] ?? `#${i + 1}`}</span>
                  <input
                    type="time"
                    className="notif-time"
                    value={t}
                    disabled={busy || !active || !draft.remind_meals}
                    onChange={(e) => {
                      const meal_times = [...draft.meal_times];
                      meal_times[i] = e.target.value;
                      setDraft({ ...draft, meal_times });
                    }}
                  />
                </div>
              ))}
            </div>

            <label className="notif-row">
              <input
                type="checkbox"
                checked={draft.remind_training}
                disabled={busy || !active}
                onChange={(e) => setDraft({ ...draft, remind_training: e.target.checked })}
              />
              <span className="notif-row-label">Entrenamiento</span>
              <input
                type="time"
                className="notif-time"
                value={draft.training_time}
                disabled={busy || !active || !draft.remind_training}
                onChange={(e) => setDraft({ ...draft, training_time: e.target.value })}
              />
            </label>
          </div>

          <p className="muted" style={{ fontSize: 11, margin: '8px 0 0' }}>
            Entrenamiento solo si hay actividad en el plan ese día.
          </p>

          <button
            type="button"
            className="primary"
            style={{ width: '100%', marginTop: 12 }}
            disabled={busy || !active}
            onClick={() => void patchPrefs({ ...draft, enabled: active })}
          >
            Guardar preferencias
          </button>

          {active && (
            <button
              type="button"
              className="ghost"
              style={{ width: '100%', marginTop: 8 }}
              disabled={busy}
              onClick={() => void sendTest()}
            >
              Enviar notificación de prueba
            </button>
          )}
        </>
      )}
    </div>
  );
}
