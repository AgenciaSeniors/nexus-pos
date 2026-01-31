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

// Helper para verificar conexión real
export function isOnline() {
  return typeof navigator !== 'undefined' && navigator.onLine;
}

// --- RECUPERACIÓN DE ZOMBIES ---
// Si el PC se apaga mientras subía una venta, el item queda en 'processing'.
// Esta función lo detecta al iniciar y lo devuelve a 'pending' para que no se pierda.
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
    
    // Disparo optimista: si hay red, intenta subir ya (sin bloquear UI)
    if (isOnline()) {
      processQueue();
    }
  } catch (error) {
    console.error("Error crítico al añadir a la cola de sincronización:", error);
  }
}

// --- PROCESAMIENTO ATÓMICO POR TIPO (Lógica de Negocio Completa) ---

async function processItem(item: QueueItem) {
  const { type, payload } = item;

  switch (type) {
    // CASO 1: VENTAS (La más crítica)
    // Usa RPC para garantizar que Venta y Stock ocurran juntos o no ocurran.
    case 'SALE': {
      const { sale, items } = payload as SalePayload;
      // Limpieza: quitamos campos locales que no existen en Supabase
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
      
      // ✅ ÉXITO: Actualizamos Dexie inmediatamente para que el botón se ponga verde
      await db.sales.update(sale.id, { sync_status: 'synced' });
      console.log(`✅ Venta ${sale.id} sincronizada.`);
      break;
    }

    // CASO 2: MOVIMIENTOS DE INVENTARIO (Entradas/Salidas manuales)
    case 'MOVEMENT': {
      const movement = payload as InventoryMovement;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sync_status, ...cleanMov } = movement;
      
      const { error } = await supabase.from('inventory_movements').insert(cleanMov);
      if (error) throw new Error(`Error subiendo movimiento: ${error.message}`);

      // Actualizar estado local
      if (db.movements) await db.movements.update(movement.id, { sync_status: 'synced' });
      console.log('✅ Movimiento sincronizado.');
      break;
    }

    // CASO 3: AUDITORÍA (Logs de seguridad)
    case 'AUDIT': {
      const log = payload as AuditLog;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sync_status, ...cleanLog } = log;
      
      const { error } = await supabase.from('audit_logs').insert(cleanLog);
      if (error) throw new Error(`Error subiendo audit: ${error.message}`);

      // Actualizar estado local
      await db.audit_logs.update(log.id, { sync_status: 'synced' });
      console.log('✅ Auditoría sincronizada.');
      break;
    }

    // CASO 4: PRODUCTOS (Subida desde el POS - Admin)
    case 'PRODUCT_SYNC': {
      const product = payload as Product;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sync_status, ...cleanProduct } = product;
      
      const { error } = await supabase.from('products').upsert(cleanProduct);
      if (error) throw new Error(`Error sync producto: ${error.message}`);
      break;
    }

    // CASO 5: CLIENTES
    case 'CUSTOMER_SYNC': {
      const customer = payload as Customer;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sync_status, ...cleanCustomer } = customer;
      
      const { error } = await supabase.from('customers').upsert(cleanCustomer);
      if (error) throw new Error(`Error sync cliente: ${error.message}`);
      break;
    }

    // CASO 6: CONFIGURACIÓN (Settings)
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

    default:
      throw new Error(`Tipo de acción desconocido en cola: ${type}`);
  }
}

// --- MOTOR DE PROCESAMIENTO (Recursivo y Resiliente) ---

export async function processQueue() {
  if (!isOnline()) return;

  // Procesamos en lotes de 5 para no saturar la red, pero mantenemos el orden
  const pendingItems = await db.action_queue
    .where('status').equals('pending')
    .limit(5) 
    .toArray();

  if (pendingItems.length === 0) return;

  for (const item of pendingItems) {
    try {
      // 1. Marcar como procesando (Bloqueo para no procesar doble)
      await db.action_queue.update(item.id, { status: 'processing' });
      
      // 2. Ejecutar la lógica específica definida arriba
      await processItem(item);
      
      // 3. Éxito: Eliminar de la cola de pendientes
      await db.action_queue.delete(item.id); 

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const newRetries = (item.retries || 0) + 1;
      
      console.error(`❌ Fallo ítem ${item.type} (${item.id}):`, errorMessage);

      // ESTRATEGIA "DEAD LETTER":
      // Si falla 5 veces consecutivas (ej. datos corruptos), lo apartamos
      // a estado 'failed' (antes fatal_error) para que NO bloquee el resto de ventas.
      if (newRetries >= 5) {
          console.error(`💀 Ítem ${item.id} marcado como FATAL.`);
          await db.action_queue.update(item.id, { 
              status: 'failed', 
              error: `ABANDONADO tras 5 intentos: ${errorMessage}` 
          });
      } else {
          // Reintentar más tarde (Backoff implícito)
          await db.action_queue.update(item.id, { 
              status: 'pending', 
              retries: newRetries, 
              error: errorMessage 
          });
      }
    }
  }

  // RECURSIVIDAD CONTROLADA:
  // Si quedan ítems pendientes, se llama a sí misma para seguir procesando.
  // IMPORTANTE: Usamos 'await' para que la función padre (syncManualFull) sepa cuándo terminamos de verdad.
  if ((await db.action_queue.where('status').equals('pending').count()) > 0) {
    await processQueue(); 
  }
}

