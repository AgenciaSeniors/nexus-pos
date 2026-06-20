import type { BusinessConfig } from './db';

export type BusinessType = 'retail' | 'restaurant';

/**
 * Resuelve el tipo de negocio a partir de la(s) fila(s) de settings locales.
 *
 * Regla: se usa la PRIMERA fila de settings (igual que el resto del código, que
 * asume un solo negocio por dispositivo — ver `syncCriticalData`, que limpia las
 * settings huérfanas). Si no hay settings o el campo está ausente, se asume
 * 'retail' para no romper a los tenants existentes que nunca tuvieron el campo.
 *
 * Función pura para poder testearla sin IndexedDB.
 */
export function resolveBusinessType(
  settings: Pick<BusinessConfig, 'business_type'>[] | undefined | null,
): BusinessType {
  const value = settings?.[0]?.business_type;
  return value === 'restaurant' ? 'restaurant' : 'retail';
}

/** `true` si el negocio opera en modo restaurante. */
export function isRestaurantMode(
  settings: Pick<BusinessConfig, 'business_type'>[] | undefined | null,
): boolean {
  return resolveBusinessType(settings) === 'restaurant';
}
