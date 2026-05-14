/**
 * Funciones puras para calcular reembolsos y reversiones en ventas.
 *
 * La lógica vive aquí (sin dependencias de Dexie/Supabase/React) para que
 * se pueda testear aisladamente. FinancePage la usa al anular y al hacer
 * devoluciones parciales.
 *
 * Bug que resuelve: si una venta tuvo devoluciones parciales y luego se anula,
 * NO se debe devolver stock ni reembolsar dinero/puntos que ya se devolvieron
 * previamente. El cálculo del PENDIENTE va aquí.
 */

interface RefundedItemLike {
  product_id: string;
  quantity: number;
  amount: number;
}

interface SaleItemLike {
  product_id: string;
  quantity: number;
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

  const pendingQtyByProduct: Record<string, number> = {};
  for (const item of saleItems) {
    const refundedQty = alreadyRefundedQtyByProduct[item.product_id] || 0;
    const pending = Math.max(0, (item.quantity || 0) - refundedQty);
    if (pending > 0) pendingQtyByProduct[item.product_id] = pending;
  }

  const pendingAmount = Math.max(0, safeTotal - alreadyRefundedAmount);
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
