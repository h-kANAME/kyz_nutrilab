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
  if (kcalOk && qOk) {
    ok++;
    console.log(`OK    ${c.id}: ${r.kcal} kcal q${r.quality_score}`);
  } else {
    fail++;
    console.log(
      `FAIL  ${c.id}: got ${r.kcal}/q${r.quality_score} want ${c.gold_kcal}/q${c.gold_quality} ("${c.text}")`,
    );
  }
}

console.log(`\n${ok}/${cases.length} ok, ${fail} fail`);
if (fail > 0) process.exit(1);
