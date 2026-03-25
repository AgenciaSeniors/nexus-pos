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
  type VoidSalePayload
} from './db';
import { supabase } from './supabase';
import type { Table } from 'dexie';

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
    
    if (isOnline()) {
      setTimeout(() => {
        processQueue().catch(err => console.error("Error en sync background:", err));
      }, 50);
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

      const { error } = await supabase.rpc('process_sale_transaction', {
        p_sale: saleClean, p_items: items || []
      });

      if (error && error.code !== '23505') throw new Error(`Fallo venta: ${error.message}`);
      await db.sales.update(sale.id, { sync_status: 'synced' });
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
      const { error } = await supabase.from('products').upsert(cleanProduct);
      if (error) throw new Error(`Error producto: ${error.message}`);
      await db.products.update(product.id, { sync_status: 'synced' });
      break;
    }
    case 'CUSTOMER_SYNC': {
      const customer = payload as Customer;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sync_status, ...cleanCustomer } = customer;
      const { error } = await supabase.from('customers').upsert(cleanCustomer);
      if (error) throw new Error(`Error cliente: ${error.message}`);
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
        const { error } = await supabase.from('sales').update({ status: 'voided' }).eq('id', saleId);
        if (error) throw new Error(`Error anulando venta: ${error.message}`);
        await db.sales.update(saleId, { sync_status: 'synced' });
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
    await _runQueue();
  } finally {
    _isProcessingQueue = false;
  }
}

async function _runQueue() {
  if (!db.isOpen()) return;
  const pendingItems = await db.action_queue.where('status').equals('pending').limit(5).toArray();
  if (pendingItems.length === 0) return;

  for (const item of pendingItems) {
    // Backoff exponencial: omitir ítems reintentados recientemente
    if (item.retries > 0) {
      const backoffMs = Math.min(Math.pow(2, item.retries - 1) * 30000, 300000); // 30s, 60s, 2m, 4m, máx 5m
      if (Date.now() - item.timestamp < backoffMs) continue;
    }

    try {
      await db.action_queue.update(item.id, { status: 'processing' });
      await processItem(item);
      await db.action_queue.delete(item.id);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const newRetries = (item.retries || 0) + 1;

      console.error(`❌ Fallo ítem ${item.type} (${item.id}):`, errorMessage);

      if (newRetries >= 5) {
          await db.action_queue.update(item.id, { status: 'failed', error: `ABANDONADO: ${errorMessage}` });
      } else {
          // Actualiza timestamp para calcular el backoff desde el último intento
          await db.action_queue.update(item.id, { status: 'pending', retries: newRetries, error: errorMessage, timestamp: Date.now() });
      }
    }
  }

  if ((await db.action_queue.where('status').equals('pending').count()) > 0) {
    await _runQueue();
  }
}

async function safeBulkPut<T extends { id: string; sync_status?: string }>(table: Table<T, string>, items: T[]) {
  const dirtyItems = await table.filter(i => i.sync_status !== undefined && i.sync_status !== 'synced').primaryKeys();
  const dirtySet = new Set(dirtyItems);
  const safeItems = items.filter(i => !dirtySet.has(i.id));

  if (safeItems.length > 0) {
    await table.bulkPut(safeItems);
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
      await db.settings.put({
        id: businessResult.data.id, name: businessResult.data.name, address: businessResult.data.address,
        phone: businessResult.data.phone, receipt_message: businessResult.data.receipt_message,
        master_pin: businessResult.data.master_pin, 
        subscription_expires_at: businessResult.data.subscription_expires_at, status: businessResult.data.status as any,
        last_check: new Date().toISOString(), sync_status: 'synced'
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

export function syncHeavyData(businessId: string): Promise<void> {
  if (!isOnline()) return Promise.resolve();

  const syncProducts = new Promise<void>(resolve => {
    setTimeout(async () => {
      try {
        const productsData = await fetchAll('products', businessId);
        if (productsData.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const cleanProducts = productsData.map((p: any) => ({ ...p, sync_status: 'synced' }));
          await safeBulkPut(db.products as never, cleanProducts);
        }
      } catch (error) { console.error(error); } finally { resolve(); }
    }, 200);
  });

  const syncCustomers = new Promise<void>(resolve => {
    setTimeout(async () => {
      try {
        const customersData = await fetchAll('customers', businessId);
        if (customersData.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const cleanCustomers = customersData.map((c: any) => ({ ...c, sync_status: 'synced' }));
          await safeBulkPut(db.customers as never, cleanCustomers);
        }
      } catch (error) { console.error(error); } finally { resolve(); }
    }, 1000);
  });

  return Promise.all([syncProducts, syncCustomers]).then(() => undefined);
}

export async function syncBusinessProfile(businessId: string) {
  await syncCriticalData(businessId);
  await syncHeavyData(businessId);
}

export async function syncPush() {
    await resetProcessingItems();
    await processQueue();
}

export async function syncPull() {
    if (!isOnline()) return;
    const settings = await db.settings.toArray();
    if (settings.length > 0) {
        const businessId = settings[0].id;
        await syncCriticalData(businessId);
        await syncHeavyData(businessId);
    }
}

export async function syncManualFull() {
    if (!isOnline()) throw new Error("Sin conexión a internet");
    // Reintentar ítems que fallaron previamente (en sync automático solo se reintenta hasta 5 veces)
    if (db.isOpen()) {
        await db.action_queue
            .where('status').equals('failed')
            .modify({ status: 'pending', retries: 0, error: undefined });
    }
    await syncPush();
    await syncPull();
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
                    await db.cash_shifts.put({ ...realShift, sync_status: 'synced' });
                }
            }
        }

        // 4. Stock actualizado (productos pueden haber sido vendidos desde otro dispositivo)
        const { data: productsData } = await supabase
            .from('products')
            .select('id, stock, price, cost, name, category, unit, sku, business_id, deleted_at')
            .eq('business_id', businessId);

        if (productsData && productsData.length > 0) {
            const cleanProducts = productsData.map((p: any) => ({ ...p, sync_status: 'synced' as const }));
            await safeBulkPut(db.products as never, cleanProducts);

            // Alertar sobre stock negativo (conflicto de ventas simultáneas offline)
            const negativeStock = productsData.filter((p: any) => p.stock < 0 && !p.deleted_at);
            if (negativeStock.length > 0) {
                const names = negativeStock.map((p: any) => p.name).slice(0, 3).join(', ');
                console.warn(`⚠️ Stock negativo detectado: ${names}`);
                // Dispara evento personalizado para que la UI lo muestre
                window.dispatchEvent(new CustomEvent('nexus-stock-alert', {
                  detail: { products: negativeStock.map((p: any) => ({ id: p.id, name: p.name, stock: p.stock })) }
                }));
            }
        }
    } catch (error) {
        // Silencioso: no interrumpir la app si falla el pull en background
        console.error('syncLiveData error:', error);
    }
}

if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
        resetProcessingItems()
            .then(() => processQueue())
            .then(() => syncLiveData())
            .catch(err => console.error("Error al procesar cola tras reconexión:", err));
    });
    resetProcessingItems();
    // Push + Pull cada 30 segundos para mantener dispositivos sincronizados
    setInterval(() => {
        if (isOnline() && db.isOpen()) {
            processQueue().catch(err => {
                if (err?.name !== 'DatabaseClosedError') console.error("Error en sync push periódico:", err);
            });
            syncLiveData().catch(err => {
                if (err?.name !== 'DatabaseClosedError') console.error("Error en sync pull periódico:", err);
            });
        }
    }, 30000);
}