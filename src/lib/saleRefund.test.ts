import { describe, it, expect } from 'vitest';
import { computeVoidDelta, isFullyRefunded, computeRefundQuote, cashPortionOfRefund } from './saleRefund';

// =============================================================================
// computeVoidDelta — el cálculo crítico que previene doble reembolso
// =============================================================================

describe('computeVoidDelta — venta SIN devoluciones previas', () => {
  it('devuelve todo: stock, dinero y puntos', () => {
    const items = [
      { product_id: 'A', quantity: 2 },
      { product_id: 'B', quantity: 1 },
    ];
    const calc = computeVoidDelta(50, items, []);
    expect(calc.pendingAmount).toBe(50);
    expect(calc.alreadyRefundedAmount).toBe(0);
    expect(calc.pendingQtyByProduct).toEqual({ A: 2, B: 1 });
    expect(calc.pointsToRevertNow).toBe(5); // floor(50/10)
    expect(calc.pointsAlreadyReverted).toBe(0);
  });

  it('refundedItems=undefined es tratado como []', () => {
    const calc = computeVoidDelta(20, [{ product_id: 'X', quantity: 1 }]);
    expect(calc.pendingAmount).toBe(20);
    expect(calc.pendingQtyByProduct).toEqual({ X: 1 });
  });
});

describe('computeVoidDelta — con devolución parcial previa (BUG DOBLE REEMBOLSO)', () => {
  it('caso del bug: venta $50 (2 items) + partial $25 (1 item) → void solo del resto', () => {
    // Reproduce el bug del audit:
    // - Venta $50 con 2 items de $25
    // - Cliente devolvió 1 ($25 reembolsado, stock +1)
    // - Ahora se anula → solo debe devolverse el item restante y $25
    const items = [{ product_id: 'A', quantity: 2 }];
    const refunds = [{ product_id: 'A', quantity: 1, amount: 25 }];
    const calc = computeVoidDelta(50, items, refunds);

    expect(calc.alreadyRefundedAmount).toBe(25);
    expect(calc.pendingAmount).toBe(25); // NO $50 (eso era el bug)
    expect(calc.pendingQtyByProduct).toEqual({ A: 1 }); // NO 2 (eso era el bug)
    expect(calc.pointsAlreadyReverted).toBe(2); // floor(25/10) ya revertidos en partial
    expect(calc.pointsToRevertNow).toBe(3); // floor(50/10)=5, ya 2, restan 3
  });

  it('múltiples partials del mismo producto se suman', () => {
    const items = [{ product_id: 'A', quantity: 5 }];
    const refunds = [
      { product_id: 'A', quantity: 2, amount: 20 },
      { product_id: 'A', quantity: 1, amount: 10 },
    ];
    const calc = computeVoidDelta(50, items, refunds);
    expect(calc.alreadyRefundedQtyByProduct).toEqual({ A: 3 });
    expect(calc.pendingQtyByProduct).toEqual({ A: 2 });
    expect(calc.pendingAmount).toBe(20);
  });

  it('venta ya completamente reembolsada vía partials → pending = 0 (dinero/stock)', () => {
    const items = [{ product_id: 'A', quantity: 2 }];
    const refunds = [
      { product_id: 'A', quantity: 1, amount: 25 },
      { product_id: 'A', quantity: 1, amount: 25 },
    ];
    const calc = computeVoidDelta(50, items, refunds);
    expect(calc.pendingAmount).toBe(0);
    expect(calc.pendingQtyByProduct).toEqual({}); // ningún producto pendiente
    // Puntos: el sistema acumula con floor() así que dos refunds de $25 reversan
    // floor(25/10)*2 = 4 pts, pero la venta había ganado floor(50/10) = 5. El void
    // reversa el punto restante (esperado, no es bug — es consecuencia del floor).
    expect(calc.pointsAlreadyReverted).toBe(4);
    expect(calc.pointsToRevertNow).toBe(1);
  });

  it('múltiples productos con refunds mixtos', () => {
    const items = [
      { product_id: 'A', quantity: 3 },
      { product_id: 'B', quantity: 2 },
      { product_id: 'C', quantity: 1 },
    ];
    // Solo A y C fueron parcialmente devueltos
    const refunds = [
      { product_id: 'A', quantity: 1, amount: 15 },
      { product_id: 'C', quantity: 1, amount: 10 },
    ];
    const calc = computeVoidDelta(80, items, refunds);
    expect(calc.alreadyRefundedAmount).toBe(25);
    expect(calc.pendingAmount).toBe(55);
    expect(calc.pendingQtyByProduct).toEqual({ A: 2, B: 2 });
    expect(calc.alreadyRefundedQtyByProduct).toEqual({ A: 1, C: 1 });
  });
});

