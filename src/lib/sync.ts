import {
  db,
  type QueueItem,
  type QueuePayload,
  type SalePayload,
  type Product,
  type Customer,
  type InventoryMovement,
  type AuditLog,
  type BusinessConfig,
  type CashShift,
  type CashMovement,
  type Staff,
  type VoidSalePayload,
  type PartialRefundPayload,
  type LoyaltyChangePayload
} from './db';
import { supabase } from './supabase';
import type { Table } from 'dexie';
import {
  filterRemoteItemsForBulkPut,
  isReadyToRetry,
  canResolveStockConflict,
  sortQueueByDependency,
  QUEUE_TYPE_LABELS,
  RETRY_CONFIG,
} from './syncResolution';

// ─── LAST SYNC TIMESTAMP ──────────────────────────────────────────────────────
// Permite a la UI saber cuándo fue la última sincronización exitosa.
const LAST_SYNC_KEY = 'nexus_last_sync_at';
// Timestamp del último syncHeavyData (orphan cleanup completo).
// El pull incremental no detecta items borrados físicamente del servidor, así que
// cada 24h forzamos un fetchAll para garantizar tombstones consistentes.
const LAST_HEAVY_SYNC_KEY = 'nexus_last_heavy_sync_at';
const HEAVY_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function getLastSyncTimestamp(): number {
  return parseInt(localStorage.getItem(LAST_SYNC_KEY) || '0');
}

function setLastSyncTimestamp() {
  localStorage.setItem(LAST_SYNC_KEY, Date.now().toString());
}

function getLastHeavySyncTimestamp(): number {
  return parseInt(localStorage.getItem(LAST_HEAVY_SYNC_KEY) || '0');
}

function setLastHeavySyncTimestamp() {
  localStorage.setItem(LAST_HEAVY_SYNC_KEY, Date.now().toString());
}

export function isOnline() {
  return typeof navigator !== 'undefined' && navigator.onLine;
}

export async function resetProcessingItems() {
    if (!db.isOpen()) return;
    const stuckItems = await db.action_queue.where('status').equals('processing').toArray();
    if (stuckItems.length > 0) {
        await db.action_queue.where('status').equals('processing').modify({ status: 'pending' });
    }
}

export async function addToQueue(type: QueueItem['type'], payload: QueuePayload) {
  try {
    await db.action_queue.add({
      id: crypto.randomUUID(),
      type,
      payload,
      timestamp: Date.now(),
      retries: 0,
      status: 'pending'
    });

    // Disparar processQueue inmediatamente (sin setTimeout — el guard interno
    // _isProcessingQueue evita ejecuciones concurrentes; el loop de 30s sirve de red).
    if (isOnline()) {
      processQueue().catch(err => console.error("Error en sync background:", err));
    }
  } catch (error) {
    console.error("Error crítico al añadir a la cola:", error);
    throw error;
  }
}

