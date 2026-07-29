import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AuthHelpers } from '../plugins/auth.js';
import type { Db } from '../db/index.js';
import type { Env } from '../config/env.js';
import {
  countSubscriptions,
  deleteAllPushSubscriptions,
  deletePushSubscription,
  getNotificationPrefs,
  isPushConfigured,
  notificationPrefsSchema,
  pushSubscriptionSchema,
  savePushSubscription,
  sendPushToUser,
  upsertNotificationPrefs,
} from '../services/notifications.js';
import { NOTIF_TZ, slotsFromPrefs } from '../services/notificationJob.js';

export function notificationRoutes(auth: AuthHelpers, db: Db, env: Env): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', auth.requireAuth);

    app.get('/notifications/status', async (request) => {
      const prefs = getNotificationPrefs(db, request.user!.id);
      const slots = slotsFromPrefs(prefs);
      return {
        configured: isPushConfigured(env),
        publicKey: isPushConfigured(env) ? env.VAPID_PUBLIC_KEY : null,
        subscriptionCount: countSubscriptions(db, request.user!.id),
        prefs,
        schedule: {
          timezone: NOTIF_TZ,
          meals: slots.meals.map((s) => ({
            time: `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`,
            body: s.body,
          })),
          training: {
            time: `${String(slots.training.hour).padStart(2, '0')}:${String(slots.training.minute).padStart(2, '0')}`,
            body: slots.training.body,
          },
          weight: {
            time: `${String(slots.weight.hour).padStart(2, '0')}:${String(slots.weight.minute).padStart(2, '0')}`,
            body: slots.weight.body,
          },
          tickHint: 'Mission Control cada 15 min (UTC)',
        },
      };
    });

    app.put('/notifications/prefs', async (request) => {
      const prefs = notificationPrefsSchema.parse(request.body);
      const next = upsertNotificationPrefs(db, request.user!.id, prefs);
      return { prefs: next };
    });

    app.post('/notifications/subscribe', async (request, reply) => {
      if (!isPushConfigured(env)) {
        return reply.badRequest('Web Push no configurado en el servidor');
      }
      const body = pushSubscriptionSchema.parse(request.body);
      const ua = request.headers['user-agent'] ?? '';
      savePushSubscription(db, request.user!.id, body, ua);
      const prefs = getNotificationPrefs(db, request.user!.id);
      const next = upsertNotificationPrefs(db, request.user!.id, { ...prefs, enabled: true });
      return {
        ok: true,
        subscriptionCount: countSubscriptions(db, request.user!.id),
        prefs: next,
      };
    });

    app.delete('/notifications/subscribe', async (request) => {
      const body = z
        .object({
          endpoint: z.string().url().max(2048).optional(),
          all: z.boolean().optional(),
        })
        .parse(request.body ?? {});

      if (body.all) {
        deleteAllPushSubscriptions(db, request.user!.id);
      } else if (body.endpoint) {
        deletePushSubscription(db, request.user!.id, body.endpoint);
      }

      const prefs = getNotificationPrefs(db, request.user!.id);
      const still = countSubscriptions(db, request.user!.id);
      const next =
        still === 0
          ? upsertNotificationPrefs(db, request.user!.id, { ...prefs, enabled: false })
          : prefs;

      return { ok: true, subscriptionCount: still, prefs: next };
    });

    app.post('/notifications/test', async (request, reply) => {
      if (!isPushConfigured(env)) {
        return reply.badRequest('Web Push no configurado en el servidor');
      }
      const count = countSubscriptions(db, request.user!.id);
      if (count === 0) {
        return reply.badRequest('No hay dispositivos suscritos');
      }
      try {
        const result = await sendPushToUser(db, env, request.user!.id, {
          title: 'KYZ NutriLab',
          body: 'Notificaciones activas. Así te vamos a recordar comidas, entrenamiento y peso.',
          url: '/',
        });
        return { ok: true, ...result };
      } catch (e) {
        return reply.badRequest(e instanceof Error ? e.message : 'No se pudo enviar');
      }
    });
  };
}
