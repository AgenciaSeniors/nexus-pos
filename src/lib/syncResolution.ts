/**
 * Funciones puras de resolución de sincronización.
 *
 * Estas funciones contienen la lógica crítica del motor de sync extraída
 * en forma pura (sin side effects ni dependencias de Dexie/Supabase) para
 * poder testearse aisladamente.
 *
 * El motor en `sync.ts` las consume.
 */

interface SyncableItem {
  id: string;
  sync_status?: string;
  updated_at?: string;
}

/**
 * Decide si un item remoto debe sobrescribir al local durante un pull.
 *
 * Regla:
 * - Si el local NO está dirty (synced) → siempre sobrescribir
 * - Si el local está dirty y el remoto es estrictamente más nuevo (updated_at) → sobrescribir
 * - Si el local está dirty y es más nuevo o igual → preservar local
 *
 * Esto resuelve el bug donde edits pending locales bloqueaban actualizaciones
 * legítimas de otros dispositivos: el `updated_at` del remoto refleja el
 * último estado conocido por el servidor, así que si es más nuevo, ganaste tú
 * en otro dispositivo y este local pending está atrás.
 */
export function shouldOverwriteLocal<T extends SyncableItem>(
  remote: T,
  local: T | undefined,
): boolean {
  if (!local) return true;
  if (!local.sync_status || local.sync_status === 'synced') return true;

  const remoteAt = local.updated_at && remote.updated_at
    ? new Date(remote.updated_at).getTime()
    : 0;
  const localAt = local.updated_at
    ? new Date(local.updated_at).getTime()
    : 0;

  return remoteAt > localAt;
}

/**
 * Filtra un lote de items remotos para conservar solo aquellos que pueden
 * sobrescribir al local con seguridad.
 */
export function filterRemoteItemsForBulkPut<T extends SyncableItem>(
  remoteItems: T[],
  localDirty: T[],
): T[] {
  if (localDirty.length === 0) return remoteItems;
  const localDirtyMap = new Map<string, T>(localDirty.map(i => [i.id, i]));
  return remoteItems.filter(remote => shouldOverwriteLocal(remote, localDirtyMap.get(remote.id)));
}

/**
 * Calcula el delay del backoff exponencial para un item de cola fallido.
 *
 * Secuencia: 30s → 60s → 2min → 4min → 5min (max)
 *
 * @param retries Número de intentos previos (1, 2, 3, ...)
 * @returns ms a esperar desde el último intento
 */
export function computeBackoffMs(retries: number): number {
  if (retries <= 0) return 0;
  const ms = Math.pow(2, retries - 1) * 30_000;
  return Math.min(ms, 300_000); // 5 min máx
}

/**
 * Determina si un item de cola está listo para reintentarse según su backoff.
 *
 * @param retries Número de intentos previos del item
 * @param lastAttemptTs Timestamp (ms) del último intento (típicamente item.timestamp)
 * @param now Timestamp actual (default: Date.now())
 */
export function isReadyToRetry(
  retries: number,
  lastAttemptTs: number,
  now: number = Date.now(),
): boolean {
  if (retries === 0) return true; // primer intento, no hay backoff
  const required = computeBackoffMs(retries);
  return (now - lastAttemptTs) >= required;
}

interface SaleItem {
  product_id: string;
  quantity: number;
}

interface ProductSnapshot {
  stock: number;
  deleted_at?: string | null;
}

/**
 * Determina si una venta marcada como `stock_conflict` puede auto-resolverse
 * porque ahora hay stock suficiente para todos sus items.
 *
 * @param items Items de la venta
 * @param getProduct Función que retorna el snapshot del producto, o null si no existe
 */
export function canResolveStockConflict(
  items: SaleItem[],
  getProduct: (productId: string) => ProductSnapshot | null | undefined,
): boolean {
  if (!items || items.length === 0) return false;
  for (const item of items) {
    const product = getProduct(item.product_id);
    if (!product) return false;
    if (product.deleted_at) return false;
    if ((product.stock ?? 0) < item.quantity) return false;
  }
  return true;
}

/**
 * Etiquetas legibles para los tipos de operación en la cola.
 * Exportadas para reutilización en UI (badges, toasts) y en sync.ts.
 */
