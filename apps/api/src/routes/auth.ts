import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AuthHelpers } from '../plugins/auth.js';

export function authRoutes(auth: AuthHelpers): FastifyPluginAsync {
  return async (app) => {
    app.post('/google', {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    }, async (request, reply) => {
      const body = z.object({ credential: z.string().min(10) }).parse(request.body);
      let profile;
      try {
        profile = await auth.verifyGoogleIdToken(body.credential);
      } catch {
        return reply.unauthorized('Invalid Google credential');
      }
      if (!profile.emailVerified) {
        return reply.forbidden('Email not verified');
      }
      if (!auth.isAllowed(profile.email)) {
        return reply.forbidden('Email not in allowlist');
      }
      const user = auth.upsertUser(profile);
      await auth.issueSession(reply, user);
      return { user };
    });

    app.post('/logout', async (_request, reply) => {
      auth.clearSession(reply);
      return { ok: true };
    });

    app.get('/me', { preHandler: auth.requireAuth }, async (request) => {
      return { user: request.user };
    });
  };
}
