/**
 * Destino del stock (vitrina vs almacén) y lectura de la cantidad inicial.
 *
 * CONTEXTO: hasta ahora un producto nuevo nacía SIEMPRE con `stock: 0`, y el
 * ajuste por "Compra" caía SIEMPRE en almacén. Para dejar mercancía en la
 * vitrina había que hacer tres pasos: crear el producto, ajustar el stock, y
 * después un traslado almacén→vitrina. El negocio pequeño cubano no tiene
 * almacén: ese rodeo era trabajo inventado.
 *
 * Ahora el destino lo elige el usuario, salvo donde la semántica lo fija.
 * Funciones puras para poder testearlas sin IndexedDB ni React.
 */

import { round3 } from './recipe';

export type StockTarget = 'display' | 'warehouse';

/**
 * Resuelve a qué stock aplica un ajuste.
 *
 * - `return` (devolución de un cliente) siempre entra a VITRINA: es mercancía
 *   que vuelve al punto de venta, no mercancía que entra al depósito.
 * - Todo lo demás (`restock`, `damage`, `correction`) respeta lo que el usuario
 *   eligió. `restock` antes forzaba almacén; ya no.
 */
export function resolveStockTarget(reason: string, chosen: StockTarget): StockTarget {
  if (reason === 'return') return 'display';
  return chosen;
}

/**
 * Motivo con el que se registra el movimiento de inventario, para que el
 * historial distinga vitrina de almacén.
 *
 * `restock` en almacén tiene su propia clave histórica (`restock_warehouse`) en
 * vez de seguir el patrón `<motivo>_warehouse`; se respeta para no romper la
 * lectura de los movimientos ya guardados.
 */
export function movementReason(reason: string, target: StockTarget): string {
  if (target !== 'warehouse') return reason;
  return reason === 'restock' ? 'restock_warehouse' : `${reason}_warehouse`;
}

/**
 * Cantidad inicial tecleada al CREAR un producto.
 *
 * Devuelve 0 para vacío, texto no numérico o negativo: crear un producto con
 * stock negativo no significa nada, y el input puede traer un "-" suelto o un
 * valor pegado a mano que se salte el `min=0` del navegador.
 */
export function parseInitialStock(raw: string): number {
  const n = round3(parseFloat(raw));
  return Number.isFinite(n) && n > 0 ? n : 0;
}
