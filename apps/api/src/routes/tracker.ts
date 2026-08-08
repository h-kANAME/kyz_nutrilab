import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AuthHelpers } from '../plugins/auth.js';
import type { Db } from '../db/index.js';
import type { Env } from '../config/env.js';
import { listAvailableLlms } from '../services/llm.js';
import {
  MEAL_TYPES,
  addMeal,
  activityCreateSchema,
  activityMapForUser,
  activityUpdateSchema,
  completeOnboarding,
  completePlanOnboarding,
  computeBase,
  computeTmb,
  createCustomActivity,
  deleteCustomActivity,
  deleteMeal,
  formulaBreakdown,
  getActivities,
  getDay,
  getDaysRange,
  getPlan,
  getSettings,
  objetivoDia,
  planSchema,
  settingsSchema,
  updateActivity,
  updateDay,
  updateMeal,
  updatePlan,
  updateSettings,
  weightedQuality,
} from '../services/tracker.js';
import {
  PROGRESS_MAX_DAYS,
  daysSpanInclusive,
  getWeightProgress,
  progressWeightQuerySchema,
} from '../services/progressWeight.js';

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

function withActMap(db: Db, userId: string) {
  return activityMapForUser(db, userId);
}

export function trackerRoutes(auth: AuthHelpers, db: Db, env: Env): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', auth.requireAuth);

    app.get('/settings', async (request) => {
      const settings = getSettings(db, request.user!.id);
      const plan = getPlan(db, request.user!.id);
      const actMap = withActMap(db, request.user!.id);
      const dow = new Date().getDay();
      const todayPlan = plan.find((p) => p.weekday === dow);
      const keys = todayPlan?.activity_keys ?? [];
      const formula = formulaBreakdown(settings, keys, actMap);
      return {
        settings,
        activities: getActivities(db, request.user!.id),
        derived: {
          tmb: formula.tmb,
          base: formula.base,
          floor: settings.minimo,
          formula,
          today_activity_keys: keys,
        },
        llmProviders: listAvailableLlms(env),
      };
    });

    app.put('/settings', async (request, reply) => {
      const data = settingsSchema.parse(request.body);
      const providers = listAvailableLlms(env);
      const selected = providers.find((p) => p.id === data.llm_provider);
      if (!selected?.configured) {
        return reply.badRequest(`El proveedor ${data.llm_provider} no tiene API key configurada`);
      }
      const settings = updateSettings(db, request.user!.id, data);
      const plan = getPlan(db, request.user!.id);
      const actMap = withActMap(db, request.user!.id);
      const dow = new Date().getDay();
      const todayPlan = plan.find((p) => p.weekday === dow);
      const keys = todayPlan?.activity_keys ?? [];
      const formula = formulaBreakdown(settings, keys, actMap);
      return {
        settings,
        activities: getActivities(db, request.user!.id),
        derived: {
          tmb: formula.tmb,
          base: formula.base,
          floor: settings.minimo,
          formula,
          today_activity_keys: keys,
        },
        llmProviders: providers,
      };
    });

    app.post('/settings/onboarding', async (request, reply) => {
      const data = settingsSchema.parse(request.body);
      const providers = listAvailableLlms(env);
      const selected = providers.find((p) => p.id === data.llm_provider);
      if (!selected?.configured) {
        const fallback = providers.find((p) => p.configured);
        if (!fallback) {
          return reply.badRequest('Ningún proveedor LLM tiene API key configurada');
        }
        data.llm_provider = fallback.id;
      }
      const settings = completeOnboarding(db, request.user!.id, data);
      const formula = formulaBreakdown(settings, []);
      return {
        settings,
        activities: getActivities(db, request.user!.id),
        derived: {
          tmb: formula.tmb,
          base: formula.base,
          floor: settings.minimo,
          formula,
          today_activity_keys: [] as string[],
        },
        llmProviders: providers,
      };
    });

    app.get('/activities', async (request) => ({
      activities: getActivities(db, request.user!.id),
    }));

    app.post('/activities', async (request) => {
      const body = activityCreateSchema.parse(request.body);
      const activity = createCustomActivity(db, request.user!.id, body);
      return { activity, activities: getActivities(db, request.user!.id) };
    });

    app.patch('/activities/:id', async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = activityUpdateSchema.parse(request.body);
      const activity = updateActivity(db, request.user!.id, id, body);
      if (!activity) return reply.notFound();
      return { activity, activities: getActivities(db, request.user!.id) };
    });

    app.delete('/activities/:id', async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const ok = deleteCustomActivity(db, request.user!.id, id);
      if (!ok) return reply.badRequest('Solo se pueden eliminar actividades personalizadas');
      return { activities: getActivities(db, request.user!.id) };
    });

    app.get('/plan', async (request) => {
      const settings = getSettings(db, request.user!.id);
      const days = getPlan(db, request.user!.id);
      const actMap = withActMap(db, request.user!.id);
      const activities = getActivities(db, request.user!.id);
      return {
        days: days.map((d) => ({
          ...d,
          objetivo: objetivoDia(settings, d.activity_keys, actMap),
        })),
        activities,
        derived: {
          tmb: Math.round(computeTmb(settings)),
          base: Math.round(computeBase(settings)),
          floor: settings.minimo,
        },
      };
    });

    app.put('/plan', async (request) => {
      const { days } = planSchema.parse(request.body);
      const settings = getSettings(db, request.user!.id);
      const actMap = withActMap(db, request.user!.id);
      const catalog = getActivities(db, request.user!.id);
      const allowed = new Set(catalog.map((a) => a.key));
      for (const d of days) {
        const keys = (d.activity_slots?.length ? d.activity_slots.map((s) => s.key) : d.activity_keys) ?? [];
        for (const k of keys) {
          if (!allowed.has(k)) throw new Error(`Actividad desconocida: ${k}`);
        }
      }
      const updated = updatePlan(db, request.user!.id, days);
      return {
        days: updated.map((d) => ({
          ...d,
          objetivo: objetivoDia(settings, d.activity_keys, actMap),
        })),
        activities: catalog,
      };
    });

    app.post('/plan/onboarding', async (request, reply) => {
      const { days } = planSchema.parse(request.body);
      try {
        const catalog = getActivities(db, request.user!.id);
        const result = completePlanOnboarding(db, request.user!.id, days);
        const settings = result.settings;
        const actMap = withActMap(db, request.user!.id);
        return {
          settings,
          activities: catalog,
          days: result.days.map((d) => ({
            ...d,
            objetivo: objetivoDia(settings, d.activity_keys, actMap),
          })),
        };
      } catch (e) {
        return reply.badRequest(e instanceof Error ? e.message : 'Plan inválido');
      }
    });

    app.get('/progress/weight', async (request, reply) => {
      const q = progressWeightQuerySchema.parse(request.query);
      if (q.from > q.to) return reply.badRequest('from must be <= to');
      const span = daysSpanInclusive(q.from, q.to);
      if (span < 1) return reply.badRequest('Invalid date range');
      if (span > PROGRESS_MAX_DAYS) {
        return reply.badRequest(`Range too large (max ${PROGRESS_MAX_DAYS} days)`);
      }
      return getWeightProgress(db, request.user!.id, q.from, q.to);
    });

    app.get('/days', async (request, reply) => {
      const q = z
        .object({ from: z.string().regex(dateRe), to: z.string().regex(dateRe) })
        .parse(request.query);
      if (q.from > q.to) return reply.badRequest('from must be <= to');
      const fromD = new Date(q.from);
      const toD = new Date(q.to);
      const daysSpan = (toD.getTime() - fromD.getTime()) / 86400000;
      if (daysSpan > 120) return reply.badRequest('Range too large (max 120 days)');

      const settings = getSettings(db, request.user!.id);
      const plan = getPlan(db, request.user!.id);
      const actMap = withActMap(db, request.user!.id);
      const days = getDaysRange(db, request.user!.id, q.from, q.to).map((day) => {
        const dow = new Date(day.date + 'T12:00:00').getDay();
        const planDay = plan.find((p) => p.weekday === dow)!;
        const consumed = day.meals.reduce((s, m) => s + m.kcal, 0);
        const goal = objetivoDia(settings, planDay.activity_keys, actMap);
        return {
          ...day,
          consumed,
          goal,
          quality_avg: weightedQuality(day.meals),
          plan: planDay,
        };
      });
      return { days };
    });

    app.get('/days/:date', async (request, reply) => {
      const { date } = z.object({ date: z.string().regex(dateRe) }).parse(request.params);
      const settings = getSettings(db, request.user!.id);
      const plan = getPlan(db, request.user!.id);
      const actMap = withActMap(db, request.user!.id);
      const day = getDay(db, request.user!.id, date);
      const dow = new Date(date + 'T12:00:00').getDay();
      const planDay = plan.find((p) => p.weekday === dow)!;
      const consumed = day.meals.reduce((s, m) => s + m.kcal, 0);
      return {
        day: {
          ...day,
          consumed,
          goal: objetivoDia(settings, planDay.activity_keys, actMap),
          quality_avg: weightedQuality(day.meals),
          plan: planDay,
        },
      };
    });

    app.put('/days/:date', async (request) => {
      const { date } = z.object({ date: z.string().regex(dateRe) }).parse(request.params);
      const body = z
        .object({
          weight: z.number().positive().max(400).nullable().optional(),
          training: z.boolean().nullable().optional(),
          notes: z.string().max(2000).optional(),
        })
        .parse(request.body);
      const day = updateDay(db, request.user!.id, date, body);
      return { day };
    });

    app.post('/meals', async (request) => {
      const body = z
        .object({
          date: z.string().regex(dateRe),
          meal_type: z.enum(MEAL_TYPES),
          label: z.string().min(1).max(200).optional(),
          kcal: z.number().positive().max(10000),
          protein: z.number().min(0).nullable().optional(),
          carbs: z.number().min(0).nullable().optional(),
          fat: z.number().min(0).nullable().optional(),
          quality_score: z.number().int().min(1).max(5).nullable().optional(),
          quality_note: z.string().max(240).nullable().optional(),
          source: z.enum(['manual', 'ai_text', 'ai_image']).optional(),
          raw_prompt: z.string().max(4000).nullable().optional(),
          image_path: z.string().max(500).nullable().optional(),
        })
        .parse(request.body);

      const day = addMeal(db, request.user!.id, {
        date: body.date,
        meal_type: body.meal_type,
        label: body.label ?? body.meal_type,
        kcal: body.kcal,
        protein: body.protein,
        carbs: body.carbs,
        fat: body.fat,
        quality_score: body.quality_score,
        quality_note: body.quality_note,
        source: body.source ?? 'manual',
        raw_prompt: body.raw_prompt,
        image_path: body.image_path,
      });
      return { day };
    });

    app.patch('/meals/:id', async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = z
        .object({
          label: z.string().min(1).max(200).optional(),
          kcal: z.number().positive().max(10000).optional(),
          meal_type: z.enum(MEAL_TYPES).optional(),
        })
        .parse(request.body);
      const day = updateMeal(db, request.user!.id, id, body);
      if (!day) return reply.notFound('Meal not found');
      return { day };
    });

    app.delete('/meals/:id', async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const result = deleteMeal(db, request.user!.id, id);
      if (!result) return reply.notFound('Meal not found');
      return { day: result.day };
    });
  };
}