async function processItem(item: QueueItem) {
  const { type, payload } = item;

  switch (type) {
    case 'SALE': {
      const { sale, items } = payload as SalePayload;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sync_status, ...saleClean } = sale;

      const { data: rpcData, error } = await supabase.rpc('process_sale_transaction', {
        p_sale: saleClean, p_items: items || []
      });

      if (error && error.code !== '23505') throw new Error(`Fallo venta: ${error.message}`);

      if (rpcData?.conflict) {
        await db.sales.update(sale.id, { status: 'stock_conflict', sync_status: 'synced' });
        const names = (rpcData.conflict_items as string[] || []).join(', ');
        // Dispatch event for Layout to show toast
        window.dispatchEvent(new CustomEvent('nexus-stock-conflict', {
          detail: { saleId: sale.id, items: names }
        }));
      } else {
        await db.sales.update(sale.id, { sync_status: 'synced' });
      }
      break;
    }
    case 'MOVEMENT': {
      const movement = payload as InventoryMovement;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sync_status, ...cleanMov } = movement;
      const { error } = await supabase.from('inventory_movements').insert(cleanMov);
      if (error && error.code !== '23505') throw new Error(`Error movimiento: ${error.message}`);
      if (db.movements) await db.movements.update(movement.id, { sync_status: 'synced' });
      break;
    }
    case 'AUDIT': {
      const log = payload as AuditLog;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sync_status, ...cleanLog } = log;
      const { error } = await supabase.from('audit_logs').insert(cleanLog);
      if (error && error.code !== '23505') throw new Error(`Error audit: ${error.message}`);
      await db.audit_logs.update(log.id, { sync_status: 'synced' });
      break;
    }
    case 'PRODUCT_SYNC': {
      const product = payload as Product;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sync_status, ...cleanProduct } = product;
      // SKU vacío → null para no violar UNIQUE(business_id, sku) en Supabase
      if (cleanProduct.sku === '') (cleanProduct as Record<string, unknown>).sku = null;
      const { error } = await supabase.from('products').upsert(cleanProduct);
      if (error && error.code !== '23505') throw new Error(`Error producto: ${error.message}`);
      await db.products.update(product.id, { sync_status: 'synced' });
      break;
    }
    case 'CUSTOMER_SYNC': {
      const customer = payload as Customer;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sync_status, ...cleanCustomer } = customer;
      const { error } = await supabase.from('customers').upsert(cleanCustomer);
      if (error && error.code !== '23505') throw new Error(`Error cliente: ${error.message}`);
      await db.customers.update(customer.id, { sync_status: 'synced' });
      break;
    }
    case 'SETTINGS_SYNC': {
      const config = payload as BusinessConfig;
      const updateData = { 
          name: config.name, 
          address: config.address, 
          phone: config.phone, 
          receipt_message: config.receipt_message,
          master_pin: config.master_pin
      };
      const { error } = await supabase.from('businesses').update(updateData).eq('id', config.id);
      if (error) throw new Error(`Error negocio: ${error.message}`);
      await db.settings.update(config.id, { sync_status: 'synced' });
      break;
    }
    case 'SHIFT': {
        const shift = payload as CashShift;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { sync_status, ...cleanShift } = shift;
        const { error } = await supabase.from('cash_shifts').upsert(cleanShift);
        if (error) throw new Error(`Error turno: ${error.message}`);
        await db.cash_shifts.update(shift.id, { sync_status: 'synced' });
        break;
    }
    case 'CASH_MOVEMENT': {
        const mov = payload as CashMovement;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { sync_status, ...cleanMov } = mov;
        const { error } = await supabase.from('cash_movements').insert(cleanMov);
        if (error && error.code !== '23505') throw new Error(`Error mov caja: ${error.message}`);
        await db.cash_movements.update(mov.id, { sync_status: 'synced' });
        break;
    }
    case 'STAFF_SYNC': {
        const staff = payload as Staff;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { sync_status, ...cleanStaff } = staff;
        const { error } = await supabase.from('staff').upsert(cleanStaff);
        if (error) throw new Error(`Error sincronizando usuario: ${error.message}`);
        await db.staff.update(staff.id, { sync_status: 'synced' });
        break;
    }
    case 'VOID_SALE': {
        const { saleId } = payload as VoidSalePayload;
        // Defensa en profundidad: además de RLS, restringimos por business_id
        // para que un saleId mal formado no pueda anular una venta de otro tenant
        // si la política RLS llegara a estar mal configurada.
        const localSale = await db.sales.get(saleId);
        if (!localSale) throw new Error(`Venta ${saleId} no existe localmente`);
        // voided_at del local se envía al servidor: clave para reportes inmutables
        // (saber si la anulación fue dentro o después del turno).
        const voidedAt = localSale.voided_at || new Date().toISOString();
        const { error } = await supabase
            .from('sales')
            .update({ status: 'voided', voided_at: voidedAt })
            .eq('id', saleId)
            .eq('business_id', localSale.business_id);
        if (error) throw new Error(`Error anulando venta: ${error.message}`);
        await db.sales.update(saleId, { sync_status: 'synced' });
        break;
    }
    case 'PARTIAL_REFUND': {
        const { saleId, refunded_items } = payload as PartialRefundPayload;
        const localSale = await db.sales.get(saleId);
        if (!localSale) throw new Error(`Venta ${saleId} no existe localmente`);
        const { error } = await supabase
            .from('sales')
            .update({ status: 'partial_refund', refunded_items })
            .eq('id', saleId)
            .eq('business_id', localSale.business_id);
        if (error) throw new Error(`Error registrando devolución: ${error.message}`);
        await db.sales.update(saleId, { sync_status: 'synced' });
        break;
    }
    case 'LOYALTY_CHANGE': {
        // Incremento atómico de puntos de lealtad via RPC. El RPC ejecuta
        // UPDATE ... SET loyalty_points = loyalty_points + delta en una sola transacción,
        // evitando el race condition del patrón read-modify-write anterior.
        //
        // `idempotency_key` previene puntos duplicados si la red corta entre
        // que el RPC ejecutó y nosotros recibimos respuesta: al reintentar,
        // el RPC detecta que ese key ya se procesó y devuelve el total actual.
        const { customer_id, delta, business_id, idempotency_key } = payload as LoyaltyChangePayload;
        const { data: newPoints, error } = await supabase.rpc('add_loyalty_points', {
            p_customer_id: customer_id,
            p_business_id: business_id,
            p_delta: delta,
            p_idempotency_key: idempotency_key,
        });
        if (error) throw new Error(`Error actualizando puntos: ${error.message}`);
        // El RPC retorna el nuevo total; lo reflejamos en local y desbloqueamos sync.
        const finalPoints = typeof newPoints === 'number' ? newPoints : 0;
        await db.customers.update(customer_id, { loyalty_points: finalPoints, sync_status: 'synced' });
        break;
    }
    default:
      throw new Error(`Tipo de acción desconocido: ${type}`);
  }
}

