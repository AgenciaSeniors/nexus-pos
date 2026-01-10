import Dexie, { type Table } from 'dexie';

// 1. Interfaces de Datos
export interface Product {
  id: string;
  name: string;
  price: number;
  cost?: number;
  stock: number;
  sku: string;
  business_id: string;
  category?: string;
  unit?: string;
  sync_status?: 'synced' | 'pending_update' | 'pending_create' | 'pending_delete';
}

export interface SaleItem {
  product_id: string;
  name: string;
  quantity: number;
  price: number;
  unit?: string;
}

export interface Sale {
  id: string;
  business_id: string;
  total: number;
  date: string;
  items: SaleItem[];
  customer_id?: string;
  staff_id?: string; // <--- NUEVO: ID del vendedor
  staff_name?: string; // <--- NUEVO: Nombre del vendedor
  payment_method: 'efectivo' | 'transferencia' | 'tarjeta';
  amount_tendered?: number;
  change?: number;
  sync_status?: 'synced' | 'pending';
}

export interface BusinessConfig {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  receipt_message?: string;
}

export interface Customer {
  id: string;
  business_id: string;
  name: string;
  phone?: string;
  email?: string;
  sync_status?: 'synced' | 'pending_create' | 'pending_update';
}

export interface ParkedOrder {
  id: string;
  date: string;
  items: SaleItem[];
  total: number;
  note?: string;
}

// --- NUEVA INTERFAZ: EMPLEADOS ---
export interface Staff {
  id: string;
  name: string;
  role: 'admin' | 'vendedor';
  pin: string;
  active: boolean;
}

// 2. Definición de la Base de Datos
export class NexusDB extends Dexie {
  products!: Table<Product>;
  sales!: Table<Sale>;
  settings!: Table<BusinessConfig>;
  customers!: Table<Customer>;
  parked_orders!: Table<ParkedOrder>;
  staff!: Table<Staff>; // <--- NUEVA TABLA

  constructor() {
    super('NexusPOS_DB');
    // Actualizamos a versión 6 para incluir la nueva tabla
    this.version(6).stores({
      products: 'id, name, sku, category, sync_status', 
      sales: 'id, date, customer_id, staff_id, sync_status', // Agregado índice staff_id
      settings: 'id',
      customers: 'id, name, phone, sync_status',
      parked_orders: 'id, date',
      staff: 'id, name, pin' // <--- Nueva definición
    });
  }
}

export const db = new NexusDB();