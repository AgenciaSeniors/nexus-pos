// src/lib/licenseClock.ts
// Reloj de licencia resistente a manipulación ("anti-truco-del-reloj").
//
// Problema: la app es offline-first y toda la verificación de trial/licencia
// se hacía con el reloj del teléfono (Date.now()), así que atrasar la hora
// permitía usar la app indefinidamente.
//
// Solución (sin depender del reloj del sistema):
//  1) Marca de agua monotónica (HWM): el mayor instante visto NUNCA retrocede.
//     tiempoConfiable = max(reloj, HWM, monotónico). Atrasar el reloj no resta
//     tiempo; adelantarlo solo vence antes.
//  2) Reloj monotónico (performance.now()): avanza con el tiempo real de uso
//     aunque cambien la hora del sistema, así que el HWM crece mientras se usa.
//  3) Anclaje al servidor (RPC get_server_time): al sincronizar online se fija
//     el HWM a la hora real del servidor y se marca la última validación.
//  4) Revalidación forzada: si pasan > REVALIDATE_MS sin validar contra el
//     servidor, se exige reconexión (cubre el caso "offline para siempre").
//
// Persistencia: localStorage (si el usuario borra los datos de la app, también
// pierde sus ventas offline y al reconectar el HWM se re-ancla al servidor, así
// que no gana nada). No pretende frenar a un atacante con el teléfono rooteado.

import { supabase } from './supabase';

const LS_HWM = 'nexus_time_hwm';
const LS_VAL = 'nexus_last_server_validation';

/** Máximo de días offline sin validar contra el servidor antes de exigir reconexión. */
export const REVALIDATE_MS = 7 * 24 * 60 * 60 * 1000;

export type LicenseLockState = 'EXPIRED' | 'NEEDS_REVALIDATION' | 'SUSPENDED';

let hwm = 0;                 // marca de agua (epoch ms)
let lastValidation = 0;     // última hora de servidor confirmada (epoch ms)
let perfBase = 0;           // performance.now() de referencia
let epochAtPerfBase = 0;    // epoch correspondiente a perfBase
let started = false;

function readNum(key: string): number {
  const v = Number(localStorage.getItem(key));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function persist(): void {
  try {
    localStorage.setItem(LS_HWM, String(Math.floor(hwm)));
    localStorage.setItem(LS_VAL, String(Math.floor(lastValidation)));
  } catch { /* almacenamiento no disponible: seguimos solo en memoria */ }
}

/** Tiempo monotónico estimado en epoch ms (inmune a cambiar la hora del sistema). */
function monotonicNow(): number {
  return epochAtPerfBase + (performance.now() - perfBase);
}

/** Inicializa el reloj desde localStorage y arranca el avance del HWM. Idempotente. */
export function initLicenseClock(): void {
  if (started) return;
  started = true;
  perfBase = performance.now();
  hwm = Math.max(readNum(LS_HWM), Date.now());
  epochAtPerfBase = hwm;
  lastValidation = readNum(LS_VAL);
  persist();
  setInterval(tickHwm, 60_000);
  // Intento de anclar a la hora del servidor al arrancar (si hay red).
  fetchServerTime().catch(() => { /* offline: se usa el HWM local */ });
}

/** Avanza el HWM con el mayor entre reloj del dispositivo y tiempo monotónico real. */
export function tickHwm(): void {
  const candidate = Math.max(Date.now(), monotonicNow());
  if (candidate > hwm) {
    hwm = candidate;
    persist();
  }
}

/** Tiempo confiable: nunca menor que el HWM ni que el monotónico. */
export function getTrustedNow(): number {
  return Math.max(Date.now(), hwm, monotonicNow());
}

/** Última validación contra el servidor (epoch ms); 0 si nunca se validó. */
export function getLastServerValidation(): number {
  return lastValidation;
}

/** Registra la hora del servidor: ancla el HWM y refresca la base monotónica. */
export function noteServerTime(serverMs: number): void {
  if (!Number.isFinite(serverMs) || serverMs <= 0) return;
  if (serverMs > hwm) hwm = serverMs;
  // Re-anclar la base monotónica al nuevo HWM para no perder el avance ya contado.
  perfBase = performance.now();
  epochAtPerfBase = hwm;
  lastValidation = Math.max(lastValidation, serverMs);
  persist();
}

/** Pide la hora al servidor (RPC get_server_time) y la registra. */
export async function fetchServerTime(): Promise<void> {
  const { data, error } = await supabase.rpc('get_server_time');
  if (error || !data) return;
  const ms = new Date(data as string).getTime();
  if (Number.isFinite(ms)) noteServerTime(ms);
}

/**
 * Determina si la app debe bloquearse según la licencia cacheada y el tiempo
 * confiable. Devuelve null si todo está en orden.
 */
export function computeLicenseLock(
  s: { status?: string; subscription_expires_at?: string } | undefined,
  isSuperAdmin: boolean,
): LicenseLockState | null {
  if (isSuperAdmin) return null;     // el super admin nunca se bloquea
  if (!s) return null;               // sin settings aún (no bloquear de más)

  if (s.status === 'suspended') return 'SUSPENDED';

  const now = getTrustedNow();

  if (s.subscription_expires_at) {
    const exp = new Date(s.subscription_expires_at).getTime();
    if (Number.isFinite(exp) && now > exp) return 'EXPIRED';
  }

  const lastVal = getLastServerValidation();
  if (lastVal > 0 && (now - lastVal) > REVALIDATE_MS) return 'NEEDS_REVALIDATION';

  return null;
}
