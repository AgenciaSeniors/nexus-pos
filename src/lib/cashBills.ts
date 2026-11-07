/**
 * Billetes en efectivo: denominaciones del peso cubano y el desglose de billetes con que
 * paga el cliente (`sale.cash_bills`), para saber cuántos billetes de cada tipo entraron en
 * el turno o en el día. Funciones puras.
 */
import type { Sale } from './db';

/** Billetes CUP en circulación, de mayor a menor (incluye los nuevos de 10 000 y 20 000). */
export const CUP_BILLS: number[] = [20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 3, 1];
export const CUP_COINS: number[] = [5, 3, 1];

/** Denominación (como texto, p. ej. "1000") → cantidad de billetes. */
export type CashBills = Record<string, number>;

export function billsTotal(bills: CashBills | null | undefined): number {
  if (!bills) return 0;
  return Object.entries(bills).reduce((sum, [d, n]) => sum + Number(d) * (n || 0), 0);
}

export function billsCount(bills: CashBills | null | undefined): number {
  if (!bills) return 0;
  return Object.values(bills).reduce((sum, n) => sum + (n || 0), 0);
}

export function addBill(bills: CashBills | null | undefined, denomination: number): CashBills {
  const key = String(denomination);
  return { ...(bills || {}), [key]: ((bills || {})[key] || 0) + 1 };
}

export function removeBill(bills: CashBills | null | undefined, denomination: number): CashBills {
  const key = String(denomination);
  const next = { ...(bills || {}) };
  if ((next[key] || 0) <= 1) delete next[key];
  else next[key] -= 1;
  return next;
}

/** Quita ceros y claves raras; devuelve null si no queda nada. */
export function normalizeBills(raw: unknown): CashBills | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: CashBills = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const d = Number(k);
    const n = Math.floor(Number(v));
    if (Number.isFinite(d) && d > 0 && Number.isFinite(n) && n > 0) out[String(d)] = n;
  }
  return Object.keys(out).length ? out : null;
}

export interface BillsSummary {
  /** Por denominación, de mayor a menor, solo las que aparecen. */
  rows: { denomination: number; count: number; total: number }[];
  /** Billetes en total y dinero en total que entró con desglose. */
  count: number;
  total: number;
  /** Ventas con efectivo que tienen desglose, y las que no (el cajero escribió el monto a mano). */
  salesWithBills: number;
  cashSalesWithoutBills: number;
}

const isCashSale = (s: Sale): boolean => {
  const m = (s.payment_method || 'efectivo').toLowerCase();
  return m === 'efectivo' || m === 'mixto';
};

/** Suma los billetes recibidos en un grupo de ventas (las anuladas no cuentan). */
export function summarizeBills(sales: Sale[]): BillsSummary {
  const acc: Record<string, number> = {};
  let salesWithBills = 0;
  let cashSalesWithoutBills = 0;
  for (const s of sales) {
    if (s.status === 'voided' || !isCashSale(s)) continue;
    const bills = normalizeBills(s.cash_bills);
    if (!bills) { cashSalesWithoutBills++; continue; }
    salesWithBills++;
    for (const [d, n] of Object.entries(bills)) acc[d] = (acc[d] || 0) + n;
  }
  const rows = Object.entries(acc)
    .map(([d, count]) => ({ denomination: Number(d), count, total: Number(d) * count }))
    .sort((a, b) => b.denomination - a.denomination);
  return {
    rows,
    count: rows.reduce((s, r) => s + r.count, 0),
    total: rows.reduce((s, r) => s + r.total, 0),
    salesWithBills,
    cashSalesWithoutBills,
  };
}

/** "2 × $1000 · 1 × $500" */
export function formatBills(bills: CashBills | null | undefined): string {
  const b = normalizeBills(bills);
  if (!b) return '';
  return Object.entries(b)
    .map(([d, n]) => ({ d: Number(d), n }))
    .sort((a, b) => b.d - a.d)
    .map(x => `${x.n} × $${x.d}`)
    .join(' · ');
}
