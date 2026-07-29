async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const hasJsonBody = init?.body != null && !(init.body instanceof FormData);
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: {
      ...(hasJsonBody ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = (await res.json()) as { error?: string; message?: string };
      message = data.message || data.error || message;
    } catch {
      /* ignore */
    }
    throw new Error(message || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  me: () => request<{ user: import('./types').User }>('/api/auth/me'),
  loginGoogle: (credential: string) =>
    request<{ user: import('./types').User }>('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ credential }),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  getSettings: () =>
    request<{
      settings: import('./types').Settings;
      activities?: import('./types').UserActivity[];
      derived: {
        tmb: number;
        base: number;
        floor: number;
        formula?: import('./formula').FormulaBreakdown;
        today_activity_keys?: string[];
      };
      llmProviders: import('./types').LlmProviderInfo[];
    }>('/api/settings'),
  putSettings: (settings: import('./types').Settings) =>
    request<{
      settings: import('./types').Settings;
      activities?: import('./types').UserActivity[];
      derived: {
        tmb: number;
        base: number;
        floor: number;
        formula?: import('./formula').FormulaBreakdown;
        today_activity_keys?: string[];
      };
      llmProviders: import('./types').LlmProviderInfo[];
    }>('/api/settings', { method: 'PUT', body: JSON.stringify(settings) }),
  completeOnboarding: (settings: import('./types').Settings) =>
    request<{
      settings: import('./types').Settings;
      derived: {
        tmb: number;
        base: number;
        floor: number;
        formula?: import('./formula').FormulaBreakdown;
        today_activity_keys?: string[];
      };
      llmProviders: import('./types').LlmProviderInfo[];
    }>('/api/settings/onboarding', { method: 'POST', body: JSON.stringify(settings) }),
  getPlan: () =>
    request<{
      days: import('./types').PlanDay[];
      activities?: import('./types').UserActivity[];
      derived: { tmb: number; base: number; floor: number };
    }>('/api/plan'),
  putPlan: (days: import('./types').PlanDay[]) =>
    request<{
      days: import('./types').PlanDay[];
      activities?: import('./types').UserActivity[];
    }>('/api/plan', {
      method: 'PUT',
      body: JSON.stringify({ days }),
    }),
  completePlanOnboarding: (days: import('./types').PlanDay[]) =>
    request<{
      settings: import('./types').Settings;
      days: import('./types').PlanDay[];
      activities: import('./types').UserActivity[];
    }>('/api/plan/onboarding', {
      method: 'POST',
      body: JSON.stringify({ days }),
    }),
  getActivities: () =>
    request<{ activities: import('./types').UserActivity[] }>('/api/activities'),
  createActivity: (body: { label: string; kcal: number }) =>
    request<{
      activity: import('./types').UserActivity;
      activities: import('./types').UserActivity[];
    }>('/api/activities', { method: 'POST', body: JSON.stringify(body) }),
  updateActivity: (id: string, body: { label?: string; kcal?: number }) =>
    request<{
      activity: import('./types').UserActivity;
      activities: import('./types').UserActivity[];
    }>(`/api/activities/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteActivity: (id: string) =>
    request<{ activities: import('./types').UserActivity[] }>(`/api/activities/${id}`, {
      method: 'DELETE',
    }),
  getDay: (date: string) =>
    request<{ day: import('./types').DayLog }>(`/api/days/${date}`),
  getDays: (from: string, to: string) =>
    request<{ days: import('./types').DayLog[] }>(`/api/days?from=${from}&to=${to}`),
  putDay: (
    date: string,
    body: { weight?: number | null; training?: boolean | null; notes?: string },
  ) =>
    request<{ day: import('./types').DayLog }>(`/api/days/${date}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  addMeal: (body: {
    date: string;
    meal_type: string;
    label?: string;
    kcal: number;
  }) =>
    request<{ day: import('./types').DayLog }>('/api/meals', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteMeal: (id: string) =>
    request<{ day: import('./types').DayLog }>(`/api/meals/${id}`, { method: 'DELETE' }),
  parseMeal: (body: { mealType: string; text: string; date: string }) =>
    request<{ day: import('./types').DayLog; estimate: unknown }>('/api/ai/parse-meal', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  parseMealImage: (form: FormData) =>
    request<{ day: import('./types').DayLog; estimate: unknown }>('/api/ai/parse-meal-image', {
      method: 'POST',
      body: form,
      headers: {},
    }),
  getNotificationStatus: () =>
    request<import('./types').NotificationStatus>('/api/notifications/status'),
  putNotificationPrefs: (prefs: import('./types').NotificationPrefs) =>
    request<{ prefs: import('./types').NotificationPrefs }>('/api/notifications/prefs', {
      method: 'PUT',
      body: JSON.stringify(prefs),
    }),
  subscribePush: (body: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    request<{
      ok: boolean;
      subscriptionCount: number;
      prefs: import('./types').NotificationPrefs;
    }>('/api/notifications/subscribe', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  unsubscribePush: (body: { endpoint?: string; all?: boolean }) =>
    request<{
      ok: boolean;
      subscriptionCount: number;
      prefs: import('./types').NotificationPrefs;
    }>('/api/notifications/subscribe', {
      method: 'DELETE',
      body: JSON.stringify(body),
    }),
  testPush: () =>
    request<{ ok: boolean; sent: number; removed: number }>('/api/notifications/test', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
};

export function mealImageUrl(imagePath: string | null): string | null {
  if (!imagePath) return null;
  return `/api/uploads/${imagePath}`;
}
