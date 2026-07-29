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

export function NotificationsCard({ toast }: Props) {
  const [status, setStatus] = useState<NotificationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [localSub, setLocalSub] = useState(false);
  const supported = pushSupported();

  const load = async () => {
    const s = await api.getNotificationStatus();
    setStatus(s);
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

  const prefs = status.prefs;

  const patchPrefs = async (next: NotificationPrefs) => {
    setBusy(true);
    try {
      const r = await api.putNotificationPrefs(next);
      setStatus((prev) => (prev ? { ...prev, prefs: r.prefs } : prev));
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
      const r = await api.unsubscribePush(
        endpoint ? { endpoint } : { all: true },
      );
      setLocalSub(false);
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

  return (
    <div className="card">
      <div className="card-title">Notificaciones</div>
      <p className="field-hint">
        Recordatorios en Android (Chrome / PWA) para comidas, entrenamiento y peso. Requiere HTTPS
        o localhost.
      </p>

      {status.schedule && (
        <div className="notif-schedule">
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
            Horarios ({status.schedule.timezone.replace('America/', '')})
          </div>
          <ul className="notif-schedule-list">
            <li>
              <strong>Peso</strong> {status.schedule.weight.time}
            </li>
            {status.schedule.meals.map((m) => (
              <li key={m.time}>
                <strong>Comidas</strong> {m.time}
              </li>
            ))}
            <li>
              <strong>Entrenamiento</strong> {status.schedule.training.time}
              <span className="muted"> · solo si hay plan ese día</span>
            </li>
          </ul>
          <p className="muted" style={{ fontSize: 11, margin: '6px 0 0' }}>
            Solo se envía si falta el dato. Disparo vía Mission Control.
          </p>
        </div>
      )}

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
            {(
              [
                ['remind_meals', 'Comidas'],
                ['remind_training', 'Entrenamiento'],
                ['remind_weight', 'Peso'],
              ] as const
            ).map(([key, label]) => (
              <label className="notif-toggle" key={key}>
                <input
                  type="checkbox"
                  checked={prefs[key]}
                  disabled={busy || !active}
                  onChange={(e) =>
                    void patchPrefs({ ...prefs, [key]: e.target.checked, enabled: active })
                  }
                />
                <span>{label}</span>
              </label>
            ))}
          </div>

          {active && (
            <button
              type="button"
              className="ghost"
              style={{ width: '100%', marginTop: 12 }}
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
