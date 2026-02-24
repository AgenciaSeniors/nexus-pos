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
  type CashMovement
} from './db';
import { supabase } from './supabase';
import type { Table } from 'dexie';

// Helper para verificar conexión real
export function isOnline() {
  return typeof navigator !== 'undefined' && navigator.onLine;
}

// --- RECUPERACIÓN DE ZOMBIES ---
export async function resetProcessingItems() {
    const stuckItems = await db.action_queue.where('status').equals('processing').toArray();
    if (stuckItems.length > 0) {
        await db.action_queue.where('status').equals('processing').modify({ status: 'pending' });
    }
}

// --- GESTIÓN DE COLA (Entrada) ---

export async function addToQueue(type: QueueItem['type'], payload: QueuePayload) {
  try {
    // 1. La operación de base de datos sigue siendo parte de la transacción (await)
    await db.action_queue.add({
      id: crypto.randomUUID(),
      type,
      payload,
      timestamp: Date.now(),
      retries: 0,
      status: 'pending'
    });
    
    // 2. CORRECCIÓN: Sacamos processQueue de la transacción actual.
    // Usamos setTimeout para que se ejecute en el siguiente "tick", 
    // permitiendo que la transacción de la Venta (Sale) se complete y cierre exitosamente primero.
    if (isOnline()) {
      setTimeout(() => {
        processQueue().catch(err => console.error("Error en sync background:", err));
      }, 50); // Un pequeño delay de 50ms es suficiente y seguro
    }
  } catch (error) {
    console.error("Error crítico al añadir a la cola de sincronización:", error);
    // Es importante relanzar el error para que la transacción padre (ej. Venta) se entere y haga rollback si falla el guardado en cola
    throw error; 
  }
}

// --- PROCESAMIENTO ATÓMICO POR TIPO ---

async function processItem(item: QueueItem) {
  const { type, payload } = item;

  switch (type) {
    case 'SALE': {
      const { sale, items } = payload as SalePayload;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sync_status, ...saleClean } = sale;

      const { error } = await supabase.rpc('process_sale_transaction', {
        p_sale: saleClean,
        p_items: items || []
      });

      if (error) {
        // Si el error es de duplicado, asumimos que ya subió
        if (error.code !== '23505') { 
            throw new Error(`Fallo transacción venta ${sale.id}: ${error.message}`);
        }
      }
      
      await db.sales.update(sale.id, { sync_status: 'synced' });
      break;
    }

    case 'MOVEMENT': {
      const movement = payload as InventoryMovement;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sync_status, ...cleanMov } = movement;
      
      const { error } = await supabase.from('inventory_movements').insert(cleanMov);
      if (error && error.code !== '23505') throw new Error(`Error subiendo movimiento: ${error.message}`);

      if (db.movements) await db.movements.update(movement.id, { sync_status: 'synced' });
      break;
    }

    case 'AUDIT': {
      const log = payload as AuditLog;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sync_status, ...cleanLog } = log;
      
      const { error } = await supabase.from('audit_logs').insert(cleanLog);
      if (error && error.code !== '23505') throw new Error(`Error subiendo audit: ${error.message}`);

      await db.audit_logs.update(log.id, { sync_status: 'synced' });
      break;
    }

    case 'PRODUCT_SYNC': {
      const product = payload as Product;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sync_status, ...cleanProduct } = product;
      
      const { error } = await supabase.from('products').upsert(cleanProduct);
      if (error) throw new Error(`Error sync producto: ${error.message}`);

      // ✅ ACTUALIZACIÓN DE ESTADO LOCAL
      await db.products.update(product.id, { sync_status: 'synced' });
      break;
    }

    case 'CUSTOMER_SYNC': {
      const customer = payload as Customer;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sync_status, ...cleanCustomer } = customer;
      
      const { error } = await supabase.from('customers').upsert(cleanCustomer);
      if (error) throw new Error(`Error sync cliente: ${error.message}`);

      // ✅ ACTUALIZACIÓN DE ESTADO LOCAL
      await db.customers.update(customer.id, { sync_status: 'synced' });
      break;
    }

    case 'SETTINGS_SYNC': {
      const config = payload as BusinessConfig;
      const updateData = {
        name: config.name,
        address: config.address,
        phone: config.phone,
        receipt_message: config.receipt_message
      };
      
      const { error } = await supabase
        .from('businesses')
        .update(updateData)
        .eq('id', config.id);

      if (error) throw new Error(`Error actualizando negocio: ${error.message}`);

      // ✅ ACTUALIZACIÓN DE ESTADO LOCAL
      await db.settings.update(config.id, { sync_status: 'synced' });
      break;
    }

    case 'SHIFT': {
        const shift = payload as CashShift;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { sync_status, ...cleanShift } = shift;

        const { error } = await supabase.from('cash_shifts').upsert(cleanShift);
        if (error) throw new Error(`Error sincronizando turno: ${error.message}`);

        // ✅ ACTUALIZACIÓN DE ESTADO LOCAL
        await db.cash_shifts.update(shift.id, { sync_status: 'synced' });
        break;
    }

    case 'CASH_MOVEMENT': {
        const mov = payload as CashMovement;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { sync_status, ...cleanMov } = mov;

        const { error } = await supabase.from('cash_movements').insert(cleanMov);
        if (error && error.code !== '23505') throw new Error(`Error sincronizando movimiento: ${error.message}`);

        // ✅ ACTUALIZACIÓN DE ESTADO LOCAL
        await db.cash_movements.update(mov.id, { sync_status: 'synced' });
        break;
    }

    default:
      throw new Error(`Tipo de acción desconocido en cola: ${type}`);
  }
}

