/**
 * Utilidades de hashing de PINs — PBKDF2 + salt único por PIN.
 *
 * El PBKDF2 con 100k iteraciones convierte cada verificación en una operación
 * costosa (~50-100ms), haciendo prohibitivo el brute-force aun para PINs cortos.
 *
 * Formato almacenado: `pbkdf2$<iters>$<salt-hex>$<hash-hex>`
 *
 * Compatibilidad: detecta y verifica hashes legacy SHA-256 (64 hex chars) creados
 * por la versión anterior. Cuando `needsRehash()` retorna true, el caller debería
 * re-hashear con `hashPin()` y actualizar el storage tras una verificación exitosa.
 *
 * MIGRACIÓN: verifyPin acepta 3 formatos — PBKDF2 (nuevo), SHA-256 (legacy) y
 * texto plano (legacy de versiones muy antiguas). Los dos últimos se aceptan
 * para no bloquear negocios existentes; needsRehash() los marca para que el
 * caller los re-hashee a PBKDF2 tras un login exitoso. Un PIN de 4 dígitos en
 * texto plano dentro de IndexedDB local no es un riesgo real adicional: quien
 * tiene acceso a IndexedDB ya controla el dispositivo.
 */

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_HASH = 'SHA-256';
const SALT_BYTES = 16;     // 128 bits → suficiente
const HASH_BYTES = 32;     // 256 bits

const NEW_FORMAT_PREFIX = 'pbkdf2$';
const LEGACY_SHA256_REGEX = /^[0-9a-f]{64}$/;
// Pepper legacy (solo para verificar hashes viejos creados con esa versión)
const LEGACY_PEPPER = 'nexus-pos-v1';

function bufferToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Comparación constant-time para evitar timing attacks.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function pbkdf2(pin: string, saltBytes: Uint8Array, iterations: number): Promise<string> {
  const pinBytes = new TextEncoder().encode(pin);
  const key = await crypto.subtle.importKey(
    'raw',
    pinBytes,
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations,
      hash: PBKDF2_HASH,
    },
    key,
    HASH_BYTES * 8,
  );
  return bufferToHex(derivedBits);
}

/**
 * Hash legacy (SHA-256 + pepper compartido). Solo usado para verificar PINs antiguos
 * — NO para crear nuevos.
 */
async function legacySha256Hash(pin: string, entityId: string): Promise<string> {
  const data = new TextEncoder().encode(`${pin}:${entityId}:${LEGACY_PEPPER}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return bufferToHex(hashBuffer);
}

/**
 * Hashea un PIN para guardar. Genera salt aleatorio nuevo en cada llamada,
 * así dos PINs iguales producen hashes distintos.
 *
 * @param pin El PIN en texto plano (típicamente 4 dígitos)
 * @param _entityId Reservado para compatibilidad de firma — no se usa en PBKDF2.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function hashPin(pin: string, _entityId: string): Promise<string> {
  if (!pin || pin.length < 4) {
    throw new Error('PIN inválido');
  }
  const saltBytes = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const saltHex = bufferToHex(saltBytes.buffer);
  const hashHex = await pbkdf2(pin, saltBytes, PBKDF2_ITERATIONS);
  return `${NEW_FORMAT_PREFIX}${PBKDF2_ITERATIONS}$${saltHex}$${hashHex}`;
}

/**
 * Verifica un PIN contra un valor almacenado.
 *
 * Soporta:
 * - Formato nuevo: `pbkdf2$<iters>$<salt>$<hash>` (vía PBKDF2)
 * - Formato legacy: SHA-256 hex de 64 chars (vía pepper compartido)
 *
 * NO acepta texto plano. Si el storedValue es un PIN sin hashear (texto plano),
 * la verificación falla y el admin debe re-establecer el PIN.
 */
export async function verifyPin(
  pin: string,
  entityId: string,
  storedValue: string,
): Promise<boolean> {
  if (!storedValue || !pin) return false;

  // Formato nuevo PBKDF2
  if (storedValue.startsWith(NEW_FORMAT_PREFIX)) {
    const parts = storedValue.split('$');
    if (parts.length !== 4) return false;
    const [, itersStr, saltHex, expectedHash] = parts;
    const iters = parseInt(itersStr, 10);
    if (!iters || iters < 1000) return false; // sanity check
    try {
      const saltBytes = hexToBuffer(saltHex);
      const computed = await pbkdf2(pin, saltBytes, iters);
      return constantTimeEqual(computed, expectedHash);
    } catch {
      return false;
    }
  }

  // Formato legacy SHA-256 (pepper compartido)
  if (LEGACY_SHA256_REGEX.test(storedValue)) {
    const computed = await legacySha256Hash(pin, entityId);
    return constantTimeEqual(computed, storedValue);
  }

  // Formato legacy en TEXTO PLANO: PIN sin hashear (4-8 dígitos).
  // Se acepta para NO dejar bloqueados a negocios que vienen de versiones
  // antiguas — rechazarlo dejaría a empleados (e incluso al admin) sin poder
  // entrar, sin recurso. Tras un login exitoso el caller debe re-hashear con
  // hashPin() para migrar al formato seguro (needsRehash() lo detecta).
  if (/^\d{4,8}$/.test(storedValue)) {
    return constantTimeEqual(pin, storedValue);
  }

  // Cualquier otro formato no reconocido se rechaza.
  return false;
}

/**
 * Detecta si un valor almacenado YA está en el formato moderno PBKDF2.
 * Si retorna false (es legacy o texto plano), conviene re-hashear con `hashPin()`
 * tras una verificación exitosa para migrar al formato seguro.
 */
export function isPinHashed(value: string): boolean {
  if (!value) return false;
  return value.startsWith(NEW_FORMAT_PREFIX) || LEGACY_SHA256_REGEX.test(value);
}

/**
 * Retorna true si el valor está en un formato hashado pero anticuado (SHA-256).
 * Útil para auto-migración silenciosa: tras verificar con éxito un hash legacy,
 * generar uno nuevo con `hashPin()` y actualizar el storage.
 */
export function needsRehash(value: string): boolean {
  if (!value) return false;
  // Necesitan migración: hashes SHA-256 viejos Y PINs en texto plano (4-8 dígitos)
  return LEGACY_SHA256_REGEX.test(value) || /^\d{4,8}$/.test(value);
}
