import { currency } from './currency';
import type { ComandaItem } from './db';

type LineLike = Pick<ComandaItem, 'price' | 'custom_price' | 'quantity' | 'modifiers_total' | 'voided'>;

/**
 * Total de una línea de comanda. Reusa la semántica de `SaleItem`:
 * - `custom_price` (si existe) reemplaza al precio base unitario.
 * - `modifiers_total` (Fase 3) es el extra de modificadores POR UNIDAD.
 * - una línea anulada (`voided`) no suma.
 * Total = (precio unitario + modificadores por unidad) × cantidad.
 * Usa los helpers decimales de `currency` para evitar errores de punto flotante.
 */
export function comandaItemTotal(item: LineLike): number {
  if (item.voided) return 0;
  const unit = currency.add(item.custom_price ?? item.price, item.modifiers_total ?? 0);
  return currency.multiply(unit, item.quantity);
}

/** Total de una comanda = suma de los totales de sus líneas no anuladas. */
export function comandaTotal(items: LineLike[]): number {
  return items.reduce((sum, it) => currency.add(sum, comandaItemTotal(it)), 0);
}
