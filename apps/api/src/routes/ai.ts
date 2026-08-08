import type { FastifyPluginAsync } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AuthHelpers } from '../plugins/auth.js';
import type { Db } from '../db/index.js';
import type { Env } from '../config/env.js';
import { MEAL_TYPES, getSettings } from '../services/tracker.js';
import {
  createLlmProvider,
  listAvailableLlms,
  publicAiError,
  type LlmProviderName,
} from '../services/llm.js';
import { estimateMealImage, estimateMealText } from '../services/estimateMeal.js';
import { newId } from '../db/index.js';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 5 * 1024 * 1024;

function resolveProvider(db: Db, env: Env, userId: string) {
  const settings = getSettings(db, userId);
  const preferred = settings.llm_provider as LlmProviderName;
  const available = listAvailableLlms(env);
  const chosen = available.find((p) => p.id === preferred && p.configured);
  if (!chosen) {
    const fallback = available.find((p) => p.configured);
    if (!fallback) {
      throw new Error('Ningún proveedor LLM tiene API key configurada');
    }
    return createLlmProvider(env, fallback.id);
  }
  return createLlmProvider(env, preferred);
}

export function aiRoutes(auth: AuthHelpers, db: Db, env: Env): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', auth.requireAuth);

    app.get('/providers', async () => ({
      providers: listAvailableLlms(env),
      defaultProvider: env.LLM_PROVIDER,
    }));

    app.post(
      '/parse-meal',
      { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
      async (request, reply) => {
        const body = z
          .object({
            mealType: z.enum(MEAL_TYPES),
            text: z.string().min(3).max(4000),
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          })
          .parse(request.body);

        let provider;
        try {
          provider = resolveProvider(db, env, request.user!.id);
        } catch (e) {
          return reply.serviceUnavailable(publicAiError(e));
        }

        const jobId = newId();
        db.prepare(
          `INSERT INTO ai_jobs (id, user_id, provider, model, kind, status) VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(jobId, request.user!.id, provider.name, provider.model, 'text', 'running');

        try {
          const estimate = await estimateMealText(provider, {
            mealType: body.mealType,
            text: body.text,
          });

          // No persiste: la UI confirma y llama POST /meals.
          db.prepare(`UPDATE ai_jobs SET status = ? WHERE id = ?`).run('ok', jobId);
          return {
            estimate,
            day: null,
            provider: provider.name,
            model: provider.model,
            pendingSave: {
              date: body.date,
              meal_type: body.mealType,
              source: 'ai_text' as const,
              raw_prompt: body.text,
            },
          };
        } catch (e) {
          const msg = publicAiError(e);
          request.log.warn({ err: e }, 'AI parse-meal failed');
          db.prepare(`UPDATE ai_jobs SET status = ?, error = ? WHERE id = ?`).run(
            'error',
            (e instanceof Error ? e.message : String(e)).slice(0, 500),
            jobId,
          );
          return reply.code(502).send({ statusCode: 502, error: 'Bad Gateway', message: msg });
        }
      },
    );

    app.post(
      '/parse-meal-image',
      { config: { rateLimit: { max: 15, timeWindow: '1 minute' } } },
      async (request, reply) => {
        const file = await request.file();
        if (!file) return reply.badRequest('Image required');

        if (!ALLOWED_MIME.has(file.mimetype)) {
          return reply.badRequest('Only jpeg, png, webp allowed');
        }

        const buffer = await file.toBuffer();
        if (buffer.length > MAX_BYTES) {
          return reply.badRequest('Image too large (max 5MB)');
        }

        const fields = file.fields as Record<
          string,
          { value?: string } | Array<{ value?: string }> | undefined
        >;
        const fieldVal = (name: string) => {
          const f = fields[name];
          if (!f) return undefined;
          return Array.isArray(f) ? f[0]?.value : f.value;
        };
        const mealType = z.enum(MEAL_TYPES).parse(fieldVal('mealType'));
        const date = z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .parse(fieldVal('date'));
        const text = fieldVal('text')?.slice(0, 1000) ?? '';

        let provider;
        try {
          provider = resolveProvider(db, env, request.user!.id);
        } catch (e) {
          return reply.serviceUnavailable(publicAiError(e));
        }

        const jobId = newId();
        db.prepare(
          `INSERT INTO ai_jobs (id, user_id, provider, model, kind, status) VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(jobId, request.user!.id, provider.name, provider.model, 'image', 'running');

        const ext =
          file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
        const absDir = path.join(env.UPLOAD_DIR, request.user!.id, date);
        fs.mkdirSync(absDir, { recursive: true });
        const filename = `${randomUUID()}.${ext}`;
        const absPath = path.join(absDir, filename);
        const relPath = path.posix.join(request.user!.id, date, filename);
        fs.writeFileSync(absPath, buffer);

        try {
          const estimate = await estimateMealImage(provider, {
            mealType,
            text,
            mimeType: file.mimetype,
            base64: buffer.toString('base64'),
          });

          // No persiste comidas: la UI confirma. La foto ya quedó en disco.
          db.prepare(`UPDATE ai_jobs SET status = ? WHERE id = ?`).run('ok', jobId);
          return {
            estimate,
            day: null,
            imageUrl: `/api/uploads/${relPath}`,
            image_path: relPath,
            provider: provider.name,
            model: provider.model,
            pendingSave: {
              date,
              meal_type: mealType,
              source: 'ai_image' as const,
              raw_prompt: text || null,
              image_path: relPath,
            },
          };
        } catch (e) {
          const msg = publicAiError(e);
          request.log.warn({ err: e }, 'AI parse-meal-image failed');
          db.prepare(`UPDATE ai_jobs SET status = ?, error = ? WHERE id = ?`).run(
            'error',
            (e instanceof Error ? e.message : String(e)).slice(0, 500),
            jobId,
          );
          return reply.code(502).send({ statusCode: 502, error: 'Bad Gateway', message: msg });
        }
      },
    );
  };
}
