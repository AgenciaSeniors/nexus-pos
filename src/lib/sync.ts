import { 
  db, 
  type QueueItem,
  type QueuePayload,
  type SalePayload, 
  type Product, 
  type Customer, 
  type InventoryMovement, 
  type AuditLog, 
  type BusinessConfig 
} from './db';
import { supabase } from './supabase';

// Helper para verificar conexión
export function isOnline() {
  return navigator.onLine;
}

// Helper para añadir a la cola de sincronización
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
    console.error("Error al añadir a la cola de sincronización:", error);
  }
}

// Lógica específica para procesar cada tipo de ítem
async function processItem(item: QueueItem) {
  const { type, payload } = item;

  switch (type) {
    case 'SALE': {
      const { sale, items } = payload as SalePayload;
      
      // ✅ CORRECCIÓN: Ya no extraemos 'shift_id' manualmente. 
      // Al dejarlo en 'saleClean', se enviará a Supabase, lo cual es correcto.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sync_status, ...saleClean } = sale;
      
      // 2. Subir Cabecera de Venta
      const { error: saleError } = await supabase.from('sales').upsert(saleClean);
      if (saleError) throw new Error(`Error subiendo venta ${sale.id}: ${saleError.message}`);

      // 3. Subir Items
      if (items && items.length > 0) {
        const { error: itemsError } = await supabase.from('sale_items').upsert(items);
        if (itemsError) throw new Error(`Error subiendo items de venta ${sale.id}: ${itemsError.message}`);
      }
      break;
    }

    case 'PRODUCT_SYNC': {
      const product = payload as Product;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sync_status, ...cleanProduct } = product;
      
      const { error } = await supabase.from('products').upsert(cleanProduct);
      if (error) throw new Error(`Error sincronizando producto ${product.name}: ${error.message}`);
      break;
    }

    case 'CUSTOMER_SYNC': {
      const customer = payload as Customer;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sync_status, ...cleanCustomer } = customer;

      const { error } = await supabase.from('customers').upsert(cleanCustomer);
      if (error) throw new Error(`Error sincronizando cliente ${customer.name}: ${error.message}`);
      break;
    }

    case 'MOVEMENT': {
      const movement = payload as InventoryMovement;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sync_status, ...cleanMov } = movement;

      const { error } = await supabase.from('inventory_movements').insert(cleanMov);
      if (error) throw new Error(`Error subiendo movimiento de inventario: ${error.message}`);
      break;
    }

    case 'AUDIT': {
      const log = payload as AuditLog;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sync_status, ...cleanLog } = log;

      const { error } = await supabase.from('audit_logs').insert(cleanLog);
      if (error) throw new Error(`Error subiendo log de auditoría: ${error.message}`);
      break;
    }

    case 'SETTINGS_SYNC': {
      const config = payload as BusinessConfig;
      
      const updateData = {
        id: config.id,
        name: config.name,
        address: config.address,
        phone: config.phone,
        receipt_message: config.receipt_message
      };

      const { error } = await supabase
        .from('businesses')
        .update(updateData)
        .eq('id', config.id);

      if (error) throw new Error(`Error actualizando configuración del negocio: ${error.message}`);
      break;
    }

    default:
      throw new Error(`Tipo desconocido: ${type}`);
  }
}

// Función Maestra que procesa la cola recursivamente
export async function processQueue() {
  if (!isOnline()) return;

  const pendingItems = await db.action_queue
    .where('status').equals('pending')
    .limit(5) 
    .toArray();

  if (pendingItems.length === 0) return;

  let processedCount = 0;

  for (const item of pendingItems) {
    try {
      await db.action_queue.update(item.id, { status: 'processing' });

      await processItem(item);

      await db.action_queue.delete(item.id);
      processedCount++;

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ Fallo al sincronizar item ${item.type} (${item.id}):`, errorMessage);
      
      const newRetries = (item.retries || 0) + 1;
      
      if (newRetries >= 5) {
        await db.action_queue.update(item.id, { 
            status: 'failed', 
            error: errorMessage 
        });
      } else {
        await db.action_queue.update(item.id, { 
            status: 'pending', 
            retries: newRetries 
        });
      }
    }
  }

  if (processedCount > 0) {
    const remaining = await db.action_queue.where('status').equals('pending').count();
    if (remaining > 0) {
      processQueue();
    }
  }
}
export async function syncPush() {
    console.log("⬆️ Iniciando subida manual...");
    await processQueue();
}

export async function syncPull() {
    console.log("🔄 Iniciando sincronización manual...");
    await processQueue();
}

window.addEventListener('online', () => {
    console.log("🌐 Conexión restaurada. Procesando cola...");
    processQueue();
});

setInterval(() => {
    if (isOnline()) {
        processQueue();
    }
}, 30000);