import { describe, it, expect } from 'vitest';
import type { ProductDayRow } from './dailyInventory';
import { evaluateCounts, interpretShortfall } from './shortfall';

const row = (over: Partial<ProductDayRow>): ProductDayRow => ({
  product_id: 'p1', name: 'Café', price: 10, start_display: 20, start_warehouse: 0,
  entries: 0, sold: 5, returned: 0, other: 0, transfer_to_display: 0,
  end_display: 15, end_warehouse: 0, ...over,
});

describe('evaluateCounts', () => {
  it('lo no contado no cuenta', () => {
    const s = evaluateCounts([row({})], {});
    expect(s.countedProducts).toBe(0);
    expect(s.lines[0].unit_diff).toBeNull();
  });

  it('faltan unidades: valor = unidades × precio', () => {
    const s = evaluateCounts([row({})], { p1: { display: '12' } }); // esperaba 15, hay 12
    expect(s.lines[0]).toMatchObject({ unit_diff: -3, value_diff: -30 });
    expect(s).toMatchObject({ missingUnits: 3, missingValue: 30, extraUnits: 0, extraValue: 0 });
  });

  it('sobran unidades', () => {
    const s = evaluateCounts([row({})], { p1: { display: '17' } });
    expect(s).toMatchObject({ extraUnits: 2, extraValue: 20, missingValue: 0 });
  });

  it('suma vitrina y almacén, y solo compara lo que se contó', () => {
    const r = row({ end_display: 10, end_warehouse: 30 });
    // Solo contó la vitrina (8 en vez de 10): el almacén no cuenta como faltante.
    expect(evaluateCounts([r], { p1: { display: '8' } }).lines[0].unit_diff).toBe(-2);
    // Contó las dos: vitrina −2 y almacén +1 → −1 neto.
    expect(evaluateCounts([r], { p1: { display: '8', warehouse: '31' } }).lines[0].unit_diff).toBe(-1);
  });

  it('acepta coma decimal y descarta texto o negativos', () => {
    const r = row({ unit: 'kg', end_display: 2.5 });
    expect(evaluateCounts([r], { p1: { display: '2,3' } }).lines[0].unit_diff).toBe(-0.2);
    expect(evaluateCounts([r], { p1: { display: 'abc' } }).countedProducts).toBe(0);
    expect(evaluateCounts([r], { p1: { display: '-4' } }).countedProducts).toBe(0);
  });

  it('suma varios productos', () => {
    const rows = [row({ product_id: 'a', price: 10, end_display: 5 }), row({ product_id: 'b', price: 20, end_display: 5 })];
    const s = evaluateCounts(rows, { a: { display: '3' }, b: { display: '6' } });
    expect(s).toMatchObject({ countedProducts: 2, missingValue: 20, extraValue: 20 });
  });
});

describe('interpretShortfall', () => {
  const base = { missingValue: 0, extraValue: 0, countedProducts: 3 };

  it('sin productos contados pide contar', () => {
    expect(interpretShortfall({ ...base, cashDifference: -35, countedProducts: 0 }).verdict).toBe('no_data');
  });

  it('sin cierre de caja no hay con qué comparar', () => {
    expect(interpretShortfall({ ...base, cashDifference: null, missingValue: 30 }).verdict).toBe('no_cash');
  });

  it('caja y productos cuadran', () => {
    expect(interpretShortfall({ ...base, cashDifference: 0 }).verdict).toBe('all_ok');
  });

  it('FALTA dinero y SOBRA mercancía por el mismo valor → los productos lo explican', () => {
    const r = interpretShortfall({ cashDifference: -35, missingValue: 0, extraValue: 35, countedProducts: 2 });
    expect(r.verdict).toBe('explained');
    expect(r.detail).toContain('dio por vendida');
    expect(r.residual).toBe(0);
  });

  it('SOBRA dinero y FALTA mercancía por el mismo valor → se cobró sin registrar', () => {
    const r = interpretShortfall({ cashDifference: 40, missingValue: 40, extraValue: 0, countedProducts: 2 });
    expect(r.verdict).toBe('explained');
    expect(r.detail).toContain('cobró sin registrar');
  });

  it('la caja cuadra pero falta mercancía → pérdida real', () => {
    const r = interpretShortfall({ cashDifference: 0, missingValue: 25, extraValue: 0, countedProducts: 2 });
    expect(r.verdict).toBe('goods_lost');
    expect(r.detail).toContain('sin cobrarse ni registrarse');
  });

  it('la caja cuadra pero sobra mercancía', () => {
    const r = interpretShortfall({ cashDifference: 0, missingValue: 0, extraValue: 25, countedProducts: 2 });
    expect(r.verdict).toBe('goods_lost');
    expect(r.detail).toContain('Sobran');
  });

  it('explican una parte: dice cuánto queda por explicar', () => {
    const r = interpretShortfall({ cashDifference: -100, missingValue: 0, extraValue: 60, countedProducts: 2 });
    expect(r.verdict).toBe('partial');
    expect(r.residual).toBe(-40);
    expect(r.detail).toContain('Quedan $40.00 sin explicar');
  });

  it('productos y caja van en direcciones contrarias → no la explican, y apunta al lado del dinero', () => {
    const r = interpretShortfall({ cashDifference: -50, missingValue: 30, extraValue: 0, countedProducts: 2 });
    expect(r.verdict).toBe('unexplained');
    expect(r.detail).toContain('vuelto');
  });

  it('productos que NO cambian y la caja sí → no la explican', () => {
    const r = interpretShortfall({ cashDifference: -35, missingValue: 0, extraValue: 0, countedProducts: 3 });
    expect(r.verdict).toBe('unexplained');
  });

  it('los productos sugieren más que la diferencia de caja', () => {
    const r = interpretShortfall({ cashDifference: 20, missingValue: 50, extraValue: 0, countedProducts: 2 });
    expect(r.verdict).toBe('partial');
    expect(r.headline).toContain('más');
  });

  it('respeta la tolerancia de centavos', () => {
    expect(interpretShortfall({ cashDifference: -35.2, missingValue: 0, extraValue: 35, countedProducts: 1 }).verdict).toBe('explained');
  });
});
