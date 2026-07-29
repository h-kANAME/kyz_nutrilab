/**
 * Benchmark de estimación de comidas vs gold set canónico.
 * Uso: desde apps/api → npx tsx scripts/benchmark-meals.ts
 * Carga env desde ../../.env (raíz monorepo).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../src/config/env.js';
import {
  createLlmProvider,
  listAvailableLlms,
  type LlmProviderName,
} from '../src/services/llm.js';
import { MEAL_PROMPT_VERSION } from '../src/services/mealPrompt.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

type GoldCase = {
  id: string;
  mealType: string;
  text: string;
  gold_kcal: number;
  tol_kcal: number;
  gold_quality: number;
};

type CaseResult = {
  id: string;
  text: string;
  gold_kcal: number;
  predicted_kcal: number | null;
  abs_err: number | null;
  within_tol: boolean;
  gold_quality: number;
  predicted_quality: number | null;
  quality_ok: boolean;
  ok: boolean;
  error?: string;
  ms: number;
};

type ProviderSummary = {
  provider: string;
  model: string;
  n: number;
  success_rate: number;
  kcal_hit_rate: number;
  kcal_mae: number;
  kcal_mape: number;
  quality_exact_rate: number;
  quality_mae: number;
  consistency: number;
  composite: number;
  cases: CaseResult[];
};

function loadDotEnv(file: string): void {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runProvider(
  name: LlmProviderName,
  env: ReturnType<typeof loadEnv>,
  cases: GoldCase[],
): Promise<ProviderSummary> {
  const provider = createLlmProvider(env, name);
  const results: CaseResult[] = [];

  const consistencyCases: GoldCase[] = [1, 2, 3].map((i) => ({
    id: `consist-cafe-${i}`,
    mealType: 'Extra',
    text: 'Café con leche descremada',
    gold_kcal: 55,
    tol_kcal: 10,
    gold_quality: 4,
  }));
  const allCases = [...cases, ...consistencyCases];

  for (const c of allCases) {
    const started = Date.now();
    try {
      const estimate = await provider.parseMealText({
        mealType: c.mealType,
        text: c.text,
      });
      const predicted = Math.round(
        estimate.items.reduce((s, it) => s + it.kcal, 0),
      );
      const q =
        estimate.items.length === 1
          ? estimate.items[0].quality_score
          : Math.round(
              estimate.items.reduce((s, it) => s + it.quality_score * it.kcal, 0) /
                Math.max(1, estimate.items.reduce((s, it) => s + it.kcal, 0)),
            );
      const abs = Math.abs(predicted - c.gold_kcal);
      const within = abs <= c.tol_kcal;
      results.push({
        id: c.id,
        text: c.text,
        gold_kcal: c.gold_kcal,
        predicted_kcal: predicted,
        abs_err: abs,
        within_tol: within,
        gold_quality: c.gold_quality,
        predicted_quality: q,
        quality_ok: q === c.gold_quality,
        ok: true,
        ms: Date.now() - started,
      });
    } catch (e) {
      results.push({
        id: c.id,
        text: c.text,
        gold_kcal: c.gold_kcal,
        predicted_kcal: null,
        abs_err: null,
        within_tol: false,
        gold_quality: c.gold_quality,
        predicted_quality: null,
        quality_ok: false,
        ok: false,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
        ms: Date.now() - started,
      });
    }
    await sleep(350);
  }

  const okCases = results.filter((r) => r.ok && r.predicted_kcal != null && !r.id.startsWith('consist-'));
  const scored = results.filter((r) => !r.id.startsWith('consist-'));
  const n = scored.length;
  const success_rate = okCases.length / n;
  const kcal_hit_rate = scored.filter((r) => r.within_tol).length / n;
  const kcal_mae =
    okCases.length === 0
      ? Infinity
      : okCases.reduce((s, r) => s + (r.abs_err ?? 0), 0) / okCases.length;
  const kcal_mape =
    okCases.length === 0
      ? Infinity
      : okCases.reduce(
          (s, r) => s + Math.abs((r.predicted_kcal! - r.gold_kcal) / Math.max(1, r.gold_kcal)),
          0,
        ) / okCases.length;
  const quality_exact_rate = scored.filter((r) => r.quality_ok).length / n;
  const quality_mae =
    okCases.length === 0
      ? Infinity
      : okCases.reduce(
          (s, r) => s + Math.abs((r.predicted_quality ?? 0) - r.gold_quality),
          0,
        ) / okCases.length;

  // Ranking NutriLab: acierto kcal (40%) + MAE invertido (20%) + quality exact (20%) + éxito parse (10%) + consistencia (10%)
  const maeScore = Number.isFinite(kcal_mae) ? Math.max(0, 1 - kcal_mae / 80) : 0;
  let consistency = 1;
  const cafeRuns = results.filter((r) => r.id.startsWith('consist-cafe') && r.predicted_kcal != null);
  if (cafeRuns.length >= 2) {
    const vals = cafeRuns.map((r) => r.predicted_kcal!);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    const stdev = Math.sqrt(variance);
    consistency = Math.max(0, 1 - stdev / 20);
  }

  const composite =
    0.4 * kcal_hit_rate +
    0.2 * maeScore +
    0.2 * quality_exact_rate +
    0.1 * success_rate +
    0.1 * consistency;

  return {
    provider: provider.name,
    model: provider.model,
    n,
    success_rate,
    kcal_hit_rate,
    kcal_mae: Number.isFinite(kcal_mae) ? Math.round(kcal_mae * 10) / 10 : -1,
    kcal_mape: Number.isFinite(kcal_mape) ? Math.round(kcal_mape * 1000) / 10 : -1,
    quality_exact_rate,
    quality_mae: Number.isFinite(quality_mae) ? Math.round(quality_mae * 100) / 100 : -1,
    consistency: Math.round(consistency * 1000) / 1000,
    composite: Math.round(composite * 1000) / 1000,
    cases: results,
  };
}

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

async function main() {
  loadDotEnv(path.join(root, '.env'));
  const env = loadEnv(process.env);
  const goldPath = path.join(__dirname, 'fixtures/meal-gold.json');
  const cases = JSON.parse(fs.readFileSync(goldPath, 'utf8')) as GoldCase[];
  if (cases.length < 20) {
    throw new Error(`Gold set too small: ${cases.length}`);
  }

  const available = listAvailableLlms(env).filter((p) => p.configured);
  if (available.length === 0) throw new Error('Ningún LLM configurado');

  console.log(`Prompt ${MEAL_PROMPT_VERSION} · ${cases.length} casos · proveedores: ${available.map((a) => a.id).join(', ')}`);

  const summaries: ProviderSummary[] = [];
  for (const a of available) {
    console.log(`\n→ Corriendo ${a.id}…`);
    const summary = await runProvider(a.id, env, cases);
    summaries.push(summary);
    console.log(
      `  hit kcal ${pct(summary.kcal_hit_rate)} · MAE ${summary.kcal_mae} · quality ${pct(summary.quality_exact_rate)} · composite ${summary.composite}`,
    );
  }

  const ranked = [...summaries].sort((a, b) => b.composite - a.composite);
  console.log('\n========== RANKING NutriLab ==========');
  ranked.forEach((s, i) => {
    console.log(
      `${i + 1}. ${s.provider}/${s.model}  score=${s.composite}  kcal_hit=${pct(s.kcal_hit_rate)}  MAE=${s.kcal_mae}  quality=${pct(s.quality_exact_rate)}  consist=${pct(s.consistency)}  ok=${pct(s.success_rate)}`,
    );
  });

  const outDir = path.join(__dirname, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `benchmark-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      {
        prompt_version: MEAL_PROMPT_VERSION,
        gold_cases: cases.length,
        ranked: ranked.map(({ cases: _c, ...rest }) => rest),
        details: ranked,
      },
      null,
      2,
    ),
  );
  console.log(`\nResultados: ${outFile}`);
  if (ranked[0]) {
    console.log(`\nRecomendado: ${ranked[0].provider} (${ranked[0].model})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
