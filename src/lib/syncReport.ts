/**
 * Qué decirle al usuario después de tocar "sincronizar".
 *
 * Antes el botón mostraba "¡Sistema sincronizado con éxito!" siempre que no lanzara un
 * error, aunque la cola siguiera llena (esperando turno de reintento, sesión perdida...).
 * El usuario creía que había subido todo y se enteraba tarde. Ahora el mensaje sale de lo
 * que REALMENTE queda sin enviar.
 */
import type { SyncSummary } from './sync';

export type SyncReportLevel = 'success' | 'warning' | 'error';

export function describeSyncSummary(r: SyncSummary): { level: SyncReportLevel; message: string } {
  if (r.authLost && (r.pending > 0 || r.failed > 0)) {
    return {
      level: 'error',
      message: 'Se perdió la sesión: tus cambios están guardados en el teléfono pero NO se envían. Cierra sesión y vuelve a entrar para enviarlos.',
    };
  }

  if (r.pending > 0) {
    const porRed = /^Red:/.test(r.lastError || '');
    const motivo = porRed ? ' La conexión no alcanzó para enviarlos; se reintentará sola.' : ' Se reintentará solo en unos segundos.';
    return {
      level: 'warning',
      message: `Quedan ${r.pending} cambio${r.pending === 1 ? '' : 's'} sin enviar.${motivo}`,
    };
  }

  if (r.failed > 0) {
    return {
      level: 'warning',
      message: `${r.failed} cambio${r.failed === 1 ? '' : 's'} ${r.failed === 1 ? 'no se pudo' : 'no se pudieron'} enviar al servidor. Revisa Ajustes → Datos para reintentarlo.`,
    };
  }

  return { level: 'success', message: '¡Todo sincronizado!' };
}

/** Mensaje cuando de verdad no hay camino a internet. */
export const NO_CONNECTION_MESSAGE =
  'Sin conexión real a internet. Tus cambios siguen guardados en el teléfono y se enviarán solos al volver.';
