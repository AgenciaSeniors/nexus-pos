/**
 * Conectividad REAL (no solo lo que dice el navegador).
 *
 * PROBLEMA: `navigator.onLine` miente en los dos sentidos, sobre todo en el WebView de
 * Android y en redes como las de Cuba:
 *  - FALSO NEGATIVO: tras volver el internet (o cambiar de Wi-Fi a datos) el evento `online`
 *    puede no llegar —sobre todo si la app estaba en segundo plano— y la app se queda
 *    creyendo que no hay red: el botón de sincronizar se ve rojo y desactivado, y la cola
 *    ni se intenta. Cerrar sesión y volver a entrar "arreglaba" todo porque se vuelve a leer.
 *  - FALSO POSITIVO: Wi-Fi conectado pero sin internet. `onLine` dice true, cada intento
 *    falla y los reintentos suben al máximo de espera (5 min); cuando el internet vuelve no
 *    cambia `onLine`, así que no hay ningún evento que despierte la cola.
 *
 * Aquí se sondea al servidor de verdad (un GET ligero a Supabase: cualquier respuesta, hasta
 * un 401, prueba que hay camino). Se usa para:
 *  - decidir si hay red cuando el navegador dice que no (`isOnline` en sync.ts),
 *  - avisar a la interfaz y a la cola cuando la conexión VUELVE (`nexus-reconnected`),
 *    aunque el navegador nunca lo diga.
 */
import { readSupabaseEnv } from './env';

const PROBE_TIMEOUT_MS = 6_000;
/** Cuánto tiempo vale una comprobación positiva para decidir "hay red". */
const REACHABLE_TTL_MS = 60_000;
/** Cada cuánto se sondea mientras la app cree que no hay red. */
const OFFLINE_POLL_MS = 10_000;

let lastReachableAt = 0;
let current: boolean = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
const listeners = new Set<(online: boolean) => void>();
let pollId: ReturnType<typeof setInterval> | null = null;
let initialized = false;
let probing: Promise<boolean> | null = null;

/** Solo para tests. */
export function __resetConnectivity(online = true): void {
  lastReachableAt = 0;
  current = online;
  probing = null;
  if (pollId) { clearInterval(pollId); pollId = null; }
}

/** ¿Una comprobación reciente demostró que hay camino al servidor? */
export function isReachableRecently(): boolean {
  return lastReachableAt > 0 && Date.now() - lastReachableAt < REACHABLE_TTL_MS;
}

/** Registra que una petición real llegó al servidor (también cuenta como prueba). */
export function noteReachable(): void {
  lastReachableAt = Date.now();
}

/**
 * Sondea el servidor. Resuelve true si hubo respuesta de CUALQUIER tipo, false si no hay red
 * (fallo de conexión o más de 6 s). Las llamadas simultáneas comparten un solo sondeo.
 */
export function probeReachable(): Promise<boolean> {
  if (probing) return probing;
  const { url } = readSupabaseEnv();
  if (!url || typeof fetch === 'undefined') {
    return Promise.resolve(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  }
  probing = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    try {
      // no-cors: la respuesta es opaca pero resuelve si hubo conexión, sin depender de CORS.
      await fetch(`${url.replace(/\/$/, '')}/auth/v1/health`, {
        method: 'GET', mode: 'no-cors', cache: 'no-store', signal: ctrl.signal,
      });
      lastReachableAt = Date.now();
      return true;
    } catch {
      lastReachableAt = 0;
      return false;
    } finally {
      clearTimeout(timer);
      probing = null;
    }
  })();
  return probing;
}

/** Lo que cree la interfaz ahora mismo (combina eventos del navegador y sondeos). */
export function getConnectivity(): boolean {
  return current;
}

function setCurrent(next: boolean): void {
  if (next === current) return;
  current = next;
  listeners.forEach(cb => { try { cb(next); } catch { /* un oyente roto no frena a los demás */ } });
  if (next) {
    if (pollId) { clearInterval(pollId); pollId = null; }
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nexus-reconnected'));
  } else {
    startPolling();
  }
}

function startPolling(): void {
  if (pollId || typeof window === 'undefined') return;
  pollId = setInterval(() => {
    probeReachable().then(ok => { if (ok) setCurrent(true); }).catch(() => {});
  }, OFFLINE_POLL_MS);
}

/**
 * Comprueba YA si hay red (p. ej. al tocar "sincronizar"): confía en el navegador si dice que
 * sí, y si dice que no, sondea antes de rendirse.
 */
export async function checkConnectivityNow(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    if (!current) setCurrent(true);
    return true;
  }
  const ok = await probeReachable();
  setCurrent(ok);
  return ok;
}

/** Suscribe un oyente a los cambios; devuelve la función para darse de baja. */
export function subscribeConnectivity(cb: (online: boolean) => void): () => void {
  initConnectivity();
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Engancha los eventos del navegador. Idempotente. */
export function initConnectivity(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  window.addEventListener('online', () => setCurrent(true));
  window.addEventListener('offline', () => {
    // El aviso del navegador puede ser falso: se marca sin red y el sondeo lo corrige en segundos.
    setCurrent(false);
    probeReachable().then(ok => { if (ok) setCurrent(true); }).catch(() => {});
  });
  // Al volver a la app (después de estar en segundo plano no llegan los eventos) se relee todo.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (navigator.onLine) setCurrent(true);
    else probeReachable().then(ok => setCurrent(ok)).catch(() => {});
  });

  if (!current) startPolling();
}
