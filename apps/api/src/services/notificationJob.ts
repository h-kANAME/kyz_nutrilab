import type { Db } from '../db/index.js';
import { newId } from '../db/index.js';
import type { Env } from '../config/env.js';
import { isPushConfigured, sendPushToUser } from './notifications.js';
import { getPlan } from './tracker.js';

/** Zona horaria de negocio (Argentina, sin DST). */
export const NOTIF_TZ = 'America/Argentina/Buenos_Aires';

/**
 * Ventanas de disparo (hora local AR). El cron del panel debe tickear
 * al menos cada 15 min para no saltar la ventana.
 */
export const REMINDER_SLOTS = {
  meals: [
    { kind: 'meals_1000', hour: 10, minute: 0, minMeals: 1, body: '¿Registraste el desayuno / media mañana?' },
    { kind: 'meals_1330', hour: 13, minute: 30, minMeals: 2, body: '¿Ya cargaste el almuerzo?' },
    { kind: 'meals_2100', hour: 21, minute: 0, minMeals: 3, body: 'Cerrá el día: registrá la cena si falta.' },
  ],
  training: { kind: 'training_2100', hour: 21, minute: 0, body: 'Hoy tenías entrenamiento: ¿lo marcaste?' },
  weight: { kind: 'weight_0900', hour: 9, minute: 0, body: 'Actualizá tu peso de hoy.' },
} as const;

const WINDOW_MINUTES = 14;

export type ArClock = { date: string; hour: number; minute: number; weekday: number };

export function arClock(now = new Date()): ArClock {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: NOTIF_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(now);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));

  // weekday from a reliable AR calendar date
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

type Eligible = {
  user_id: string;
  remind_meals: number;
  remind_training: number;
  remind_weight: number;
};

function listEligible(db: Db): Eligible[] {
  return db
    .prepare(
      `SELECT DISTINCT np.user_id, np.remind_meals, np.remind_training, np.remind_weight
       FROM notification_prefs np
       INNER JOIN push_subscriptions ps ON ps.user_id = np.user_id
       WHERE np.enabled = 1`,
    )
    .all() as Eligible[];
}

export type ReminderResult = {
  users: number;
  considered: number;
  sent: number;
  skipped: number;
  details: Array<{ userId: string; kind: string; status: string }>;
};

/**
 * Evalúa slots locales AR y manda push solo si falta el dato y no se envió hoy ese kind.
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

  const users = listEligible(db);
  result.users = users.length;

  for (const u of users) {
    const plan = getPlan(db, u.user_id);
    const todayPlan = plan.find((p) => p.weekday === clock.weekday);
    const hasTrainingPlanned = (todayPlan?.activity_keys?.length ?? 0) > 0;
    const meals = mealCount(db, u.user_id, clock.date);
    const meta = dayMeta(db, u.user_id, clock.date);

    if (u.remind_meals) {
      for (const slot of REMINDER_SLOTS.meals) {
        if (!inSlotWindow(clock, slot.hour, slot.minute)) continue;
        result.considered += 1;
        if (meals >= slot.minMeals) {
          result.skipped += 1;
          result.details.push({ userId: u.user_id, kind: slot.kind, status: 'ok_meals' });
          continue;
        }
        if (alreadySent(db, u.user_id, clock.date, slot.kind)) {
          result.skipped += 1;
          result.details.push({ userId: u.user_id, kind: slot.kind, status: 'deduped' });
          continue;
        }
        if (dryRun) {
          result.sent += 1;
          result.details.push({ userId: u.user_id, kind: slot.kind, status: 'dry_run' });
          continue;
        }
        const push = await sendPushToUser(db, env, u.user_id, {
          title: 'KYZ NutriLab · Comidas',
          body: slot.body,
          url: '/',
        });
        if (push.sent > 0) {
          markSent(db, u.user_id, clock.date, slot.kind);
          result.sent += 1;
          result.details.push({ userId: u.user_id, kind: slot.kind, status: 'sent' });
        } else {
          result.skipped += 1;
          result.details.push({ userId: u.user_id, kind: slot.kind, status: 'no_device' });
        }
      }
    }

    if (u.remind_training) {
      const slot = REMINDER_SLOTS.training;
      if (inSlotWindow(clock, slot.hour, slot.minute)) {
        result.considered += 1;
        const trainingMarked = meta?.training !== null && meta?.training !== undefined;
        if (!hasTrainingPlanned) {
          result.skipped += 1;
          result.details.push({ userId: u.user_id, kind: slot.kind, status: 'rest_day' });
        } else if (trainingMarked) {
          result.skipped += 1;
          result.details.push({ userId: u.user_id, kind: slot.kind, status: 'ok_training' });
        } else if (alreadySent(db, u.user_id, clock.date, slot.kind)) {
          result.skipped += 1;
          result.details.push({ userId: u.user_id, kind: slot.kind, status: 'deduped' });
        } else if (dryRun) {
          result.sent += 1;
          result.details.push({ userId: u.user_id, kind: slot.kind, status: 'dry_run' });
        } else {
          const push = await sendPushToUser(db, env, u.user_id, {
            title: 'KYZ NutriLab · Entrenamiento',
            body: slot.body,
            url: '/',
          });
          if (push.sent > 0) {
            markSent(db, u.user_id, clock.date, slot.kind);
            result.sent += 1;
            result.details.push({ userId: u.user_id, kind: slot.kind, status: 'sent' });
          } else {
            result.skipped += 1;
            result.details.push({ userId: u.user_id, kind: slot.kind, status: 'no_device' });
          }
        }
      }
    }

    if (u.remind_weight) {
      const slot = REMINDER_SLOTS.weight;
      if (inSlotWindow(clock, slot.hour, slot.minute)) {
        result.considered += 1;
        const hasWeight = meta?.weight != null;
        if (hasWeight) {
          result.skipped += 1;
          result.details.push({ userId: u.user_id, kind: slot.kind, status: 'ok_weight' });
        } else if (alreadySent(db, u.user_id, clock.date, slot.kind)) {
          result.skipped += 1;
          result.details.push({ userId: u.user_id, kind: slot.kind, status: 'deduped' });
        } else if (dryRun) {
          result.sent += 1;
          result.details.push({ userId: u.user_id, kind: slot.kind, status: 'dry_run' });
        } else {
          const push = await sendPushToUser(db, env, u.user_id, {
            title: 'KYZ NutriLab · Peso',
            body: slot.body,
            url: '/',
          });
          if (push.sent > 0) {
            markSent(db, u.user_id, clock.date, slot.kind);
            result.sent += 1;
            result.details.push({ userId: u.user_id, kind: slot.kind, status: 'sent' });
          } else {
            result.skipped += 1;
            result.details.push({ userId: u.user_id, kind: slot.kind, status: 'no_device' });
          }
        }
      }
    }
  }

  return result;
}