// --- FUNCIONES DE SINCRONIZACIÓN PÚBLICAS ---

export async function syncPush() {
    console.log("⬆️ Iniciando Push (Subida de datos)...");
    await resetProcessingItems(); // Limpieza defensiva de zombies
    await processQueue();
}

export async function syncPull() {
    if (!isOnline()) return;
    
    console.log("⬇️ Iniciando Pull (Descarga de datos)...");
    const settings = await db.settings.toArray();
    
    if (settings.length > 0) {
        const businessId = settings[0].id;
        
        // Descargamos TODO en paralelo para máxima velocidad
        await Promise.all([
            syncCriticalData(businessId), // Staff, Licencia
            syncHeavyData(businessId)     // Productos, Clientes
        ]);
        console.log("✨ Pull completado.");
    }
}

/**
 * 🔥 SYNC MANUAL FULL (La función del Botón)
 * Lógica: SECUENCIAL ESTRICTA
 * 1. Primero SUBE todo lo pendiente (Push).
 * 2. Solo si termina de subir, BAJA las novedades (Pull).
 * Esto evita sobrescribir tu stock local con datos viejos del servidor.
 */
export async function syncManualFull() {
    if (!isOnline()) throw new Error("Sin conexión a internet");
    
    console.log("🔄 Iniciando Ciclo de Sincronización Completa...");
    
    // 1. SUBIR
    await syncPush();
    
    // 2. BAJAR
    await syncPull();
    
    console.log("✅ Ciclo de Sincronización Finalizado.");
}

// --- LISTENERS AUTOMÁTICOS ---
if (typeof window !== 'undefined') {
    // Al volver la conexión, intentar subir cola
    window.addEventListener('online', () => {
        console.log("🌐 Conexión detectada. Reanudando cola...");
        resetProcessingItems().then(() => processQueue());
    });
    
    // Al cargar la app, limpiar zombies
    resetProcessingItems();

    // Cronjob de fondo (cada 30s intenta subir si hay red)
    setInterval(() => { if (isOnline()) processQueue(); }, 30000);
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

    // Negocio
    if (businessResult.data) {
      await db.settings.put({
        id: businessResult.data.id, 
        name: businessResult.data.name,
        address: businessResult.data.address,
        phone: businessResult.data.phone,
        receipt_message: businessResult.data.receipt_message,
        subscription_expires_at: businessResult.data.subscription_expires_at,
        // CORRECCIÓN: Tipo explícito en lugar de any
        status: businessResult.data.status as 'active' | 'suspended' | 'pending', 
        last_check: new Date().toISOString(), 
        sync_status: 'synced'
      });
    }

    // Staff
    if (staffResult.data) {
      await db.staff.clear(); 
      await db.staff.bulkPut(staffResult.data);
    }

    // Cajas
    if (registersResult.data) {
      const cleanRegisters = registersResult.data.map(r => ({ ...r, sync_status: 'synced' }));
      await db.cash_registers.bulkPut(cleanRegisters);
    }

  } catch (error) {
    console.error('⚠️ Error carga crítica:', error);
  }
}

// 2. Datos Pesados (Inventario y Clientes)
export async function syncHeavyData(businessId: string) {
  if (!isOnline()) return; 
  try {
    console.log('⬇️ Descargando inventario y clientes...');
    const [productsResult, customersResult] = await Promise.all([
      supabase.from('products').select('*').eq('business_id', businessId),
      supabase.from('customers').select('*').eq('business_id', businessId)
    ]);

    // Productos
    if (productsResult.data) {
        const cleanProducts = productsResult.data.map(p => ({ ...p, sync_status: 'synced' }));
        
        await db.products.bulkPut(cleanProducts);
    }

    // Clientes
    if (customersResult.data) {
        const cleanCustomers = customersResult.data.map(c => ({ ...c, sync_status: 'synced' }));
        
        await db.customers.bulkPut(cleanCustomers);
    }

  } catch (error) {
    console.error('⚠️ Error carga inventario:', error);
  }
}

// Wrapper para compatibilidad con AuthGuard
export async function syncBusinessProfile(businessId: string) {
  await syncCriticalData(businessId);
  await syncHeavyData(businessId);
}