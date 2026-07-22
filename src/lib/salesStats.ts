/**
 * Estadísticas de ventas — funciones PURAS (sin IndexedDB) reutilizables por el
 * Panel de Inicio (`HomePage`) y por Finanzas (`FinancePage`).
 *
 * La lógica de ganancia/margen/top productos vivía embebida dentro de
 * `FinancePage.tsx`; aquí se centraliza para tener una única fuente de verdad,
 * testeable sin montar React ni Dexie.
 *
 * Respeta la inmutabilidad histórica de los reportes reutilizando
 * `isSaleValidAtTime` / `endOfLocalDay` de `shiftStats.ts`: una venta anulada
 * DESPUÉS del fin del período sigue contando para ese período.
 */
import type { Sale, Product, RefundedItem, SaleItem } from './db';
import { isSaleValidAtTime, endOfLocalDay } from './shiftStats';
import { cashPortionOfRefund } from './saleRefund';

/** Parseo numérico defensivo (idéntico al helper interno de FinancePage). */
export const safeFloat = (val: unknown): number => {
  const num = parseFloat(val as string);
  return isNaN(num) ? 0 : num;
};

/**
 * Fecha LOCAL en formato `YYYY-MM-DD` (no UTC).
 * Crítico para Cuba (UTC-5/-4): una venta a las 11pm local se guarda como el día
 * siguiente en UTC, así que nunca comparar `sale.date` (UTC) con hoy en UTC.
 */
export const localDateStr = (d: Date = new Date()): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** `true` si la fecha local de una venta (ISO UTC) coincide con un día local `YYYY-MM-DD`. */
export const saleMatchesLocalDate = (saleDate: string, localDay: string): boolean =>
  localDateStr(new Date(saleDate)) === localDay;

export interface ProductStat {
  name: string;
  qty: number;
  revenue: number;
}

export interface PaymentBreakdown {
  efectivo: number;
  transferencia: number;
  tarjeta: number;
}

export interface CategoryStat {
  name: string;
  value: number;
}

export interface HourlyPoint {
  /** Etiqueta de hora `HH:00`. */
  time: string;
  total: number;
}

export interface DayKpis {
  /** Ventas válidas consideradas en el cálculo. */
  sales: Sale[];
  revenue: number;
  cost: number;
  profit: number;
  /** Margen en porcentaje (0–100). */
  margin: number;
  /** Número de tickets/ventas. */
  count: number;
  /** Ticket promedio (revenue / count). */
  avgTicket: number;
  paymentBreakdown: PaymentBreakdown;
  /** Top 5 productos por cantidad vendida. */
  topProducts: ProductStat[];
  /** Ingreso por categoría, mayor a menor. */
  byCategory: CategoryStat[];
  /** Ventas por hora (0–23) para mini-gráficos. */
  hourly: HourlyPoint[];
}

