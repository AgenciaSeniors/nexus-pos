import { describe, it, expect } from 'vitest';
import { soldByCount, summarizeCounts, registeredUnitsByProduct, restockedUnitsByProduct, type CountRow } from './shiftCount';

const row = (over: Partial<CountRow> = {}): CountRow => ({
  product_id: 'p1',
  product_name: 'Cerveza',
  unit_price: 100,
  opening_qty: 20,
  ...over,
});

describe('soldByCount', () => {
  it('caso base: lo que falta es lo que se vendió', () => {
    expect(soldByCount(row({ closing_qty: 8 })).sold).toBe(12);
  });

  it('turno abierto (sin conteo final) todavía no cuadra nada', () => {
    expect(soldByCount(row()).sold).toBe(0);
    expect(soldByCount(row({ closing_qty: undefined })).sold).toBe(0);
  });

  it('closing_qty = 0 SÍ es un conteo válido (se vendió todo)', () => {
    // Regresión: un `|| undefined` o un `!closing_qty` trataría el 0 como
    // "sin contar" y el turno cerraría sin cobrar nada.
    expect(soldByCount(row({ closing_qty: 0 })).sold).toBe(20);
  });

  it('suma las reposiciones hechas a mitad de turno', () => {
    // Abrió con 20, entraron 10 del almacén, quedaron 5 → vendió 25, no 15.
    const r = soldByCount(row({ closing_qty: 5 }), { restockedByProduct: { p1: 10 } });
    expect(r.sold).toBe(25);
  });

  it('las mermas NO se le cobran al dependiente', () => {
    // Abrió 20, quedan 8, pero 2 se rompieron → se cobran 10, no 12.
    expect(soldByCount(row({ closing_qty: 8, loss_qty: 2 })).sold).toBe(10);
  });

  it('lo ya cobrado en ventas registradas no se cobra dos veces', () => {
    // Faltan 12; 5 salieron en ventas tecleadas → solo 7 se cobran por conteo.
    const r = soldByCount(row({ closing_qty: 8 }), { registeredByProduct: { p1: 5 } });
    expect(r.sold).toBe(7);
  });

  it('mermas y ventas registradas se combinan', () => {
    // 20 − 8 = 12 faltan; 2 rotas y 4 vendidas con ticket → 6 por conteo.
    const r = soldByCount(row({ closing_qty: 8, loss_qty: 2 }), { registeredByProduct: { p1: 4 } });
    expect(r.sold).toBe(6);
  });

  it('todo junto: inicial + reposición − merma − final − registrado', () => {
    const r = soldByCount(
      row({ opening_qty: 20, closing_qty: 5, loss_qty: 1 }),
      { restockedByProduct: { p1: 10 }, registeredByProduct: { p1: 4 } },
    );
    // 20 + 10 − 1 − 5 − 4 = 20
    expect(r.sold).toBe(20);
  });

  it('un sobrante no se cobra en negativo: se reporta aparte', () => {
    // Hay MÁS de lo esperado (entró mercancía sin registrar, o el conteo
    // inicial estaba bajo). Cobrar negativo sería devolverle dinero.
    const r = soldByCount(row({ opening_qty: 10, closing_qty: 14 }));
    expect(r.sold).toBe(0);
    expect(r.surplus).toBe(4);
  });

  it('las ventas registradas por sí solas pueden dejar sobrante en 0', () => {
    // Faltan 3 pero se registraron 5: contradicción (alguien repuso sin avisar).
    const r = soldByCount(row({ opening_qty: 10, closing_qty: 7 }), { registeredByProduct: { p1: 5 } });
    expect(r.sold).toBe(0);
    expect(r.surplus).toBe(2);
  });

  it('respeta cantidades fraccionadas sin deriva de coma flotante', () => {
    const r = soldByCount(row({ opening_qty: 1, closing_qty: 0.7 }));
    expect(r.sold).toBe(0.3); // 1 - 0.7 = 0.30000000000000004 en float
  });
});

