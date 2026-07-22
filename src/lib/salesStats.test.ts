import { describe, it, expect } from 'vitest';
import {
  computeKpis,
  computeDayKpis,
  computeProductProfitability,
  compareValues,
  localDateStr,
} from './salesStats';
import type { Sale, SaleItem, Product } from './db';

// --- Factories mínimas -------------------------------------------------------
function makeSale(partial: Partial<Sale> = {}): Sale {
  return {
    id: Math.random().toString(36).slice(2),
    business_id: 'biz',
    date: new Date().toISOString(),
    shift_id: 'shift',
    total: 0,
    items: [],
    payment_method: 'efectivo',
    sync_status: 'synced',
    ...partial,
  } as Sale;
}

function makeItem(partial: Partial<SaleItem> = {}): SaleItem {
  return {
    product_id: 'p1',
    name: 'Producto',
    quantity: 1,
    price: 0,
    ...partial,
  } as SaleItem;
}

function makeProduct(partial: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    business_id: 'biz',
    name: 'Producto',
    price: 0,
    stock: 0,
    sku: null,
    sync_status: 'synced',
    ...partial,
  } as Product;
}

// =============================================================================
// computeKpis — ganancia y margen
// =============================================================================
describe('computeKpis — ganancia con costo histórico', () => {
  it('usa el costo congelado en el ítem por encima del costo actual del producto', () => {
    const sale = makeSale({
      total: 100,
      items: [makeItem({ product_id: 'p1', price: 100, quantity: 1, cost: 40 })],
    });
    // El producto hoy cuesta 70, pero la venta congeló 40 → debe usar 40.
    const products = [makeProduct({ id: 'p1', cost: 70 })];
    const k = computeKpis([sale], products);
    expect(k.revenue).toBe(100);
    expect(k.cost).toBe(40);
    expect(k.profit).toBe(60);
    expect(k.margin).toBeCloseTo(60);
  });

  it('cae al costo actual del producto cuando el ítem no trae costo', () => {
    const sale = makeSale({
      total: 100,
      items: [makeItem({ product_id: 'p1', price: 100, quantity: 2 })], // sin cost
    });
    const products = [makeProduct({ id: 'p1', cost: 30 })];
    const k = computeKpis([sale], products);
    expect(k.cost).toBe(60); // 30 * 2
    expect(k.revenue).toBe(100);
    expect(k.profit).toBe(40);
  });

  it('margen 0 cuando no hay ingresos (sin dividir por cero)', () => {
    const k = computeKpis([], []);
    expect(k.revenue).toBe(0);
    expect(k.margin).toBe(0);
    expect(k.avgTicket).toBe(0);
    expect(k.count).toBe(0);
  });

  it('ticket promedio = ingresos / número de ventas', () => {
    const sales = [makeSale({ total: 100 }), makeSale({ total: 50 })];
    const k = computeKpis(sales, []);
    expect(k.count).toBe(2);
    expect(k.avgTicket).toBe(75);
  });
});

// =============================================================================
// computeKpis — desglose de pago, productos y categorías
// =============================================================================
describe('computeKpis — desgloses', () => {
  it('reparte el pago mixto entre efectivo y transferencia', () => {
    const sale = makeSale({
      total: 100,
      payment_method: 'mixto',
      cash_amount: 70,
      transfer_amount: 30,
    });
    const k = computeKpis([sale], []);
    expect(k.paymentBreakdown.efectivo).toBe(70);
    expect(k.paymentBreakdown.transferencia).toBe(30);
    expect(k.paymentBreakdown.tarjeta).toBe(0);
  });

  it('top productos ordenado por cantidad y limitado a 5', () => {
    const items = ['A', 'B', 'C', 'D', 'E', 'F'].map((n, i) =>
      makeItem({ product_id: 'x' + i, name: n, quantity: i + 1, price: 10 }),
    );
    const sale = makeSale({ total: 210, items });
    const k = computeKpis([sale], []);
    expect(k.topProducts).toHaveLength(5);
    expect(k.topProducts[0].name).toBe('F'); // mayor cantidad (6)
    expect(k.topProducts[0].qty).toBe(6);
    expect(k.topProducts[0].revenue).toBe(60); // 10 * 6
  });

  it('agrupa ingresos por categoría del producto', () => {
    const sale = makeSale({
      total: 150,
      items: [
        makeItem({ product_id: 'p1', name: 'Café', price: 50, quantity: 2 }),
        makeItem({ product_id: 'p2', name: 'Pan', price: 50, quantity: 1 }),
      ],
    });
    const products = [
      makeProduct({ id: 'p1', category: 'Bebidas' }),
      makeProduct({ id: 'p2', category: 'Panadería' }),
    ];
    const k = computeKpis([sale], products);
    expect(k.byCategory[0]).toEqual({ name: 'Bebidas', value: 100 });
    expect(k.byCategory).toContainEqual({ name: 'Panadería', value: 50 });
  });
});

