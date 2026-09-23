/**
 * Plataforma en la que corre la app y a dónde mandar a bajar la actualización.
 *
 * Vive APARTE de `version.ts` a propósito: ese módulo importa el cliente de
 * Supabase, que lanza al cargarse si faltan las variables de entorno. Eso hacía
 * imposible testear estas funciones sin un `.env` — pasaban en local y fallaban
 * en CI. Aquí no se importa nada: son funciones puras y se prueban en cualquier
 * entorno.
 */

export type Platform = 'android' | 'windows' | 'all';

export function getPlatform(): Platform {
  if (typeof window !== 'undefined' && (window as unknown as { electronAPI?: unknown }).electronAPI) return 'windows';
  if (typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)) return 'android';
  return 'all';
}

const RELEASES = 'https://github.com/AgenciaSeniors/nexus-pos/releases';

/**
 * A dónde mandar al usuario a bajar la actualización.
 *
 * La app avisaba de la versión nueva y remataba con "Contacta a soporte", que
 * en la práctica dejaba la actualización en manos de una llamada. Estos enlaces
 * son los mismos releases que el CI publica en cada build.
 *
 * En web/PWA devuelve `url` vacío: no hay nada que bajar, se actualiza sola al
 * recargar.
 */
export function downloadUrlForPlatform(platform: Platform = getPlatform()): { url: string; label: string } {
  if (platform === 'android') {
    return { url: `${RELEASES}/tag/android-latest`, label: 'Descargar APK para Android' };
  }
  if (platform === 'windows') {
    return { url: `${RELEASES}/latest`, label: 'Descargar instalador para Windows' };
  }
  return { url: '', label: '' };
}