describe('computeVoidDelta — casos límite', () => {
  it('venta con total 0 no rompe (descuento 100%)', () => {
    const calc = computeVoidDelta(0, [{ product_id: 'A', quantity: 1 }]);
    expect(calc.pendingAmount).toBe(0);
    expect(calc.pendingQtyByProduct).toEqual({ A: 1 });
    expect(calc.pointsToRevertNow).toBe(0);
  });

  it('items vacíos', () => {
    const calc = computeVoidDelta(50, []);
    expect(calc.pendingAmount).toBe(50);
    expect(calc.pendingQtyByProduct).toEqual({});
  });

  it('refund con quantity 0 no se cuenta', () => {
    const items = [{ product_id: 'A', quantity: 2 }];
    const refunds = [{ product_id: 'A', quantity: 0, amount: 0 }];
    const calc = computeVoidDelta(50, items, refunds);
    expect(calc.pendingQtyByProduct).toEqual({ A: 2 });
    expect(calc.pendingAmount).toBe(50);
  });

  it('refund con amount mayor al total no genera pending negativo', () => {
    // Caso defensivo: data corrupta no debería crear cash_movements negativos
    const calc = computeVoidDelta(50, [{ product_id: 'A', quantity: 1 }], [
      { product_id: 'A', quantity: 1, amount: 100 }, // bug en data: refund > total
    ]);
    expect(calc.pendingAmount).toBe(0); // clamp a 0, NO -50
  });

  it('NaN/Infinity en total se trata como 0', () => {
    const calc = computeVoidDelta(NaN as unknown as number, [{ product_id: 'A', quantity: 1 }]);
    expect(calc.pendingAmount).toBe(0);
  });

  it('valores negativos en refund se clampean a 0', () => {
    const items = [{ product_id: 'A', quantity: 2 }];
    const refunds = [{ product_id: 'A', quantity: -1, amount: -10 }];
    const calc = computeVoidDelta(50, items, refunds);
    expect(calc.pendingQtyByProduct).toEqual({ A: 2 }); // -1 tratado como 0
    expect(calc.pendingAmount).toBe(50);
  });
});

describe('computeVoidDelta — cálculo de puntos', () => {
  it('puntos ganados = floor(total/10)', () => {
    expect(computeVoidDelta(19, []).pointsToRevertNow).toBe(1);
    expect(computeVoidDelta(25, []).pointsToRevertNow).toBe(2);
    expect(computeVoidDelta(100, []).pointsToRevertNow).toBe(10);
    expect(computeVoidDelta(9, []).pointsToRevertNow).toBe(0);
  });

  it('puntos ya revertidos en partials se descuentan', () => {
    // Total $25 → 2 pts. Partial $10 reversó 1 pt. Quedan 1.
    const calc = computeVoidDelta(25, [{ product_id: 'A', quantity: 1 }], [
      { product_id: 'A', quantity: 1, amount: 10 },
    ]);
    expect(calc.pointsAlreadyReverted).toBe(1);
    expect(calc.pointsToRevertNow).toBe(1);
  });

  it('partials que NO triggerean punto (amount<10) no descuentan', () => {
    // Total $19 → 1 pt. Partial $9 reversó 0 pts. Al void: revertir 1 pt completo.
    const calc = computeVoidDelta(19, [{ product_id: 'A', quantity: 1 }], [
      { product_id: 'A', quantity: 1, amount: 9 },
    ]);
    expect(calc.pointsAlreadyReverted).toBe(0);
    expect(calc.pointsToRevertNow).toBe(1);
  });
});

