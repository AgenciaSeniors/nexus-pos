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
import type { Sale, Product } from './db';
import { isSaleValidAtTime, endOfLocalDay } from './shiftStats';

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
export function computeKpis(sales: Sale[], products: Product[]): DayKpis {
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
    const saleTotal = safeFloat(sale.total);
    revenue += saleTotal;

    const d = new Date(sale.date);
    if (!isNaN(d.getTime())) {
      const key = String(d.getHours()).padStart(2, '0') + ':00';
      hourlyTotals[key] = (hourlyTotals[key] || 0) + saleTotal;
    }

    for (const item of sale.items || []) {
      const qty = safeFloat(item.quantity);
      const price = safeFloat(item.price);
      const histCost = item.cost !== undefined ? safeFloat(item.cost) : costs.get(item.product_id) || 0;
      cost += histCost * qty;
      const lineRevenue = price * qty;
      const cat = cats.get(item.product_id) || 'General';
      categoryRevenue[cat] = (categoryRevenue[cat] || 0) + lineRevenue;
      productQty[item.name] = (productQty[item.name] || 0) + qty;
      productRevenue[item.name] = (productRevenue[item.name] || 0) + lineRevenue;
    }

    const m = sale.payment_method?.toLowerCase() || 'efectivo';
    if (m === 'efectivo') paymentBreakdown.efectivo += saleTotal;
    else if (m === 'transferencia' || m === 'transfer') paymentBreakdown.transferencia += saleTotal;
    else if (m === 'tarjeta') paymentBreakdown.tarjeta += saleTotal;
    else if (m === 'mixto') {
      paymentBreakdown.efectivo += safeFloat(sale.cash_amount || 0);
      paymentBreakdown.transferencia += safeFloat(sale.transfer_amount || 0);
    }
  }

  const profit = revenue - cost;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
  const count = sales.length;
  const avgTicket = count > 0 ? revenue / count : 0;

  const topProducts: ProductStat[] = Object.keys(productQty)
    .map((name) => ({ name, qty: productQty[name], revenue: productRevenue[name] || 0 }))
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
  return computeKpis(salesForLocalDay(allSales, localDay), products);
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
export function computeProductProfitability(sales: Sale[], products: Product[]): ProductProfit[] {
  const { costs } = buildProductMeta(products);
  const agg = new Map<string, ProductProfit>();

  for (const sale of sales) {
    for (const item of sale.items || []) {
      const key = item.product_id || item.name;
      const qty = safeFloat(item.quantity);
      const price = safeFloat(item.price);
      const histCost = item.cost !== undefined ? safeFloat(item.cost) : costs.get(item.product_id) || 0;
      const cur =
        agg.get(key) ||
        { product_id: item.product_id || '', name: item.name, qty: 0, revenue: 0, cost: 0, profit: 0, margin: 0 };
      cur.qty += qty;
      cur.revenue += price * qty;
      cur.cost += histCost * qty;
      agg.set(key, cur);
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
