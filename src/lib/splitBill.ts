import { currency } from './currency';

/**
 * Divide un total en `parts` partes lo más iguales posible, repartiendo los
 * centavos de resto entre las primeras partes para que la suma sea EXACTA.
 *
 * Ej: splitEqual(10, 3) → [3.34, 3.33, 3.33]  (suma 10.00)
 */
export function splitEqual(total: number, parts: number): number[] {
  if (parts <= 0) return [];
  const totalCents = currency.toCents(total);
  const base = Math.floor(totalCents / parts);
  const remainder = totalCents - base * parts; // centavos sobrantes
  const result: number[] = [];
  for (let i = 0; i < parts; i++) {
    const cents = base + (i < remainder ? 1 : 0);
    result.push(currency.fromCents(cents));
  }
  return result;
}

export interface SplitItemLike {
  id: string;
  total: number; // total de la línea (ya con modificadores y cantidad)
}

/**
 * Divide por ítem: dado un mapa item_id → índice de sub-cuenta, suma el total
 * de cada sub-cuenta. `parts` es el número de sub-cuentas.
 * Los ítems sin asignar (índice null/undefined) NO se cuentan.
 */
export function splitByItems(
  items: SplitItemLike[],
  assignment: Record<string, number | null | undefined>,
  parts: number,
): number[] {
  const totals = new Array(parts).fill(0);
  for (const it of items) {
    const idx = assignment[it.id];
    if (idx === null || idx === undefined || idx < 0 || idx >= parts) continue;
    totals[idx] = currency.add(totals[idx], it.total);
  }
  return totals;
}

/** true si todos los ítems están asignados a una sub-cuenta válida. */
export function allItemsAssigned(
  items: SplitItemLike[],
  assignment: Record<string, number | null | undefined>,
  parts: number,
): boolean {
  return items.every(it => {
    const idx = assignment[it.id];
    return idx !== null && idx !== undefined && idx >= 0 && idx < parts;
  });
}
