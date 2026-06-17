import Dexie, { type Table } from 'dexie';

// --- INTERFACES ---
export interface Product {
  id: string;
  business_id: string;
  name: string;
  price: number;
  cost?: number;
  stock: number;
  stock_warehouse?: number;
  sku: string | null;
  category?: string;
  unit?: string;
  expiration_date?: string;
  low_stock_threshold?: number;
  created_at?: string;
  updated_at?: string;
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
  status?: 'completed' | 'voided' | 'stock_conflict' | 'partial_refund';
  /**
   * Timestamp ISO de cuándo se anuló la venta. Crítico para reportes inmutables:
   * permite distinguir si la anulación ocurrió DENTRO del turno (debe descontarse
   * del cuadre) o DESPUÉS (no debe cambiar el reporte histórico de ese turno).
   * Ver `lib/shiftStats.ts`.
   */
  voided_at?: string;
  // Descuento
  discount_amount?: number;
  discount_type?: 'percentage' | 'fixed';
  discount_input?: number;
  // Pago mixto (efectivo + transferencia)
  cash_amount?: number;
  transfer_amount?: number;
  // Puntos canjeados
  redeemed_points?: number;
  // Devoluciones parciales
  refunded_items?: RefundedItem[];
  // Modo restaurante: referencia a la comanda de la que salió esta venta (si aplica).
  comanda_id?: string;
  sync_status: 'synced' | 'pending_create' | 'pending_update';
}

export interface RefundedItem {
  product_id: string;
  name: string;
  quantity: number;
  amount: number;
  date: string;
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
  /**
   * Tipo de negocio. Controla el modo de la app:
   * - 'retail' (default): punto de venta clásico de productos.
   * - 'restaurant': mesas, comandas, cocina, etc.
   * Si está ausente se asume 'retail' para compatibilidad con tenants existentes.
   */
  business_type?: 'retail' | 'restaurant';
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

// ─── MODO RESTAURANTE ─────────────────────────────────────────────────────────
// Convención de sync: cada entidad lleva business_id, created_at/updated_at
// (mantenidos por el servidor, usados por fetchSince) y sync_status local.

export interface RestaurantArea {
  id: string;
  business_id: string;
  name: string;              // "Salón", "Terraza", "Barra"
  sort_order?: number;
  deleted_at?: string | null;
  created_at?: string;
  updated_at?: string;
  sync_status: 'synced' | 'pending_create' | 'pending_update' | 'pending_delete';
}

export interface RestaurantTable {
  id: string;
  business_id: string;
  area_id: string;
  name: string;              // "Mesa 4"
  capacity?: number;
  pos_x?: number;
  pos_y?: number;
  /**
   * Estado de la mesa. Es un campo de conveniencia: la verdad de "ocupada" es la
   * existencia de una comanda abierta. Ante conflicto de sync se recalcula desde
   * las comandas en vez de confiar en el enum (evita carreras entre dispositivos).
   */
  state: 'libre' | 'ocupada' | 'por_cobrar' | 'reservada';
  current_comanda_id?: string | null;
  assigned_staff_id?: string | null;
  deleted_at?: string | null;
  created_at?: string;
  updated_at?: string;
  sync_status: 'synced' | 'pending_create' | 'pending_update' | 'pending_delete';
}

/**
 * Modificador aplicado a una línea de comanda (snapshot embebido, inmutable).
 * El precio se congela al elegirlo para sobrevivir a cambios del menú.
 * (Inerte hasta la Fase 3; declarado para forward-compat.)
 */
export interface ComandaItemModifier {
  group_id: string;
  group_name: string;
  modifier_id: string;
  modifier_name: string;
  price_delta: number;
}

export interface Comanda {
  id: string;
  business_id: string;
  table_id: string;
  area_id?: string;
  staff_id?: string;         // mesero que la abrió
  staff_name?: string;
  customer_id?: string;
  customer_name?: string;
  opened_at: string;
  status: 'open' | 'por_cobrar' | 'closed' | 'cancelled';
  closed_at?: string;
  guests?: number;
  note?: string;
  total?: number;            // se completa al cerrar
  tip_total?: number;
  sale_ids?: string[];       // Sale(s) producidas al cerrar (split → varias)
  created_at?: string;
  updated_at?: string;
  sync_status: 'synced' | 'pending_create' | 'pending_update';
}

export interface ComandaItem {
  id: string;
  comanda_id: string;
  business_id: string;       // denormalizado para RLS + fetchSince
  product_id: string;
  name: string;              // snapshot
  quantity: number;
  price: number;             // precio unitario base (snapshot)
  custom_price?: number;
  note?: string;
  modifiers?: ComandaItemModifier[];   // embebido (Fase 3)
  modifiers_total?: number;
  course?: number;
  /**
   * Estado de cocina. Inerte en Fase 1 (default 'pending'); se activa en Fase 2 (KDS).
   * El KDS posee estas columnas; el mesero posee quantity/price/note/modifiers.
   */
  kitchen_status: 'pending' | 'sent' | 'preparando' | 'listo' | 'served' | 'cancelled';
  sent_at?: string;
  ready_at?: string;
  voided?: boolean;
  item_updated_at?: string;  // pivote de concurrencia por ítem (Fase 2)
  created_at?: string;
  updated_at?: string;
  sync_status: 'synced' | 'pending_create' | 'pending_update';
}

export type ComandaClosePayload = {
  comanda_id: string;
  sales: Sale[];
  business_id: string;
  idempotency_key: string;
};

export type SalePayload = { sale: Sale; items: SaleItem[] };
export type VoidSalePayload = { saleId: string };
export type PartialRefundPayload = { saleId: string; refunded_items: RefundedItem[] };
/**
 * Cambio de puntos de lealtad. `idempotency_key` previene aplicar el mismo
 * cambio dos veces si el item se reintenta tras un fallo de red intermitente
 * (el RPC en Supabase debe verificar que el key no se haya procesado antes).
 */
export type LoyaltyChangePayload = {
  customer_id: string;
  delta: number;
  business_id: string;
  idempotency_key: string;
};

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
    | VoidSalePayload
    | PartialRefundPayload
    | LoyaltyChangePayload
    | RestaurantArea
    | RestaurantTable
    | Comanda
    | ComandaItem
    | ComandaClosePayload;

export interface QueueItem {
  id: string;
  type: 'SALE' | 'MOVEMENT' | 'AUDIT' | 'PRODUCT_SYNC' | 'CUSTOMER_SYNC' | 'SETTINGS_SYNC' | 'SHIFT' | 'CASH_MOVEMENT' | 'STAFF_SYNC' | 'VOID_SALE' | 'PARTIAL_REFUND' | 'LOYALTY_CHANGE' | 'AREA_SYNC' | 'TABLE_SYNC' | 'COMANDA_SYNC' | 'COMANDA_ITEM_SYNC' | 'COMANDA_CLOSE';
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
  restaurant_areas!: Table<RestaurantArea>;
  restaurant_tables!: Table<RestaurantTable>;
  comandas!: Table<Comanda>;
  comanda_items!: Table<ComandaItem>;

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

