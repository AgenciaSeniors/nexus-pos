/**
 * Elección del turno activo.
 *
 * Debería haber UN solo turno abierto por negocio, pero se han visto varios a la
 * vez (apertura offline en dos dispositivos, o el check remoto fallando). Cuando
 * eso pasa, TODAS las pantallas deben elegir el MISMO turno; si no, cada una
 * trabaja sobre uno distinto: el POS registraba la venta en un turno y Finanzas
 * enseñaba otro. Con `.first()` sobre un índice sin orden la elección era
 * indeterminada y cambiaba cuando aparecía otro turno abierto.
 *
 * Regla: el turno abierto MÁS RECIENTE. Si empatan en fecha, el de `id` mayor,
 * para que el desempate también sea estable.
 *
 * Funciones puras (sin Dexie) para poder probarlas en cualquier entorno.
 */

interface OpenableShift {
  id: string;
  status: 'open' | 'closed';
  opened_at: string;
}

/** Turnos abiertos ordenados del más reciente al más antiguo. */
export function sortOpenShifts<T extends OpenableShift>(shifts: readonly T[]): T[] {
  return shifts
    .filter(s => s.status === 'open')
    .sort((a, b) => {
      const byDate = (b.opened_at || '').localeCompare(a.opened_at || '');
      return byDate !== 0 ? byDate : b.id.localeCompare(a.id);
    });
}

/** El turno activo: el abierto más reciente, o null si no hay ninguno. */
export function pickActiveShift<T extends OpenableShift>(shifts: readonly T[]): T | null {
  return sortOpenShifts(shifts)[0] ?? null;
}
