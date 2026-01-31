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

// --- GESTIÓN DE COLA (Añadir ítems) ---

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
    
    // Intentar procesar inmediatamente si hay red (sin bloquear)
    if (isOnline()) {
      processQueue();
    }
  } catch (error) {
    console.error("Error al añadir a la cola de sincronización:", error);
  }
}

// --- PROCESAMIENTO INDIVIDUAL (Lógica completa por tipo) ---

async function processItem(item: QueueItem) {
  const { type, payload } = item;

  switch (type) {
    case 'SALE': {
      const { sale, items } = payload as SalePayload;
      
      // 1. Limpieza de datos locales antes de subir
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sync_status, ...saleClean } = sale;

      // 2. Subir a Supabase usando RPC Seguro (Atomicidad: Venta + Stock)
      // Esto evita que se venda stock que no existe
      const { error } = await supabase.rpc('process_sale_transaction', {
        p_sale: saleClean,
        p_items: items || []
      });

      if (error) {
        console.error("Error RPC Venta:", error);
        throw new Error(`Fallo transacción venta ${sale.id}: ${error.message}`);
      }
      
      // 3. ✅ ACTUALIZACIÓN LOCAL INMEDIATA
      // Importante: Marcamos como 'synced' en Dexie para que el botón verde reaccione YA.
      await db.sales.update(sale.id, { sync_status: 'synced' });
      
      console.log(`✅ Venta ${sale.id} sincronizada y stock descontado.`);
      break;
    }

    case 'MOVEMENT': {
      const movement = payload as InventoryMovement;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sync_status, ...cleanMov } = movement;
      
      // 1. Subir
      const { error } = await supabase.from('inventory_movements').insert(cleanMov);
      if (error) throw new Error(`Error movimiento: ${error.message}`);

      // 2. ✅ ACTUALIZAR ESTADO LOCAL
      await db.movements.update(movement.id, { sync_status: 'synced' });
      console.log('✅ Movimiento de inventario sincronizado.');
      break;
    }

    case 'AUDIT': {
      const log = payload as AuditLog;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sync_status, ...cleanLog } = log;
      
      // 1. Subir
      const { error } = await supabase.from('audit_logs').insert(cleanLog);
      if (error) throw new Error(`Error audit: ${error.message}`);

      // 2. ✅ ACTUALIZAR ESTADO LOCAL
      await db.audit_logs.update(log.id, { sync_status: 'synced' });
      console.log('✅ Log de auditoría sincronizado.');
      break;
    }

    // --- Casos de Bajada (Sync Down) o Configuración ---

    case 'PRODUCT_SYNC': {
      const product = payload as Product;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sync_status, ...cleanProduct } = product;
      
      const { error } = await supabase.from('products').upsert(cleanProduct);
      if (error) throw new Error(`Error sincronizando producto: ${error.message}`);
      break;
    }

    case 'CUSTOMER_SYNC': {
      const customer = payload as Customer;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sync_status, ...cleanCustomer } = customer;
      
      const { error } = await supabase.from('customers').upsert(cleanCustomer);
      if (error) throw new Error(`Error sincronizando cliente: ${error.message}`);
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

      if (error) throw new Error(`Error actualizando config negocio: ${error.message}`);
      break;
    }

    default:
      throw new Error(`Tipo de acción desconocido en cola: ${type}`);
  }
}

// --- PROCESADOR DE COLA (Recursivo y Robusto) ---

export async function processQueue() {
  if (!isOnline()) return;

  // Procesamos en lotes pequeños (5) para no congelar la interfaz
  const pendingItems = await db.action_queue
    .where('status').equals('pending')
    .limit(5) 
    .toArray();

  if (pendingItems.length === 0) return;

  for (const item of pendingItems) {
    try {
      // 1. Marcar como procesando
      await db.action_queue.update(item.id, { status: 'processing' });

      // 2. Ejecutar lógica específica
      await processItem(item);

      // 3. Si éxito, eliminar de la cola
      await db.action_queue.delete(item.id); 

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const newRetries = (item.retries || 0) + 1;
      
      console.error(`❌ Fallo ítem ${item.type} (${item.id}):`, errorMessage);

      // Lógica de "Dead Letter": Si falla 5 veces, lo apartamos como FATAL
      if (newRetries >= 5) {
          console.error(`💀 Ítem ${item.id} marcado como FATAL tras 5 intentos.`);
          await db.action_queue.update(item.id, { 
              status: 'failed', 
              error: `ABANDONADO: ${errorMessage}` 
          });
      } else {
          // Reintentar luego (Backoff simple)
          await db.action_queue.update(item.id, { 
              status: 'pending', 
              retries: newRetries, 
              error: errorMessage 
          });
      }
    }
  }

  // Si quedan pendientes, seguimos procesando (recursividad)
  if ((await db.action_queue.where('status').equals('pending').count()) > 0) {
    processQueue();
  }
}

