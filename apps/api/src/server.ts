import { loadEnv } from './config/env.js';
import { buildApp } from './app.js';

const env = loadEnv();
const { app } = await buildApp(env);

await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
app.log.info(`NutriLab API on :${env.API_PORT}`);
