import { z } from 'zod';
import webpush from 'web-push';
import type { Db } from '../db/index.js';
import { newId } from '../db/index.js';
import type { Env } from '../config/env.js';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horario HH:MM');

export const MEAL_SLOT_LABELS = ['Desayuno', 'Almuerzo', 'Merienda', 'Cena'] as const;
export const DEFAULT_MEAL_TIMES = ['08:00', '13:00', '17:00', '21:00'] as const;
export const DEFAULT_TRAINING_TIME = '21:00';
export const DEFAULT_WEIGHT_TIME = '09:00';

export const notificationPrefsSchema = z.object({
  enabled: z.boolean(),
  remind_meals: z.boolean(),
  remind_training: z.boolean(),
  remind_weight: z.boolean(),
  meal_times: z.array(hhmm).length(4).default([...DEFAULT_MEAL_TIMES]),
  training_time: hhmm.default(DEFAULT_TRAINING_TIME),
  weight_time: hhmm.default(DEFAULT_WEIGHT_TIME),
});

export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(256),
  }),
});

export function isPushConfigured(env: Env): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

function configureWebPush(env: Env): void {
  if (!isPushConfigured(env)) return;
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
}

function parseMealTimes(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw || '[]') as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_MEAL_TIMES];
    const times = parsed.filter(
      (t): t is string => typeof t === 'string' && hhmm.safeParse(t).success,
    );
    if (times.length === 4) return times;
    // Migrar 3 → 4 insertando Merienda (17:00) entre almuerzo y cena
    if (times.length === 3) {
      return [times[0], times[1], '17:00', times[2]];
    }
    return [...DEFAULT_MEAL_TIMES];
  } catch {
    return [...DEFAULT_MEAL_TIMES];
  }
}

function normalizeTime(value: string | null | undefined, fallback: string): string {
  const t = (value || '').trim();
  return hhmm.safeParse(t).success ? t : fallback;
}

export function getNotificationPrefs(db: Db, userId: string): NotificationPrefs {
  const row = db
    .prepare(
      `SELECT enabled, remind_meals, remind_training, remind_weight,
              meal_times, training_time, weight_time
       FROM notification_prefs WHERE user_id = ?`,
    )
    .get(userId) as
    | {
        enabled: number;
        remind_meals: number;
        remind_training: number;
        remind_weight: number;
        meal_times?: string;
        training_time?: string;
        weight_time?: string;
      }
    | undefined;

  if (!row) {
    return {
      enabled: false,
      remind_meals: true,
      remind_training: true,
      remind_weight: true,
      meal_times: [...DEFAULT_MEAL_TIMES],
      training_time: DEFAULT_TRAINING_TIME,
      weight_time: DEFAULT_WEIGHT_TIME,
    };
  }

  return {
    enabled: Boolean(row.enabled),
    remind_meals: Boolean(row.remind_meals),
    remind_training: Boolean(row.remind_training),
    remind_weight: Boolean(row.remind_weight),
    meal_times: parseMealTimes(row.meal_times),
    training_time: normalizeTime(row.training_time, DEFAULT_TRAINING_TIME),
    weight_time: normalizeTime(row.weight_time, DEFAULT_WEIGHT_TIME),
  };
}

export function upsertNotificationPrefs(
  db: Db,
  userId: string,
  prefs: NotificationPrefs,
): NotificationPrefs {
  const mealTimes = (
    prefs.meal_times?.length === 4 ? prefs.meal_times : [...DEFAULT_MEAL_TIMES]
  ).slice(0, 4);
  const trainingTime = normalizeTime(prefs.training_time, DEFAULT_TRAINING_TIME);
  const weightTime = normalizeTime(prefs.weight_time, DEFAULT_WEIGHT_TIME);

  db.prepare(
    `INSERT INTO notification_prefs
       (user_id, enabled, remind_meals, remind_training, remind_weight,
        meal_times, training_time, weight_time, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       enabled = excluded.enabled,
       remind_meals = excluded.remind_meals,
       remind_training = excluded.remind_training,
       remind_weight = excluded.remind_weight,
       meal_times = excluded.meal_times,
       training_time = excluded.training_time,
       weight_time = excluded.weight_time,
       updated_at = datetime('now')`,
  ).run(
    userId,
    prefs.enabled ? 1 : 0,
    prefs.remind_meals ? 1 : 0,
    prefs.remind_training ? 1 : 0,
    prefs.remind_weight ? 1 : 0,
    JSON.stringify(mealTimes),
    trainingTime,
    weightTime,
  );
  return getNotificationPrefs(db, userId);
}

export function countSubscriptions(db: Db, userId: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM push_subscriptions WHERE user_id = ?`)
    .get(userId) as { c: number };
  return row.c;
}

export function savePushSubscription(
  db: Db,
  userId: string,
  sub: z.infer<typeof pushSubscriptionSchema>,
  userAgent = '',
): void {
  const existing = db
    .prepare(`SELECT id FROM push_subscriptions WHERE endpoint = ?`)
    .get(sub.endpoint) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE push_subscriptions
       SET user_id = ?, p256dh = ?, auth = ?, user_agent = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(userId, sub.keys.p256dh, sub.keys.auth, userAgent.slice(0, 300), existing.id);
    return;
  }

  db.prepare(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(newId(), userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, userAgent.slice(0, 300));
}

export function deletePushSubscription(db: Db, userId: string, endpoint: string): boolean {
  const result = db
    .prepare(`DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?`)
    .run(userId, endpoint);
  return result.changes > 0;
}

export function deleteAllPushSubscriptions(db: Db, userId: string): number {
  const result = db.prepare(`DELETE FROM push_subscriptions WHERE user_id = ?`).run(userId);
  return result.changes;
}

export async function sendPushToUser(
  db: Db,
  env: Env,
  userId: string,
  payload: { title: string; body: string; url?: string },
): Promise<{ sent: number; removed: number }> {
  if (!isPushConfigured(env)) {
    throw new Error('Web Push no configurado (faltan VAPID keys)');
  }
  configureWebPush(env);

  const rows = db
    .prepare(`SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?`)
    .all(userId) as Array<{ id: string; endpoint: string; p256dh: string; auth: string }>;

  let sent = 0;
  let removed = 0;
  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? '/',
  });

  for (const row of rows) {
    try {
      await webpush.sendNotification(
        {
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        },
        body,
        { TTL: 60 * 60 },
      );
      sent += 1;
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        db.prepare(`DELETE FROM push_subscriptions WHERE id = ?`).run(row.id);
        removed += 1;
      }
    }
  }

  return { sent, removed };
}
