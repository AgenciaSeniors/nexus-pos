import { describe, it, expect } from 'vitest';
import { classifyMovement, buildDailyInventory } from './dailyInventory';

const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00`);
const iso = (day: string, hhmm: string) => at(day, hhmm).toISOString();
const mv = (product_id: string, reason: string, qty_change: number, day: string, hhmm: string) =>
  ({ product_id, reason, qty_change, created_at: iso(day, hhmm) });

const DAY = '2026-10-14';
const START = at(DAY, '00:00');
const END = at('2026-10-15', '00:00');

describe('classifyMovement', () => {
  it('una venta baja la vitrina', () => {
    expect(classifyMovement({ reason: 'sale', qty_change: -3 })).toEqual({ kind: 'sale', display: -3, warehouse: 0 });
  });
  it('compra en vitrina sube la vitrina; compra en almacén sube el almacén', () => {
    expect(classifyMovement({ reason: 'restock', qty_change: 10 })).toEqual({ kind: 'entry', display: 10, warehouse: 0 });
    expect(classifyMovement({ reason: 'restock_warehouse', qty_change: 10 })).toEqual({ kind: 'entry', display: 0, warehouse: 10 });
  });
  it('el stock inicial de un producto nuevo es una entrada', () => {
    expect(classifyMovement({ reason: 'initial', qty_change: 12 }).kind).toBe('entry');
  });
  it('merma y corrección respetan el lugar', () => {
    expect(classifyMovement({ reason: 'damage', qty_change: -1 })).toEqual({ kind: 'loss', display: -1, warehouse: 0 });
    expect(classifyMovement({ reason: 'damage_warehouse', qty_change: -2 })).toEqual({ kind: 'loss', display: 0, warehouse: -2 });
    expect(classifyMovement({ reason: 'correction_warehouse', qty_change: 4 })).toEqual({ kind: 'adjust', display: 0, warehouse: 4 });
  });
  it('un traslado mueve de un lado al otro sin cambiar el total', () => {
    expect(classifyMovement({ reason: 'transfer_to_display', qty_change: 5 })).toEqual({ kind: 'transfer', display: 5, warehouse: -5 });
    expect(classifyMovement({ reason: 'transfer_to_warehouse', qty_change: -2 })).toEqual({ kind: 'transfer', display: -2, warehouse: 2 });
  });
  it('anulaciones y devoluciones parciales devuelven mercancía a la vitrina', () => {
    expect(classifyMovement({ reason: 'Anulación - Venta #ab12cd', qty_change: 2 })).toEqual({ kind: 'void', display: 2, warehouse: 0 });
    expect(classifyMovement({ reason: 'Anulación (resto) - Venta #ab12cd', qty_change: 1 }).kind).toBe('void');
    expect(classifyMovement({ reason: 'Devolución parcial - Venta #ab12cd', qty_change: 1 }).kind).toBe('void');
  });
  it('una devolución de cliente entra a la vitrina', () => {
    expect(classifyMovement({ reason: 'return', qty_change: 1 })).toEqual({ kind: 'return', display: 1, warehouse: 0 });
  });
  it('un motivo desconocido no se pierde: cae en "otros"', () => {
    expect(classifyMovement({ reason: 'algo raro', qty_change: -1 }).kind).toBe('other');
  });
});

describe('buildDailyInventory', () => {
  it('reconstruye inicial y final esperado de un día sencillo', () => {
    // Hoy quedan 15 en vitrina tras vender 5 (había 20).
    const [row] = buildDailyInventory({
      products: [{ id: 'p1', name: 'Café', price: 10, stock: 15, stock_warehouse: 0 }],
      movements: [mv('p1', 'sale', -2, DAY, '09:00'), mv('p1', 'sale', -3, DAY, '15:00')],
      windowStart: START, windowEnd: END,
    });
    expect(row).toMatchObject({ start_display: 20, end_display: 15, sold: 5, entries: 0 });
  });

  it('lo que entra DURANTE el día va en su columna y no se mezcla con el inicial', () => {
    // Empezó con 10, vendió 4 y a mediodía entraron 20 → debe quedar 26.
    const [row] = buildDailyInventory({
      products: [{ id: 'p1', name: 'Café', price: 10, stock: 26, stock_warehouse: 0 }],
      movements: [mv('p1', 'sale', -4, DAY, '10:00'), mv('p1', 'restock', 20, DAY, '12:00')],
      windowStart: START, windowEnd: END,
    });
    expect(row.start_display).toBe(10);
    expect(row.entries).toBe(20);
    expect(row.sold).toBe(4);
    expect(row.end_display).toBe(26);
    // identidad: inicial + entradas − ventas = final
    expect(row.start_display + row.entries - row.sold).toBe(row.end_display);
  });

  it('separa vitrina y almacén, y un traslado solo cambia el reparto', () => {
    // Almacén 30→20 y vitrina 5→15 por un traslado de 10; sin ventas.
    const [row] = buildDailyInventory({
      products: [{ id: 'p1', name: 'Agua', price: 5, stock: 15, stock_warehouse: 20 }],
      movements: [mv('p1', 'transfer_to_display', 10, DAY, '11:00')],
      windowStart: START, windowEnd: END,
    });
    expect(row).toMatchObject({ start_display: 5, start_warehouse: 30, end_display: 15, end_warehouse: 20, transfer_to_display: 10 });
    expect(row.start_display + row.start_warehouse).toBe(row.end_display + row.end_warehouse);
  });

  it('una compra directa al almacén sube solo el almacén', () => {
    const [row] = buildDailyInventory({
      products: [{ id: 'p1', name: 'Agua', price: 5, stock: 8, stock_warehouse: 50 }],
      movements: [mv('p1', 'restock_warehouse', 50, DAY, '08:00')],
      windowStart: START, windowEnd: END,
    });
    expect(row).toMatchObject({ start_display: 8, start_warehouse: 0, end_warehouse: 50, entries: 50 });
  });

  it('un día pasado descuenta los movimientos POSTERIORES al periodo', () => {
    // Ayer: empezó 20, vendió 5 → terminó 15. Hoy vendió 4 más: stock actual 11.
    const [row] = buildDailyInventory({
      products: [{ id: 'p1', name: 'Café', price: 10, stock: 11, stock_warehouse: 0 }],
      movements: [
        mv('p1', 'sale', -5, DAY, '12:00'),
        mv('p1', 'sale', -4, '2026-10-15', '10:00'), // posterior al periodo
      ],
      windowStart: START, windowEnd: END,
    });
    expect(row).toMatchObject({ start_display: 20, end_display: 15, sold: 5 });
  });

  it('ignora movimientos de antes del periodo y productos que no se movieron', () => {
    const rows = buildDailyInventory({
      products: [
        { id: 'p1', name: 'Café', price: 10, stock: 9, stock_warehouse: 0 },
        { id: 'p2', name: 'Sin movimiento', price: 3, stock: 7, stock_warehouse: 0 },
      ],
      movements: [mv('p1', 'sale', -1, '2026-10-13', '10:00')], // anterior: no entra
      windowStart: START, windowEnd: END,
    });
    expect(rows).toHaveLength(0);
  });

  it('una anulación devuelve unidades y se informa aparte de las ventas', () => {
    const [row] = buildDailyInventory({
      products: [{ id: 'p1', name: 'Café', price: 10, stock: 19, stock_warehouse: 0 }],
      movements: [mv('p1', 'sale', -3, DAY, '10:00'), mv('p1', 'Anulación - Venta #abc123', 2, DAY, '11:00')],
      windowStart: START, windowEnd: END,
    });
    expect(row).toMatchObject({ sold: 3, returned: 2, start_display: 20, end_display: 19 });
  });

  it('mermas y ajustes quedan en "otros" con su signo', () => {
    const [row] = buildDailyInventory({
      products: [{ id: 'p1', name: 'Café', price: 10, stock: 7, stock_warehouse: 0 }],
      movements: [mv('p1', 'damage', -2, DAY, '10:00'), mv('p1', 'correction', 1, DAY, '17:00')],
      windowStart: START, windowEnd: END,
    });
    expect(row.other).toBe(-1);
    expect(row.start_display).toBe(8);
  });

  it('ordena por valor vendido: lo que más dinero movió, primero', () => {
    const rows = buildDailyInventory({
      products: [
        { id: 'a', name: 'Barato', price: 1, stock: 0, stock_warehouse: 0 },
        { id: 'b', name: 'Caro', price: 100, stock: 0, stock_warehouse: 0 },
      ],
      movements: [mv('a', 'sale', -10, DAY, '10:00'), mv('b', 'sale', -2, DAY, '10:00')],
      windowStart: START, windowEnd: END,
    });
    expect(rows.map(r => r.name)).toEqual(['Caro', 'Barato']);
  });

  it('cantidades fraccionarias no acumulan residuo binario', () => {
    const [row] = buildDailyInventory({
      products: [{ id: 'p1', name: 'Arroz', price: 40, unit: 'kg', stock: 9.55, stock_warehouse: 0 }],
      movements: [mv('p1', 'sale', -0.15, DAY, '10:00'), mv('p1', 'sale', -0.3, DAY, '11:00')],
      windowStart: START, windowEnd: END,
    });
    expect(row.start_display).toBe(10);
    expect(row.sold).toBe(0.45);
  });
});
