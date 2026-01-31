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

// Helper para verificar conexión real
export function isOnline() {
  return typeof navigator !== 'undefined' && navigator.onLine;
}

// --- RECUPERACIÓN DE ZOMBIES ---
export async function resetProcessingItems() {
    const stuckItems = await db.action_queue.where('status').equals('processing').toArray();
    if (stuckItems.length > 0) {
        console.warn(`⚠️ Recuperando ${stuckItems.length} ítems interrumpidos...`);
        await db.action_queue.where('status').equals('processing').modify({ status: 'pending' });
    }
}

// --- GESTIÓN DE COLA (Entrada) ---

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
      processQueue();
    }
  } catch (error) {
    console.error("Error crítico al añadir a la cola de sincronización:", error);
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
        console.error("Error RPC Venta:", error);
        throw new Error(`Fallo transacción venta ${sale.id}: ${error.message}`);
      }
      
      await db.sales.update(sale.id, { sync_status: 'synced' });
      console.log(`✅ Venta ${sale.id} sincronizada.`);
      break;
    }

    case 'MOVEMENT': {
      const movement = payload as InventoryMovement;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sync_status, ...cleanMov } = movement;
      
      const { error } = await supabase.from('inventory_movements').insert(cleanMov);
      if (error) throw new Error(`Error subiendo movimiento: ${error.message}`);

      
      if (db.movements) await db.movements.update(movement.id, { sync_status: 'synced' });
      console.log('✅ Movimiento sincronizado.');
      break;
    }

    case 'AUDIT': {
      const log = payload as AuditLog;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sync_status, ...cleanLog } = log;
      
      const { error } = await supabase.from('audit_logs').insert(cleanLog);
      if (error) throw new Error(`Error subiendo audit: ${error.message}`);

      await db.audit_logs.update(log.id, { sync_status: 'synced' });
      console.log('✅ Auditoría sincronizada.');
      break;
    }

    case 'PRODUCT_SYNC': {
      const product = payload as Product;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sync_status, ...cleanProduct } = product;
      
      const { error } = await supabase.from('products').upsert(cleanProduct);
      if (error) throw new Error(`Error sync producto: ${error.message}`);
      break;
    }

    case 'CUSTOMER_SYNC': {
      const customer = payload as Customer;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sync_status, ...cleanCustomer } = customer;
      
      const { error } = await supabase.from('customers').upsert(cleanCustomer);
      if (error) throw new Error(`Error sync cliente: ${error.message}`);
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
      break;
    }

    // ✅ NUEVO: GESTIÓN DE TURNOS (Apertura/Cierre)
    // Usamos upsert porque un turno se crea (abierto) y luego se actualiza (cerrado)
    case 'SHIFT': {
        const shift = payload as CashShift;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { sync_status, ...cleanShift } = shift;

        const { error } = await supabase.from('cash_shifts').upsert(cleanShift);
        if (error) throw new Error(`Error sincronizando turno: ${error.message}`);

        await db.cash_shifts.update(shift.id, { sync_status: 'synced' });
        console.log('✅ Turno de caja sincronizado.');
        break;
    }

    // ✅ NUEVO: MOVIMIENTOS DE EFECTIVO (Entradas/Salidas)
    case 'CASH_MOVEMENT': {
        const mov = payload as CashMovement;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { sync_status, ...cleanMov } = mov;

        const { error } = await supabase.from('cash_movements').insert(cleanMov);
        if (error) throw new Error(`Error sincronizando movimiento caja: ${error.message}`);

        await db.cash_movements.update(mov.id, { sync_status: 'synced' });
        console.log('✅ Movimiento de caja sincronizado.');
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

// --- FUNCIONES DE SINCRONIZACIÓN PÚBLICAS ---

export async function syncPush() {
    console.log("⬆️ Iniciando Push (Subida de datos)...");
    await resetProcessingItems(); 
    await processQueue();
}

export async function syncPull() {
    if (!isOnline()) return;
    
    console.log("⬇️ Iniciando Pull (Descarga de datos)...");
    const settings = await db.settings.toArray();
    
    if (settings.length > 0) {
        const businessId = settings[0].id;
        
        await Promise.all([
            syncCriticalData(businessId), 
            syncHeavyData(businessId)     
        ]);
        console.log("✨ Pull completado.");
    }
}

export async function syncManualFull() {
    if (!isOnline()) throw new Error("Sin conexión a internet");
    
    console.log("🔄 Iniciando Ciclo de Sincronización Completa...");
    
    await syncPush();
    await syncPull();
    
    console.log("✅ Ciclo de Sincronización Finalizado.");
}

// --- LISTENERS AUTOMÁTICOS ---
if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
        console.log("🌐 Conexión detectada. Reanudando cola...");
        resetProcessingItems().then(() => processQueue());
    });
    
    resetProcessingItems();

    setInterval(() => { if (isOnline()) processQueue(); }, 30000);
}

// --- ESTRATEGIA DE CARGA DE DATOS ---

export async function syncCriticalData(businessId: string) {
  if (!isOnline()) return; 
  try {
    const [businessResult, staffResult, registersResult, shiftsResult] = await Promise.all([
      supabase.from('businesses').select('*').eq('id', businessId).single(),
      supabase.from('staff').select('*').eq('business_id', businessId).eq('active', true),
      supabase.from('cash_registers').select('*').eq('business_id', businessId),
      // ✅ BAJAMOS TURNOS RECIENTES PARA NO PERDER EL ESTADO AL BORRAR CACHÉ
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
      const cleanRegisters = registersResult.data.map(r => ({ ...r, sync_status: 'synced' }));
      
      await db.cash_registers.bulkPut(cleanRegisters);
    }

    // ✅ RECUPERAR TURNO ABIERTO (Si lo había en la nube pero no en local)
    if (shiftsResult.data && shiftsResult.data.length > 0) {
        const shifts = shiftsResult.data.map(s => ({ ...s, sync_status: 'synced' }));
        
        await db.cash_shifts.bulkPut(shifts);
    }

  } catch (error) {
    console.error('⚠️ Error carga crítica:', error);
  }
}

export async function syncHeavyData(businessId: string) {
  if (!isOnline()) return; 
  try {
    console.log('⬇️ Descargando inventario y clientes...');
    const [productsResult, customersResult] = await Promise.all([
      supabase.from('products').select('*').eq('business_id', businessId),
      supabase.from('customers').select('*').eq('business_id', businessId)
    ]);

    if (productsResult.data) {
        const cleanProducts = productsResult.data.map(p => ({ ...p, sync_status: 'synced' }));
        
        await db.products.bulkPut(cleanProducts);
    }

    if (customersResult.data) {
        const cleanCustomers = customersResult.data.map(c => ({ ...c, sync_status: 'synced' }));

        await db.customers.bulkPut(cleanCustomers);
    }

  } catch (error) {
    console.error('⚠️ Error carga inventario:', error);
  }
}

export async function syncBusinessProfile(businessId: string) {
  await syncCriticalData(businessId);
  await syncHeavyData(businessId);
}