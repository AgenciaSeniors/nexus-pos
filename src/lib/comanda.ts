import { currency } from './currency';
import type { ComandaItem } from './db';

type LineLike = Pick<ComandaItem, 'price' | 'custom_price' | 'quantity' | 'modifiers_total' | 'voided'>;

/**
 * Total de una línea de comanda. Reusa la semántica de `SaleItem`:
 * - `custom_price` (si existe) reemplaza al precio base.
 * - `modifiers_total` (Fase 3) se suma al total de la línea.
 * - una línea anulada (`voided`) no suma.
 * Usa los helpers decimales de `currency` para evitar errores de punto flotante.
 */
export function comandaItemTotal(item: LineLike): number {
  if (item.voided) return 0;
  const unit = item.custom_price ?? item.price;
  const base = currency.multiply(unit, item.quantity);
  return currency.add(base, item.modifiers_total ?? 0);
}

/** Total de una comanda = suma de los totales de sus líneas no anuladas. */
export function comandaTotal(items: LineLike[]): number {
  return items.reduce((sum, it) => currency.add(sum, comandaItemTotal(it)), 0);
}