export const QUEUE_TYPE_LABELS: Record<string, string> = {
  SALE: 'Venta',
  PRODUCT_SYNC: 'Producto',
  CUSTOMER_SYNC: 'Cliente',
  MOVEMENT: 'Movimiento',
  AUDIT: 'Auditoría',
  SETTINGS_SYNC: 'Configuración',
  SHIFT: 'Turno',
  CASH_MOVEMENT: 'Mov. Caja',
  STAFF_SYNC: 'Empleado',
  VOID_SALE: 'Anulación',
  PARTIAL_REFUND: 'Devolución',
  LOYALTY_CHANGE: 'Puntos de Lealtad',
  AREA_SYNC: 'Área',
  TABLE_SYNC: 'Mesa',
  COMANDA_SYNC: 'Comanda',
  COMANDA_ITEM_SYNC: 'Ítem de comanda',
  COMANDA_CLOSE: 'Cierre de comanda',
  KITCHEN_STATUS: 'Estado de cocina',
  MODIFIER_GROUP_SYNC: 'Grupo de modificadores',
  MODIFIER_SYNC: 'Modificador',
  PRODUCT_MODIFIER_SYNC: 'Modificador de producto',
  RECIPE_SYNC: 'Receta',
};

export const RETRY_CONFIG = {
  MAX_RETRIES: 5,
  BACKOFF_BASE_MS: 30_000,
  BACKOFF_MAX_MS: 300_000,
};

/**
 * Determina si un error de procesamiento es TRANSITORIO (red, timeout, servidor
 * temporalmente caído) y por tanto NO debe contar hacia el límite de reintentos
 * que envía un item a `failed`.
 *
 * Razón: un error de red es temporal — la operación ES válida y debe
 * reintentarse indefinidamente hasta que la conexión coopere. En cambio, un
 * error PERMANENTE (foreign key, columna inexistente, dato inválido) sí debe
 * ir a `failed` tras MAX_RETRIES, porque reintentarlo nunca lo va a arreglar.
 *
 * CRÍTICO para offline-first en redes inestables (Cuba): sin esta distinción,
 * una venta legítima terminaría en `failed` solo por sufrir 5 timeouts de red
 * seguidos — y dejaría de subir sola hasta un "Reintentar" manual.
 */
export function isTransientError(errorMessage: string): boolean {
  if (!errorMessage) return false;
  const m = errorMessage.toLowerCase();
  return (
    m.includes('tiempo de espera') ||          // withTimeout (sync.ts)
    m.includes('timeout') ||
    m.includes('timed out') ||
    m.includes('failed to fetch') ||           // fetch sin red
    m.includes('networkerror') ||
    m.includes('network request failed') ||
    m.includes('network error') ||
    m.includes('fetch failed') ||
    m.includes('load failed') ||               // Safari/iOS
    m.includes('econnreset') ||
    m.includes('econnrefused') ||
    m.includes('etimedout') ||
    m.includes('enotfound') ||
    m.includes('socket hang up') ||
    m.includes('the operation was aborted') ||
    m.includes('err_network') ||
    m.includes('err_internet_disconnected') ||
    m.includes('err_connection') ||
    m.includes('503') ||                       // servidor temporalmente no disponible
    m.includes('504') ||                       // gateway timeout
    m.includes('upstream')
  );
}

/**
 * Decide el resultado de un item de cola que falló al procesarse.
 *
 * @param errorMessage Mensaje del error capturado
 * @param previousRetries Reintentos que ya tenía el item (antes de este fallo)
 * @returns El nuevo estado del item:
 *   - `retry`     → vuelve a `pending`; el contador de retries indicado
 *   - `failed`    → error permanente agotó los reintentos
 *
 * Errores transitorios (red): SIEMPRE `retry`, indefinidamente. El retries se
 * capea a MAX_RETRIES solo para que el backoff no crezca sin fin.
 * Errores permanentes: `retry` hasta MAX_RETRIES, luego `failed`.
 */
export function decideQueueItemOutcome(
  errorMessage: string,
  previousRetries: number,
): { outcome: 'retry' | 'failed'; retries: number; transient: boolean } {
  const transient = isTransientError(errorMessage);
  const newRetries = (previousRetries || 0) + 1;

  if (transient) {
    return {
      outcome: 'retry',
      retries: Math.min(newRetries, RETRY_CONFIG.MAX_RETRIES),
      transient: true,
    };
  }
  if (newRetries >= RETRY_CONFIG.MAX_RETRIES) {
    return { outcome: 'failed', retries: newRetries, transient: false };
  }
  return { outcome: 'retry', retries: newRetries, transient: false };
}

