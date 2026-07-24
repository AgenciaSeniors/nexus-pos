/**
 * Persistencia del progreso de una división de cuenta (por comanda).
 *
 * Los cobros de una división vivían solo en estado de React: si la app se
 * cerraba (o el modal se cerraba por accidente) con 2 de 3 cuentas cobradas,
 * el dinero ya había entrado físicamente a la gaveta pero no quedaba registro.
 * El progreso se guarda en localStorage y el modal lo restaura al reabrirse;
 * se limpia al completar la división o al cobrar la comanda completa.
 */
import type { Sale } from './db';

export interface SavedSplitState {
  mode: 'equal' | 'item';
  parts: number;
  assignment: Record<string, number>;
  paid: Record<number, Sale>;
  splitGroupId: string;
  /** Total de la comanda al momento del primer cobro (para detectar cambios). */
  grandTotal: number;
  /** Totales por cuenta CONGELADOS al primer cobro: la suma debe cerrar. */
  partTotals: number[];
}

const splitStateKey = (comandaId: string) => `nexus_split_state_${comandaId}`;

export function loadSplitState(comandaId: string): SavedSplitState | null {
  try {
    const raw = localStorage.getItem(splitStateKey(comandaId));
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedSplitState;
    if (!s || typeof s.parts !== 'number' || !s.paid || !Array.isArray(s.partTotals)) return null;
    return s;
  } catch {
    return null;
  }
}

export function saveSplitState(comandaId: string, state: SavedSplitState): void {
  try {
    localStorage.setItem(splitStateKey(comandaId), JSON.stringify(state));
  } catch { /* almacenamiento lleno: la división sigue en memoria */ }
}

/** Borra el progreso guardado de una división (al completarla o cobrar la comanda). */
export function clearSplitState(comandaId: string): void {
  try { localStorage.removeItem(splitStateKey(comandaId)); } catch { /* noop */ }
}

/**
 * `true` si hay una división EN CURSO para la comanda: existe progreso guardado
 * con al menos una cuenta ya cobrada. Mientras esté en curso, la comanda no
 * debe editarse (agregar/quitar ítems recalcularía totales ya cobrados).
 */
export function hasSplitInProgress(comandaId: string): boolean {
  const s = loadSplitState(comandaId);
  return !!s && Object.keys(s.paid).length > 0;
}