// =============================================================================
// isFullyRefunded — ayuda a la UI a decidir si mostrar el void
// =============================================================================
describe('isFullyRefunded', () => {
  it('false si no hay refunds previos', () => {
    expect(isFullyRefunded(50, [{ product_id: 'A', quantity: 1 }])).toBe(false);
  });

  it('false si hay refund parcial pero no total', () => {
    expect(isFullyRefunded(50, [{ product_id: 'A', quantity: 2 }], [
      { product_id: 'A', quantity: 1, amount: 25 },
    ])).toBe(false);
  });

  it('true si todos los items y todo el dinero fue devuelto', () => {
    expect(isFullyRefunded(50, [{ product_id: 'A', quantity: 2 }], [
      { product_id: 'A', quantity: 2, amount: 50 },
    ])).toBe(true);
  });
});

// =============================================================================
// computeVoidDelta — líneas duplicadas del mismo producto (restaurante)
// =============================================================================
describe('computeVoidDelta — líneas duplicadas del mismo product_id', () => {
  it('acumula cantidades entre líneas (no sobrescribe con la última)', () => {
    // "Burger" x2 (sola) + "Burger" x3 (+queso, otra línea) → devolver 5, no 3
    const items = [
      { product_id: 'burger', quantity: 2 },
      { product_id: 'burger', quantity: 3 },
    ];
    const calc = computeVoidDelta(60, items, []);
    expect(calc.pendingQtyByProduct).toEqual({ burger: 5 });
  });

  it('lo ya devuelto se descuenta UNA vez del total del producto, no por línea', () => {
    const items = [
      { product_id: 'burger', quantity: 2 },
      { product_id: 'burger', quantity: 3 },
    ];
    const refunds = [{ product_id: 'burger', quantity: 2, amount: 20 }];
    const calc = computeVoidDelta(60, items, refunds);
    expect(calc.pendingQtyByProduct).toEqual({ burger: 3 }); // 5 − 2, no 1
  });
});

