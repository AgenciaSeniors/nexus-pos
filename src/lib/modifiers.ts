import { currency } from './currency';
import type { ComandaItemModifier } from './db';

/** Suma de los price_delta de los modificadores elegidos (extra POR UNIDAD). */
export function modifiersTotal(selected: Pick<ComandaItemModifier, 'price_delta'>[]): number {
  return selected.reduce((sum, m) => currency.add(sum, m.price_delta || 0), 0);
}

/** Precio unitario final = precio base + extra de modificadores. */
export function lineUnitPrice(basePrice: number, selected: Pick<ComandaItemModifier, 'price_delta'>[]): number {
  return currency.add(basePrice, modifiersTotal(selected));
}

export interface ModifierGroupRule {
  min_select?: number;
  max_select?: number;
  required?: boolean;
}

/**
 * Valida cuántas opciones se eligieron de un grupo contra min/max/required.
 * Devuelve `null` si es válido, o un mensaje de error.
 */
export function validateGroupSelection(group: ModifierGroupRule, count: number): string | null {
  const min = group.required ? Math.max(1, group.min_select ?? 0) : (group.min_select ?? 0);
  const max = group.max_select ?? Infinity;
  if (count < min) return min === 1 ? 'Elige una opción' : `Elige al menos ${min}`;
  if (count > max) return max === 1 ? 'Elige solo una opción' : `Elige máximo ${max}`;
  return null;
}
