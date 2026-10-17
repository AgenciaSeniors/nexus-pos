/**
 * "Buscar el faltante": compara lo que se CUENTA físicamente con lo que el
 * sistema espera que quede (lib/dailyInventory) y traduce la diferencia de
 * unidades a dinero, para saber si explica la diferencia de caja.
 *
 * La relación entre producto y dinero es esta:
 *
 *  - Faltan unidades y se cobraron sin registrar → el efectivo SOBRA.
 *  - Sobran unidades porque se registró una venta que no salió (cantidad de más,
 *    venta que había que anular)                  → el efectivo FALTA.
 *  - Faltan unidades sin cobrar ni registrar (regalo, fiado, pérdida) → el
 *    efectivo NO cambia: es una pérdida de mercancía.
 *
 * Por eso el efecto en caja que "explican" los productos es:
 *     valor de lo que falta − valor de lo que sobra
 * y lo que queda de la diferencia real de caja no viene de los productos
 * (vuelto, método de pago, salidas de caja sin anotar, fondo inicial...).
 *
 * Funciones puras.
 */
import type { ProductDayRow } from './dailyInventory';

export interface CountEntry {
  /** Lo tecleado: '' o ausente = no contado */
  display?: string;
  warehouse?: string;
}

export interface ShortfallLine {
  product_id: string;
  name: string;
  price: number;
  unit?: string;
  expected_display: number;
  expected_warehouse: number;
  counted_display: number | null;
  counted_warehouse: number | null;
  /** contado − esperado, solo sobre lo que se contó. null si no se contó nada */
  unit_diff: number | null;
  /** unit_diff × precio de venta */
  value_diff: number | null;
}