describe('summarizeCounts', () => {
  it('suma el dinero esperado de todas las líneas', () => {
    const s = summarizeCounts([
      row({ product_id: 'p1', unit_price: 100, opening_qty: 20, closing_qty: 8 }),  // 12 × 100
      row({ product_id: 'p2', unit_price: 50, opening_qty: 10, closing_qty: 4 }),   //  6 × 50
    ]);
    expect(s.expected_amount).toBe(1500);
  });

  it('no arrastra deriva al sumar muchas líneas con decimales', () => {
    // 10 líneas de 0.1 kg a $0.10: en float puro esto no da 0.10 exacto.
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({ product_id: `p${i}`, unit_price: 0.1, opening_qty: 1, closing_qty: 0.9 }),
    );
    expect(summarizeCounts(rows).expected_amount).toBe(0.1);
  });

  it('valora las mermas a precio de venta', () => {
    const s = summarizeCounts([row({ unit_price: 100, opening_qty: 20, closing_qty: 8, loss_qty: 2 })]);
    expect(s.loss_amount).toBe(200);
    expect(s.expected_amount).toBe(1000); // 10 cobradas, no 12
  });

  it('cuenta cuántos productos tienen sobrante', () => {
    const s = summarizeCounts([
      row({ product_id: 'p1', opening_qty: 10, closing_qty: 14 }),
      row({ product_id: 'p2', opening_qty: 10, closing_qty: 3 }),
      row({ product_id: 'p3', opening_qty: 5, closing_qty: 9 }),
    ]);
    expect(s.surplus_count).toBe(2);
  });

  it('un turno sin conteo final no espera dinero', () => {
    const s = summarizeCounts([row(), row({ product_id: 'p2' })]);
    expect(s.expected_amount).toBe(0);
  });

  it('expone las cantidades usadas en cada línea, para poder auditar el cuadre', () => {
    const [line] = summarizeCounts(
      [row({ opening_qty: 20, closing_qty: 5, loss_qty: 1 })],
      { restockedByProduct: { p1: 10 }, registeredByProduct: { p1: 4 } },
    ).lines;
    expect(line).toMatchObject({
      opening_qty: 20, closing_qty: 5, restocked_qty: 10,
      loss_qty: 1, registered_qty: 4, sold_qty: 20, amount: 2000,
    });
  });
});

describe('registeredUnitsByProduct', () => {
  it('agrupa unidades por producto entre varias ventas', () => {
    const out = registeredUnitsByProduct([
      { items: [{ product_id: 'p1', quantity: 2 }, { product_id: 'p2', quantity: 1 }] },
      { items: [{ product_id: 'p1', quantity: 3 }] },
    ]);
    expect(out).toEqual({ p1: 5, p2: 1 });
  });

  it('descuenta las devoluciones parciales', () => {
    // Se vendieron 3 y se devolvió 1: solo 2 salieron del inventario, así que
    // solo 2 dejan de estar en el conteo.
    const out = registeredUnitsByProduct([
      { items: [{ product_id: 'p1', quantity: 3 }], refunded_items: [{ product_id: 'p1', quantity: 1 }] },
    ]);
    expect(out).toEqual({ p1: 2 });
  });

  it('tolera ventas sin items y sin devoluciones', () => {
    expect(registeredUnitsByProduct([])).toEqual({});
    // @ts-expect-error items ausente: dato viejo o corrupto, no debe reventar
    expect(registeredUnitsByProduct([{}])).toEqual({});
  });

  it('suma cantidades fraccionadas sin deriva', () => {
    const out = registeredUnitsByProduct([
      { items: [{ product_id: 'p1', quantity: 0.1 }] },
      { items: [{ product_id: 'p1', quantity: 0.2 }] },
    ]);
    expect(out).toEqual({ p1: 0.3 });
  });
});

describe('restockedUnitsByProduct', () => {
  const mov = (product_id: string, qty_change: number, reason: string) => ({ product_id, qty_change, reason });

  it('suma compras y traslados a vitrina', () => {
    const out = restockedUnitsByProduct([
      mov('p1', 10, 'restock'),
      mov('p1', 5, 'transfer_to_display'),
      mov('p2', 3, 'initial'),
    ]);
    expect(out).toEqual({ p1: 15, p2: 3 });
  });

  it('ignora las bajas por venta', () => {
    // Las ventas ya se descuentan por registeredUnitsByProduct.
    const out = restockedUnitsByProduct([mov('p1', 10, 'restock'), mov('p1', -4, 'sale')]);
    expect(out).toEqual({ p1: 10 });
  });

  it('NO cuenta las devoluciones de cliente', () => {
    // Doble conteo: la devolución ya se resta en registeredUnitsByProduct.
    expect(restockedUnitsByProduct([mov('p1', 2, 'return')])).toEqual({});
  });

  it('NO cuenta movimientos de almacén: se cuenta la vitrina', () => {
    expect(restockedUnitsByProduct([
      mov('p1', 10, 'restock_warehouse'),
      mov('p1', 5, 'transfer_to_warehouse'),
    ])).toEqual({});
  });

  it('ignora mermas y correcciones negativas', () => {
    expect(restockedUnitsByProduct([mov('p1', -2, 'damage'), mov('p1', -1, 'correction')])).toEqual({});
  });

  it('sin movimientos devuelve vacío', () => {
    expect(restockedUnitsByProduct([])).toEqual({});
  });
});
