import { 
  db, 
  type QueueItem, 
  type QueuePayload, // Asegúrate de que esto esté exportado en db.ts
  type SalePayload, 
  type InventoryMovement, 
  type AuditLog, 
  type Product, 
  type Customer 
} from './db';
import { supabase } from './supabase';

// Helper para verificar conexión
const isOnline = () => navigator.onLine;

// ============================================================================
// 1. ENCOLADOR (El Frontend llama a esto para guardar acciones pendientes)
// ============================================================================
// ✅ CORRECCIÓN: Usamos QueuePayload en lugar de 'any'
export async function addToQueue(type: QueueItem['type'], payload: QueuePayload) {
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
}

// ============================================================================
// 2. PROCESADOR DE COLA (Worker: Sube los datos uno por uno)
// ============================================================================
export async function processQueue() {
  if (!isOnline()) return;

  const pendingItems = await db.action_queue
    .where('status').equals('pending')
    .sortBy('timestamp');

  if (pendingItems.length === 0) return;

  for (const item of pendingItems) {
    try {
      await db.action_queue.update(item.id, { status: 'processing' });

      let entityId = ''; 

      switch (item.type) {
        
        // --- CASO A: NUEVA VENTA ---
        case 'SALE': { // ✅ CORRECCIÓN: Llaves agregadas para scope local
          const saleData = item.payload as SalePayload;
          entityId = saleData.sale.id;

          const { error: saleErr } = await supabase.from('sales').upsert(saleData.sale);
          if (saleErr) throw new Error(`Error subiendo venta: ${saleErr.message}`);
          
          if (saleData.items && saleData.items.length > 0) {
             const { error: itemsErr } = await supabase.from('sale_items').insert(saleData.items);
             if (itemsErr) throw new Error(`Error subiendo items: ${itemsErr.message}`);
          }
          break;
        }

        // --- CASO B: MOVIMIENTO DE INVENTARIO ---
        case 'MOVEMENT': {
          const movData = item.payload as InventoryMovement;
          entityId = movData.id;
          
          const { error: movErr } = await supabase.from('inventory_movements').insert(movData);
          if (movErr) throw new Error(`Error subiendo movimiento: ${movErr.message}`);
          break;
        }

        // --- CASO C: LOG DE AUDITORÍA ---
        case 'AUDIT': {
          const auditData = item.payload as AuditLog;
          entityId = auditData.id;

          const { error: auditErr } = await supabase.from('audit_logs').insert(auditData);
          if (auditErr) throw new Error(`Error subiendo audit log: ${auditErr.message}`);
          break;
        }

        // --- CASO D: PRODUCTO ---
        case 'PRODUCT_SYNC': {
           const prodData = item.payload as Product;
           entityId = prodData.id;

           const { error: prodErr } = await supabase.from('products').upsert(prodData);
           if (prodErr) throw new Error(`Error subiendo producto: ${prodErr.message}`);
           break;
        }
           
        // --- CASO E: CLIENTE ---
        case 'CUSTOMER_SYNC': {
           const custData = item.payload as Customer;
           entityId = custData.id;

           const { error: custErr } = await supabase.from('customers').upsert(custData);
           if (custErr) throw new Error(`Error subiendo cliente: ${custErr.message}`);
           break;
        }
      }

      // === ÉXITO ===
      await db.action_queue.delete(item.id);
      
      if (entityId) {
          await updateLocalEntityStatus(item.type, entityId);
      }

    } catch (err: unknown) { // ✅ CORRECCIÓN: 'unknown' en lugar de 'any'
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`Error procesando item de cola [${item.type}]:`, errorMessage);
      
      if (item.retries < 5) {
        await db.action_queue.update(item.id, { 
            status: 'pending', 
            retries: item.retries + 1, 
            error: errorMessage 
        });
      } else {
        await db.action_queue.update(item.id, { 
            status: 'failed', 
            error: 'Max retries reached: ' + errorMessage
        });
      }
    }
  }
}

// ============================================================================
// 3. ACTUALIZADOR DE ESTADO LOCAL
// ============================================================================
async function updateLocalEntityStatus(type: QueueItem['type'], id: string) {
    if (!id) return;
    try {
        switch (type) {
            case 'SALE':
                await db.sales.update(id, { sync_status: 'synced' });
                break;
            case 'MOVEMENT':
                await db.movements.update(id, { sync_status: 'synced' });
                break;
            case 'AUDIT':
                await db.audit_logs.update(id, { sync_status: 'synced' });
                break;
            case 'PRODUCT_SYNC':
                await db.products.update(id, { sync_status: 'synced' });
                break;
            case 'CUSTOMER_SYNC':
                await db.customers.update(id, { sync_status: 'synced' });
                break;
        }
    } catch (e) {
        console.warn(`No se pudo actualizar el estado local para ${type} ID: ${id}`, e);
    }
}

// ============================================================================
// 4. PULL: BAJADA DE DATOS
// ============================================================================
export async function syncPull() {
    if (!isOnline()) return;
    
    const businessId = localStorage.getItem('nexus_business_id');
    if (!businessId) return;

    try {
        const { data: remoteProducts } = await supabase
            .from('products')
            .select('*')
            .eq('business_id', businessId);
        
        if (remoteProducts) {
            await db.transaction('rw', db.products, async () => {
                for (const p of remoteProducts) {
                    const local = await db.products.get(p.id);
                    if (!local || local.sync_status === 'synced') {
                        await db.products.put({ ...p, sync_status: 'synced' } as Product);
                    }
                }
            });
        }

        const { data: remoteCustomers } = await supabase
            .from('customers')
            .select('*')
            .eq('business_id', businessId);

        if (remoteCustomers) {
             await db.transaction('rw', db.customers, async () => {
                for (const c of remoteCustomers) {
                    const local = await db.customers.get(c.id);
                    if (!local || local.sync_status === 'synced') {
                        await db.customers.put({ ...c, sync_status: 'synced' } as Customer);
                    }
                }
             });
        }
    } catch (error) {
        console.error("Error en syncPull:", error);
    }
}

export async function syncPush() {
    await processQueue();
}