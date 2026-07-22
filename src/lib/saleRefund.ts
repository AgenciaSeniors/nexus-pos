/**
 * Funciones puras para calcular reembolsos y reversiones en ventas.
 *
 * La lógica vive aquí (sin dependencias de Dexie/Supabase/React) para que
 * se pueda testear aisladamente. FinancePage la usa al anular y al hacer
 * devoluciones parciales.
 *
 * Bugs que resuelve:
 * - Si una venta tuvo devoluciones parciales y luego se anula, NO se debe
 *   devolver stock ni reembolsar dinero/puntos que ya se devolvieron
 *   previamente. El cálculo del PENDIENTE va aquí.
 * - Una venta puede tener VARIAS líneas del mismo product_id (restaurante:
 *   mismo plato con distintos modificadores/notas). Las cantidades se
 *   acumulan por producto, nunca se sobrescriben.
 * - El dinero a reembolsar se prorratea por los descuentos de la venta
 *   (descuento manual y puntos canjeados): el cliente nunca recibe más de
 *   lo que realmente pagó.
 */

const round2 = (n: number): number => Math.round(n * 100) / 100;

interface RefundedItemLike {
  product_id: string;
  quantity: number;
  amount: number;
}

interface SaleItemLike {
  product_id: string;
  quantity: number;
  price?: number;
  custom_price?: number;
}

export interface VoidCalculation {
  /** Monto pendiente de reembolsar en efectivo/transferencia (>= 0) */
  pendingAmount: number;
  /** Suma de lo ya reembolsado en partials previos */
  alreadyRefundedAmount: number;
  /** Cantidades pendientes de devolver al stock, por product_id */
  pendingQtyByProduct: Record<string, number>;
  /** Cantidades ya devueltas previamente, por product_id (informativo) */
  alreadyRefundedQtyByProduct: Record<string, number>;
  /** Puntos que aún hay que revertir (puntos ganados originales - ya revertidos) */
  pointsToRevertNow: number;
  /** Puntos ya revertidos en devoluciones parciales previas */
  pointsAlreadyReverted: number;
}

/**
 * Calcula qué falta por reembolsar al anular una venta, considerando
 * cualquier devolución parcial previa.
 *
 * @param saleTotal       Total final de la venta (después de descuentos)
 * @param saleItems       Items originales de la venta (qty cobradas al cliente)
 * @param refundedItems   Devoluciones parciales previas (puede estar vacío)
 */
export function computeVoidDelta(
  saleTotal: number,
  saleItems: SaleItemLike[],
  refundedItems: RefundedItemLike[] = [],
): VoidCalculation {
  const safeTotal = Number.isFinite(saleTotal) ? saleTotal : 0;

  const alreadyRefundedQtyByProduct: Record<string, number> = {};
  let alreadyRefundedAmount = 0;
  let pointsAlreadyReverted = 0;

  for (const r of refundedItems) {
    const qty = Number.isFinite(r.quantity) ? Math.max(0, r.quantity) : 0;
    const amt = Number.isFinite(r.amount) ? Math.max(0, r.amount) : 0;
    alreadyRefundedQtyByProduct[r.product_id] =
      (alreadyRefundedQtyByProduct[r.product_id] || 0) + qty;
    alreadyRefundedAmount += amt;
    // Cada partial reversó floor(amount/10) puntos (consistente con FinancePage)
    pointsAlreadyReverted += Math.floor(amt / 10);
  }

  // Cantidad vendida TOTAL por producto (acumulando líneas duplicadas del
  // mismo product_id — restaurante: mismo plato con distintos modificadores).
  const soldQtyByProduct: Record<string, number> = {};
  for (const item of saleItems) {
    soldQtyByProduct[item.product_id] =
      (soldQtyByProduct[item.product_id] || 0) + (item.quantity || 0);
  }

  const pendingQtyByProduct: Record<string, number> = {};
  for (const [productId, soldQty] of Object.entries(soldQtyByProduct)) {
    const refundedQty = alreadyRefundedQtyByProduct[productId] || 0;
    const pending = Math.max(0, soldQty - refundedQty);
    if (pending > 0) pendingQtyByProduct[productId] = pending;
  }

  const pendingAmount = Math.max(0, round2(safeTotal - alreadyRefundedAmount));
  const pointsEarnedTotal = Math.floor(safeTotal / 10);
  const pointsToRevertNow = Math.max(0, pointsEarnedTotal - pointsAlreadyReverted);

  return {
    pendingAmount,
    alreadyRefundedAmount,
    pendingQtyByProduct,
    alreadyRefundedQtyByProduct,
    pointsToRevertNow,
    pointsAlreadyReverted,
  };
}

/**
 * Determina si una venta ya fue completamente devuelta vía partials.
 * Útil para alertar al usuario que el void no hará nada nuevo.
 */
export function isFullyRefunded(
  saleTotal: number,
  saleItems: SaleItemLike[],
  refundedItems: RefundedItemLike[] = [],
): boolean {
  const calc = computeVoidDelta(saleTotal, saleItems, refundedItems);
  return calc.pendingAmount === 0 && Object.keys(calc.pendingQtyByProduct).length === 0;
}

export interface RefundQuote {
  /** Valor bruto de lo seleccionado (qty × precio de línea, sin descuentos) */
  grossAmount: number;
  /**
   * Dinero a devolver al cliente: bruto prorrateado por los descuentos de la
   * venta y limitado a lo que aún queda pagado (total − ya reembolsado).
   */
  amount: number;
  /** Desglose por producto con montos prorrateados (suman `amount`) */
  perProduct: { product_id: string; quantity: number; amount: number }[];
  /** true si con esta devolución la venta queda devuelta por completo */
  coversRemainder: boolean;
}