// Guard para evitar ejecuciones concurrentes del procesador de cola
let _isProcessingQueue = false;

export async function processQueue() {
  if (!isOnline() || _isProcessingQueue) return;

  _isProcessingQueue = true;
  try {
    // Recuperación de crash: cualquier item en `processing` al entrar aquí
    // quedó de una ejecución anterior interrumpida (la app se cerró a mitad).
    // El guard _isProcessingQueue garantiza que no hay otro _runQueue activo,
    // así que es seguro devolverlos a `pending`.
    await resetProcessingItems();
    await _runQueue();
  } finally {
    _isProcessingQueue = false;
  }
}

/**
 * Limpieza de mantenimiento de la cola: elimina items `failed` con más de
 * 30 días de antigüedad (ya marcados como ABANDONADOS, sin posibilidad de recuperación).
 * Evita que IndexedDB crezca indefinidamente con basura no procesable.
 */
export async function pruneOldQueueItems(maxAgeDays = 30): Promise<number> {
  if (!db.isOpen()) return 0;
  const cutoff = Date.now() - maxAgeDays * 86400000;
  try {
    const oldFailed = await db.action_queue
      .where('status').equals('failed')
      .filter(item => item.timestamp < cutoff)
      .toArray();
    if (oldFailed.length === 0) return 0;
    await db.action_queue.bulkDelete(oldFailed.map(i => i.id));
    console.log(`🧹 Cola: ${oldFailed.length} item(s) failed >${maxAgeDays}d eliminados`);
    return oldFailed.length;
  } catch (err) {
    console.warn('Error en pruneOldQueueItems:', err);
    return 0;
  }
}

// Mejora 6: El backoff ahora se persiste actualizando el campo `timestamp` del item
// en la cola. Antes usaba un Map en memoria que se perdía al cerrar la app,
// causando que todos los reintentos se dispararan de golpe al reabrir.

async function _runQueue() {
  if (!db.isOpen()) return;

  // Traer TODA la cola pendiente, no solo los 5 más viejos.
  //
  // BUG HISTÓRICO: `.limit(5).sortBy('timestamp')` tomaba siempre los 5 items
  // más viejos. Si esos 5 estaban rotos (error de schema, FK, etc.), los items
  // NUEVOS detrás de ellos nunca se procesaban — la cola entera quedaba
  // "colgada". Ahora recorremos todo y los items rotos no bloquean a los sanos.
  const allPending = await db.action_queue.where('status').equals('pending').toArray();
  if (allPending.length === 0) return;

  // Ordenar por dependencia de foreign key (entidades base primero) y luego
  // FIFO. Esto evita errores "foreign key violation" al subir, por ejemplo,
  // un AUDIT antes que la venta/empleado del que depende. (lógica en syncResolution.ts)
  const ordered = sortQueueByDependency(allPending);

  let processedCount = 0;

  for (const item of ordered) {
    // Backoff exponencial: si el item falló antes y aún no cumple su espera,
    // se SALTA — pero NO bloquea a los siguientes (clave del fix).
    if (!isReadyToRetry(item.retries, item.timestamp)) continue;

    processedCount++;

    try {
      // timestamp actualizado al entrar en processing: permite detectar items
      // realmente atascados (app crasheada) vs. en proceso normal.
      await db.action_queue.update(item.id, { status: 'processing', timestamp: Date.now() });
      await processItem(item);
      await db.action_queue.delete(item.id);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const newRetries = (item.retries || 0) + 1;

      console.error(`❌ Fallo ítem ${item.type} (${item.id}):`, errorMessage);

      if (newRetries >= RETRY_CONFIG.MAX_RETRIES) {
          await db.action_queue.update(item.id, { status: 'failed', error: `ABANDONADO: ${errorMessage}` });
          window.dispatchEvent(new CustomEvent('nexus-sync-failed', {
            detail: { type: QUEUE_TYPE_LABELS[item.type] || item.type, error: errorMessage }
          }));
      } else {
          // timestamp actualizado = persistencia del backoff (sobrevive cierre de app)
          await db.action_queue.update(item.id, { status: 'pending', retries: newRetries, error: errorMessage, timestamp: Date.now() });
      }
    }
  }

  // Recursar SOLO si se procesó algo y quedan items LISTOS (no en backoff).
  // Esto procesa items encolados durante esta vuelta (ej: una venta nueva)
  // sin esperar al ciclo de 30s. Los items en backoff NO disparan recursión,
  // así que no hay loop infinito sobre items rotos.
  if (processedCount > 0) {
    const stillPending = await db.action_queue.where('status').equals('pending').toArray();
    const hasReady = stillPending.some(i => isReadyToRetry(i.retries, i.timestamp));
    if (hasReady) await _runQueue();
  }
}

