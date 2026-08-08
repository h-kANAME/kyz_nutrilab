/**
 * Tests unitarios del resolver de catálogo (sin LLM).
 * Uso: npx tsx scripts/test-meal-resolve.ts
 */
import assert from 'node:assert/strict';
import { matchCatalogFood } from '../src/services/foodCatalog.js';
import { resolveParsedItem, resolveParsedItems } from '../src/services/mealResolve.js';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}`);
    throw e;
  }
}

console.log('foodCatalog / mealResolve');

test('match café con leche descremada', () => {
  const m = matchCatalogFood('Café con leche descremada');
  assert.ok(m);
  assert.equal(m!.food.id, 'cafe_leche_desc');
});

test('match por catalog_hint plausible', () => {
  const m = matchCatalogFood('Pechuga de pollo a la plancha', 'pechuga_plancha');
  assert.ok(m);
  assert.equal(m!.food.id, 'pechuga_plancha');
  assert.equal(m!.via, 'id');
});

test('catalog_hint irrelevante se ignora', () => {
  const m = matchCatalogFood('lo que sea xyz desconocido', 'pechuga_plancha');
  assert.equal(m, null);
});

test('tostadas de arroz ≠ arroz_blanco', () => {
  const m = matchCatalogFood('Tostadas de arroz con queso untable');
  assert.ok(m);
  assert.notEqual(m!.food.id, 'arroz_blanco');
  assert.equal(m!.food.id, 'tostadas_queso_untable');
});

test('queso solo no matchea untable light', () => {
  const m = matchCatalogFood('queso');
  assert.ok(!m || m.food.id !== 'queso_untable_light');
});

test('hint arroz_blanco con tostadas se ignora', () => {
  const m = matchCatalogFood('Tostadas de arroz', 'arroz_blanco');
  assert.ok(m);
  assert.equal(m!.food.id, 'tostadas_de_arroz');
  assert.equal(m!.via, 'alias');
});

test('arroz blanco cocido sigue matcheando', () => {
  const m = matchCatalogFood('Arroz blanco cocido');
  assert.ok(m);
  assert.equal(m!.food.id, 'arroz_blanco');
});

test('queso untable light', () => {
  const r = resolveParsedItem({ raw_name: 'Queso untable light' });
  assert.ok(r);
  assert.equal(r!.catalog_id, 'queso_untable_light');
  assert.equal(r!.kcal, 70);
});

test('café default 55 kcal', () => {
  const r = resolveParsedItem({ raw_name: 'Café con leche descremada' });
  assert.ok(r);
  assert.equal(r!.kcal, 55);
  assert.equal(r!.quality_score, 4);
  assert.equal(r!.source, 'catalog');
});

test('café 300 ml → 110 kcal', () => {
  const r = resolveParsedItem({
    raw_name: 'Café con leche descremada',
    catalog_hint: 'cafe_leche_desc',
    quantity: 300,
    unit: 'ml',
  });
  assert.ok(r);
  assert.equal(r!.kcal, 110);
});

test('pechuga 200 g → 220 kcal', () => {
  const r = resolveParsedItem({
    raw_name: 'Pechuga de pollo a la plancha',
    quantity: 200,
    unit: 'g',
  });
  assert.ok(r);
  assert.equal(r!.kcal, 220);
  assert.equal(r!.quality_score, 5);
});

test('omelette 2 huevos → 156 kcal', () => {
  const r = resolveParsedItem({
    raw_name: 'Omelette de 2 huevos sin aceite',
    catalog_hint: 'omelette',
    quantity: 2,
    unit: 'unit',
  });
  assert.ok(r);
  assert.equal(r!.kcal, 156);
  assert.equal(r!.quality_score, 4);
});

test('omelette default (sin qty) → 156', () => {
  const r = resolveParsedItem({
    raw_name: 'omelette sin aceite',
    catalog_hint: 'omelette',
  });
  assert.ok(r);
  assert.equal(r!.kcal, 156);
});

test('arroz 300 g → 390', () => {
  const r = resolveParsedItem({
    raw_name: 'Arroz blanco cocido',
    quantity: 300,
    unit: 'g',
  });
  assert.ok(r);
  assert.equal(r!.kcal, 390);
});

test('medialuna → 230 / quality 1', () => {
  const r = resolveParsedItem({ raw_name: 'Una medialuna' });
  assert.ok(r);
  assert.equal(r!.kcal, 230);
  assert.equal(r!.quality_score, 1);
});

test('milanesa quality 2 vs pechuga 5', () => {
  const mil = resolveParsedItem({ raw_name: 'milanesa de pollo rebozada y frita' });
  const pech = resolveParsedItem({ raw_name: 'pechuga de pollo a la plancha' });
  assert.ok(mil && pech);
  assert.equal(mil!.quality_score, 2);
  assert.equal(pech!.quality_score, 5);
});

test('unresolved food returns null', () => {
  const r = resolveParsedItem({ raw_name: 'sopa de piedras extraterrestres xyz' });
  assert.equal(r, null);
});

test('batch confidence alta si todo catálogo', () => {
  const batch = resolveParsedItems([
    { raw_name: 'café solo' },
    { raw_name: 'huevo duro' },
  ]);
  assert.equal(batch.unresolved.length, 0);
  assert.equal(batch.resolved.length, 2);
  assert.ok(batch.confidence >= 0.9);
});

test('gold-ish: coca 330 → 140', () => {
  const r = resolveParsedItem({
    raw_name: 'Coca-Cola 330 ml',
    quantity: 330,
    unit: 'ml',
  });
  assert.ok(r);
  assert.equal(r!.kcal, 140);
  assert.equal(r!.quality_score, 1);
});

test('qty embebida en raw_name: café 300 ml → 110', () => {
  const r = resolveParsedItem({ raw_name: 'Café con leche descremada 300 ml' });
  assert.ok(r);
  assert.equal(r!.kcal, 110);
});

test('qty embebida: pechuga 200 g → 220', () => {
  const r = resolveParsedItem({ raw_name: 'Pechuga de pollo a la plancha 200 g' });
  assert.ok(r);
  assert.equal(r!.kcal, 220);
});

console.log('\nAll mealResolve tests passed.');
