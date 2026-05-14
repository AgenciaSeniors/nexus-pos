/**
 * Funciones puras para calcular estadísticas de ventas respetando la
 * inmutabilidad histórica.
 *
 * Problema que resuelve:
 * Antes, los reportes filtraban `status !== 'voided'` siempre, sin importar
 * CUÁNDO se anuló la venta. Resultado: si hoy anulas una venta de un turno
 * cerrado hace 3 días, el reporte histórico de ese turno cambia retroactivamente
 * — los números ya no cuadran con lo que se vio al cerrar.
 *
 * Solución: cada venta anulada lleva un timestamp `voided_at`. Los reportes
 * históricos consideran la venta VÁLIDA si fue anulada DESPUÉS del cierre del
 * periodo (porque al cierre seguía contando). Solo se descuentan las
 * anulaciones que ocurrieron DENTRO del periodo.
 */

interface SaleLike {
  status?: string;
  voided_at?: string;
  date: string;
}

/**
 * Determina si una venta debe contar en un reporte cerrado para un periodo
 * cuyo último instante fue `periodEnd`.
 *
 * @param sale       Venta a evaluar
 * @param periodEnd  Timestamp (ISO o Date) del último instante del periodo:
 *                   - Para un turno cerrado: `shift.closed_at`
 *                   - Para un día pasado: fin del día (23:59:59 local)
 *                   - Para "ahora" (vivo): `Date.now()` o `new Date()`
 * @returns          true si la venta contaba al cierre del periodo
 */
export function isSaleValidAtTime(
  sale: SaleLike,
  periodEnd: string | Date | number,
): boolean {
  // Venta no anulada → siempre cuenta
  if (sale.status !== 'voided') return true;

  // Anulada pero sin timestamp → datos legacy: tratamos como "anulada antes del periodo"
  // (comportamiento conservador, idéntico al anterior — no cambia reportes históricos
  // de datos viejos).
  if (!sale.voided_at) return false;

  const periodEndMs = typeof periodEnd === 'number' ? periodEnd :
    (periodEnd instanceof Date ? periodEnd.getTime() : new Date(periodEnd).getTime());
  const voidedAtMs = new Date(sale.voided_at).getTime();

  if (isNaN(periodEndMs) || isNaN(voidedAtMs)) return false; // datos corruptos

  // Anulada DESPUÉS del periodo → válida (al cierre seguía contando)
  // Anulada DENTRO del periodo → inválida (el cierre ya la había descontado)
  return voidedAtMs > periodEndMs;
}

/**
 * Filtra una lista de ventas para incluir solo las válidas en el momento del cierre.
 *
 * Ejemplo: reporte de un turno cerrado ayer a las 22:00.
 * - Ventas no anuladas → incluidas
 * - Ventas anuladas ayer a las 21:00 → excluidas (se anularon ANTES del cierre)
 * - Ventas anuladas hoy a las 10:00 → incluidas (al cierre eran válidas;
 *   la anulación de hoy se refleja como un movimiento de caja en el turno actual)
 */
export function filterSalesValidAtTime<T extends SaleLike>(
  sales: T[],
  periodEnd: string | Date | number,
): T[] {
  return sales.filter(s => isSaleValidAtTime(s, periodEnd));
}

/**
 * Helper para obtener el fin de un día local en formato YYYY-MM-DD.
 * Útil para reportes diarios.
 */
export function endOfLocalDay(localDateStr: string): Date {
  // localDateStr formato YYYY-MM-DD
  const [y, m, d] = localDateStr.split('-').map(Number);
  // 23:59:59.999 del día local
  return new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999);
}
