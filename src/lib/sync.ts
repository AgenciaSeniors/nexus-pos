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
      const { error } = await supabase.rpc('process_sale_transaction', {
        p_sale: saleClean,
        p_items: items || []
      });

      if (error) {
        console.error("Error RPC Venta:", error);
        throw new Error(`Fallo transacción venta ${sale.id}: ${error.message}`);
      }
      
      // 3. ✅ ACTUALIZACIÓN LOCAL INMEDIATA
      // Marcamos la venta como 'synced' en Dexie para que la UI (botón) se actualice al instante
      await db.sales.update(sale.id, { sync_status: 'synced' });
      
      // También marcamos los items si es necesario (opcional, pero buena práctica)
      if (items && items.length > 0) {
          // Nota: Dexie sale_items puede no tener sync_status, pero si lo tuviera:
          // await db.sale_items.bulkUpdate(...) 
      }
      
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
    // Estos generalmente no tienen un registro local con status 'pending' que actualizar,
    // pero mantenemos la lógica de subida por si acaso se usan bidireccionalmente.

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

  // Procesamos en lotes pequeños para no bloquear el navegador
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
          // Reintentar luego
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

// --- FUNCIONES PÚBLICAS DE SINCRONIZACIÓN (Push & Pull) ---

export async function syncPush() {
    console.log("⬆️ Iniciando subida de cambios pendientes...");
    await processQueue();
}

// Esta función se llama al pulsar "Actualizar"
export async function syncPull() {
    if (!isOnline()) return;
    
    console.log("⬇️ Iniciando descarga de actualizaciones...");
    const settings = await db.settings.toArray();
    
    if (settings.length > 0) {
        const businessId = settings[0].id;
        
        // Ejecutamos la descarga completa para garantizar que el stock local sea real
        try {
            await Promise.all([
                syncCriticalData(businessId), // Licencia, Staff, Cajas
                syncHeavyData(businessId)     // Productos, Clientes
            ]);
            console.log("✨ Sincronización de bajada completada exitosamente.");
        } catch (error) {
            console.error("Error en syncPull:", error);
        }
    }
}

// Listeners automáticos
if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
        console.log("🌐 Conexión restaurada. Procesando cola...");
        processQueue();
    });

    // Intentar sincronizar cada 30 segundos si hay red
    setInterval(() => {
        if (isOnline()) {
            processQueue();
        }
    }, 30000);
}

// --- ESTRATEGIA DE CARGA DE DATOS (Data Fetching) ---

// 1. Datos Críticos (Rápidos)
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
        status: businessResult.data.status, // Cast seguro para tipos de Dexie
        last_check: new Date().toISOString(), 
        sync_status: 'synced'
      });
    }

    // Actualizar Staff (Sobreescribimos para asegurar PINs actualizados)
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

// 3. Función Maestra (Compatibility Wrapper)
// Esta es la que llama AuthGuard al inicio
export async function syncBusinessProfile(businessId: string) {
  // Primero lo vital
  await syncCriticalData(businessId);
  // Luego el inventario (sin await si queremos que sea background, con await si es primera carga)
  // En este contexto, AuthGuard decide si espera o no usando las funciones individuales,
  // pero mantenemos esta para compatibilidad.
  await syncHeavyData(businessId);
}