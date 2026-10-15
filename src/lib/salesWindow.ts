/**
 * Ventana de ventas que necesita cada pestaña de Finanzas.
 *
 * Una sola fuente de verdad para dos usos que antes habrían podido divergir:
 *  - qué ventas LEE Finanzas de la base local (Dexie), y
 *  - qué rango hay que PEDIR a la nube si ese dispositivo no lo tiene guardado.
 *
 * Funciones puras (sin Dexie ni Supabase).
 */

export type FinanceViewMode = 'control' | 'history' | 'daily' | 'trends' | 'closing';

export interface SalesWindowInput {
  viewMode: FinanceViewMode;
  reportMode: 'day' | 'range';
  /** YYYY-MM-DD local */
  selectedDate: string;
  dateFrom: string;
  now?: Date;
}

export interface SalesWindow {
  from: Date;
  /** null = sin tope superior (todo lo posterior a `from`) */
  to: Date | null;
}

const DAY_MARGIN = 2;

/**
 * - Modo rango: desde la fecha inicial, sin tope.
 * - Modo día / Cierre del día: alrededor de la FECHA SELECCIONADA (no de hoy: si
 *   se elige un día viejo, el reporte saldría vacío). ±2 días de margen cubren
 *   cualquier desfase entre el huso local y el UTC del campo `date`.
 * - Resto (historial, tendencias): los últimos 30 días.
 */
export function salesWindow({ viewMode, reportMode, selectedDate, dateFrom, now = new Date() }: SalesWindowInput): SalesWindow {
  const from = new Date(now.getTime());

  if (viewMode === 'daily' && reportMode === 'range' && dateFrom) {
    // T00:00 = hora local; sin la 'T' se parsearía como UTC y en husos positivos
    // faltarían horas.
    from.setTime(new Date(dateFrom + 'T00:00').getTime());
    return { from, to: null };
  }

  const isDayScope = (viewMode === 'daily' && reportMode === 'day') || viewMode === 'closing';
  if (isDayScope) {
    const anchor = new Date(selectedDate + 'T00:00');
    const base = isNaN(anchor.getTime()) ? now : anchor;
    from.setTime(base.getTime());
    from.setDate(from.getDate() - DAY_MARGIN);
    const to = new Date(base.getTime());
    to.setDate(to.getDate() + DAY_MARGIN);
    return { from, to };
  }

  from.setDate(from.getDate() - 30);
  return { from, to: null };
}

/**
 * ¿La ventana cae dentro de lo que cada dispositivo ya descarga solo
 * (SALES_BACKFILL_DAYS)? Si es así no hace falta pedir nada a la nube.
 */
export function isWindowCoveredByBackfill(from: Date, backfillDays: number, now: Date = new Date()): boolean {
  // Un día de holgura: el relleno se calcula al momento de ejecutarse.
  return from.getTime() >= now.getTime() - (backfillDays - 1) * 86400000;
}
