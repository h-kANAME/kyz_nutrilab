/**
 * Valida que el gold set se resuelve con kcal exactas vía catálogo
 * (sin LLM: usa el texto del caso como raw_name).
 * Uso: npx tsx scripts/validate-gold-catalog.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveParsedItem } from '../src/services/mealResolve.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type GoldCase = {
  id: string;
  text: string;
  gold_kcal: number;
  tol_kcal: number;
  gold_quality: number;
  expect_catalog_id?: string;
  forbid_catalog_id?: string;
};

const cases = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/meal-gold.json'), 'utf8'),
) as GoldCase[];

let ok = 0;
let fail = 0;

for (const c of cases) {
  const r = resolveParsedItem({ raw_name: c.text });
  if (!r) {
    console.log(`MISS  ${c.id}: no match for "${c.text}"`);
    fail++;
    continue;
  }
  const kcalOk = Math.abs(r.kcal - c.gold_kcal) <= c.tol_kcal;
  const qOk = r.quality_score === c.gold_quality;
  const expectOk = !c.expect_catalog_id || r.catalog_id === c.expect_catalog_id;
  const forbidOk = !c.forbid_catalog_id || r.catalog_id !== c.forbid_catalog_id;
  if (kcalOk && qOk && expectOk && forbidOk) {
    ok++;
    console.log(`OK    ${c.id}: ${r.kcal} kcal q${r.quality_score} (${r.catalog_id})`);
  } else {
    fail++;
    const bits = [
      !kcalOk || !qOk
        ? `got ${r.kcal}/q${r.quality_score} want ${c.gold_kcal}/q${c.gold_quality}`
        : null,
      !expectOk ? `catalog ${r.catalog_id} want ${c.expect_catalog_id}` : null,
      !forbidOk ? `forbidden catalog ${c.forbid_catalog_id}` : null,
    ]
      .filter(Boolean)
      .join('; ');
    console.log(`FAIL  ${c.id}: ${bits} ("${c.text}")`);
  }
}

console.log(`\n${ok}/${cases.length} ok, ${fail} fail`);
if (fail > 0) process.exit(1);
