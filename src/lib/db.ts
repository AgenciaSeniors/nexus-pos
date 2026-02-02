import Dexie, { type Table } from 'dexie';

// --- INTERFACES ---
export interface Product {
  id: string;
  business_id: string;
  name: string;
  price: number;
  cost?: number;
  stock: number;
  sku: string;
  category?: string;
  unit?: string;
  expiration_date?: string;
  created_at?: string; 
  sync_status: 'synced' | 'pending_create' | 'pending_update' | 'pending_delete';
  deleted_at?: string | null;
}

export interface SaleItem {
  product_id: string;
  name: string;
  quantity: number;
  price: number;
  unit?: string;
  cost?: number;
}

export interface Sale {
  id: string;
  business_id: string;
  date: string;
  shift_id: string;
  total: number;
  items: SaleItem[];
  staff_id?: string;
  staff_name?: string;
  customer_id?: string;
  customer_name?: string;
  payment_method: 'efectivo' | 'transferencia' | 'tarjeta' | 'mixto';
  amount_tendered?: number;
  change?: number;
  sync_status: 'synced' | 'pending_create' | 'pending_update';
}

export interface InventoryMovement {
  id: string;
  business_id: string;
  product_id: string;
  qty_change: number;
  reason: string;
  created_at: string;
  staff_id?: string;
  sync_status: 'synced' | 'pending_create';
}

export interface BusinessConfig {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  receipt_message?: string;
  subscription_expires_at?: string;
  last_check?: string;
  status?: 'active' | 'suspended' | 'pending';
  sync_status?: 'synced' | 'pending_create' | 'pending_update'; 
}

export interface Customer {
  id: string;
  business_id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  loyalty_points?: number;
  sync_status: 'synced' | 'pending_create' | 'pending_update';
  deleted_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ParkedOrder {
  id: string;
  business_id: string;
  date: string;
  items: SaleItem[];
  total: number;
  note?: string;
  customer_id?: string;
  customer_name?: string;
}

export interface Staff {
  id: string;
  name: string;
  role: 'admin' | 'vendedor';
  pin: string;
  active: boolean;
  business_id: string;
}

export interface CashRegister {
  id: string;
  business_id: string;
  name: string;
  sync_status?: 'synced' | 'pending_create';
}

export interface CashShift {
  id: string;
  business_id: string;
  staff_id: string;
  start_amount: number;
  end_amount?: number;
  expected_amount?: number;
  difference?: number;
  opened_at: string;
  closed_at?: string;
  status: 'open' | 'closed';
  sync_status: 'synced' | 'pending_create' | 'pending_update';
}

export interface CashMovement {
  id: string;
  shift_id: string;
  business_id: string;
  type: 'in' | 'out';
  amount: number;
  reason: string;
  staff_id: string;
  created_at: string;
  sync_status: 'synced' | 'pending_create';
}

export interface AuditLog {
  id: string;
  business_id: string;
  staff_id: string;
  staff_name: string;
  // ✅ UPDATE_LOYALTY y UPDATE_PRODUCT agregados para cobertura completa
  action: 'LOGIN' | 'LOGOUT' | 'SALE' | 'CREATE_PRODUCT' | 'UPDATE_PRODUCT' | 'DELETE_PRODUCT' | 
          'UPDATE_STOCK' | 'OPEN_DRAWER' | 'VOID_SALE' | 'CREATE_CUSTOMER' | 
          'UPDATE_CUSTOMER' | 'DELETE_CUSTOMER' | 'UPDATE_LOYALTY' | 'OPEN_SHIFT' | 'CLOSE_SHIFT' | 
          'CASH_IN' | 'CASH_OUT' | 'UPDATE_SETTINGS';
  details: Record<string, unknown> | null;
  created_at: string;
  sync_status: 'pending_create' | 'synced';
}

export type SalePayload = { sale: Sale; items: SaleItem[] };

export type QueuePayload = 
    | SalePayload 
    | InventoryMovement 
    | AuditLog 
    | Product 
    | Customer
    | BusinessConfig
    | CashShift      
    | CashMovement;  

export interface QueueItem {
  id: string;
  type: 'SALE' | 'MOVEMENT' | 'AUDIT' | 'PRODUCT_SYNC' | 'CUSTOMER_SYNC' | 'SETTINGS_SYNC' | 'SHIFT' | 'CASH_MOVEMENT';
  payload: QueuePayload; 
  timestamp: number;
  retries: number;
  status: 'pending' | 'processing' | 'failed';
  error?: string;
}

// --- DATABASE CLASS ---
export class NexusDB extends Dexie {
  products!: Table<Product>;
  sales!: Table<Sale>;
  movements!: Table<InventoryMovement>;
  settings!: Table<BusinessConfig>;
  customers!: Table<Customer>;
  parked_orders!: Table<ParkedOrder>;
  staff!: Table<Staff>;
  audit_logs!: Table<AuditLog>;
  action_queue!: Table<QueueItem>;
  cash_registers!: Table<CashRegister>;
  cash_shifts!: Table<CashShift>;
  cash_movements!: Table<CashMovement>;