/**
 * Prioridad de procesamiento por tipo de operación, según sus dependencias
 * de foreign key en el servidor. Menor número = se procesa primero.
 *
 * Razón: si un AUDIT o un SHIFT se sube ANTES que el negocio/empleado/venta
 * del que depende, Postgres rechaza con "foreign key constraint violation".
 * Procesando en orden de dependencia, las entidades base existen antes que
 * las que las referencian.
 *
 * Niveles:
 *  10 — Entidades base (no dependen de nada nuevo): config, empleados,
 *       productos, clientes.
 *  20 — Turnos de caja (dependen de empleado).
 *  30 — Ventas (dependen de turno, productos, cliente).
 *  40 — Operaciones que dependen de una venta/turno ya existente:
 *       movimientos de inventario, de caja, auditoría.
 *  50 — Mutaciones sobre ventas existentes: anulación, devolución, puntos.
 */
export const QUEUE_TYPE_PRIORITY: Record<string, number> = {
  SETTINGS_SYNC: 10,
  STAFF_SYNC: 10,
  PRODUCT_SYNC: 10,
  CUSTOMER_SYNC: 10,
  SHIFT: 20,
  SALE: 30,
  MOVEMENT: 40,
  CASH_MOVEMENT: 40,
  AUDIT: 40,
  VOID_SALE: 50,
  PARTIAL_REFUND: 50,
  LOYALTY_CHANGE: 50,
  // Modo restaurante: entidades base primero (área → mesa → comanda → ítems),
  // y el cierre al final (produce ventas y referencia la comanda ya sincronizada).
  AREA_SYNC: 10,
  TABLE_SYNC: 15,
  // Config base del menú: antes que las comandas que la referencian.
  MODIFIER_GROUP_SYNC: 12,
  MODIFIER_SYNC: 14,
  PRODUCT_MODIFIER_SYNC: 16,
  RECIPE_SYNC: 16,
  COMANDA_SYNC: 25,
  COMANDA_ITEM_SYNC: 30,
  KITCHEN_STATUS: 40,
  COMANDA_CLOSE: 50,
};

const DEFAULT_PRIORITY = 35; // tipos desconocidos: en medio, antes que mutaciones

interface QueueItemOrderable {
  type: string;
  timestamp: number;
  /**
   * Momento de ENCOLADO, estable (no se toca en reintentos, a diferencia de
   * `timestamp`, que se sobrescribe al entrar a processing / fallar).
   * Items encolados antes de introducir el campo caen a `timestamp`.
   */
  enqueued_at?: number;
}

/** Orden causal de encolado de un item (estable frente a reintentos). */
export function enqueueOrderOf(item: QueueItemOrderable): number {
  return item.enqueued_at ?? item.timestamp;
}

/**
 * Comparador para ordenar la cola de sync: primero por prioridad de dependencia,
 * luego por orden de encolado (FIFO dentro del mismo nivel).
 *
 * Uso: `pendingItems.sort(compareQueueOrder)`
 */
export function compareQueueOrder(a: QueueItemOrderable, b: QueueItemOrderable): number {
  const pa = QUEUE_TYPE_PRIORITY[a.type] ?? DEFAULT_PRIORITY;
  const pb = QUEUE_TYPE_PRIORITY[b.type] ?? DEFAULT_PRIORITY;
  if (pa !== pb) return pa - pb;
  return enqueueOrderOf(a) - enqueueOrderOf(b);
}

/**
 * Ordena una lista de items de cola por dependencia + orden de encolado.
 * No muta el array original.
 */
export function sortQueueByDependency<T extends QueueItemOrderable>(items: T[]): T[] {
  return [...items].sort(compareQueueOrder);
}

// ─── ORDEN CAUSAL DE STOCK (evita perder unidades al reconectar) ─────────────
//
// Problema: PRODUCT_SYNC sube el stock como valor ABSOLUTO (upsert de la fila),
// mientras que SALE y COMANDA_CLOSE lo DESCUENTAN en el servidor (RPC
// process_sale_transaction). Con la ordenación por prioridad pura, un
// PRODUCT_SYNC encolado DESPUÉS de una venta pendiente (p. ej. anulación o
// ajuste hechos offline tras vender offline) se subía ANTES que la venta:
// el upsert fijaba el stock ya descontado y el RPC volvía a descontar encima
// → unidades perdidas permanentemente.
//
// Regla: un PRODUCT_SYNC debe procesarse DESPUÉS de toda venta pendiente MÁS
// ANTIGUA (orden de encolado) que toque su producto — su stock absoluto ya
// incluye el efecto de esa venta. Sigue yendo ANTES que ventas más nuevas
// (producto creado offline y vendido después: la FK exige el producto primero).

