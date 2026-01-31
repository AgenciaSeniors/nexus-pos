import Dexie, { type Table } from 'dexie';

// --- INTERFACES EXISTENTES ---
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
  shift_id?: string;
  total: number;
  items: SaleItem[];
  staff_id?: string;
  staff_name?: string;
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
}

export interface ParkedOrder {
  id: string;
  business_id: string;
  date: string;
  items: SaleItem[];
  total: number;
  note?: string;
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

// ✅ NUEVAS INTERFACES DE CAJA
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

// ✅ TIPOS DE AUDITORÍA ACTUALIZADOS
export interface AuditLog {
  id: string;
  business_id: string;
  staff_id: string;
  staff_name: string;
  // Agregamos: OPEN_SHIFT, CLOSE_SHIFT, CASH_IN, CASH_OUT
  action: 'LOGIN' | 'LOGOUT' | 'SALE' | 'CREATE_PRODUCT' | 'DELETE_PRODUCT' | 
          'UPDATE_STOCK' | 'OPEN_DRAWER' | 'VOID_SALE' | 'CREATE_CUSTOMER' | 
          'UPDATE_CUSTOMER' | 'DELETE_CUSTOMER' | 'OPEN_SHIFT' | 'CLOSE_SHIFT' | 
          'CASH_IN' | 'CASH_OUT';
  details: Record<string, unknown> | null;
  created_at: string;
  sync_status: 'pending_create' | 'synced';
}

// ✅ PAYLOADS DE COLA ACTUALIZADOS
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

// =============================

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

    this.version(5).stores({
      businesses: 'id',
      products: 'id, business_id, sku, name, sync_status',
      sales: 'id, business_id, shift_id, date, sync_status',
      movements: 'id, business_id, product_id, created_at, sync_status',
      inventory_movements: 'id, business_id, product_id, sync_status',
      customers: 'id, business_id, name, phone, sync_status',
      parked_orders: 'id, business_id, date',
      settings: 'id',
      staff: 'id, business_id, pin, active',
      audit_logs: 'id, business_id, action, created_at, sync_status',
      action_queue: 'id, type, timestamp, status',
      cash_registers: 'id, business_id',
      cash_shifts: 'id, business_id, staff_id, status, [business_id+status]', 
      cash_movements: 'id, shift_id, business_id'
    });
  }
}

export const db = new NexusDB();