export interface ShortfallSummary {
  lines: ShortfallLine[];
  countedProducts: number;
  missingUnits: number;
  /** Dinero equivalente a las unidades que FALTAN (número positivo) */
  missingValue: number;
  extraUnits: number;
  /** Dinero equivalente a las unidades que SOBRAN (número positivo) */
  extraValue: number;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const round3 = (n: number): number => Math.round((n + Number.EPSILON) * 1000) / 1000;

function parseCount(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const n = parseFloat(raw.replace(',', '.'));
  return isNaN(n) || n < 0 ? null : round3(n);
}

export function evaluateCounts(rows: ProductDayRow[], counts: Record<string, CountEntry>): ShortfallSummary {
  let countedProducts = 0, missingUnits = 0, extraUnits = 0, missingValue = 0, extraValue = 0;

  const lines: ShortfallLine[] = rows.map(r => {
    const entry = counts[r.product_id] || {};
    const cd = parseCount(entry.display);
    const cw = parseCount(entry.warehouse);
    let unit_diff: number | null = null;
    if (cd !== null || cw !== null) {
      unit_diff = round3((cd !== null ? cd - r.end_display : 0) + (cw !== null ? cw - r.end_warehouse : 0));
      countedProducts++;
    }
    const value_diff = unit_diff === null ? null : round2(unit_diff * r.price);
    if (unit_diff !== null && unit_diff < 0) { missingUnits += -unit_diff; missingValue += -(unit_diff * r.price); }
    if (unit_diff !== null && unit_diff > 0) { extraUnits += unit_diff; extraValue += unit_diff * r.price; }
    return {
      product_id: r.product_id, name: r.name, price: r.price, unit: r.unit,
      expected_display: r.end_display, expected_warehouse: r.end_warehouse,
      counted_display: cd, counted_warehouse: cw, unit_diff, value_diff,
    };
  });

  return {
    lines, countedProducts,
    missingUnits: round3(missingUnits), missingValue: round2(missingValue),
    extraUnits: round3(extraUnits), extraValue: round2(extraValue),
  };
}

export type ShortfallVerdict =
  | 'no_data'        // aún no se ha contado nada
  | 'no_cash'        // no hay cierre de caja con el que comparar
  | 'all_ok'         // caja y productos cuadran
  | 'explained'      // los productos explican la diferencia de caja
  | 'partial'        // explican una parte
  | 'unexplained'    // no la explican
  | 'goods_lost'     // la caja cuadra pero falta/sobra mercancía
  ;

export interface Interpretation {
  verdict: ShortfallVerdict;
  headline: string;
  detail: string;
  /** Lo que los productos explican del efecto en caja (+ sobra / − falta) */
  explained: number;
  /** Diferencia de caja − lo que explican los productos */
  residual: number;
}

const TIP_CASH_SIDE = 'Revisa el vuelto, el método de pago de las ventas (efectivo/transferencia), salidas o entradas de caja sin anotar y el fondo inicial.';

export function interpretShortfall(args: {
  cashDifference: number | null;
  missingValue: number;
  extraValue: number;
  countedProducts: number;
  tolerance?: number;
  fmt?: (n: number) => string;
}): Interpretation {
  const { cashDifference, missingValue, extraValue, countedProducts, tolerance = 0.5 } = args;
  const fmt = args.fmt ?? ((n: number) => `$${n.toFixed(2)}`);
  const explained = round2(missingValue - extraValue);

  if (countedProducts === 0) {
    return { verdict: 'no_data', headline: 'Cuenta los productos', explained: 0, residual: cashDifference ?? 0,
      detail: 'Escribe cuántas unidades hay de cada producto (empieza por los que más se vendieron). Aquí verás cuánto dinero explican.' };
  }
  if (cashDifference === null) {
    return { verdict: 'no_cash', headline: 'Sin cierre de caja para comparar', explained, residual: 0,
      detail: `Faltan ${fmt(missingValue)} y sobran ${fmt(extraValue)} en mercancía. Cierra el turno para ver si coincide con la caja.` };
  }

  const D = round2(cashDifference);
  const residual = round2(D - explained);
  const cashOk = Math.abs(D) <= tolerance;
  const resOk = Math.abs(residual) <= tolerance;

  if (cashOk && Math.abs(explained) <= tolerance) {
    return { verdict: 'all_ok', headline: 'Todo cuadra', explained, residual,
      detail: 'La caja y la mercancía coinciden con lo que registró el sistema.' };
  }

  if (cashOk) {
    // La caja está bien pero la mercancía no.
    return { verdict: 'goods_lost', headline: 'La caja cuadra, pero la mercancía no', explained, residual,
      detail: missingValue > tolerance
        ? `Faltan ${fmt(missingValue)} en mercancía sin que falte dinero: salió sin cobrarse ni registrarse (regalo, fiado o pérdida).`
        : `Sobran ${fmt(extraValue)} en mercancía sin que falte dinero: puede ser una entrada sin registrar o un error al contar.` };
  }

  if (resOk) {
    return { verdict: 'explained', headline: 'Los productos explican la diferencia', explained, residual,
      detail: D > 0
        ? `Faltan ${fmt(missingValue)} en mercancía que se cobró sin registrar: por eso sobra dinero en caja.`
        : `Sobran ${fmt(extraValue)} en mercancía que el sistema dio por vendida y no salió (cantidad tecleada de más o una venta que había que anular): por eso falta dinero en caja.` };
  }

  const sameDirection = Math.sign(explained) === Math.sign(D) && explained !== 0;
  if (sameDirection && Math.abs(explained) < Math.abs(D)) {
    return { verdict: 'partial', headline: 'Los productos explican una parte', explained, residual,
      detail: `Explican ${fmt(Math.abs(explained))} de los ${fmt(Math.abs(D))} de diferencia. Quedan ${fmt(Math.abs(residual))} sin explicar. ${TIP_CASH_SIDE}` };
  }
  if (sameDirection) {
    return { verdict: 'partial', headline: 'Los productos sugieren más de lo que falta', explained, residual,
      detail: `Por la mercancía deberían ser ${fmt(Math.abs(explained))}, pero la caja difiere ${fmt(Math.abs(D))}: parte pudo no cobrarse (regalo o fiado).` };
  }
  return { verdict: 'unexplained', headline: 'Los productos no explican la diferencia', explained, residual,
    detail: `La diferencia de ${fmt(Math.abs(D))} no viene de lo que se vendió. ${TIP_CASH_SIDE}` };
}
