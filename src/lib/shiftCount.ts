/**
 * Cuadre por conteo — cuánto se vendió según el conteo de productos.
 *
 * Para los negocios que no teclean venta por venta (bares, cafeterías, puntos
 * de venta con cola): se cuenta al abrir, se cuenta al cerrar, y lo que falta
 * es lo que se vendió. El dinero esperado sale de multiplicar por el precio.
 *
 * LA FÓRMULA:
 *
 *   vendido = inicial + reposiciones − mermas − final − ya registrado en ventas
 *
 * Los dos últimos términos son los que evitan cobrarle de más al dependiente:
 *
 * - `mermas`: lo que se rompió, se consumió o se regaló. Salió del inventario
 *   pero no entró dinero. Sin esto, el dependiente paga las roturas.
 * - `ya registrado`: si durante el turno se tecleó una venta normal (una
 *   transferencia, un cliente con puntos, alguien que pidió ticket), ese
 *   producto salió del conteo Y está en una venta. Cobrarlo por ambas vías
 *   sería cobrarlo dos veces.
 *
 * Funciones puras: sin IndexedDB, sin React, sin relojes.
 */

import { round3 } from './recipe';
import { currency } from './currency';

/** Una fila de conteo, reducida a lo que hace falta para la cuenta. */
export interface CountRow {
  product_id: string;
  product_name: string;
  unit_price: number;
  opening_qty: number;
  closing_qty?: number;
  loss_qty?: number;
}

/** Cantidades que vienen de fuera del conteo, por producto. */
export interface CountContext {
  /** Unidades que entraron al turno después de abrir (reposición de almacén, compra). */
  restockedByProduct?: Record<string, number>;
  /** Unidades ya cobradas en ventas registradas durante el turno. */
  registeredByProduct?: Record<string, number>;
}

export interface CountLine {
  product_id: string;
  product_name: string;
  unit_price: number;
  opening_qty: number;
  closing_qty: number;
  restocked_qty: number;
  loss_qty: number;
  registered_qty: number;
  /** Unidades atribuidas a venta NO registrada. Nunca negativo (ver `surplus_qty`). */
  sold_qty: number;
  /** Dinero que el conteo espera por este producto. */
  amount: number;
  /**
   * Unidades que SOBRAN respecto a lo que el sistema esperaba. Señal de que
   * entró mercancía sin registrar o de que el conteo inicial estaba bajo.
   * Se reporta pero NO se descuenta del dinero: nadie devuelve dinero porque
   * aparezcan cajas de más.
   */
  surplus_qty: number;
}

export interface CountSummary {
  lines: CountLine[];
  /** Total que el conteo espera en caja, sin contar lo ya cobrado en ventas. */
  expected_amount: number;
  /** Valor de lo declarado como merma, a precio de venta. */
  loss_amount: number;
  /** Productos con sobrante — merecen una mirada antes de cerrar. */
  surplus_count: number;
}

/**
 * Lo vendido de un producto según el conteo.
 *
 * Un turno abierto (sin `closing_qty`) da 0: todavía no hay nada que cuadrar.
 * Ojo con `?? undefined` — `closing_qty: 0` es un conteo final legítimo (se
 * vendió todo) y no debe confundirse con "sin contar".
 */
export function soldByCount(row: CountRow, ctx: CountContext = {}): { sold: number; surplus: number } {
  if (row.closing_qty === undefined || row.closing_qty === null) {
    return { sold: 0, surplus: 0 };
  }
  const restocked = ctx.restockedByProduct?.[row.product_id] ?? 0;
  const registered = ctx.registeredByProduct?.[row.product_id] ?? 0;
  const loss = row.loss_qty ?? 0;

  const raw = round3(
    row.opening_qty + restocked - loss - row.closing_qty - registered,
  );

  // Negativo = hay MÁS mercancía de la que el sistema esperaba. No se cobra en
  // negativo (sería devolverle dinero al dependiente); se reporta como sobrante.
  if (raw < 0) return { sold: 0, surplus: round3(-raw) };
  return { sold: raw, surplus: 0 };
}

/**
 * Cuadre completo del turno.
 *
 * El dinero se suma con `currency` (enteros de centavos) y no con aritmética de
 * coma flotante: sumar 40 líneas de `0.1 * precio` en float deriva, y aquí el
 * resultado es lo que el dependiente tiene que entregar.
 */
export function summarizeCounts(rows: CountRow[], ctx: CountContext = {}): CountSummary {
  const lines: CountLine[] = rows.map(row => {
    const { sold, surplus } = soldByCount(row, ctx);
    return {
      product_id: row.product_id,
      product_name: row.product_name,
      unit_price: row.unit_price,
      opening_qty: row.opening_qty,
      closing_qty: row.closing_qty ?? 0,
      restocked_qty: ctx.restockedByProduct?.[row.product_id] ?? 0,
      loss_qty: row.loss_qty ?? 0,
      registered_qty: ctx.registeredByProduct?.[row.product_id] ?? 0,
      sold_qty: sold,
      amount: currency.multiply(row.unit_price, sold),
      surplus_qty: surplus,
    };
  });

  return {
    lines,
    expected_amount: lines.reduce((acc, l) => currency.add(acc, l.amount), 0),
    loss_amount: lines.reduce((acc, l) => currency.add(acc, currency.multiply(l.unit_price, l.loss_qty)), 0),
    surplus_count: lines.filter(l => l.surplus_qty > 0).length,
  };
}

/**
 * Agrupa por producto las unidades vendidas en ventas YA registradas.
 *
 * Se descuentan las líneas devueltas: si se vendieron 3 y se devolvió 1, solo 2
 * salieron de verdad del inventario, así que solo 2 dejan de estar en el conteo.
 * Las ventas anuladas no deben llegar aquí (el llamador las filtra).
 */
/**
 * Motivos de movimiento que SUMAN mercancía al mostrador durante el turno.
 *
 * Deliberadamente NO incluye 'return' (devolución de cliente): esa mercancía
 * ya se descuenta por la vía de `registeredUnitsByProduct`, que resta las
 * líneas devueltas. Contarla aquí también la contaría dos veces.
 *
 * Tampoco incluye los motivos '*_warehouse': el conteo es de lo que el
 * dependiente tiene delante (vitrina), no del almacén.
 */
const RESTOCK_REASONS = new Set(['restock', 'transfer_to_display', 'initial']);

/**
 * Unidades que entraron a la vitrina DESPUÉS de abrir el turno.
 *
 * Sin esto, reponer a mitad de turno se leería como mercancía que sobró y el
 * cuadre cobraría de menos: abrir con 20, reponer 10 y cerrar con 5 son 25
 * vendidas, no 15.
 */
export function restockedUnitsByProduct(
  movements: { product_id: string; qty_change: number; reason: string }[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of movements) {
    if (!RESTOCK_REASONS.has(m.reason)) continue;
    if (m.qty_change <= 0) continue;
    out[m.product_id] = round3((out[m.product_id] ?? 0) + m.qty_change);
  }
  return out;
}

export function registeredUnitsByProduct(
  sales: { items: { product_id: string; quantity: number }[]; refunded_items?: { product_id: string; quantity: number }[] }[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const sale of sales) {
    for (const item of sale.items ?? []) {
      out[item.product_id] = round3((out[item.product_id] ?? 0) + item.quantity);
    }
    for (const ref of sale.refunded_items ?? []) {
      out[ref.product_id] = round3((out[ref.product_id] ?? 0) - ref.quantity);
    }
  }
  return out;
}
