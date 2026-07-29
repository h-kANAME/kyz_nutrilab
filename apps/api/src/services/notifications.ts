import { z } from 'zod';
import webpush from 'web-push';
import type { Db } from '../db/index.js';
import { newId } from '../db/index.js';
import type { Env } from '../config/env.js';

export const notificationPrefsSchema = z.object({
  enabled: z.boolean(),
  remind_meals: z.boolean(),
  remind_training: z.boolean(),
  remind_weight: z.boolean(),
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

export function getNotificationPrefs(db: Db, userId: string): NotificationPrefs {
  const row = db
    .prepare(
      `SELECT enabled, remind_meals, remind_training, remind_weight
       FROM notification_prefs WHERE user_id = ?`,
    )
    .get(userId) as
    | {
        enabled: number;
        remind_meals: number;
        remind_training: number;
        remind_weight: number;
      }
    | undefined;

  if (!row) {
    return {
      enabled: false,
      remind_meals: true,
      remind_training: true,
      remind_weight: true,
    };
  }

  return {
    enabled: Boolean(row.enabled),
    remind_meals: Boolean(row.remind_meals),
    remind_training: Boolean(row.remind_training),
    remind_weight: Boolean(row.remind_weight),
  };
}

export function upsertNotificationPrefs(
  db: Db,
  userId: string,
  prefs: NotificationPrefs,
): NotificationPrefs {
  db.prepare(
    `INSERT INTO notification_prefs
       (user_id, enabled, remind_meals, remind_training, remind_weight, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       enabled = excluded.enabled,
       remind_meals = excluded.remind_meals,
       remind_training = excluded.remind_training,
       remind_weight = excluded.remind_weight,
       updated_at = datetime('now')`,
  ).run(
    userId,
    prefs.enabled ? 1 : 0,
    prefs.remind_meals ? 1 : 0,
    prefs.remind_training ? 1 : 0,
    prefs.remind_weight ? 1 : 0,
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
      // Otros errores: se ignoran por dispositivo (red / FCM temporal)
    }
  }

  return { sent, removed };
}
