/**
 * Auditoría read-only de labels históricos vs matcher actual.
 * Uso (desde apps/api o repo root):
 *   NUTRILAB_AUDIT_DB=../../nutrilab.db npx tsx scripts/audit-meal-labels.ts
 * Default: ../../nutrilab.db relativo a este script si existe, si no DATABASE_PATH.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { matchCatalogFood } from '../src/services/foodCatalog.js';
import { resolveParsedItem } from '../src/services/mealResolve.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRootDb = path.resolve(__dirname, '../../../nutrilab.db');
const dbPath =
  process.env.NUTRILAB_AUDIT_DB ||
  (fs.existsSync(repoRootDb) ? repoRootDb : process.env.DATABASE_PATH || '');

if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('No se encontró DB. Seteá NUTRILAB_AUDIT_DB=./nutrilab.db');
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });

type Row = {
  date: string;
  meal_type: string;
  label: string;
  kcal: number;
};

const rows = db
  .prepare(
    `SELECT d.date, m.meal_type, m.label, m.kcal
     FROM meals m
     JOIN day_logs d ON d.id = m.day_log_id
     ORDER BY d.date, m.meal_type, m.label`,
  )
  .all() as Row[];

type SlotKey = string;
const bySlot = new Map<SlotKey, Row[]>();
for (const r of rows) {
  const k = `${r.date}|${r.meal_type}`;
  const list = bySlot.get(k) ?? [];
  list.push(r);
  bySlot.set(k, list);
}

const suspects: Array<{
  date: string;
  meal_type: string;
  label: string;
  kcal: number;
  reason: string;
  rematch_id?: string;
  rematch_kcal?: number;
}> = [];

for (const [slot, items] of bySlot) {
  const [date, meal_type] = slot.split('|') as [string, string];
  const labels = items.map((i) => i.label.toLowerCase());
  const hasQueso = labels.some((l) => l.includes('queso untable') || l.includes('queso de untar'));
  const hasArroz = items.filter((i) => /arroz blanco/i.test(i.label));
  const isSnackSlot = meal_type === 'Desayuno' || meal_type === 'Merienda';

  for (const arroz of hasArroz) {
    if (isSnackSlot && hasQueso) {
      suspects.push({
        date,
        meal_type,
        label: arroz.label,
        kcal: arroz.kcal,
        reason: 'Arroz blanco en Desayuno/Merienda junto a queso untable (posible tostada mal parseada)',
      });
    }
  }
}

for (const r of rows) {
  const match = matchCatalogFood(r.label);
  const resolved = resolveParsedItem({ raw_name: r.label });
  if (match && resolved && Math.abs(resolved.kcal - r.kcal) > 80) {
    suspects.push({
      date: r.date,
      meal_type: r.meal_type,
      label: r.label,
      kcal: r.kcal,
      reason: `kcal histórica vs catálogo actual difiere >80 (ahora ${resolved.kcal})`,
      rematch_id: resolved.catalog_id,
      rematch_kcal: resolved.kcal,
    });
  }
  if (/^arroz blanco/i.test(r.label) && (r.meal_type === 'Desayuno' || r.meal_type === 'Merienda')) {
    const already = suspects.some(
      (s) => s.date === r.date && s.meal_type === r.meal_type && s.label === r.label,
    );
    if (!already) {
      suspects.push({
        date: r.date,
        meal_type: r.meal_type,
        label: r.label,
        kcal: r.kcal,
        reason: 'Arroz blanco en slot de snack — revisar si eran tostadas de arroz',
        rematch_id: match?.food.id,
        rematch_kcal: resolved?.kcal,
      });
    }
  }
}

// Dedup
const seen = new Set<string>();
const unique = suspects.filter((s) => {
  const k = `${s.date}|${s.meal_type}|${s.label}|${s.reason}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

console.log(`DB: ${dbPath}`);
console.log(`Meals: ${rows.length}`);
console.log(`Suspects: ${unique.length}\n`);

for (const s of unique) {
  console.log(
    `${s.date} ${s.meal_type} | ${s.label} (${s.kcal} kcal) — ${s.reason}` +
      (s.rematch_id ? ` [ahora→ ${s.rematch_id} ${s.rematch_kcal}kcal]` : ''),
  );
}

const outDir = path.resolve(__dirname, 'fixtures');
const outPath = path.join(outDir, 'audit-meal-labels-report.json');
fs.writeFileSync(
  outPath,
  JSON.stringify({ dbPath, meals: rows.length, suspects: unique }, null, 2),
  'utf8',
);
console.log(`\nReport: ${outPath}`);
db.close();