// --- ESTRATEGIA DE CARGA DE DATOS (Data Fetching) ---

// 1. Datos Críticos (Rápidos: Licencia, Staff, Cajas)
export async function syncCriticalData(businessId: string) {
  if (!isOnline()) return; 

  try {
    const [businessResult, staffResult, registersResult] = await Promise.all([
      supabase.from('businesses').select('*').eq('id', businessId).single(),
      supabase.from('staff').select('*').eq('business_id', businessId).eq('active', true),
      supabase.from('cash_registers').select('*').eq('business_id', businessId)
    ]);

    // Actualizar Negocio
    if (businessResult.data) {
      await db.settings.put({
        id: businessResult.data.id, 
        name: businessResult.data.name,
        address: businessResult.data.address,
        phone: businessResult.data.phone,
        receipt_message: businessResult.data.receipt_message,
        subscription_expires_at: businessResult.data.subscription_expires_at,
        status: businessResult.data.status, // Cast seguro
        last_check: new Date().toISOString(), 
        sync_status: 'synced'
      });
    }

    // Actualizar Staff (Limpiar y recargar para asegurar PINs correctos)
    if (staffResult.data) {
      await db.staff.clear(); 
      await db.staff.bulkPut(staffResult.data);
    }

    // Actualizar Cajas
    if (registersResult.data) {
      const cleanRegisters = registersResult.data.map(r => ({ ...r, sync_status: 'synced' }));
      
      await db.cash_registers.bulkPut(cleanRegisters);
    }

  } catch (error) {
    console.error('⚠️ Error en syncCriticalData:', error);
  }
}

// 2. Datos Pesados (Inventario y Clientes)
export async function syncHeavyData(businessId: string) {
  if (!isOnline()) return; 

  try {
    console.log('⬇️ Descargando inventario actualizado...');
    const [productsResult, customersResult] = await Promise.all([
      supabase.from('products').select('*').eq('business_id', businessId),
      supabase.from('customers').select('*').eq('business_id', businessId)
    ]);

    // Actualizar Productos
    if (productsResult.data) {
        const cleanProducts = productsResult.data.map(p => ({
            ...p,
            sync_status: 'synced' // Importante: vienen de la nube, están sincronizados
        }));
        
        await db.products.bulkPut(cleanProducts);
        console.log(`📦 ${productsResult.data.length} Productos actualizados.`);
    }

    // Actualizar Clientes
    if (customersResult.data) {
        const cleanCustomers = customersResult.data.map(c => ({
            ...c,
            sync_status: 'synced'
        }));
        
        await db.customers.bulkPut(cleanCustomers);
    }

  } catch (error) {
    console.error('⚠️ Error en syncHeavyData:', error);
  }
}

// --- FUNCIONES MAESTRAS DE SINCRONIZACIÓN ---

export async function syncPush() {
    console.log("⬆️ Iniciando subida de cambios pendientes...");
    await processQueue();
}

export async function syncPull() {
    if (!isOnline()) return;
    
    console.log("⬇️ Iniciando descarga de actualizaciones...");
    const settings = await db.settings.toArray();
    
    if (settings.length > 0) {
        const businessId = settings[0].id;
        // Descargar TODO para asegurar consistencia
        await Promise.all([
            syncCriticalData(businessId),
            syncHeavyData(businessId)
        ]);
        console.log("✨ Sincronización de bajada completada.");
    }
}

/**
 * ⚡ SYNC MANUAL FULL (La función del Botón)
 * Ejecuta una sincronización estricta SECUENCIAL:
 * 1. Sube todo lo pendiente (Push)
 * 2. Solo entonces, baja las novedades (Pull)
 * Esto evita sobrescribir datos locales con datos viejos del servidor.
 */
export async function syncManualFull() {
    if (!isOnline()) throw new Error("Sin conexión a internet");
    
    console.log("🔄 Iniciando Ciclo de Sincronización Completa...");
    
    // Paso 1: PUSH (Vital: Vaciar cola antes de bajar nada)
    await syncPush();
    
    // Paso 2: PULL (Refrescar la verdad desde el servidor)
    await syncPull();
    
    console.log("✅ Ciclo completado.");
}

// Wrapper para AuthGuard (Compatibilidad)
export async function syncBusinessProfile(businessId: string) {
  await syncCriticalData(businessId);
  await syncHeavyData(businessId);
}

// Auto-Sync en background (Solo Push para no interrumpir al usuario con descargas pesadas)
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