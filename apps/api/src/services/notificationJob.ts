import type { Db } from '../db/index.js';
import { newId } from '../db/index.js';
import type { Env } from '../config/env.js';
import {
  DEFAULT_MEAL_TIMES,
  DEFAULT_TRAINING_TIME,
  DEFAULT_WEIGHT_TIME,
  getNotificationPrefs,
  isPushConfigured,
  sendPushToUser,
  type NotificationPrefs,
} from './notifications.js';
import { getPlan } from './tracker.js';

/** Zona horaria de negocio (Argentina, sin DST). */
export const NOTIF_TZ = 'America/Argentina/Buenos_Aires';

/** Defaults (fallback si el usuario no configuró). */
export const REMINDER_SLOTS = {
  meals: DEFAULT_MEAL_TIMES.map((time, i) => {
    const [hour, minute] = time.split(':').map(Number);
    return {
      kind: `meals_${time.replace(':', '')}`,
      hour,
      minute,
      minMeals: i + 1,
      body: mealBody(i),
    };
  }),
  training: {
    kind: `training_${DEFAULT_TRAINING_TIME.replace(':', '')}`,
    hour: Number(DEFAULT_TRAINING_TIME.slice(0, 2)),
    minute: Number(DEFAULT_TRAINING_TIME.slice(3, 5)),
    body: 'Hoy tenías entrenamiento: ¿lo marcaste?',
  },
  weight: {
    kind: `weight_${DEFAULT_WEIGHT_TIME.replace(':', '')}`,
    hour: Number(DEFAULT_WEIGHT_TIME.slice(0, 2)),
    minute: Number(DEFAULT_WEIGHT_TIME.slice(3, 5)),
    body: 'Actualizá tu peso de hoy.',
  },
} as const;

const WINDOW_MINUTES = 14;

function mealBody(index: number): string {
  if (index === 0) return '¿Registraste el desayuno?';
  if (index === 1) return '¿Ya cargaste el almuerzo?';
  if (index === 2) return '¿Registraste la merienda?';
  if (index === 3) return 'Cerrá el día: registrá la cena si falta.';
  return 'Recordá registrar tu comida.';
}

export function parseHhMm(time: string): { hour: number; minute: number } {
  const [h, m] = time.split(':').map(Number);
  return { hour: h, minute: m };
}

export function slotsFromPrefs(prefs: NotificationPrefs) {
  const mealTimes = prefs.meal_times?.length ? prefs.meal_times : [...DEFAULT_MEAL_TIMES];
  return {
    meals: mealTimes.map((time, i) => {
      const { hour, minute } = parseHhMm(time);
      return {
        kind: `meals_${time.replace(':', '')}`,
        hour,
        minute,
        minMeals: i + 1,
        body: mealBody(i),
      };
    }),
    training: (() => {
      const time = prefs.training_time || DEFAULT_TRAINING_TIME;
      const { hour, minute } = parseHhMm(time);
      return {
        kind: `training_${time.replace(':', '')}`,
        hour,
        minute,
        body: 'Hoy tenías entrenamiento: ¿lo marcaste?',
      };
    })(),
    weight: (() => {
      const time = prefs.weight_time || DEFAULT_WEIGHT_TIME;
      const { hour, minute } = parseHhMm(time);
      return {
        kind: `weight_${time.replace(':', '')}`,
        hour,
        minute,
        body: 'Actualizá tu peso de hoy.',
      };
    })(),
  };
}

export type ArClock = { date: string; hour: number; minute: number; weekday: number };

export function arClock(now = new Date()): ArClock {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: NOTIF_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  const [y, m, d] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d, 15, 0, 0)).getUTCDay();

  return { date, hour, minute, weekday };
}

export function inSlotWindow(
  clock: ArClock,
  hour: number,
  minute: number,
  windowMin = WINDOW_MINUTES,
): boolean {
  const now = clock.hour * 60 + clock.minute;
  const start = hour * 60 + minute;
  return now >= start && now <= start + windowMin;
}

function alreadySent(db: Db, userId: string, date: string, kind: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM notification_sends WHERE user_id = ? AND date = ? AND kind = ?`,
    )
    .get(userId, date, kind) as { ok: number } | undefined;
  return Boolean(row);
}

function markSent(db: Db, userId: string, date: string, kind: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO notification_sends (id, user_id, date, kind) VALUES (?, ?, ?, ?)`,
  ).run(newId(), userId, date, kind);
}