// =============================================================================
// computeDayKpis — filtro por día local + inmutabilidad histórica
// =============================================================================
describe('computeDayKpis — filtra por día local y respeta anulaciones', () => {
  it('solo considera ventas del día local indicado', () => {
    const day = '2026-03-10';
    const inDay = makeSale({ date: new Date(2026, 2, 10, 12, 0).toISOString(), total: 100 });
    const otherDay = makeSale({ date: new Date(2026, 2, 11, 12, 0).toISOString(), total: 999 });
    const k = computeDayKpis([inDay, otherDay], [], day);
    expect(k.revenue).toBe(100);
    expect(k.count).toBe(1);
  });

  it('excluye una venta anulada DENTRO del día', () => {
    const day = '2026-03-10';
    const voidedSameDay = makeSale({
      date: new Date(2026, 2, 10, 12, 0).toISOString(),
      total: 100,
      status: 'voided',
      voided_at: new Date(2026, 2, 10, 15, 0).toISOString(),
    });
    const k = computeDayKpis([voidedSameDay], [], day);
    expect(k.count).toBe(0);
    expect(k.revenue).toBe(0);
  });

  it('incluye una venta anulada DESPUÉS del día (al cierre seguía válida)', () => {
    const day = '2026-03-10';
    const voidedLater = makeSale({
      date: new Date(2026, 2, 10, 12, 0).toISOString(),
      total: 100,
      status: 'voided',
      voided_at: new Date(2026, 2, 12, 9, 0).toISOString(),
    });
    const k = computeDayKpis([voidedLater], [], day);
    expect(k.count).toBe(1);
    expect(k.revenue).toBe(100);
  });

  it('usa el día local de hoy por defecto', () => {
    const today = makeSale({ date: new Date().toISOString(), total: 42 });
    const k = computeDayKpis([today], []);
    expect(k.revenue).toBe(42);
    // sanity: el helper de fecha local devuelve YYYY-MM-DD
    expect(localDateStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// =============================================================================
// computeProductProfitability — rentabilidad por producto
// =============================================================================
describe('computeProductProfitability', () => {
  it('agrega ingreso, costo y ganancia por producto y ordena por ganancia', () => {
    const sales = [
      makeSale({
        items: [
          makeItem({ product_id: 'p1', name: 'Pizza', price: 100, quantity: 2, cost: 40 }),
          makeItem({ product_id: 'p2', name: 'Refresco', price: 20, quantity: 1, cost: 5 }),
        ],
      }),
      makeSale({
        items: [makeItem({ product_id: 'p1', name: 'Pizza', price: 100, quantity: 1, cost: 40 })],
      }),
    ];
    const list = computeProductProfitability(sales, []);
    expect(list).toHaveLength(2);
    // Pizza: 3 u, ingreso 300, costo 120, ganancia 180 → primero
    expect(list[0]).toMatchObject({ name: 'Pizza', qty: 3, revenue: 300, cost: 120, profit: 180 });
    expect(list[0].margin).toBeCloseTo(60);
    // Refresco: ganancia 15
    expect(list[1]).toMatchObject({ name: 'Refresco', profit: 15 });
  });

  it('cae al costo actual del producto cuando el ítem no trae costo', () => {
    const sales = [makeSale({ items: [makeItem({ product_id: 'p1', name: 'Pan', price: 50, quantity: 2 })] })];
    const products = [makeProduct({ id: 'p1', cost: 20 })];
    const list = computeProductProfitability(sales, products);
    expect(list[0].cost).toBe(40); // 20 * 2
    expect(list[0].profit).toBe(60); // 100 - 40
  });

  it('margen 0 sin dividir por cero cuando el ingreso es 0', () => {
    const sales = [makeSale({ items: [makeItem({ product_id: 'p1', name: 'Regalo', price: 0, quantity: 1, cost: 10 })] })];
    const list = computeProductProfitability(sales, []);
    expect(list[0].margin).toBe(0);
    expect(list[0].profit).toBe(-10);
  });
});

// =============================================================================
// compareValues — deltas para comparativas (hoy vs. ayer)
// =============================================================================
describe('compareValues', () => {
  it('crecimiento positivo', () => {
    const d = compareValues(150, 100);
    expect(d.abs).toBe(50);
    expect(d.pct).toBeCloseTo(50);
    expect(d.direction).toBe('up');
  });

  it('caída', () => {
    const d = compareValues(80, 100);
    expect(d.abs).toBe(-20);
    expect(d.pct).toBeCloseTo(-20);
    expect(d.direction).toBe('down');
  });

  it('anterior 0 y actual > 0 → pct null, dirección up', () => {
    const d = compareValues(100, 0);
    expect(d.pct).toBeNull();
    expect(d.direction).toBe('up');
  });

  it('ambos 0 → flat sin variación', () => {
    const d = compareValues(0, 0);
    expect(d.pct).toBe(0);
    expect(d.direction).toBe('flat');
  });
});

// =============================================================================
// computeSaleNet / computeKpis — devoluciones parciales netas
// =============================================================================
describe('computeKpis — devoluciones parciales descuentan de los reportes', () => {
  it('resta el dinero devuelto del ingreso, costo y ganancia', () => {
    // Venta $100 (2 × $50, costo $20 c/u); devolución de 1 unidad ($50)
    const sale = makeSale({
      total: 100,
      status: 'partial_refund',
      items: [makeItem({ product_id: 'p1', price: 50, quantity: 2, cost: 20 })],
      refunded_items: [{ product_id: 'p1', name: 'Producto', quantity: 1, amount: 50, date: new Date().toISOString() }],
    });
    const k = computeKpis([sale], [makeProduct({ id: 'p1' })]);
    expect(k.revenue).toBe(50);   // 100 − 50
    expect(k.cost).toBe(20);      // 40 − 20
    expect(k.profit).toBe(30);
  });

  it('resta lo devuelto del desglose por método de pago (efectivo)', () => {
    const sale = makeSale({
      total: 100,
      payment_method: 'efectivo',
      status: 'partial_refund',
      items: [makeItem({ product_id: 'p1', price: 50, quantity: 2 })],
      refunded_items: [{ product_id: 'p1', name: 'Producto', quantity: 1, amount: 50, date: new Date().toISOString() }],
    });
    const k = computeKpis([sale], []);
    expect(k.paymentBreakdown.efectivo).toBe(50);
  });

  it('venta mixta: el reembolso consume primero el efectivo y el resto la transferencia', () => {
    // $100 = $40 efectivo + $60 transferencia; devuelto $80
    const sale = makeSale({
      total: 100,
      payment_method: 'mixto',
      cash_amount: 40,
      transfer_amount: 60,
      status: 'partial_refund',
      items: [makeItem({ product_id: 'p1', price: 100, quantity: 1 })],
      refunded_items: [{ product_id: 'p1', name: 'Producto', quantity: 1, amount: 80, date: new Date().toISOString() }],
    });
    const k = computeKpis([sale], []);
    expect(k.paymentBreakdown.efectivo).toBe(0);        // 40 − 40
    expect(k.paymentBreakdown.transferencia).toBe(20);  // 60 − 40
    expect(k.revenue).toBe(20);
  });

  it('resta cantidades devueltas de topProducts y categorías', () => {
    const sale = makeSale({
      total: 100,
      status: 'partial_refund',
      items: [makeItem({ product_id: 'p1', name: 'Ron', price: 50, quantity: 2 })],
      refunded_items: [{ product_id: 'p1', name: 'Ron', quantity: 2, amount: 100, date: new Date().toISOString() }],
    });
    const k = computeKpis([sale], [makeProduct({ id: 'p1', category: 'Bebidas' })]);
    // Todo devuelto → no aparece en top products y la categoría queda en 0
    expect(k.topProducts).toEqual([]);
    expect(k.byCategory.find(c => c.name === 'Bebidas')?.value).toBe(0);
    expect(k.revenue).toBe(0);
  });

  it('inmutabilidad histórica: una devolución posterior al período no altera el reporte', () => {
    const periodEnd = new Date('2026-01-10T23:59:59').getTime();
    const sale = makeSale({
      total: 100,
      date: new Date('2026-01-10T12:00:00').toISOString(),
      status: 'partial_refund',
      items: [makeItem({ product_id: 'p1', price: 100, quantity: 1 })],
      refunded_items: [{ product_id: 'p1', name: 'Producto', quantity: 1, amount: 100, date: '2026-01-15T10:00:00.000Z' }],
    });
    const k = computeKpis([sale], [], periodEnd);
    expect(k.revenue).toBe(100); // al cierre del 10, la venta seguía completa
    const kNow = computeKpis([sale], []);
    expect(kNow.revenue).toBe(0); // sin período: refleja el estado actual
  });

  it('el monto devuelto nunca supera el total de la venta (data corrupta)', () => {
    const sale = makeSale({
      total: 50,
      items: [makeItem({ product_id: 'p1', price: 50, quantity: 1 })],
      refunded_items: [{ product_id: 'p1', name: 'Producto', quantity: 1, amount: 999, date: new Date().toISOString() }],
    });
    const k = computeKpis([sale], []);
    expect(k.revenue).toBe(0); // clamp, no negativo
  });

  it('la suma del gráfico por hora coincide con el ingreso neto', () => {
    const sale = makeSale({
      total: 100,
      date: new Date('2026-01-10T09:30:00').toISOString(),
      status: 'partial_refund',
      items: [makeItem({ product_id: 'p1', price: 50, quantity: 2 })],
      refunded_items: [{ product_id: 'p1', name: 'Producto', quantity: 1, amount: 50, date: new Date().toISOString() }],
    });
    const k = computeKpis([sale], []);
    const hourlySum = k.hourly.reduce((s, h) => s + h.total, 0);
    expect(hourlySum).toBe(k.revenue);
  });
});

describe('computeKpis — custom_price y métodos desconocidos', () => {
  it('usa custom_price para ingreso por producto/categoría (consistente con el total)', () => {
    const sale = makeSale({
      total: 30,
      items: [makeItem({ product_id: 'p1', name: 'Ron', price: 10, custom_price: 15, quantity: 2 })],
    });
    const k = computeKpis([sale], [makeProduct({ id: 'p1', category: 'Bebidas' })]);
    expect(k.byCategory[0].value).toBe(30); // 15×2, no 10×2
    expect(k.topProducts[0].revenue).toBe(30);
  });

  it('métodos de pago desconocidos no desaparecen del desglose', () => {
    const sale = makeSale({ total: 40, payment_method: 'cheque' as Sale['payment_method'] });
    const k = computeKpis([sale], []);
    const sum = k.paymentBreakdown.efectivo + k.paymentBreakdown.transferencia + k.paymentBreakdown.tarjeta;
    expect(sum).toBe(40);
  });
});

describe('computeProductProfitability — devoluciones parciales', () => {
  it('resta cantidad, ingreso y costo de lo devuelto', () => {
    const sale = makeSale({
      total: 100,
      status: 'partial_refund',
      items: [makeItem({ product_id: 'p1', name: 'Ron', price: 50, quantity: 2, cost: 20 })],
      refunded_items: [{ product_id: 'p1', name: 'Ron', quantity: 1, amount: 50, date: new Date().toISOString() }],
    });
    const list = computeProductProfitability([sale], []);
    expect(list[0].qty).toBe(1);
    expect(list[0].revenue).toBe(50);
    expect(list[0].cost).toBe(20);
    expect(list[0].profit).toBe(30);
  });
});
