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
  low_stock_threshold?: number;
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
  note?: string;
  custom_price?: number;
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
  status?: 'completed' | 'voided' | 'stock_conflict';
  // Descuento
  discount_amount?: number;
  discount_type?: 'percentage' | 'fixed';
  discount_input?: number;
  // Pago mixto (efectivo + transferencia)
  cash_amount?: number;
  transfer_amount?: number;
  // Puntos canjeados
  redeemed_points?: number;
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
  master_pin?: string; // ✅ PIN MAESTRO AÑADIDO
  subscription_expires_at?: string;
  last_check?: string;
  status?: 'active' | 'suspended' | 'pending' | 'trial';
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
  sync_status?: 'synced' | 'pending_create' | 'pending_update';
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
  transfer_expected?: number;
  transfer_count?: number;
  transfer_difference?: number;
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
  action: 'LOGIN' | 'LOGOUT' | 'SALE' | 'CREATE_PRODUCT' | 'UPDATE_PRODUCT' | 'DELETE_PRODUCT' | 
          'UPDATE_STOCK' | 'OPEN_DRAWER' | 'VOID_SALE' | 'CREATE_CUSTOMER' | 
          'UPDATE_CUSTOMER' | 'DELETE_CUSTOMER' | 'UPDATE_LOYALTY' | 'OPEN_SHIFT' | 'CLOSE_SHIFT' | 
          'CASH_IN' | 'CASH_OUT' | 'UPDATE_SETTINGS';
  details: Record<string, unknown> | null;
  created_at: string;
  sync_status: 'pending_create' | 'synced';
}

export type SalePayload = { sale: Sale; items: SaleItem[] };
export type VoidSalePayload = { saleId: string }; // ✅ PAYLOAD PARA ANULAR VENTA

export type QueuePayload = 
    | SalePayload 
    | InventoryMovement 
    | AuditLog 
    | Product 
    | Customer
    | BusinessConfig
    | CashShift      
    | CashMovement
    | Staff
    | VoidSalePayload;

export interface QueueItem {
  id: string;
  type: 'SALE' | 'MOVEMENT' | 'AUDIT' | 'PRODUCT_SYNC' | 'CUSTOMER_SYNC' | 'SETTINGS_SYNC' | 'SHIFT' | 'CASH_MOVEMENT' | 'STAFF_SYNC' | 'VOID_SALE';
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

    this.version(9).stores({
      businesses: 'id',
      products: 'id, business_id, sku, name, sync_status, [business_id+sync_status], [business_id+deleted_at]',
      sales: 'id, business_id, shift_id, date, sync_status, [shift_id+business_id], [business_id+date]',
      movements: 'id, business_id, product_id, created_at, sync_status',
      inventory_movements: 'id, business_id, product_id, sync_status',
      customers: 'id, business_id, name, phone, sync_status, [business_id+sync_status], [business_id+deleted_at]',
      parked_orders: 'id, business_id, date',
      settings: 'id',
      staff: 'id, business_id, pin, active, [business_id+active]',
      audit_logs: 'id, business_id, action, created_at, sync_status',
      action_queue: 'id, type, timestamp, status, [status+timestamp]',
      cash_registers: 'id, business_id',
      cash_shifts: 'id, business_id, staff_id, status, [business_id+status], opened_at',
      cash_movements: 'id, shift_id, business_id, [shift_id+business_id], created_at'
    });

    this.version(9).upgrade(async (trans) => {
      console.log('🔄 Migrando base de datos a versión 9...');
      const shifts = await trans.table('cash_shifts').toArray();
      for (const shift of shifts) {
        if (typeof shift.start_amount !== 'number') {
          await trans.table('cash_shifts').update(shift.id, {
            start_amount: parseFloat(shift.start_amount) || 0
          });
        }
      }

      const sales = await trans.table('sales').toArray();
      for (const sale of sales) {
        if (typeof sale.total !== 'number') {
          await trans.table('sales').update(sale.id, {
            total: parseFloat(sale.total) || 0
          });
        }
      }
    });

    // v10: elimina la tabla local `inventory_movements` (duplicado de `movements`)
    // El servidor Supabase sí usa esa tabla, pero localmente siempre usamos `movements`
    this.version(10).stores({
      inventory_movements: null // DROP tabla local no utilizada
    });
  }
}

export const db = new NexusDB();

export async function verifyDatabaseIntegrity() { /* depuracion omitida */ }
export async function cleanCorruptedData() { /* depuracion omitida */ }

if (typeof window !== 'undefined' && import.meta.env.DEV) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).dbDebug = { verify: verifyDatabaseIntegrity, clean: cleanCorruptedData, db: db };
}