function mealCount(db: Db, userId: string, date: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM meals m
       JOIN day_logs d ON d.id = m.day_log_id
       WHERE d.user_id = ? AND d.date = ?`,
    )
    .get(userId, date) as { c: number };
  return row.c;
}

function dayMeta(
  db: Db,
  userId: string,
  date: string,
): { weight: number | null; training: number | null } | null {
  const row = db
    .prepare(`SELECT weight, training FROM day_logs WHERE user_id = ? AND date = ?`)
    .get(userId, date) as { weight: number | null; training: number | null } | undefined;
  return row ?? null;
}

function listEligibleIds(db: Db): string[] {
  return (
    db
      .prepare(
        `SELECT DISTINCT np.user_id
         FROM notification_prefs np
         INNER JOIN push_subscriptions ps ON ps.user_id = np.user_id
         WHERE np.enabled = 1`,
      )
      .all() as Array<{ user_id: string }>
  ).map((r) => r.user_id);
}

export type ReminderResult = {
  users: number;
  considered: number;
  sent: number;
  skipped: number;
  details: Array<{ userId: string; kind: string; status: string }>;
};

/**
 * Evalúa slots locales AR (horarios del usuario) y manda push si falta el dato.
 * Idempotente: seguro correr cada 15 min desde Mission Control.
 */
export async function runNotificationReminders(
  db: Db,
  env: Env,
  opts: { dryRun?: boolean; now?: Date } = {},
): Promise<ReminderResult> {
  const dryRun = Boolean(opts.dryRun);
  const clock = arClock(opts.now ?? new Date());
  const result: ReminderResult = {
    users: 0,
    considered: 0,
    sent: 0,
    skipped: 0,
    details: [],
  };

  if (!isPushConfigured(env) && !dryRun) {
    throw new Error('Web Push no configurado (faltan VAPID keys)');
  }

  const userIds = listEligibleIds(db);
  result.users = userIds.length;

  for (const userId of userIds) {
    const prefs = getNotificationPrefs(db, userId);
    const slots = slotsFromPrefs(prefs);
    const plan = getPlan(db, userId);
    const todayPlan = plan.find((p) => p.weekday === clock.weekday);
    const hasTrainingPlanned = (todayPlan?.activity_keys?.length ?? 0) > 0;
    const meals = mealCount(db, userId, clock.date);
    const meta = dayMeta(db, userId, clock.date);

    if (prefs.remind_meals) {
      for (const slot of slots.meals) {
        if (!inSlotWindow(clock, slot.hour, slot.minute)) continue;
        result.considered += 1;
        if (meals >= slot.minMeals) {
          result.skipped += 1;
          result.details.push({ userId, kind: slot.kind, status: 'ok_meals' });
          continue;
        }
        if (alreadySent(db, userId, clock.date, slot.kind)) {
          result.skipped += 1;
          result.details.push({ userId, kind: slot.kind, status: 'deduped' });
          continue;
        }
        if (dryRun) {
          result.sent += 1;
          result.details.push({ userId, kind: slot.kind, status: 'dry_run' });
          continue;
        }
        const push = await sendPushToUser(db, env, userId, {
          title: 'KYZ NutriLab · Comidas',
          body: slot.body,
          url: '/',
        });
        if (push.sent > 0) {
          markSent(db, userId, clock.date, slot.kind);
          result.sent += 1;
          result.details.push({ userId, kind: slot.kind, status: 'sent' });
        } else {
          result.skipped += 1;
          result.details.push({ userId, kind: slot.kind, status: 'no_device' });
        }
      }
    }

    if (prefs.remind_training) {
      const slot = slots.training;
      if (inSlotWindow(clock, slot.hour, slot.minute)) {
        result.considered += 1;
        const trainingMarked = meta?.training !== null && meta?.training !== undefined;
        if (!hasTrainingPlanned) {
          result.skipped += 1;
          result.details.push({ userId, kind: slot.kind, status: 'rest_day' });
        } else if (trainingMarked) {
          result.skipped += 1;
          result.details.push({ userId, kind: slot.kind, status: 'ok_training' });
        } else if (alreadySent(db, userId, clock.date, slot.kind)) {
          result.skipped += 1;
          result.details.push({ userId, kind: slot.kind, status: 'deduped' });
        } else if (dryRun) {
          result.sent += 1;
          result.details.push({ userId, kind: slot.kind, status: 'dry_run' });
        } else {
          const push = await sendPushToUser(db, env, userId, {
            title: 'KYZ NutriLab · Entrenamiento',
            body: slot.body,
            url: '/',
          });
          if (push.sent > 0) {
            markSent(db, userId, clock.date, slot.kind);
            result.sent += 1;
            result.details.push({ userId, kind: slot.kind, status: 'sent' });
          } else {
            result.skipped += 1;
            result.details.push({ userId, kind: slot.kind, status: 'no_device' });
          }
        }
      }
    }

    if (prefs.remind_weight) {
      const slot = slots.weight;
      if (inSlotWindow(clock, slot.hour, slot.minute)) {
        result.considered += 1;
        const hasWeight = meta?.weight != null;
        if (hasWeight) {
          result.skipped += 1;
          result.details.push({ userId, kind: slot.kind, status: 'ok_weight' });
        } else if (alreadySent(db, userId, clock.date, slot.kind)) {
          result.skipped += 1;
          result.details.push({ userId, kind: slot.kind, status: 'deduped' });
        } else if (dryRun) {
          result.sent += 1;
          result.details.push({ userId, kind: slot.kind, status: 'dry_run' });
        } else {
          const push = await sendPushToUser(db, env, userId, {
            title: 'KYZ NutriLab · Peso',
            body: slot.body,
            url: '/',
          });
          if (push.sent > 0) {
            markSent(db, userId, clock.date, slot.kind);
            result.sent += 1;
            result.details.push({ userId, kind: slot.kind, status: 'sent' });
          } else {
            result.skipped += 1;
            result.details.push({ userId, kind: slot.kind, status: 'no_device' });
          }
        }
      }
    }
  }

  return result;
}