/** Construye los mapas de costo y categoría por id de producto (una sola pasada). */
function buildProductMeta(products: Product[]): {
  costs: Map<string, number>;
  cats: Map<string, string>;
} {
  const costs = new Map<string, number>();
  const cats = new Map<string, string>();
  for (const p of products) {
    costs.set(p.id, safeFloat(p.cost));
    cats.set(p.id, p.category || 'General');
  }
  return { costs, cats };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface SaleNet {
  /** Devoluciones parciales válidas al fin del período (o todas si no se pasa). */
  refunds: RefundedItem[];
  /** Dinero devuelto (limitado al total de la venta, nunca negativo). */
  refundAmount: number;
  /** Total neto de la venta: total − devoluciones. */
  netTotal: number;
}

/**
 * Neto de una venta descontando sus devoluciones parciales.
 *
 * Respeta la inmutabilidad histórica: una devolución hecha DESPUÉS del fin del
 * período (`periodEndMs`) no altera el reporte de ese período — igual que las
 * anulaciones con `voided_at`. Devoluciones sin fecha (data legada) se cuentan
 * siempre (conservador: el reporte nunca muestra dinero que ya se devolvió).
 */
export function computeSaleNet(sale: Sale, periodEndMs?: number): SaleNet {
  const total = safeFloat(sale.total);
  const all = sale.refunded_items || [];
  const refunds = periodEndMs === undefined
    ? all
    : all.filter((r) => {
        const t = new Date(r.date).getTime();
        return isNaN(t) || t <= periodEndMs;
      });
  const rawAmount = refunds.reduce((s, r) => s + Math.max(0, safeFloat(r.amount)), 0);
  const refundAmount = Math.min(round2(rawAmount), Math.max(0, total));
  return { refunds, refundAmount, netTotal: round2(total - refundAmount) };
}

/**
 * Resta un reembolso del desglose por método de pago, con la misma regla que
 * usa la caja: el reembolso consume primero la porción pagada en efectivo
 * (ventas en efectivo o mixtas) y el resto sale de transferencia/tarjeta.
 */
function subtractRefundFromBreakdown(bd: PaymentBreakdown, sale: Sale, refundAmount: number): void {
  if (refundAmount <= 0) return;
  const m = sale.payment_method?.toLowerCase() || 'efectivo';
  if (m === 'tarjeta') {
    bd.tarjeta = round2(bd.tarjeta - refundAmount);
    return;
  }
  if (m === 'transferencia' || m === 'transfer') {
    bd.transferencia = round2(bd.transferencia - refundAmount);
    return;
  }
  // efectivo, mixto y métodos desconocidos: primero de efectivo, resto de transferencia
  const fromCash = cashPortionOfRefund(m, safeFloat(sale.total), safeFloat(sale.cash_amount), 0, refundAmount);
  bd.efectivo = round2(bd.efectivo - fromCash);
  const rest = round2(refundAmount - fromCash);
  if (rest > 0) bd.transferencia = round2(bd.transferencia - rest);
}

/**
 * Filtra las ventas de un día local concreto, descartando las que ya no eran
 * válidas al cierre de ese día (anuladas dentro del período).
 */
export function salesForLocalDay(allSales: Sale[], localDay: string): Sale[] {
  const periodEnd = endOfLocalDay(localDay).getTime();
  return allSales.filter(
    (s) => saleMatchesLocalDate(s.date, localDay) && isSaleValidAtTime(s, periodEnd),
  );
}

/**
 * Calcula los KPIs de un conjunto de ventas YA filtrado al período deseado.
 * El costo usa el costo histórico congelado en el ítem (`item.cost`) y cae al
 * costo actual del producto solo si el ítem no lo trae — igual que FinancePage.
 */
export function computeKpis(sales: Sale[], products: Product[], periodEndMs?: number): DayKpis {
  const { costs, cats } = buildProductMeta(products);

  let revenue = 0;
  let cost = 0;
  const hourlyTotals: Record<string, number> = {};
  for (let h = 0; h <= 23; h++) hourlyTotals[String(h).padStart(2, '0') + ':00'] = 0;

  const categoryRevenue: Record<string, number> = {};
  const productQty: Record<string, number> = {};
  const productRevenue: Record<string, number> = {};
  const paymentBreakdown: PaymentBreakdown = { efectivo: 0, transferencia: 0, tarjeta: 0 };

  for (const sale of sales) {
    const { refunds, refundAmount, netTotal } = computeSaleNet(sale, periodEndMs);
    revenue += netTotal;

    const d = new Date(sale.date);
    if (!isNaN(d.getTime())) {
      const key = String(d.getHours()).padStart(2, '0') + ':00';
      // Neto en la hora de la venta: la suma del gráfico coincide con `revenue`.
      hourlyTotals[key] = (hourlyTotals[key] || 0) + netTotal;
    }

    // Primera línea de la venta por producto: para mapear devoluciones
    // (que solo traen product_id) a nombre/costo histórico.
    const itemByProduct = new Map<string, SaleItem>();

    for (const item of sale.items || []) {
      if (!itemByProduct.has(item.product_id)) itemByProduct.set(item.product_id, item);
      const qty = safeFloat(item.quantity);
      const price = safeFloat(item.custom_price ?? item.price);
      const histCost = item.cost !== undefined ? safeFloat(item.cost) : costs.get(item.product_id) || 0;
      cost += histCost * qty;
      const lineRevenue = price * qty;
      const cat = cats.get(item.product_id) || 'General';
      categoryRevenue[cat] = (categoryRevenue[cat] || 0) + lineRevenue;
      productQty[item.name] = (productQty[item.name] || 0) + qty;
      productRevenue[item.name] = (productRevenue[item.name] || 0) + lineRevenue;
    }

    // Descontar lo devuelto de cantidades, ingresos por producto/categoría y costo.
    for (const r of refunds) {
      const qty = Math.max(0, safeFloat(r.quantity));
      const amt = Math.max(0, safeFloat(r.amount));
      if (qty <= 0 && amt <= 0) continue;
      const src = itemByProduct.get(r.product_id);
      const name = src?.name || r.name;
      const histCost = src?.cost !== undefined ? safeFloat(src.cost) : costs.get(r.product_id) || 0;
      cost -= histCost * qty;
      const cat = cats.get(r.product_id) || 'General';
      categoryRevenue[cat] = (categoryRevenue[cat] || 0) - amt;
      if (name) {
        productQty[name] = (productQty[name] || 0) - qty;
        productRevenue[name] = (productRevenue[name] || 0) - amt;
      }
    }

    const m = sale.payment_method?.toLowerCase() || 'efectivo';
    const saleTotal = safeFloat(sale.total);
    if (m === 'efectivo') paymentBreakdown.efectivo += saleTotal;
    else if (m === 'transferencia' || m === 'transfer') paymentBreakdown.transferencia += saleTotal;
    else if (m === 'tarjeta') paymentBreakdown.tarjeta += saleTotal;
    else if (m === 'mixto') {
      paymentBreakdown.efectivo += safeFloat(sale.cash_amount || 0);
      paymentBreakdown.transferencia += safeFloat(sale.transfer_amount || 0);
    } else {
      // Método desconocido: no desaparecer del desglose (mismo criterio que el
      // Reporte Z, que lo agrupa con transferencia).
      paymentBreakdown.transferencia += saleTotal;
    }
    subtractRefundFromBreakdown(paymentBreakdown, sale, refundAmount);
  }

  const profit = revenue - cost;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
  const count = sales.length;
  const avgTicket = count > 0 ? revenue / count : 0;

  const topProducts: ProductStat[] = Object.keys(productQty)
    .map((name) => ({ name, qty: productQty[name], revenue: productRevenue[name] || 0 }))
    .filter((p) => p.qty > 0)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  const byCategory: CategoryStat[] = Object.entries(categoryRevenue)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const hourly: HourlyPoint[] = Object.entries(hourlyTotals).map(([time, total]) => ({ time, total }));

  return {
    sales,
    revenue,
    cost,
    profit,
    margin,
    count,
    avgTicket,
    paymentBreakdown,
    topProducts,
    byCategory,
    hourly,
  };
}

/**
 * Atajo: KPIs de un día local concreto a partir de TODAS las ventas.
 * Aplica el filtro de fecha + validez histórica y delega en `computeKpis`.
 */
export function computeDayKpis(allSales: Sale[], products: Product[], localDay: string = localDateStr()): DayKpis {
  return computeKpis(salesForLocalDay(allSales, localDay), products, endOfLocalDay(localDay).getTime());
}

export interface ProductProfit {
  product_id: string;
  name: string;
  qty: number;
  revenue: number;
  cost: number;
  profit: number;
  /** Margen en porcentaje (0–100). */
  margin: number;
}

/**
 * Rentabilidad por producto a partir de un conjunto de ventas ya filtrado al
 * período. Agrega ingreso, costo y ganancia por producto y los ordena de mayor
 * a menor ganancia. Responde "¿qué producto me deja más dinero?".
 *
 * Usa el costo histórico del ítem (`item.cost`) y cae al costo actual del
 * producto solo si el ítem no lo trae — consistente con `computeKpis`.
 */
export function computeProductProfitability(sales: Sale[], products: Product[], periodEndMs?: number): ProductProfit[] {
  const { costs } = buildProductMeta(products);
  const agg = new Map<string, ProductProfit>();

  for (const sale of sales) {
    const { refunds } = computeSaleNet(sale, periodEndMs);
    const itemByProduct = new Map<string, SaleItem>();
    for (const item of sale.items || []) {
      if (!itemByProduct.has(item.product_id)) itemByProduct.set(item.product_id, item);
      const key = item.product_id || item.name;
      const qty = safeFloat(item.quantity);
      const price = safeFloat(item.custom_price ?? item.price);
      const histCost = item.cost !== undefined ? safeFloat(item.cost) : costs.get(item.product_id) || 0;
      const cur =
        agg.get(key) ||
        { product_id: item.product_id || '', name: item.name, qty: 0, revenue: 0, cost: 0, profit: 0, margin: 0 };
      cur.qty += qty;
      cur.revenue += price * qty;
      cur.cost += histCost * qty;
      agg.set(key, cur);
    }
    // Descontar devoluciones parciales del producto correspondiente
    for (const r of refunds) {
      const cur = agg.get(r.product_id);
      if (!cur) continue;
      const qty = Math.max(0, safeFloat(r.quantity));
      const src = itemByProduct.get(r.product_id);
      const histCost = src?.cost !== undefined ? safeFloat(src.cost) : costs.get(r.product_id) || 0;
      cur.qty -= qty;
      cur.revenue -= Math.max(0, safeFloat(r.amount));
      cur.cost -= histCost * qty;
    }
  }

  return [...agg.values()]
    .map((p) => {
      const profit = p.revenue - p.cost;
      const margin = p.revenue > 0 ? (profit / p.revenue) * 100 : 0;
      return { ...p, profit, margin };
    })
    .sort((a, b) => b.profit - a.profit);
}

export interface Delta {
  /** Diferencia absoluta (actual − anterior). */
  abs: number;
  /** Diferencia porcentual respecto al anterior; `null` si no es representable. */
  pct: number | null;
  direction: 'up' | 'down' | 'flat';
}

/**
 * Compara dos valores (p. ej. ventas de hoy vs. ayer) y devuelve el delta.
 * - Si el valor anterior es 0 y el actual > 0 → `pct = null` (crecimiento "nuevo",
 *   no representable como porcentaje), dirección `up`.
 * - Si ambos son 0 → `flat`.
 */
export function compareValues(current: number, previous: number): Delta {
  const abs = current - previous;
  let pct: number | null;
  if (previous === 0) {
    pct = current === 0 ? 0 : null;
  } else {
    pct = (abs / Math.abs(previous)) * 100;
  }
  const direction: Delta['direction'] = abs > 0 ? 'up' : abs < 0 ? 'down' : 'flat';
  return { abs, pct, direction };
}