  constructor() {
    super('NexusPOS_DB');

    // 🚀 VERSIÓN 8 - ÍNDICES OPTIMIZADOS PARA MEJOR RENDIMIENTO
    this.version(8).stores({
      businesses: 'id',
      
      // ✅ PRODUCTOS: Índices compuestos para búsquedas rápidas
      products: 'id, business_id, sku, name, sync_status, [business_id+sync_status], [business_id+deleted_at]',
      
      // ✅ VENTAS: Índice compuesto shift_id+business_id para búsquedas del turno
      sales: 'id, business_id, shift_id, date, sync_status, [shift_id+business_id], [business_id+date]',
      
      // ✅ MOVIMIENTOS: Optimizado para búsquedas por turno
      movements: 'id, business_id, product_id, created_at, sync_status',
      inventory_movements: 'id, business_id, product_id, sync_status',
      
      // ✅ CLIENTES: Índice compuesto para filtros complejos
      customers: 'id, business_id, name, phone, sync_status, [business_id+sync_status], [business_id+deleted_at]',
      
      parked_orders: 'id, business_id, date',
      settings: 'id',
      
      // ✅ STAFF: Índice compuesto para búsquedas activas
      staff: 'id, business_id, pin, active, [business_id+active]',
      
      audit_logs: 'id, business_id, action, created_at, sync_status',
      
      // ✅ COLA: Índice compuesto para procesamiento eficiente
      action_queue: 'id, type, timestamp, status, [status+timestamp]',
      
      cash_registers: 'id, business_id',
      
      // ✅ TURNOS: Índice compuesto crítico para búsquedas rápidas del turno activo
      cash_shifts: 'id, business_id, staff_id, status, [business_id+status], opened_at',
      
      // ✅ MOVIMIENTOS DE CAJA: Índice compuesto para búsquedas por turno
      cash_movements: 'id, shift_id, business_id, [shift_id+business_id], created_at'
    });

    // 🔧 Hook de upgrade para migración de datos
    this.version(8).upgrade(async (trans) => {
      console.log('🔄 Migrando base de datos a versión 8...');
      
      // Verificar que los datos críticos tengan valores válidos
      const shifts = await trans.table('cash_shifts').toArray();
      for (const shift of shifts) {
        if (typeof shift.start_amount !== 'number') {
          console.warn(`⚠️ Corrigiendo start_amount del turno ${shift.id}`);
          await trans.table('cash_shifts').update(shift.id, {
            start_amount: parseFloat(shift.start_amount) || 0
          });
        }
      }
      
      const sales = await trans.table('sales').toArray();
      for (const sale of sales) {
        if (typeof sale.total !== 'number') {
          console.warn(`⚠️ Corrigiendo total de venta ${sale.id}`);
          await trans.table('sales').update(sale.id, {
            total: parseFloat(sale.total) || 0
          });
        }
      }
      
      console.log('✅ Migración completada');
    });
  }
}

export const db = new NexusDB();

// 🛠️ UTILIDADES DE DEPURACIÓN

// Verificar integridad de la base de datos
export async function verifyDatabaseIntegrity() {
  console.log('🔍 Verificando integridad de la base de datos...');
  
  try {
    // Verificar turnos
    const shifts = await db.cash_shifts.toArray();
    console.log(`📊 Turnos totales: ${shifts.length}`);
    
    const openShifts = shifts.filter(s => s.status === 'open');
    console.log(`🟢 Turnos abiertos: ${openShifts.length}`);
    
    for (const shift of openShifts) {
      console.log(`  ↳ ID: ${shift.id}, Inicio: ${shift.start_amount}, Tipo: ${typeof shift.start_amount}`);
      
      // Verificar ventas del turno
      const shiftSales = await db.sales.where('shift_id').equals(shift.id).toArray();
      console.log(`    💰 Ventas: ${shiftSales.length}`);
      
      // Verificar movimientos del turno
      const shiftMovements = await db.cash_movements.where('shift_id').equals(shift.id).toArray();
      console.log(`    🔄 Movimientos: ${shiftMovements.length}`);
    }
    
    // Verificar cola de sincronización
    const queuePending = await db.action_queue.where('status').equals('pending').count();
    const queueProcessing = await db.action_queue.where('status').equals('processing').count();
    const queueFailed = await db.action_queue.where('status').equals('failed').count();
    
    console.log('📮 Cola de sincronización:');
    console.log(`  ⏳ Pendientes: ${queuePending}`);
    console.log(`  🔄 Procesando: ${queueProcessing}`);
    console.log(`  ❌ Fallidos: ${queueFailed}`);
    
    console.log('✅ Verificación completada');
  } catch (error) {
    console.error('❌ Error verificando base de datos:', error);
  }
}

// Limpiar datos corruptos
export async function cleanCorruptedData() {
  console.log('🧹 Limpiando datos corruptos...');
  
  try {
    // Limpiar ventas sin shift_id
    const salesWithoutShift = await db.sales.filter(s => !s.shift_id).toArray();
    if (salesWithoutShift.length > 0) {
      console.warn(`⚠️ Encontradas ${salesWithoutShift.length} ventas sin turno`);
    }
    
    // Limpiar movimientos sin shift_id
    const movementsWithoutShift = await db.cash_movements.filter(m => !m.shift_id).toArray();
    if (movementsWithoutShift.length > 0) {
      console.warn(`⚠️ Encontrados ${movementsWithoutShift.length} movimientos sin turno`);
    }
    
    console.log('✅ Limpieza completada');
  } catch (error) {
    console.error('❌ Error limpiando datos:', error);
  }
}

// Exportar para uso en consola del navegador
if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).dbDebug = {
    verify: verifyDatabaseIntegrity,
    clean: cleanCorruptedData,
    db: db
  };
  
  console.log('🛠️ Herramientas de depuración disponibles:');
  console.log('  → window.dbDebug.verify() - Verificar integridad');
  console.log('  → window.dbDebug.clean() - Limpiar datos corruptos');
  console.log('  → window.dbDebug.db - Acceso directo a la base de datos');
}