// --- MOTOR DE PROCESAMIENTO ---

export async function processQueue() {
  if (!isOnline()) return;

  const pendingItems = await db.action_queue
    .where('status').equals('pending')
    .limit(5) 
    .toArray();

  if (pendingItems.length === 0) return;

  for (const item of pendingItems) {
    try {
      await db.action_queue.update(item.id, { status: 'processing' });
      await processItem(item);
      await db.action_queue.delete(item.id); 
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const newRetries = (item.retries || 0) + 1;
      
      console.error(`❌ Fallo ítem ${item.type} (${item.id}):`, errorMessage);

      if (newRetries >= 5) {
          console.error(`💀 Ítem ${item.id} marcado como FATAL.`);
          await db.action_queue.update(item.id, { 
              status: 'failed', 
              error: `ABANDONADO tras 5 intentos: ${errorMessage}` 
          });
      } else {
          await db.action_queue.update(item.id, { 
              status: 'pending', 
              retries: newRetries, 
              error: errorMessage 
          });
      }
    }
  }

  if ((await db.action_queue.where('status').equals('pending').count()) > 0) {
    await processQueue(); 
  }
}

// --- UTILIDADES DE CARGA SEGURA ---

// 🛡️ PROTECCIÓN CONTRA SOBRESCRITURA
// Solo guarda datos de la nube si NO tenemos cambios locales pendientes.
async function safeBulkPut<T extends { id: string; sync_status?: string }>(
  table: Table<T, string>, 
  items: T[]
) {
  // 1. Identificar ítems locales "sucios" (pendientes de subida)
  const dirtyItems = await table
    .filter(i => i.sync_status !== undefined && i.sync_status !== 'synced')
    .primaryKeys();
  
  const dirtySet = new Set(dirtyItems);

  // 2. Filtrar lo que viene de la nube: Si tengo un cambio local, IGNORO la nube
  const safeItems = items.filter(i => !dirtySet.has(i.id));

  if (safeItems.length > 0) {
    await table.bulkPut(safeItems);
  }
}

// 📥 PAGINACIÓN AUTOMÁTICA
// Evita timeouts al bajar miles de registros
async function fetchAll(table: string, businessId: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allData: any[] = [];
    let page = 0;
    const size = 1000;
    
;
    
    // eslint-disable-next-line no-constant-condition
    while(true) {
        const { data, error } = await supabase.from(table)
            .select('*')
            .eq('business_id', businessId)
            .range(page * size, (page + 1) * size - 1);
        
        if (error) throw error;
        if (!data || data.length === 0) break;
        
        allData.push(...data);
        if (data.length < size) break; // Si bajamos menos del límite, es la última página
        page++;
    }
    
    console.log(`✅ ${table}: ${allData.length} registros totales`);
    return allData;
}

// --- FUNCIONES DE SINCRONIZACIÓN (PULL) ---

export async function syncCriticalData(businessId: string) {
  if (!isOnline()) return;

  try {
    const [businessResult, staffResult, registersResult, shiftsResult] = await Promise.all([
      supabase.from('businesses').select('*').eq('id', businessId).single(),
      supabase.from('staff').select('*').eq('business_id', businessId).eq('active', true),
      supabase.from('cash_registers').select('*').eq('business_id', businessId),
      supabase.from('cash_shifts').select('*').eq('business_id', businessId).eq('status', 'open')
    ]);

    if (businessResult.data) {
      await db.settings.put({
        id: businessResult.data.id,
        name: businessResult.data.name,
        address: businessResult.data.address,
        phone: businessResult.data.phone,
        receipt_message: businessResult.data.receipt_message,
        subscription_expires_at: businessResult.data.subscription_expires_at,
        status: businessResult.data.status as 'active' | 'suspended' | 'pending',
        last_check: new Date().toISOString(),
        sync_status: 'synced'
      });
    }

    if (staffResult.data) {
      await db.staff.clear();
      await db.staff.bulkPut(staffResult.data);
    }

    if (registersResult.data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cleanRegisters = registersResult.data.map(r => ({ ...r, sync_status: 'synced' }));
      await db.cash_registers.bulkPut(cleanRegisters as never);
    }

    if (shiftsResult.data && shiftsResult.data.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shifts = shiftsResult.data.map(s => ({ ...s, sync_status: 'synced' }));
      await safeBulkPut(db.cash_shifts as never, shifts);
    }
  } catch (error) {
    console.error('Error en syncCriticalData:', error);
  }
}

// 🚀 OPTIMIZACIÓN: Carga en background sin bloquear la UI
// Retorna una Promise que se resuelve cuando ambas cargas terminan
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
      } catch (error) {
        console.error('Error descargando productos:', error);
      } finally {
        resolve();
      }
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
      } catch (error) {
        console.error('Error descargando clientes:', error);
      } finally {
        resolve();
      }
    }, 1000);
  });

  return Promise.all([syncProducts, syncCustomers]).then(() => undefined);
}

// Coordinador principal
export async function syncBusinessProfile(businessId: string) {
  await syncCriticalData(businessId);
  await syncHeavyData(businessId);
}

// --- COMANDOS MANUALES ---

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
    await syncPush();
    await syncPull();
}

// Watcher automático
if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
        resetProcessingItems().then(() => processQueue());
    });

    // Limpieza inicial
    resetProcessingItems();

    // Intervalo de seguridad cada 30s
    setInterval(() => {
      if (isOnline()) processQueue();
    }, 30000);
}