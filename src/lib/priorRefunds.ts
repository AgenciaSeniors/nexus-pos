/**
 * Devoluciones y anulaciones de ventas ANTERIORES.
 *
 * Los reportes de un día son inmutables: si hoy se anula una venta de ayer, el
 * reporte de ayer no cambia (al cierre esa venta era válida). Pero el dinero SÍ
 * sale hoy, y como esa venta no es de hoy, ningún día lo descontaba: la suma de
 * los días quedaba inflada.
 *
 * Criterio contable: no reescribir el pasado; la devolución se registra el día en
 * que OCURRE, como un ajuste negativo ("Devoluciones de ventas anteriores").
 *
 * Aquí se calcula ese ajuste: cuánto se devolvió en un periodo de ventas hechas
 * ANTES de él, repartido por forma de pago (efectivo / transferencia / tarjeta),
 * con la misma regla de caja de siempre (el reembolso consume primero lo pagado en
 * efectivo), y cuánto costo se recuperó por la mercancía que volvió al stock.
 *
 * Funciones puras.
 */
import type { Sale } from './db';
import { cashPortionOfRefund, computeVoidDelta } from './saleRefund';

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return isNaN(n) ? 0 : n;
};

export interface RefundEvent {
  sale_id: string;
  /** Cuándo se devolvió el dinero (ISO) */
  date: string;
  amount: number;
  cash: number;
  transfer: number;
  card: number;
  /** Costo de la mercancía que volvió al stock con esta devolución */
  cost_recovered: number;
}

export interface RefundSummary {
  count: number;
  total: number;
  cash: number;
  transfer: number;
  card: number;
  cost_recovered: number;
  events: RefundEvent[];
}

export const EMPTY_REFUND_SUMMARY: RefundSummary = {
  count: 0, total: 0, cash: 0, transfer: 0, card: 0, cost_recovered: 0, events: [],
};

/** Cuánto de un reembolso sale de cada forma de pago */
function splitByMethod(sale: Sale, alreadyRefunded: number, amount: number): { cash: number; transfer: number; card: number } {
  const method = (sale.payment_method || 'efectivo').toLowerCase();
  if (method === 'tarjeta') return { cash: 0, transfer: 0, card: amount };
  if (method === 'transferencia' || method === 'transfer') return { cash: 0, transfer: amount, card: 0 };
  if (method === 'efectivo' || method === 'mixto') {
    const cash = cashPortionOfRefund(method, num(sale.total), num(sale.cash_amount), alreadyRefunded, amount);
    return { cash, transfer: round2(amount - cash), card: 0 };
  }
  // Método desconocido: igual que en los reportes, se agrupa con transferencia
  return { cash: 0, transfer: amount, card: 0 };
}

/**
 * Todos los eventos de devolución de UNA venta, en orden cronológico:
 *  - cada devolución parcial (con su fecha), y
 *  - si la venta se anuló, el RESTO que se devolvió al anular (total − lo ya devuelto).
 * Una venta cerrada por devolución parcial completa no deja resto.
 */
export function refundEventsOf(sale: Sale): RefundEvent[] {
  const total = num(sale.total);
  const partials = (sale.refunded_items || [])
    .map(r => ({ r, t: new Date(r.date).getTime() }))
    .filter(x => !isNaN(x.t))                     // sin fecha (datos viejos): no se puede ubicar en un día
    .sort((a, b) => a.t - b.t);

  const costOf = (productId: string): number => {
    const item = (sale.items || []).find(i => i.product_id === productId);
    return num(item?.cost);
  };

  const events: RefundEvent[] = [];
  let refundedSoFar = 0;

  for (const { r } of partials) {
    const amount = Math.max(0, num(r.amount));
    if (amount <= 0) continue;
    events.push({
      sale_id: sale.id, date: r.date, amount: round2(amount),
      ...splitByMethod(sale, refundedSoFar, round2(amount)),
      cost_recovered: round2(Math.max(0, num(r.quantity)) * costOf(r.product_id)),
    });
    refundedSoFar = round2(refundedSoFar + amount);
  }

  if (sale.status === 'voided' && sale.voided_at && !isNaN(new Date(sale.voided_at).getTime())) {
    const allRefunds = (sale.refunded_items || []).map(r => ({ product_id: r.product_id, quantity: r.quantity, amount: r.amount }));
    const delta = computeVoidDelta(total, (sale.items || []).map(i => ({ product_id: i.product_id, quantity: i.quantity })), allRefunds);
    const rest = round2(total - refundedSoFar);
    if (rest > 0.005) {
      const cost = Object.entries(delta.pendingQtyByProduct).reduce((acc, [pid, qty]) => acc + qty * costOf(pid), 0);
      events.push({
        sale_id: sale.id, date: sale.voided_at, amount: rest,
        ...splitByMethod(sale, refundedSoFar, rest),
        cost_recovered: round2(cost),
      });
    }
  }
  return events;
}

/**
 * Devoluciones ocurridas en [fromMs, toMs] de ventas "anteriores".
 * @param isPrior  qué ventas cuentan como anteriores (ver quien llama):
 *                 - Corte Z / reportes: las hechas antes del primer día del periodo;
 *                 - cuadre de un turno: las de otro turno.
 */
export function summarizePriorRefunds(
  sales: Sale[],
  opts: { fromMs: number; toMs: number; isPrior: (sale: Sale) => boolean },
): RefundSummary {
  const events: RefundEvent[] = [];
  for (const sale of sales) {
    if (!opts.isPrior(sale)) continue;
    for (const e of refundEventsOf(sale)) {
      const t = new Date(e.date).getTime();
      if (t >= opts.fromMs && t <= opts.toMs) events.push(e);
    }
  }
  const sum = (pick: (e: RefundEvent) => number) => round2(events.reduce((acc, e) => acc + pick(e), 0));
  return {
    count: events.length,
    total: sum(e => e.amount),
    cash: sum(e => e.cash),
    transfer: sum(e => e.transfer),
    card: sum(e => e.card),
    cost_recovered: sum(e => e.cost_recovered),
    events: events.sort((a, b) => a.date.localeCompare(b.date)),
  };
}
