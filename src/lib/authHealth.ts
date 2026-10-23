/**
 * Salud de la sesión de Supabase.
 *
 * PROBLEMA REAL: cuando la sesión caduca y no se puede renovar (refresh token
 * inválido o usado, corte de red justo en la renovación...), supabase-js emite
 * SIGNED_OUT y desde entonces manda las peticiones con la clave ANÓNIMA. El
 * servidor no responde "401": responde "new row violates row-level security
 * policy" (Producto, Auditoría...) o "forbidden" (Venta). La app dejaba al usuario
 * trabajar "sin conexión" esperando que Supabase renovara el token, pero SIN sesión
 * no hay nada que renovar: cada operación gastaba sus 5 reintentos, quedaba marcada
 * como fallida y salía un aviso rojo asustador. Cerrar sesión y volver a entrar
 * lo arreglaba porque creaba una sesión nueva.
 *
 * Aquí se comprueba la sesión ANTES de intentar subir nada:
 *  - 'ok'        sesión vigente.
 *  - 'refreshed' estaba por caducar o caducada y se renovó sola.
 *  - 'lost'      no hay sesión ni se puede renovar: hay que volver a entrar.
 *  - 'unknown'   no se pudo saber (sin red, cliente colgado...): no se decide nada.
 *
 * Cuando pasa de 'ok' a 'lost' (o al revés) se emiten los eventos
 * `nexus-auth-lost` / `nexus-auth-restored`, que la interfaz usa para avisar UNA vez
 * y con claridad, y para reanudar la cola al recuperar la sesión.
 */
import { supabase } from './supabase';

export type SessionHealth = 'ok' | 'refreshed' | 'lost' | 'unknown';

const MIN_VALIDITY_MS = 30_000;
const GET_SESSION_TIMEOUT_MS = 8_000;
const REFRESH_TIMEOUT_MS = 15_000;

let authLost = false;

/** ¿La última comprobación dijo que no hay sesión? */
export function isAuthLost(): boolean {
  return authLost;
}

/** Solo para tests */
export function __resetAuthHealth(): void {
  authLost = false;
}

function setLost(lost: boolean) {
  if (lost === authLost) return;
  authLost = lost;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(lost ? 'nexus-auth-lost' : 'nexus-auth-restored'));
  }
}

/** Resuelve 'timeout' si la promesa no responde a tiempo (un cliente "zombie" no responde nunca). */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), ms); });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Errores de la renovación que son de RED (no dicen nada de si el token vale). */
function isNetworkishMessage(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes('failed to fetch') || m.includes('network') || m.includes('timeout')
    || m.includes('timed out') || m.includes('fetch failed') || m.includes('load failed')
    || m.includes('retryable') || m.includes('502') || m.includes('503') || m.includes('504');
}

export async function ensureValidSession(): Promise<SessionHealth> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 'unknown';
  try {
    const got = await within(supabase.auth.getSession(), GET_SESSION_TIMEOUT_MS);
    if (got === 'timeout') return 'unknown'; // cliente colgado: lo trata el vigilante de sesión

    const session = got.data?.session;
    if (session && (session.expires_at ?? 0) * 1000 - Date.now() > MIN_VALIDITY_MS) {
      setLost(false);
      return 'ok';
    }

    // Sin sesión, o a punto de caducar: intentar renovarla
    const refreshed = await within(supabase.auth.refreshSession(), REFRESH_TIMEOUT_MS);
    if (refreshed === 'timeout') return 'unknown';
    if (refreshed.data?.session) {
      setLost(false);
      return 'refreshed';
    }
    const message = String(refreshed.error?.message || '');
    if (message && isNetworkishMessage(message)) return 'unknown'; // sin red: no se sabe todavía
    setLost(true);
    return 'lost';
  } catch (err) {
    // Una excepción rara no es prueba de que se perdió la sesión
    console.warn('No se pudo comprobar la sesión:', err);
    return 'unknown';
  }
}