/** Tipos de cola cuyo procesamiento descuenta stock en el servidor. */
const STOCK_DEDUCTING_TYPES = new Set(['SALE', 'COMANDA_CLOSE']);

interface QueueItemWithPayload extends QueueItemOrderable {
  id: string;
  payload?: unknown;
}

/** product_ids que un item de venta descuenta en el servidor, o `null` si no
 *  se pueden determinar con certeza (→ tratar como "toca cualquier producto").
 *  COMANDA_CLOSE devuelve `null`: con recetas, el servidor descuenta
 *  INGREDIENTES que el cliente no conoce desde el payload. */
function productsDeductedBy(item: QueueItemWithPayload): Set<string> | null {
  if (item.type === 'COMANDA_CLOSE') return null;
  if (item.type === 'SALE') {
    const p = item.payload as { items?: { product_id?: string }[] } | undefined;
    if (!p || !Array.isArray(p.items)) return null;
    return new Set(p.items.map(i => i.product_id).filter((x): x is string => !!x));
  }
  return new Set();
}

/**
 * Para cada PRODUCT_SYNC pendiente, calcula los ids de items de venta
 * pendientes que deben completarse ANTES (sus "bloqueadores"): ventas con
 * orden de encolado más antiguo que tocan el mismo producto.
 */
export function computeStockSyncBlockers(items: QueueItemWithPayload[]): Map<string, string[]> {
  const blockers = new Map<string, string[]>();
  const deducting = items.filter(i => STOCK_DEDUCTING_TYPES.has(i.type));
  if (deducting.length === 0) return blockers;

  for (const ps of items) {
    if (ps.type !== 'PRODUCT_SYNC') continue;
    const productId = (ps.payload as { id?: string } | undefined)?.id;
    const psOrder = enqueueOrderOf(ps);
    const blocking = deducting
      .filter(d => {
        if (enqueueOrderOf(d) >= psOrder) return false;
        const touched = productsDeductedBy(d);
        return touched === null || !productId || touched.has(productId);
      })
      .map(d => d.id);
    if (blocking.length > 0) blockers.set(ps.id, blocking);
  }
  return blockers;
}

/**
 * Ordena la cola para subir: prioridad de dependencia + FIFO, y con cada
 * PRODUCT_SYNC bloqueado recolocado inmediatamente DESPUÉS de su último
 * bloqueador. No muta el array original.
 */
export function sortQueueForUpload<T extends QueueItemWithPayload>(items: T[]): T[] {
  const ordered = sortQueueByDependency(items);
  const blockers = computeStockSyncBlockers(items);
  if (blockers.size === 0) return ordered;

  const result: T[] = [];
  const emitted = new Set<string>();
  const deferred: T[] = [];

  const tryFlushDeferred = () => {
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (let i = 0; i < deferred.length; i++) {
        const item = deferred[i];
        const pending = (blockers.get(item.id) || []).some(id => !emitted.has(id));
        if (!pending) {
          deferred.splice(i, 1);
          result.push(item);
          emitted.add(item.id);
          progressed = true;
          break;
        }
      }
    }
  };

  for (const item of ordered) {
    const blockedBy = blockers.get(item.id);
    if (blockedBy && blockedBy.some(id => !emitted.has(id))) {
      deferred.push(item);
      continue;
    }
    result.push(item);
    emitted.add(item.id);
    tryFlushDeferred();
  }
  // Defensa: si algún bloqueador no estaba en la lista, emitir igual al final
  result.push(...deferred);
  return result;
}

/**
 * Detecta si un item de cola lleva "atascado" demasiado tiempo en estado
 * `processing` — señal de que la app se cerró/crasheó a mitad del procesamiento.
 *
 * @param status   Estado actual del item
 * @param timestamp Último timestamp del item
 * @param now      Tiempo actual (default Date.now())
 * @param staleMs  Umbral para considerarlo atascado (default 2 min)
 */
export function isStuckInProcessing(
  status: string,
  timestamp: number,
  now: number = Date.now(),
  staleMs: number = 120_000,
): boolean {
  return status === 'processing' && (now - timestamp) >= staleMs;
}
