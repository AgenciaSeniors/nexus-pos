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
  return typeof navigator !== 'undefined' && navigator.onLine;
}

// --- GESTIÓN DE COLA (Lógica Original Intacta) ---

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

// Procesamiento detallado ítem por ítem (Sin simplificar)
async function processItem(item: QueueItem) {
  const { type, payload } = item;

  switch (type) {
    case 'SALE': {
      const { sale, items } = payload as SalePayload;
      
      // Limpieza de campos locales antes de subir a la nube
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sync_status, ...saleClean } = sale;
      
      // 1. Subir Cabecera de Venta
      const { error: saleError } = await supabase.from('sales').upsert(saleClean);
      if (saleError) throw new Error(`Error subiendo venta ${sale.id}: ${saleError.message}`);

      // 2. Subir Items de la venta
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
      throw new Error(`Tipo de acción desconocido: ${type}`);
  }
}

// Procesador recursivo de la cola
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

if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
        console.log("🌐 Conexión restaurada. Procesando cola...");
        processQueue();
    });

    setInterval(() => {
        if (isOnline()) {
            processQueue();
        }
    }, 30000);
}

// =========================================================
// ESTRATEGIA DE CARGA INTELIGENTE
// =========================================================

// 1. DATOS CRÍTICOS (Rápidos y Ligeros)
// Necesarios para validar acceso y abrir caja.
export async function syncCriticalData(businessId: string) {
  if (!isOnline()) return; 

  try {
    console.log('⚡ Sincronizando datos críticos (Perfil, Staff, Cajas)...');
    
    const [businessResult, staffResult, registersResult] = await Promise.all([
      supabase.from('businesses').select('id, name, address, phone, receipt_message, subscription_expires_at, status').eq('id', businessId).single(),
      supabase.from('staff').select('*').eq('business_id', businessId).eq('active', true),
      supabase.from('cash_registers').select('*').eq('business_id', businessId)
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

    if (staffResult.data && staffResult.data.length > 0) {
      await db.staff.clear(); // Limpiamos para evitar empleados viejos
      await db.staff.bulkPut(staffResult.data);
      console.log(`✅ ${staffResult.data.length} Empleados actualizados.`);
    }

    if (registersResult.data && registersResult.data.length > 0) {
        const cleanRegisters = registersResult.data.map(r => ({
            ...r,
            sync_status: 'synced'
        }));
        await db.cash_registers.bulkPut(cleanRegisters);
    }

  } catch (error) {
    console.error('⚠️ Error en carga crítica (Continuando con datos locales):', error);
  }
}

// 2. DATOS PESADOS (Lentos)
// Inventario y Clientes. Se ejecutan en segundo plano si ya hay datos.
export async function syncHeavyData(businessId: string) {
  if (!isOnline()) return; 

  try {
    console.log('📦 Iniciando descarga masiva de inventario y clientes...');
    
    const [productsResult, customersResult] = await Promise.all([
      supabase.from('products').select('*').eq('business_id', businessId),
      supabase.from('customers').select('*').eq('business_id', businessId)
    ]);

    if (productsResult.data && productsResult.data.length > 0) {
        const cleanProducts = productsResult.data.map(p => ({
            ...p,
            sync_status: 'synced' // Marcamos como sincronizados
        }));
        
        await db.products.bulkPut(cleanProducts);
        console.log(`✅ ${productsResult.data.length} Productos sincronizados.`);
    }

    if (customersResult.data && customersResult.data.length > 0) {
        const cleanCustomers = customersResult.data.map(c => ({
            ...c,
            sync_status: 'synced'
        }));
        
        await db.customers.bulkPut(cleanCustomers);
        console.log(`✅ ${customersResult.data.length} Clientes sincronizados.`);
    }

  } catch (error) {
    console.error('⚠️ Error en descarga de inventario:', error);
  }
}

// 3. ✅ FUNCIÓN UNIFICADA (Para compatibilidad con App.tsx)
// Esta función es vital para que tu Login no dé error de "export missing".
export async function syncBusinessProfile(businessId: string) {
  // Primero aseguramos lo crítico (Licencia y PINs)
  await syncCriticalData(businessId);
  
  // Luego disparamos la carga de productos
  // NOTA: No usamos 'await' aquí para que el Login manual también sea rápido
  syncHeavyData(businessId);
}