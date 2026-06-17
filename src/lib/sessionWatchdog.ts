/**
 * Watchdog de sesión — recupera la app de una sesión Supabase "zombie".
 *
 * PROBLEMA REAL (Cuba, redes inestables): si la app queda abierta muchas horas
 * o días, el token de acceso expira y el cliente de Supabase intenta renovarlo
 * en segundo plano. Si esa renovación se lanza justo en un corte de red, el
 * refresh queda colgado para siempre y el cliente entra en estado "zombie":
 * `getSession()`, `rpc()` y cualquier operación autenticada se cuelgan sin
 * resolver nunca. Síntoma: "se queda sincronizando" y nada sube, aunque la red
 * ya haya vuelto.
 *
 * La única recuperación fiable es reinstanciar el cliente — es decir, recargar
 * la app con los tokens limpios para forzar un re-login fresco. Los datos están
 * a salvo en IndexedDB, así que recargar no pierde nada.
 *
 * Estrategia:
 *  - Cada CHECK_INTERVAL_MS, hacer un "health check": getSession() con timeout.
 *    getSession solo lee localStorage, así que normalmente responde en <50ms;
 *    si se cuelga, es señal inequívoca de cliente zombie.
 *  - Tras STALE_THRESHOLD chequeos colgados consecutivos ESTANDO ONLINE,
 *    limpiar los tokens sb-* y recargar UNA vez.
 *  - Guard anti-loop: no recuperar más de una vez cada RECOVER_COOLDOWN_MS
 *    (si tras recargar sigue zombie, no entrar en bucle de reloads).
 */

import { supabase } from './supabase';

const CHECK_INTERVAL_MS = 150_000;      // 2.5 min entre chequeos
// 20s (no 8s): getSession() suele ser <50ms, PERO si el token está por expirar
// dispara internamente un refresh HTTP que en redes lentas (Cuba) puede tardar
// 10-15s legítimamente. Con 8s daríamos falsos positivos → recargas innecesarias.
// 20s + 2 fallos seguidos = solo recargamos ante un cuelgue real, no por lentitud.
const SESSION_TIMEOUT_MS = 20_000;
const STALE_THRESHOLD = 2;              // 2 chequeos colgados seguidos = zombie
const RECOVER_COOLDOWN_MS = 5 * 60_000; // no recuperar más de 1 vez cada 5 min
const RECOVERED_AT_KEY = 'nexus_session_recovered_at';

let intervalId: ReturnType<typeof setInterval> | null = null;
let consecutiveStale = 0;
let onlineListener: (() => void) | null = null;

function isOnline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine;
}

/**
 * Al reconectar la red, permitir un intento de recuperación inmediato:
 * si la sesión quedó zombie mientras estábamos offline, no queremos hacer
 * esperar al usuario los 5 min de cooldown una vez que vuelve la conexión.
 */
function handleReconnect(): void {
  try {
    sessionStorage.removeItem(RECOVERED_AT_KEY);
  } catch {
    /* nada */
  }
  consecutiveStale = 0;
}

/**
 * getSession() con timeout. Resuelve `{ stale: true }` si se cuelga.
 */
async function getSessionWithTimeout(): Promise<{ stale: boolean }> {
  try {
    const result = await Promise.race([
      supabase.auth.getSession().then(() => ({ stale: false })),
      new Promise<{ stale: boolean }>((resolve) =>
        setTimeout(() => resolve({ stale: true }), SESSION_TIMEOUT_MS),
      ),
    ]);
    return result;
  } catch {
    // getSession lanzó (raro) — lo tratamos como respuesta válida, no como zombie
    return { stale: false };
  }
}

/** ¿Ya recuperamos hace poco? Evita el bucle de reloads. */
function recoveredRecently(): boolean {
  try {
    const ts = parseInt(sessionStorage.getItem(RECOVERED_AT_KEY) || '0', 10);
    return ts > 0 && Date.now() - ts < RECOVER_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function clearSupabaseTokens(): void {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('sb-'))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* localStorage no disponible */
  }
}

async function runCheck(): Promise<void> {
  // Sin red no podemos re-loguear; getSession local no debería colgarse por
  // falta de red, pero si el cliente ya está zombie, esperamos a tener red
  // para recuperar (el re-login la necesita).
  if (!isOnline()) {
    consecutiveStale = 0;
    return;
  }

  const { stale } = await getSessionWithTimeout();
  if (!stale) {
    consecutiveStale = 0;
    return;
  }

  consecutiveStale += 1;
  if (consecutiveStale < STALE_THRESHOLD) return;

  // Confirmado zombie. Recuperar si no lo hicimos hace muy poco.
  if (recoveredRecently()) {
    console.warn('🛟 Sesión zombie persistente — ya se intentó recuperar hace poco. Esperando.');
    return;
  }

  console.warn('🛟 Sesión zombie detectada — limpiando tokens y recargando para re-login.');
  try {
    sessionStorage.setItem(RECOVERED_AT_KEY, Date.now().toString());
  } catch {
    /* nada */
  }
  clearSupabaseTokens();
  // Recargar reinstancia el cliente Supabase con tokens limpios → re-login fresco.
  // Los datos del POS están en IndexedDB: recargar no pierde nada.
  location.reload();
}

/**
 * Arranca el watchdog. Idempotente (no duplica el intervalo).
 */
export function startSessionWatchdog(): void {
  if (intervalId !== null) return;
  consecutiveStale = 0;
  intervalId = setInterval(() => {
    runCheck().catch((err) => console.warn('sessionWatchdog check error:', err));
  }, CHECK_INTERVAL_MS);
  // Reconexión de red → resetear cooldown para poder recuperar de inmediato
  if (typeof window !== 'undefined' && !onlineListener) {
    onlineListener = handleReconnect;
    window.addEventListener('online', onlineListener);
  }
}

/**
 * Detiene el watchdog (logout, desmontaje).
 */
export function stopSessionWatchdog(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (typeof window !== 'undefined' && onlineListener) {
    window.removeEventListener('online', onlineListener);
    onlineListener = null;
  }
  consecutiveStale = 0;
}

// Exportado para tests
export const _internal = { RECOVER_COOLDOWN_MS, STALE_THRESHOLD, RECOVERED_AT_KEY };