/**
 * Calcula cuánto dinero devolver por una devolución parcial.
 *
 * - Prorratea por descuentos: si la venta de $100 en items se cobró en $90
 *   (10% desc.), devolver un item de $50 reembolsa $45.
 * - Con líneas duplicadas del mismo producto (precios distintos por
 *   modificadores) la cantidad se asigna a las líneas en orden, consumiendo
 *   primero lo ya devuelto en partials previos.
 * - Si la selección cubre todo lo pendiente, el monto es EXACTAMENTE el
 *   restante (total − ya devuelto): sin centavos huérfanos.
 */
export function computeRefundQuote(
  saleTotal: number,
  saleItems: SaleItemLike[],
  refundedItems: RefundedItemLike[] = [],
  selections: Record<string, number> = {},
): RefundQuote {
  const safeTotal = Math.max(0, Number.isFinite(saleTotal) ? saleTotal : 0);
  const unitOf = (it: SaleItemLike) => {
    const u = it.custom_price ?? it.price ?? 0;
    return Number.isFinite(u) ? Math.max(0, u) : 0;
  };
  const lineAmount = (unit: number, qty: number) => Math.round(Math.round(unit * 100) * qty) / 100;

  // Valor bruto de TODA la venta a precios de línea (base del prorrateo).
  let grossSale = 0;
  for (const it of saleItems) grossSale = round2(grossSale + lineAmount(unitOf(it), it.quantity || 0));
  const factor = grossSale > 0 ? safeTotal / grossSale : 1;

  const delta = computeVoidDelta(safeTotal, saleItems, refundedItems);
  const remainingMoney = delta.pendingAmount;

  // Asignar por producto: primero "consumir" lo ya devuelto línea a línea,
  // luego asignar la selección a las líneas restantes en orden.
  const alreadyByProduct = { ...delta.alreadyRefundedQtyByProduct };
  const perProduct: RefundQuote['perProduct'] = [];
  let grossAmount = 0;

  const productIds = Object.keys(selections).filter(pid => (selections[pid] || 0) > 0);
  for (const pid of productIds) {
    const pendingForProduct = delta.pendingQtyByProduct[pid] || 0;
    const wanted = Math.min(Math.max(0, selections[pid] || 0), pendingForProduct);
    if (wanted <= 0) continue;

    let toConsumePrev = alreadyByProduct[pid] || 0;
    let toRefund = wanted;
    let grossForProduct = 0;
    for (const it of saleItems) {
      if (it.product_id !== pid || toRefund <= 0) continue;
      let capacity = it.quantity || 0;
      // Lo ya devuelto ocupa las primeras líneas
      const consumed = Math.min(toConsumePrev, capacity);
      toConsumePrev -= consumed;
      capacity -= consumed;
      if (capacity <= 0) continue;
      const take = Math.min(capacity, toRefund);
      grossForProduct = round2(grossForProduct + lineAmount(unitOf(it), take));
      toRefund -= take;
    }
    grossAmount = round2(grossAmount + grossForProduct);
    perProduct.push({ product_id: pid, quantity: wanted, amount: round2(grossForProduct * factor) });
  }

  // ¿La selección cubre todo lo pendiente?
  const coversRemainder =
    perProduct.length > 0 &&
    Object.entries(delta.pendingQtyByProduct).every(
      ([pid, pending]) => (perProduct.find(p => p.product_id === pid)?.quantity || 0) >= pending,
    );

  let amount = perProduct.reduce((s, p) => round2(s + p.amount), 0);
  // Devolución final → devolver EXACTAMENTE lo restante; en cualquier caso
  // nunca devolver más de lo que queda pagado.
  const target = coversRemainder ? remainingMoney : Math.min(amount, remainingMoney);
  if (amount !== target && perProduct.length > 0) {
    const diff = round2(target - amount);
    const last = perProduct[perProduct.length - 1];
    last.amount = Math.max(0, round2(last.amount + diff));
    amount = perProduct.reduce((s, p) => round2(s + p.amount), 0);
  }

  return { grossAmount, amount, perProduct, coversRemainder };
}

/**
 * Cuánto de un reembolso sale de la GAVETA DE EFECTIVO.
 *
 * Regla: los reembolsos consumen primero la porción pagada en efectivo.
 * - Venta en efectivo → todo el reembolso sale de caja.
 * - Venta mixta → sale de caja solo hasta lo que entró en efectivo
 *   (el resto se devuelve por transferencia).
 * - Transferencia/tarjeta → nada sale de caja.
 */
export function cashPortionOfRefund(
  paymentMethod: string | undefined,
  saleTotal: number,
  cashAmount: number | undefined,
  alreadyRefundedAmount: number,
  refundAmountNow: number,
): number {
  const method = (paymentMethod || 'efectivo').toLowerCase();
  const cashPaid =
    method === 'efectivo' ? Math.max(0, saleTotal)
    : method === 'mixto' ? Math.max(0, cashAmount || 0)
    : 0;
  if (cashPaid <= 0) return 0;
  const cashAlreadyRefunded = Math.min(Math.max(0, alreadyRefundedAmount), cashPaid);
  return round2(Math.max(0, Math.min(refundAmountNow, cashPaid - cashAlreadyRefunded)));
}
