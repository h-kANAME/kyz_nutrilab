import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import multipart from '@fastify/multipart';
import fs from 'node:fs';
import path from 'node:path';
import type { Env } from './config/env.js';
import { openDb, migrate, type Db } from './db/index.js';
import { createAuthHelpers } from './plugins/auth.js';
import { authRoutes } from './routes/auth.js';
import { trackerRoutes } from './routes/tracker.js';
import { aiRoutes } from './routes/ai.js';
import { notificationRoutes } from './routes/notifications.js';

export async function buildApp(env: Env, db?: Db) {
  const database = db ?? openDb(env.SQLITE_PATH);
  migrate(database);
  fs.mkdirSync(env.UPLOAD_DIR, { recursive: true });

  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
    trustProxy: true,
  });

  await app.register(sensible);
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
  await app.register(cors, {
    origin: env.PUBLIC_ORIGIN,
    credentials: true,
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
  });
  await app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  });

  const auth = createAuthHelpers(env, database);
  const uploadRoot = path.resolve(env.UPLOAD_DIR);

  app.get('/api/healthz', async () => ({ ok: true, service: 'nutrilab-api' }));

  await app.register(authRoutes(auth), { prefix: '/api/auth' });
  await app.register(trackerRoutes(auth, database, env), { prefix: '/api' });
  await app.register(aiRoutes(auth, database, env), { prefix: '/api/ai' });
  await app.register(notificationRoutes(auth, database, env), { prefix: '/api' });

  app.get(
    '/api/uploads/*',
    { preHandler: auth.requireAuth },
    async (request, reply) => {
      const star = (request.params as { '*': string })['*'] ?? '';
      const rel = star.replace(/^\/+/, '');
      if (!rel || rel.includes('..') || !rel.startsWith(request.user!.id + '/')) {
        return reply.forbidden('Forbidden');
      }
      const abs = path.resolve(uploadRoot, rel);
      if (!abs.startsWith(uploadRoot) || !fs.existsSync(abs)) {
        return reply.notFound();
      }
      const ext = path.extname(abs).toLowerCase();
      const mime =
        ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      reply.type(mime);
      return reply.send(fs.createReadStream(abs));
    },
  );

  app.setErrorHandler((error, request, reply) => {
    if ((error as { name?: string }).name === 'ZodError') {
      return reply.badRequest('Validation error');
    }
    request.log.error(error);
    if (reply.sent) return;
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    const message = error instanceof Error ? error.message : 'Error';
    reply.code(status).send({
      error: status >= 500 ? 'Internal Server Error' : message,
    });
  });

  return { app, db: database };
}