/**
 * Resuelve conflictos al hacer pull de datos remotos:
 * - Si el item local NO está dirty (synced) → sobrescribir con el remoto
 * - Si el item local está dirty (pending_*) PERO el remoto es más nuevo (updated_at) → sobrescribir
 *   (asumimos que el cambio remoto es la versión más reciente y nuestro pending lleva atrás)
 * - Si el item local está dirty y es más nuevo o igual → preservar el local
 *
 * Esto arregla el bug donde edits locales pending bloqueaban actualizaciones legítimas
 * de otros dispositivos.
 */
async function safeBulkPut<T extends { id: string; sync_status?: string; updated_at?: string }>(table: Table<T, string>, items: T[]) {
  // Cargar items locales dirty con su updated_at
  const localDirty = await table.filter(i => i.sync_status !== undefined && i.sync_status !== 'synced').toArray();
  const safeItems = filterRemoteItemsForBulkPut(items, localDirty);
  if (safeItems.length > 0) {
    await table.bulkPut(safeItems);
  }
}

/**
 * Reintenta ventas en estado 'stock_conflict' si el stock local actual
 * ya es suficiente (fue repuesto por otro dispositivo o por un ajuste manual).
 * Se llama después del pull de productos en syncLiveData.
 */
async function autoResolveStockConflicts(businessId: string) {
  try {
    // Usa el índice compuesto [business_id+status] (v11) para evitar full scan
    const conflictedSales = await db.sales
      .where('[business_id+status]').equals([businessId, 'stock_conflict'])
      .toArray();

    if (conflictedSales.length === 0) return;

    for (const sale of conflictedSales) {
      // Precargar productos referenciados en paralelo (1 round trip por venta vs N)
      const productIds = (sale.items || []).map(i => i.product_id);
      const productSnapshots = new Map<string, { stock: number; deleted_at?: string | null }>();
      const fetched = await Promise.all(productIds.map(pid => db.products.get(pid)));
      for (let idx = 0; idx < productIds.length; idx++) {
        const p = fetched[idx];
        if (p) productSnapshots.set(productIds[idx], { stock: p.stock ?? 0, deleted_at: p.deleted_at });
      }

      // Lógica de resolución delegada a función pura (testeable, ver syncResolution.ts)
      const canResolve = canResolveStockConflict(sale.items || [], pid => productSnapshots.get(pid));

      if (canResolve) {
        await db.transaction('rw', [db.sales, db.action_queue], async () => {
          await db.sales.update(sale.id, { status: 'completed', sync_status: 'pending_update' });
          await addToQueue('SALE', { sale: { ...sale, status: 'completed', sync_status: 'pending_update' }, items: sale.items || [] });
        });
        console.log(`✅ Conflicto de stock auto-resuelto para venta ${sale.id}`);
      }
    }
  } catch (err) {
    console.warn('autoResolveStockConflicts error:', err);
  }
}

