import Dexie, { type Table } from 'dexie';

// ==========================================
// 1. INTERFACES DE DATOS (Tipos Fuertes)
// ==========================================

export interface Product {
  id: string;
  business_id: string;
  name: string;
  price: number;
  cost?: number;        // Costo para cálculo de ganancias
  stock: number;
  sku: string;
  category?: string;
  unit?: string;        // 'un', 'kg', 'lt', etc.
  expiration_date?: string; 
  sync_status: 'synced' | 'pending_create' | 'pending_update' | 'pending_delete';
}

export interface SaleItem {
  product_id: string;
  name: string;
  quantity: number;
  price: number;
  unit?: string;
  cost?: number; // Guardamos el costo al momento de la venta para reportes históricos precisos
}

export interface Sale {
  id: string;
  business_id: string;
  date: string;         // ISO String
  total: number;
  items: SaleItem[];
  customer_id?: string;
  staff_id?: string;    // Quién hizo la venta
  staff_name?: string;
  payment_method: 'efectivo' | 'transferencia' | 'tarjeta' | 'mixto';
  amount_tendered?: number; // Cuánto entregó el cliente
  change?: number;          // Cambio entregado
  note?: string;
  
  // ✅ ESTANDARIZACIÓN: Usamos sync_status igual que en productos
  sync_status: 'synced' | 'pending_create' | 'pending_update'; 
}

// 🛡️ NUEVA: Trazabilidad de Inventario (Seguridad)
export interface InventoryMovement {
  id: string;
  business_id: string;
  product_id: string;
  qty_change: number;   // Ej: -1 (venta), +10 (compra)
  reason: 'initial' | 'sale' | 'restock' | 'correction' | 'waste' | 'return';
  created_at: string;
  staff_id?: string;    // Quién hizo el movimiento
  sync_status: 'synced' | 'pending_create';
}

export interface BusinessConfig {
  id: string; // Generalmente el business_id
  name: string;
  address?: string;
  phone?: string;
  receipt_message?: string;
  logo_url?: string;
}

export interface Customer {
  id: string;
  business_id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  sync_status: 'synced' | 'pending_create' | 'pending_update' | 'pending_delete';
}

export interface ParkedOrder {
  id: string;
  business_id: string; // Importante para multi-tenant local
  date: string;
  items: SaleItem[];
  total: number;
  note?: string;
  customer_id?: string;
}

export interface Staff {
  id: string;
  name: string;
  role: 'admin' | 'vendedor';
  pin: string;
  active: boolean;
}

// ==========================================
// 2. DEFINICIÓN DE LA BASE DE DATOS (DEXIE)
// ==========================================

export class NexusDB extends Dexie {
  products!: Table<Product>;
  sales!: Table<Sale>;
  movements!: Table<InventoryMovement>; // ✅ Nueva tabla crítica
  settings!: Table<BusinessConfig>;
  customers!: Table<Customer>;
  parked_orders!: Table<ParkedOrder>;
  staff!: Table<Staff>;

  constructor() {
    super('NexusPOS_DB');

    // DEFINICIÓN DE ESQUEMA E ÍNDICES
    // La primera columna es siempre la Primary Key
    // Las demás son índices para buscar rápido (where)
    this.version(2).stores({
      
      // Productos: Buscamos por ID, Negocio, SKU (barras), Nombre y Estado de Sincronización
      products: 'id, business_id, sku, name, sync_status',
      
      // Ventas: Buscamos por ID, Negocio, Fecha (reportes), Cliente y Estado
      sales: 'id, business_id, date, customer_id, sync_status',
      
      // Movimientos: Buscamos por Producto (historial), Negocio y Estado
      movements: 'id, business_id, product_id, created_at, sync_status',
      
      // Clientes: Buscamos por Negocio, Nombre/Teléfono y Estado
      customers: 'id, business_id, name, phone, sync_status',
      
      // Pedidos Guardados: Solo local
      parked_orders: 'id, business_id, date',
      
      // Configuración: Simple
      settings: 'id',
      
      // Personal: Buscamos por PIN para el login rápido
      staff: 'id, pin, active'
    });
  }
}

export const db = new NexusDB();