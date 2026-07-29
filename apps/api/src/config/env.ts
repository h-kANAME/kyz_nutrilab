import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_PORT: z.coerce.number().default(8080),
  PUBLIC_ORIGIN: z.string().url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  ALLOWED_GOOGLE_EMAILS: z.string().default('*'),
  JWT_SECRET: z.string().min(32),
  COOKIE_NAME: z.string().default('nutrilab_session'),
  LLM_PROVIDER: z.enum(['gemini', 'openai', 'deepseek']).default('gemini'),
  GEMINI_API_KEY: z.string().optional().default(''),
  OPENAI_API_KEY: z.string().optional().default(''),
  DEEPSEEK_API_KEY: z.string().optional().default(''),
  GEMINI_MODEL: z.string().default('gemini-2.0-flash'),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  DEEPSEEK_MODEL: z.string().default('deepseek-chat'),
  SQLITE_PATH: z.string().default('./data/nutrilab.db'),
  UPLOAD_DIR: z.string().default('./data/uploads'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${msg}`);
  }
  return parsed.data;
}

export function parseAllowlist(value: string): string[] | '*' {
  const trimmed = value.trim();
  if (trimmed === '*') return '*';
  return trimmed
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
