import { 
  db, 
  type QueueItem, 
  type QueuePayload, 
  type SalePayload, 
  type InventoryMovement, 
  type AuditLog, 
  type Product, 
  type Customer,
} from './db';

import { supabase } from './supabase';

const isOnline = () => navigator.onLine;

// ============================================================================
// 1. ENCOLADOR (Producer)
// ============================================================================
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
// 2. PROCESADOR DE COLA (Consumer)
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
        case 'SALE': {
          const saleData = item.payload as SalePayload;
          entityId = saleData.sale.id;

          // 🧹 LIMPIEZA: Quitamos 'items' y 'sync_status'
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { items, sync_status, ...saleClean } = saleData.sale;

          const { error: saleErr } = await supabase.from('sales').upsert(saleClean);
          if (saleErr) throw new Error(`Error subiendo venta: ${saleErr.message}`);
          
          if (saleData.items && saleData.items.length > 0) {
             const { error: itemsErr } = await supabase.from('sale_items').insert(saleData.items);
             if (itemsErr) throw new Error(`Error subiendo items: ${itemsErr.message}`);

             // Stock atómico
             for (const saleItem of saleData.items) {
               if (saleItem.product_id) {
                 const { error: stockErr } = await supabase.rpc('decrease_stock', {
                   p_product_id: saleItem.product_id,
                   p_qty: saleItem.quantity
                 });
                 if (stockErr) console.error(`⚠️ Error stock:`, stockErr);
               }
             }
          }
          break;
        }

        // --- CASO B: MOVIMIENTO ---
        case 'MOVEMENT': {
          const movData = item.payload as InventoryMovement;
          entityId = movData.id;
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { sync_status, ...movClean } = movData;
          const { error: movErr } = await supabase.from('inventory_movements').insert(movClean);
          if (movErr) throw new Error(`Error subiendo movimiento: ${movErr.message}`);
          break;
        }

        // --- CASO C: AUDIT ---
        case 'AUDIT': {
          const auditData = item.payload as AuditLog;
          entityId = auditData.id;
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { sync_status, staff_name, ...auditClean } = auditData;
          const { error: auditErr } = await supabase.from('audit_logs').insert(auditClean);
          if (auditErr) throw new Error(`Error subiendo audit: ${auditErr.message}`);
          break;
        }

        // --- CASO D: PRODUCTO ---
        case 'PRODUCT_SYNC': {
           const prodData = item.payload as Product;
           entityId = prodData.id;
           // eslint-disable-next-line @typescript-eslint/no-unused-vars
           const { sync_status, ...prodClean } = prodData;
           const { error: prodErr } = await supabase.from('products').upsert(prodClean);
           if (prodErr) throw new Error(`Error subiendo producto: ${prodErr.message}`);
           break;
        }
           
        // --- CASO E: CLIENTE ---
        case 'CUSTOMER_SYNC': {
           const custData = item.payload as Customer;
           entityId = custData.id;
           // eslint-disable-next-line @typescript-eslint/no-unused-vars
           const { sync_status, ...custClean } = custData;
           const { error: custErr } = await supabase.from('customers').upsert(custClean);
           if (custErr) throw new Error(`Error subiendo cliente: ${custErr.message}`);
           break;
        }
        
      }

      await db.action_queue.delete(item.id);
      if (entityId) await updateLocalEntityStatus(item.type, entityId);

    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`Error en cola [${item.type}]:`, errorMessage);
      
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

async function updateLocalEntityStatus(type: QueueItem['type'], id: string) {
    if (!id) return;
    try {
        switch (type) {
            case 'SALE': await db.sales.update(id, { sync_status: 'synced' }); break;
            case 'MOVEMENT': await db.movements.update(id, { sync_status: 'synced' }); break;
            case 'AUDIT': await db.audit_logs.update(id, { sync_status: 'synced' }); break;
            case 'PRODUCT_SYNC': await db.products.update(id, { sync_status: 'synced' }); break;
            case 'CUSTOMER_SYNC': await db.customers.update(id, { sync_status: 'synced' }); break;
        }
    } catch (e) { console.warn("Update status error", e); }
}

// ============================================================================
// 4. PULL: BAJADA DE DATOS (AQUÍ ESTÁ LA MAGIA DEL NEGOCIO)
// ============================================================================
export async function syncPull() {
    if (!isOnline()) return;
    
    const businessId = localStorage.getItem('nexus_business_id');
    if (!businessId) return;

    try {
        // ✅ 1. DATOS DEL NEGOCIO (Nuevo)
        const { data: businessData } = await supabase
            .from('businesses')
            .select('*')
            .eq('id', businessId)
            .single();
        
        if (businessData) {
            // Guardamos en la tabla 'settings' que ya existe en db.ts
            await db.transaction('rw', db.settings, async () => {
                await db.settings.put({ 
                    id: businessData.id, // Usamos el ID real UUID
                    name: businessData.name,
                    address: businessData.address,
                    phone: businessData.phone,
                    receipt_message: businessData.receipt_message
                });
            });
            console.log("🏢 Datos del negocio actualizados localmente");
        }

        // ✅ 2. PRODUCTOS
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

        // ✅ 3. CLIENTES
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