// =============================================================================
// computeRefundQuote — dinero a devolver en devoluciones parciales
// =============================================================================
describe('computeRefundQuote — prorrateo por descuentos', () => {
  it('sin descuento: devuelve el valor bruto de lo seleccionado', () => {
    const items = [{ product_id: 'A', quantity: 2, price: 50 }];
    const q = computeRefundQuote(100, items, [], { A: 1 });
    expect(q.grossAmount).toBe(50);
    expect(q.amount).toBe(50);
    expect(q.coversRemainder).toBe(false);
  });

  it('con 10% de descuento: item de $50 devuelve $45, no $50', () => {
    // 2 × $50 = $100 bruto, total cobrado $90
    const items = [{ product_id: 'A', quantity: 2, price: 50 }];
    const q = computeRefundQuote(90, items, [], { A: 1 });
    expect(q.grossAmount).toBe(50);
    expect(q.amount).toBe(45);
  });

  it('devolución que cubre todo lo pendiente reembolsa EXACTAMENTE el restante', () => {
    // $10 entre 3 unidades: prorrateos individuales suman con residuo; el
    // cierre debe dar exactamente 10.00
    const items = [{ product_id: 'A', quantity: 3, price: 5 }];
    const q = computeRefundQuote(10, items, [], { A: 3 });
    expect(q.coversRemainder).toBe(true);
    expect(q.amount).toBe(10);
  });

  it('nunca devuelve más que lo restante (total − ya reembolsado)', () => {
    const items = [{ product_id: 'A', quantity: 2, price: 50 }];
    const refunds = [{ product_id: 'A', quantity: 1, amount: 60 }]; // data vieja: sobre-reembolsada
    const q = computeRefundQuote(90, items, refunds, { A: 1 });
    expect(q.amount).toBeLessThanOrEqual(30); // 90 − 60
  });

  it('líneas duplicadas: asigna a las líneas en orden con sus precios', () => {
    // Burger $10 x2 + Burger+queso $12 x3 → bruto venta $56
    const items = [
      { product_id: 'burger', quantity: 2, price: 10 },
      { product_id: 'burger', quantity: 3, price: 12 },
    ];
    // Devolver 3: 2 de la primera línea ($20) + 1 de la segunda ($12) = $32
    const q = computeRefundQuote(56, items, [], { burger: 3 });
    expect(q.grossAmount).toBe(32);
    expect(q.amount).toBe(32);
  });

  it('líneas duplicadas con devolución previa: consume primero lo ya devuelto', () => {
    const items = [
      { product_id: 'burger', quantity: 2, price: 10 },
      { product_id: 'burger', quantity: 3, price: 12 },
    ];
    const refunds = [{ product_id: 'burger', quantity: 2, amount: 20 }];
    // Quedan 3 (todas de la línea de $12): devolver 2 → $24
    const q = computeRefundQuote(56, items, refunds, { burger: 2 });
    expect(q.grossAmount).toBe(24);
    expect(q.amount).toBe(24);
  });

  it('usa custom_price cuando existe', () => {
    const items = [{ product_id: 'A', quantity: 1, price: 10, custom_price: 15 }];
    const q = computeRefundQuote(15, items, [], { A: 1 });
    expect(q.amount).toBe(15);
  });

  it('selección mayor a lo pendiente se recorta', () => {
    const items = [{ product_id: 'A', quantity: 2, price: 10 }];
    const refunds = [{ product_id: 'A', quantity: 1, amount: 10 }];
    const q = computeRefundQuote(20, items, refunds, { A: 5 });
    expect(q.perProduct[0].quantity).toBe(1);
    expect(q.amount).toBe(10);
  });

  it('venta con total 0 (descuento 100%) devuelve $0', () => {
    const items = [{ product_id: 'A', quantity: 1, price: 10 }];
    const q = computeRefundQuote(0, items, [], { A: 1 });
    expect(q.amount).toBe(0);
  });
});

// =============================================================================
// cashPortionOfRefund — cuánto sale de la gaveta
// =============================================================================
describe('cashPortionOfRefund', () => {
  it('venta en efectivo: todo el reembolso sale de caja', () => {
    expect(cashPortionOfRefund('efectivo', 100, undefined, 0, 80)).toBe(80);
  });

  it('venta mixta: sale de caja solo hasta la porción en efectivo', () => {
    // $100 = $40 efectivo + $60 transferencia; reembolso de $80 → $40 de caja
    expect(cashPortionOfRefund('mixto', 100, 40, 0, 80)).toBe(40);
  });

  it('venta mixta con reembolsos previos: la porción de efectivo se agota', () => {
    // $40 en efectivo; ya se reembolsaron $30 → solo quedan $10 de caja
    expect(cashPortionOfRefund('mixto', 100, 40, 30, 50)).toBe(10);
  });

  it('transferencia o tarjeta: nada sale de caja', () => {
    expect(cashPortionOfRefund('transferencia', 100, undefined, 0, 50)).toBe(0);
    expect(cashPortionOfRefund('tarjeta', 100, undefined, 0, 50)).toBe(0);
  });

  it('reembolso menor que la porción de efectivo restante sale completo de caja', () => {
    expect(cashPortionOfRefund('mixto', 100, 40, 0, 25)).toBe(25);
  });
});
