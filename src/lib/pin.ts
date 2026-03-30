/**
 * Utilidades de hashing de PINs — Web Crypto API (SHA-256 + sal por entidad).
 *
 * Cada PIN se hashea junto al ID único de la entidad (negocio o empleado) como sal,
 * de modo que el hash es único por entidad y resistente a tablas rainbow.
 *
 * Migración gradual: verifyPin() acepta tanto PINs en texto plano (4 dígitos)
 * como hashes (64 hex chars), sin necesidad de migración masiva ni lockouts.
 * Los PINs se hashean automáticamente la próxima vez que el admin los guarda.
 */

const PEPPER = 'nexus-pos-v1';

/**
 * Hashea un PIN con el ID de la entidad como sal.
 * @returns Hash SHA-256 en formato hex (64 caracteres)
 */
export async function hashPin(pin: string, entityId: string): Promise<string> {
  const data = new TextEncoder().encode(`${pin}:${entityId}:${PEPPER}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verifica un PIN en texto plano contra el valor almacenado (hash o texto plano).
 * Soporta migración gradual: los PINs aún en texto plano se verifican directamente.
 */
export async function verifyPin(
  pin: string,
  entityId: string,
  storedValue: string
): Promise<boolean> {
  if (!storedValue) return false;
  if (isPinHashed(storedValue)) {
    const computed = await hashPin(pin, entityId);
    return computed === storedValue;
  }
  // Retrocompatibilidad: comparación directa si aún está en texto plano
  return pin === storedValue;
}

/**
 * Detecta si un valor almacenado ya es un hash SHA-256 (64 hex chars).
 */
export function isPinHashed(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}