    // v11: agrega índice [business_id+status] en sales para conteos rápidos
    // de stock_conflict, voided, etc. — usado por Layout (sidebar badges)
    // y FinancePage (filtros de historial por estado).
    this.version(11).stores({
      sales: 'id, business_id, shift_id, date, sync_status, status, [shift_id+business_id], [business_id+date], [business_id+status]',
    });

    // v12: NO cambia índices, solo agrega el campo `voided_at` que se popula
    // a partir de ahora al anular ventas. Las ventas viejas voided sin este
    // timestamp se consideran "anuladas antes del periodo histórico" — comportamiento
    // conservador idéntico al actual, sin cambios para datos existentes.
    this.version(12).stores({
      sales: 'id, business_id, shift_id, date, sync_status, status, [shift_id+business_id], [business_id+date], [business_id+status]',
    });

    // v13: MODO RESTAURANTE — tablas de mesas/comandas. No toca tablas existentes,
    // así que para negocios retail es un no-op (las tablas quedan vacías).
    // El índice [business_id+kitchen_status] de comanda_items lo usará el KDS (Fase 2).
    this.version(13).stores({
      restaurant_areas: 'id, business_id, sync_status, [business_id+sync_status]',
      restaurant_tables: 'id, business_id, area_id, state, sync_status, [business_id+state], [business_id+sync_status]',
      comandas: 'id, business_id, table_id, status, sync_status, [business_id+status], [business_id+sync_status]',
      comanda_items: 'id, comanda_id, business_id, kitchen_status, sync_status, [comanda_id+sync_status], [business_id+kitchen_status]',
    });

    // Backup pre-migración: si la versión del schema cambió, crear backup de seguridad
    this.on('ready', () => {
      const SCHEMA_KEY = 'nexus_db_schema_version';
      const currentVersion = 13; // Debe coincidir con la última versión declarada arriba
      const savedVersion = parseInt(localStorage.getItem(SCHEMA_KEY) || '0');

      if (savedVersion > 0 && savedVersion < currentVersion) {
        console.log(`🔄 Schema migrado de v${savedVersion} a v${currentVersion}. Creando backup de seguridad...`);
        import('./backup').then(({ createBackup }) =>
          createBackup()
            .then(b => console.log(`✅ Backup pre-migración creado: ${b.id} (${(b.size / 1024).toFixed(0)} KB)`))
            .catch(err => console.warn('⚠ Error creando backup pre-migración:', err))
        );
      }

      localStorage.setItem(SCHEMA_KEY, currentVersion.toString());
    });
  }
}

export const db = new NexusDB();

if (typeof window !== 'undefined' && import.meta.env.DEV) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).dbDebug = { db };
}