async function fetchAll(table: string, businessId: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allData: any[] = [];
    let page = 0;
    const size = 1000;

    // eslint-disable-next-line no-constant-condition
    while(true) {
        const { data, error } = await supabase.from(table).select('*').eq('business_id', businessId).range(page * size, (page + 1) * size - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;

        allData.push(...data);
        if (data.length < size) break;
        page++;
    }
    return allData;
}

// Pull incremental: solo descarga registros con updated_at posterior a la última sync.
// Si since=0 (nunca se ha sincronizado), hace un fetchAll completo.
// Esto reduce drásticamente el tráfico en el ciclo de 30s cuando hay muchos productos.
async function fetchSince(table: string, businessId: string, since: number) {
    if (since === 0) return fetchAll(table, businessId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allData: any[] = [];
    const sinceIso = new Date(since).toISOString();
    let page = 0;
    const size = 1000;

    // eslint-disable-next-line no-constant-condition
    while(true) {
        const { data, error } = await supabase
            .from(table).select('*')
            .eq('business_id', businessId)
            .gt('updated_at', sinceIso)
            .range(page * size, (page + 1) * size - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allData.push(...data);
        if (data.length < size) break;
        page++;
    }
    return allData;
}

export async function syncCriticalData(businessId: string) {
  if (!isOnline()) return;

  try {
    const [businessResult, staffResult, registersResult, shiftsResult] = await Promise.all([
      supabase.from('businesses').select('*').eq('id', businessId).single(),
      supabase.from('staff').select('*').eq('business_id', businessId),
      supabase.from('cash_registers').select('*').eq('business_id', businessId),
      supabase.from('cash_shifts').select('*').eq('business_id', businessId).eq('status', 'open')
    ]);

    if (businessResult.data) {
      const remoteBiz = businessResult.data;

      // Bug 1 fix: garantizar que `settings` tenga SOLO la fila del negocio actual.
      // Si quedaron configs huérfanas de otros negocios (cambio de cuenta, datos
      // de prueba), se eliminan — de lo contrario el código que hace settings[0]
      // podría leer la fila equivocada (ej: verificar PIN contra otro negocio).
      const orphanSettings = await db.settings
        .filter(s => s.id !== remoteBiz.id)
        .primaryKeys();
      if (orphanSettings.length > 0) {
        await db.settings.bulkDelete(orphanSettings);
        console.warn(`🧹 Eliminadas ${orphanSettings.length} config(s) de settings huérfanas`);
      }

      // Bug 3 fix: NO pisar campos editados localmente que aún no se sincronizaron.
      // Si la fila local tiene sync_status 'pending_update', el usuario cambió
      // algo (típicamente el master_pin) y el push todavía no subió. Sobrescribir
      // con el valor del servidor revertiría ese cambio. Preservamos los campos
      // sensibles del local hasta que el push complete.
      const localSettings = await db.settings.get(remoteBiz.id);
      const localIsDirty = localSettings?.sync_status === 'pending_update';

      await db.settings.put({
        id: remoteBiz.id,
        name: remoteBiz.name,
        address: remoteBiz.address,
        phone: remoteBiz.phone,
        receipt_message: remoteBiz.receipt_message,
        // master_pin: si hay edición local pendiente, conservar el local
        master_pin: localIsDirty && localSettings?.master_pin
          ? localSettings.master_pin
          : remoteBiz.master_pin,
        subscription_expires_at: remoteBiz.subscription_expires_at,
        status: remoteBiz.status as any,
        last_check: new Date().toISOString(),
        // Si había cambios locales pendientes, mantener el estado dirty para
        // que el push los suba; si no, marcar como synced.
        sync_status: localIsDirty ? 'pending_update' : 'synced',
      });
    }

    if (staffResult.data) {
      // Excluir el registro del usuario autenticado: su staff record se gestiona
      // desde fetchProfileAndSync (basado en profiles), no desde la tabla staff.
      // Si se permite sobreescribir, el admin puede desaparecer del selector.
      const { data: { user } } = await supabase.auth.getUser();
      const adminId = user?.id;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cleanStaff = staffResult.data
        .filter((s: any) => !adminId || s.id !== adminId)
        .map((s: any) => ({ ...s, sync_status: 'synced' }));
      await safeBulkPut(db.staff as never, cleanStaff);
    }

    if (registersResult.data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cleanRegisters = registersResult.data.map((r: any) => ({ ...r, sync_status: 'synced' }));
      await db.cash_registers.bulkPut(cleanRegisters as never);
    }

    if (shiftsResult.data && shiftsResult.data.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shifts = shiftsResult.data.map((s: any) => ({ ...s, sync_status: 'synced' }));
      await safeBulkPut(db.cash_shifts as never, shifts);
    }
  } catch (error) {
    console.error('Error en syncCriticalData:', error);
  }
}

export async function syncHeavyData(businessId: string): Promise<{ products: number; customers: number }> {
  if (!isOnline()) return { products: 0, customers: 0 };

  const results = { products: 0, customers: 0 };

  // Productos y clientes en paralelo, sin delays artificiales
  const [productsData, customersData] = await Promise.all([
    fetchAll('products', businessId),
    fetchAll('customers', businessId)
  ]);

  if (productsData.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cleanProducts = productsData.map((p: any) => ({ ...p, sync_status: 'synced' }));
    await safeBulkPut(db.products as never, cleanProducts);
    results.products = cleanProducts.length;

    // Limpiar productos locales que ya no existen en la nube
    const remoteIds = new Set(productsData.map((p: any) => p.id));
    const bId = productsData[0]?.business_id;
    if (bId) {
      const localProducts = await db.products.where('business_id').equals(bId).toArray();
      const orphanIds = localProducts
        .filter(p => p.sync_status === 'synced' && !remoteIds.has(p.id))
        .map(p => p.id);
      if (orphanIds.length > 0) await db.products.bulkDelete(orphanIds);
    }
  }

  if (customersData.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cleanCustomers = customersData.map((c: any) => ({ ...c, sync_status: 'synced' }));
    await safeBulkPut(db.customers as never, cleanCustomers);
    results.customers = cleanCustomers.length;

    // Limpiar clientes locales que ya no existen en la nube
    const remoteCustomerIds = new Set(customersData.map((c: any) => c.id));
    const bId = customersData[0]?.business_id;
    if (bId) {
      const localCustomers = await db.customers.where('business_id').equals(bId).toArray();
      const orphanIds = localCustomers
        .filter(c => c.sync_status === 'synced' && !remoteCustomerIds.has(c.id))
        .map(c => c.id);
      if (orphanIds.length > 0) await db.customers.bulkDelete(orphanIds);
    }
  }

  // Marcar éxito de la verificación de tombstones / orphan cleanup
  setLastHeavySyncTimestamp();
  return results;
}

export async function syncBusinessProfile(businessId: string) {
  await syncCriticalData(businessId);
  await syncHeavyData(businessId);
}

export async function syncPush() {
    // processQueue ya resetea internamente los items atascados en `processing`
    // (dentro de su guard de concurrencia), así que no hace falta llamarlo aparte.
    await processQueue();
}

/**
 * Hace pull completo. Retorna true si TODO (crítico + heavy) tuvo éxito.
 * Si syncHeavyData falla, retorna false para que el caller no actualice el
 * timestamp "última sincronización" (los productos/clientes quedan desactualizados).
 */
export async function syncPull(): Promise<boolean> {
    if (!isOnline()) return false;
    const settings = await db.settings.toArray();
    if (settings.length === 0) return false;

    const businessId = settings[0].id;
    await syncCriticalData(businessId);

    try {
        await syncHeavyData(businessId);
        return true;
    } catch (err) {
        console.error('syncPull — syncHeavyData falló:', err);
        return false;
    }
}

// Reintentar solo los ítems fallidos (sin hacer pull completo)
// Útil para el botón "Reintentar fallidos" en Ajustes → Datos
export async function retryFailedItems() {
    if (!isOnline()) throw new Error("Sin conexión a internet");
    if (!db.isOpen()) return;
    const count = await db.action_queue.where('status').equals('failed').count();
    if (count === 0) throw new Error("No hay elementos fallidos que reintentar");
    await db.action_queue
        .where('status').equals('failed')
        .modify({ status: 'pending', retries: 0, error: undefined });
    await processQueue();
}

export async function syncManualFull() {
    if (!isOnline()) throw new Error("Sin conexión a internet");
    // Mantenimiento: borrar items failed muy antiguos (>30d) antes de reintentar
    await pruneOldQueueItems(30);
    // Reintentar ítems que fallaron previamente (en sync automático solo se reintenta hasta 5 veces)
    if (db.isOpen()) {
        await db.action_queue
            .where('status').equals('failed')
            .modify({ status: 'pending', retries: 0, error: undefined });
    }
    await syncPush();
    const pullOk = await syncPull();
    // Solo actualizar timestamp si TODO (push + pull completo) fue exitoso.
    // Si el pull heavy falló, los datos locales están desactualizados y el contador
    // "días sin sync" debe reflejarlo para que el usuario sepa que necesita reintentar.
    if (pullOk) {
        setLastSyncTimestamp();
    } else {
        throw new Error("Sincronización parcial: los datos pudieron no haberse actualizado completamente. Reintenta cuando la conexión sea estable.");
    }
}

// ─── SYNC LIVE: pull periódico para multi-dispositivo ───────────────────────
// Descarga el turno activo, sus ventas, movimientos de caja y stock actualizado.
// Diseñado para correr cada 30s sin sobrecargar ni sobreescribir datos locales pendientes.
export async function syncLiveData() {
    if (!isOnline() || !db.isOpen()) return;

    const settings = await db.settings.toArray();
    if (settings.length === 0) return;
    const businessId = settings[0].id;

    try {
        // 1. Turno abierto actual (puede haber sido abierto/cerrado desde otro dispositivo)
        const { data: shiftData } = await supabase
            .from('cash_shifts')
            .select('*')
            .eq('business_id', businessId)
            .eq('status', 'open')
            .limit(1);

        if (shiftData && shiftData.length > 0) {
            const remoteShift = { ...shiftData[0], sync_status: 'synced' as const };
            // Solo actualizar si no tenemos cambios pendientes en este turno
            const localShift = await db.cash_shifts.get(remoteShift.id);
            if (!localShift || localShift.sync_status === 'synced') {
                await db.cash_shifts.put(remoteShift);
            }

            // 2. Ventas de este turno (las que hicieron otros dispositivos)
            const { data: salesData } = await supabase
                .from('sales')
                .select('*')
                .eq('shift_id', remoteShift.id)
                .eq('business_id', businessId);

            if (salesData && salesData.length > 0) {
                const cleanSales = salesData.map((s: any) => ({ ...s, sync_status: 'synced' as const }));
                await safeBulkPut(db.sales as never, cleanSales);
            }

            // 3. Movimientos de caja de este turno
            const { data: cashMovData } = await supabase
                .from('cash_movements')
                .select('*')
                .eq('shift_id', remoteShift.id)
                .eq('business_id', businessId);

            if (cashMovData && cashMovData.length > 0) {
                const cleanMovs = cashMovData.map((m: any) => ({ ...m, sync_status: 'synced' as const }));
                await safeBulkPut(db.cash_movements as never, cleanMovs);
            }
        } else {
            // No hay turno abierto en la nube: si tenemos uno local marcado como synced, cerrarlo
            const localOpenShifts = await db.cash_shifts
                .where({ business_id: businessId, status: 'open' })
                .filter(s => s.sync_status === 'synced')
                .toArray();
            for (const s of localOpenShifts) {
                // El turno fue cerrado desde otro dispositivo — buscar el estado real
                const { data: realShift } = await supabase.from('cash_shifts').select('*').eq('id', s.id).single();
                if (realShift && realShift.status === 'closed') {
                    // Fix 3: Traer ventas y movimientos de caja de este turno antes de cerrarlo.
                    // Si el dispositivo estaba offline mientras otro hacía ventas y cerraba,
                    // estas ventas no estarían en IndexedDB.
                    const { data: shiftSales } = await supabase
                        .from('sales').select('*')
                        .eq('shift_id', s.id).eq('business_id', businessId);
                    if (shiftSales && shiftSales.length > 0) {
                        const cleanSales = shiftSales.map((sl: any) => ({ ...sl, sync_status: 'synced' as const }));
                        await safeBulkPut(db.sales as never, cleanSales);
                    }
                    const { data: shiftCashMovs } = await supabase
                        .from('cash_movements').select('*')
                        .eq('shift_id', s.id).eq('business_id', businessId);
                    if (shiftCashMovs && shiftCashMovs.length > 0) {
                        const cleanMovs = shiftCashMovs.map((m: any) => ({ ...m, sync_status: 'synced' as const }));
                        await safeBulkPut(db.cash_movements as never, cleanMovs);
                    }

                    await db.cash_shifts.put({ ...realShift, sync_status: 'synced' });
                }
            }
        }

        // 4. Productos: pull incremental — solo descarga lo que cambió desde el último sync.
        // fetchSince usa updated_at > lastSync para evitar bajar TODO el catálogo cada 30s.
        // Si lastSync=0 (primer ciclo), hace un fetchAll completo automáticamente.
        // NOTA: el orphan cleanup (borrar locales que ya no existen en la nube) NO se hace
        // aquí porque con pull incremental no tenemos el set completo de IDs remotos.
        // El orphan cleanup vive en syncHeavyData (login + sync manual), donde sí hay fetchAll.
        const lastSync = getLastSyncTimestamp();
        const productsData = await fetchSince('products', businessId, lastSync);

        if (productsData.length > 0) {
            const cleanProducts = productsData.map((p: any) => ({ ...p, sync_status: 'synced' as const }));
            await safeBulkPut(db.products as never, cleanProducts);

            // Alertar sobre stock negativo (conflicto de ventas simultáneas offline)
            const negativeStock = productsData.filter((p: any) => p.stock < 0 && !p.deleted_at);
            if (negativeStock.length > 0) {
                const names = negativeStock.map((p: any) => p.name).slice(0, 3).join(', ');
                console.warn(`⚠️ Stock negativo detectado: ${names}`);
                window.dispatchEvent(new CustomEvent('nexus-stock-alert', {
                  detail: { products: negativeStock.map((p: any) => ({ id: p.id, name: p.name, stock: p.stock })) }
                }));
            }

            // Auto-resolver ventas en stock_conflict: si el stock fue repuesto desde
            // otro dispositivo, reintentar la venta automáticamente. El usuario ya no
            // tendrá que aceptar manualmente conflictos que ya se resolvieron solos.
            await autoResolveStockConflicts(businessId);
        }

        // 5. Clientes: pull incremental (mismo razonamiento que productos)
        const customersData = await fetchSince('customers', businessId, lastSync);
        if (customersData.length > 0) {
            const cleanCustomers = customersData.map((c: any) => ({ ...c, sync_status: 'synced' as const }));
            await safeBulkPut(db.customers as never, cleanCustomers);
        }

        // 5b. Cada 24h: forzar fetchAll (orphan cleanup) para detectar items
        // que fueron borrados FÍSICAMENTE en el servidor. El pull incremental
        // por updated_at no puede verlos. syncHeavyData hace el set-diff completo.
        const lastHeavy = getLastHeavySyncTimestamp();
        if (Date.now() - lastHeavy > HEAVY_SYNC_INTERVAL_MS) {
            syncHeavyData(businessId).catch(err =>
                console.warn('Background heavy sync (orphan cleanup) falló:', err)
            );
        }

        // 6. Staff: sincronizar cambios de PIN y datos de empleados (Fix 2)
        // Sin esto, cambios de PIN hechos en otro dispositivo no se propagaban
        // hasta el próximo login (syncCriticalData solo corre al iniciar sesión).
        const { data: staffData } = await supabase
            .from('staff')
            .select('*')
            .eq('business_id', businessId);

        if (staffData && staffData.length > 0) {
            const { data: { user } } = await supabase.auth.getUser();
            const adminId = user?.id;
            // Excluir admin (su registro se gestiona desde profiles, no desde staff)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const cleanStaff = staffData
                .filter((s: any) => !adminId || s.id !== adminId)
                .map((s: any) => ({ ...s, sync_status: 'synced' as const }));
            await safeBulkPut(db.staff as never, cleanStaff);
        }

        // 7. Mejora 5: Verificar suscripción/trial con datos locales actualizados
        // Si el trial venció mientras la app estaba abierta, notificar a Layout
        const freshSettings = await db.settings.toArray();
        if (freshSettings.length > 0) {
            const cfg = freshSettings[0];
            if (cfg.status === 'trial' && cfg.subscription_expires_at) {
                if (new Date() > new Date(cfg.subscription_expires_at)) {
                    window.dispatchEvent(new CustomEvent('nexus-trial-expired'));
                }
            }
        }

        // Mejora 2: Registrar timestamp de última sincronización exitosa
        setLastSyncTimestamp();
    } catch (error) {
        // Silencioso: no interrumpir la app si falla el pull en background
        console.error('syncLiveData error:', error);
    }
}

// --- Sync listeners con cleanup para evitar memory leaks ---
let _syncIntervalId: ReturnType<typeof setInterval> | null = null;
let _onlineHandler: (() => void) | null = null;
let _visibilityHandler: (() => void) | null = null;

export function startSyncListeners() {
  if (_syncIntervalId !== null) return; // Ya inicializado

  _onlineHandler = () => {
    // Fix 4: Al reconectarse, reintentar automáticamente items fallidos
    // (antes solo se reintentaban con el botón manual en Ajustes)
    if (db.isOpen()) {
      db.action_queue
        .where('status').equals('failed')
        .modify({ status: 'pending', retries: 0, error: undefined })
        .catch(() => {});
    }
    resetProcessingItems()
      .then(() => processQueue())
      .then(() => syncLiveData())
      .catch(err => console.error("Error al procesar cola tras reconexión:", err));
  };
  window.addEventListener('online', _onlineHandler);

  _visibilityHandler = () => {
    if (!document.hidden && isOnline() && db.isOpen()) {
      // Fix 4: También reintentar fallidos al volver a la app
      db.action_queue
        .where('status').equals('failed')
        .modify({ status: 'pending', retries: 0, error: undefined })
        .catch(() => {});
      resetProcessingItems().then(() => processQueue()).catch(() => {});
    }
  };
  document.addEventListener('visibilitychange', _visibilityHandler);

  // Push + Pull cada 30 segundos
  _syncIntervalId = setInterval(() => {
    if (document.hidden) return;
    if (isOnline() && db.isOpen()) {
      db.action_queue.where('status').anyOf('pending', 'processing').count()
        .then(count => {
          if (count > 0) {
            processQueue().catch(err => {
              if (err?.name !== 'DatabaseClosedError') console.error("Error en sync push periódico:", err);
            });
          }
        })
        .catch(() => {});
      syncLiveData().catch(err => {
        if (err?.name !== 'DatabaseClosedError') console.error("Error en sync pull periódico:", err);
      });
    }
  }, 30000);

  resetProcessingItems().catch(() => {});
}

export function stopSyncListeners() {
  if (_syncIntervalId !== null) {
    clearInterval(_syncIntervalId);
    _syncIntervalId = null;
  }
  if (_onlineHandler) {
    window.removeEventListener('online', _onlineHandler);
    _onlineHandler = null;
  }
  if (_visibilityHandler) {
    document.removeEventListener('visibilitychange', _visibilityHandler);
    _visibilityHandler = null;
  }
}

// Auto-iniciar al importar el módulo (compatibilidad con código existente)
if (typeof window !== 'undefined') {
  startSyncListeners();
}