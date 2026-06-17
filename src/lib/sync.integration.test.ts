// @vitest-environment happy-dom
/**
 * Tests de INTEGRACIÓN del motor de sincronización.
 *
 * A diferencia de los tests unitarios (funciones puras en syncResolution.test.ts),
 * estos ejecutan el motor REAL (`addToQueue`, `processQueue`, `_runQueue`) contra:
 *   - Una IndexedDB de verdad (fake-indexeddb, en memoria)
 *   - Un Supabase mockeado y CONTROLABLE (simula éxito, error, red caída)
 *
 * Objetivo: verificar que la cola se vacía, respeta el orden de dependencias,
 * no se bloquea con items rotos, y recupera items atascados — los bugs
 * reportados en producción.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock controlable de Supabase ────────────────────────────────────────────
// Los tests configuran `mockState.responses` para simular qué devuelve cada
// operación, y leen `mockState.calls` para verificar qué se llamó.
interface MockResult { data?: unknown; error?: unknown }
const mockState = {
  // Una respuesta puede ser un objeto único (se devuelve siempre) o un array que se
  // consume EN ORDEN (útil cuando syncLiveData consulta la misma tabla dos veces, p.ej.
  // cash_shifts: primero el select de turno abierto, luego el .single() del turno cerrado).
  responses: {} as Record<string, MockResult | MockResult[]>,
  calls: [] as Array<{ op: string; key: string; payload?: unknown }>,
};

function resetMock() {
  mockState.responses = {};
  mockState.calls = [];
}

vi.mock('./supabase', () => {
  const result = (key: string): Promise<MockResult> => {
    const r = mockState.responses[key];
    // Array → se consume en orden; el último valor persiste para llamadas extra.
    if (Array.isArray(r)) return Promise.resolve(r.length > 1 ? r.shift()! : (r[0] ?? { data: null, error: null }));
    return Promise.resolve(r ?? { data: null, error: null });
  };

  // Objeto chainable para .update().eq().eq() y .select().eq()...
  const chainable = (key: string) => {
    const obj: Record<string, unknown> = {
      eq: () => obj,
      neq: () => obj,
      gt: () => obj,
      lt: () => obj,
      gte: () => obj,
      order: () => obj,
      range: () => obj,
      limit: () => obj,
      single: () => result(key),
      then: (resolve: (v: MockResult) => unknown) => result(key).then(resolve),
    };
    return obj;
  };

  return {
    supabase: {
      rpc: (name: string, args: unknown) => {
        mockState.calls.push({ op: 'rpc', key: name, payload: args });
        return result(`rpc:${name}`);
      },
      from: (table: string) => ({
        insert: (d: unknown) => {
          mockState.calls.push({ op: 'insert', key: table, payload: d });
          return result(`${table}:insert`);
        },
        upsert: (d: unknown) => {
          mockState.calls.push({ op: 'upsert', key: table, payload: d });
          return result(`${table}:upsert`);
        },
        update: (d: unknown) => {
          mockState.calls.push({ op: 'update', key: table, payload: d });
          return chainable(`${table}:update`);
        },
        select: () => {
          mockState.calls.push({ op: 'select', key: table });
          return chainable(`${table}:select`);
        },
      }),
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: 'admin-test-id' } } }),
      },
    },
  };
});

// Importar DESPUÉS del mock para que sync.ts use el supabase mockeado
const { db } = await import('./db');
const { addToQueue, processQueue, syncLiveData } = await import('./sync');

// ── Helpers ──────────────────────────────────────────────────────────────────
async function clearDb() {
  await db.action_queue.clear();
  await db.sales.clear();
  await db.products.clear();
  await db.customers.clear();
  await db.cash_shifts.clear();
  await db.cash_movements.clear();
  await db.staff.clear();
  await db.settings.clear();
  await db.restaurant_areas.clear();
  await db.restaurant_tables.clear();
  await db.comandas.clear();
  await db.comanda_items.clear();
}

/** Inserta un item directo en la cola con control total de sus campos. */
async function seedQueueItem(opts: {
  type: string; status?: string; retries?: number; timestamp?: number; payload?: unknown;
}) {
  const id = crypto.randomUUID();
  await db.action_queue.add({
    id,
    type: opts.type as never,
    payload: (opts.payload ?? {}) as never,
    timestamp: opts.timestamp ?? Date.now(),
    retries: opts.retries ?? 0,
    status: (opts.status ?? 'pending') as never,
  });
  return id;
}

/** navigator.onLine es read-only; se sobrescribe con defineProperty. */
function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
}

beforeEach(async () => {
  resetMock();
  await clearDb();
  setOnline(true);
});

// ════════════════════════════════════════════════════════════════════════════
describe('Motor de cola — vaciado básico', () => {
  it('procesa y elimina un item exitoso', async () => {
    await seedQueueItem({
      type: 'PRODUCT_SYNC',
      payload: { id: 'p1', business_id: 'b1', name: 'Test', sync_status: 'pending_create' },
    });
    // products:upsert → sin error
    await processQueue();
    expect(await db.action_queue.count()).toBe(0);
  });

  it('procesa varios items y vacía la cola completa', async () => {
    for (let i = 0; i < 10; i++) {
      await seedQueueItem({
        type: 'PRODUCT_SYNC',
        payload: { id: `p${i}`, business_id: 'b1', name: `P${i}` },
        timestamp: Date.now() + i,
      });
    }
    await processQueue();
    expect(await db.action_queue.count()).toBe(0);
  });
});

describe('Motor de cola — items rotos NO bloquean a los sanos (BUG A)', () => {
  it('un item envenenado no impide procesar los nuevos', async () => {
    // 5 SHIFT rotos (el upsert de cash_shifts devuelve error)
    mockState.responses['cash_shifts:upsert'] = { error: { message: 'columna faltante' } };
    for (let i = 0; i < 5; i++) {
      await seedQueueItem({ type: 'SHIFT', timestamp: 1000 + i,
        payload: { id: `shift${i}`, business_id: 'b1' } });
    }
    // 1 venta nueva (timestamp mucho mayor) — el RPC responde OK
    mockState.responses['rpc:process_sale_transaction'] = { data: { ok: true } };
    const ventaId = 'venta-nueva';
    await db.sales.add({
      id: ventaId, business_id: 'b1', date: new Date().toISOString(),
      shift_id: 's1', total: 100, items: [], payment_method: 'efectivo',
      sync_status: 'pending_create',
    } as never);
    await seedQueueItem({ type: 'SALE', timestamp: 999999,
      payload: { sale: { id: ventaId, business_id: 'b1', sync_status: 'pending_create' }, items: [] } });

    await processQueue();

    // La venta nueva DEBE haberse procesado (no quedó atrás de los SHIFT rotos)
    const ventaProcesada = mockState.calls.some(c => c.op === 'rpc' && c.key === 'process_sale_transaction');
    expect(ventaProcesada).toBe(true);
    // La venta ya no está en la cola
    const colaRestante = await db.action_queue.where('type').equals('SALE').count();
    expect(colaRestante).toBe(0);
    // Los SHIFT rotos siguen en cola con retries incrementados
    const shiftsEnCola = await db.action_queue.where('type').equals('SHIFT').toArray();
    expect(shiftsEnCola.length).toBe(5);
    expect(shiftsEnCola.every(s => s.retries > 0)).toBe(true);
  });

  it('item roto llega a failed tras 5 intentos sin bloquear la cola', async () => {
    mockState.responses['audit_logs:insert'] = { error: { message: 'FK violation' } };
    // timestamp viejo (hace 10 min) → ya superó el backoff del retry 4, se procesa ya
    const id = await seedQueueItem({ type: 'AUDIT', retries: 4,
      timestamp: Date.now() - 10 * 60 * 1000,
      payload: { id: 'a1', business_id: 'b1' } });

    await processQueue();

    const item = await db.action_queue.get(id);
    expect(item?.status).toBe('failed');
    expect(item?.error).toContain('ABANDONADO');
  });
});

describe('Motor de cola — orden de dependencias FK (BUG C)', () => {
  it('procesa STAFF antes que AUDIT aunque el AUDIT sea más viejo', async () => {
    // AUDIT con timestamp viejo, STAFF con timestamp nuevo.
    // Sin orden por dependencia, AUDIT iría primero y fallaría FK.
    await seedQueueItem({ type: 'AUDIT', timestamp: 100,
      payload: { id: 'a1', business_id: 'b1', staff_id: 'staff-x' } });
    await seedQueueItem({ type: 'STAFF_SYNC', timestamp: 200,
      payload: { id: 'staff-x', business_id: 'b1', name: 'Vendedor' } });

    await processQueue();

    // Verificar el ORDEN real de las llamadas a Supabase
    const staffIdx = mockState.calls.findIndex(c => c.key === 'staff');
    const auditIdx = mockState.calls.findIndex(c => c.key === 'audit_logs');
    expect(staffIdx).toBeGreaterThanOrEqual(0);
    expect(auditIdx).toBeGreaterThanOrEqual(0);
    expect(staffIdx).toBeLessThan(auditIdx); // STAFF primero
  });

  it('procesa SHIFT antes que SALE antes que VOID_SALE', async () => {
    await seedQueueItem({ type: 'VOID_SALE', timestamp: 1, payload: { saleId: 'x' } });
    await seedQueueItem({ type: 'SALE', timestamp: 2,
      payload: { sale: { id: 'x', business_id: 'b1' }, items: [] } });
    await seedQueueItem({ type: 'SHIFT', timestamp: 3, payload: { id: 's1', business_id: 'b1' } });
    // VOID_SALE necesita la venta local
    await db.sales.add({ id: 'x', business_id: 'b1', date: '', shift_id: 's1',
      total: 0, items: [], payment_method: 'efectivo', sync_status: 'synced' } as never);
    mockState.responses['rpc:process_sale_transaction'] = { data: {} };

    await processQueue();

    const order = mockState.calls.map(c => c.key);
    const shiftIdx = order.indexOf('cash_shifts');
    const saleIdx = order.findIndex(k => k === 'process_sale_transaction');
    const voidIdx = order.indexOf('sales'); // VOID_SALE hace update sobre 'sales'
    expect(shiftIdx).toBeLessThan(saleIdx);
    expect(saleIdx).toBeLessThan(voidIdx);
  });
});

describe('Motor de cola — recuperación de items atascados (BUG B)', () => {
  it('resetea un item atascado en processing y lo procesa', async () => {
    // Item que quedó en 'processing' (la app crasheó a mitad del primer intento).
    // retries:0 → sin backoff, debe procesarse de inmediato al resetearse.
    const id = await seedQueueItem({
      type: 'PRODUCT_SYNC', status: 'processing', retries: 0,
      payload: { id: 'p1', business_id: 'b1', name: 'Atascado' },
    });

    await processQueue();

    // Debe haberse procesado (eliminado de la cola)
    expect(await db.action_queue.get(id)).toBeUndefined();
  });

  it('item en processing con retries respeta el backoff al resetearse', async () => {
    // Item atascado que YA tenía reintentos: tras resetear a pending, el backoff
    // exponencial sigue vigente (no se martillea el servidor).
    const id = await seedQueueItem({
      type: 'PRODUCT_SYNC', status: 'processing', retries: 2, timestamp: Date.now(),
      payload: { id: 'p1', business_id: 'b1', name: 'ConBackoff' },
    });

    await processQueue();

    // Reseteado a pending pero NO procesado todavía (en backoff)
    const item = await db.action_queue.get(id);
    expect(item?.status).toBe('pending');
  });
});

describe('Motor de cola — offline', () => {
  it('no procesa nada si está offline', async () => {
    setOnline(false);
    await seedQueueItem({ type: 'PRODUCT_SYNC', payload: { id: 'p1', business_id: 'b1' } });
    await processQueue();
    expect(await db.action_queue.count()).toBe(1); // sigue ahí
    expect(mockState.calls.length).toBe(0); // no se llamó a Supabase
  });
});

describe('Motor de cola — addToQueue', () => {
  it('addToQueue agrega y procesa inmediatamente si hay conexión', async () => {
    mockState.responses['products:upsert'] = { error: null };
    await addToQueue('PRODUCT_SYNC', {
      id: 'p1', business_id: 'b1', name: 'X', price: 1, stock: 1,
      sku: null, sync_status: 'pending_create',
    } as never);
    // dar tiempo al processQueue disparado internamente
    await new Promise(r => setTimeout(r, 50));
    expect(await db.action_queue.count()).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Motor de cola — idempotencia 23505 (clave duplicada)', () => {
  it('un upsert que devuelve 23505 NO falla, marca synced y loguea', async () => {
    // 23505 = el registro ya existía en el servidor (reintento tras corte de red).
    // Es la idempotencia funcionando: el item debe completarse (salir de la cola)
    // y dejarse rastro en consola para visibilidad en producción.
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    await db.products.add({
      id: 'p-dup', business_id: 'b1', name: 'Dup', price: 1, stock: 1,
      sku: null, sync_status: 'pending_create',
    } as never);
    mockState.responses['products:upsert'] = { error: { code: '23505', message: 'duplicate key' } };
    await seedQueueItem({ type: 'PRODUCT_SYNC',
      payload: { id: 'p-dup', business_id: 'b1', name: 'Dup' } });

    await processQueue();

    expect(await db.action_queue.count()).toBe(0); // tratado como éxito idempotente
    expect((await db.products.get('p-dup'))?.sync_status).toBe('synced');
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('23505'));
    infoSpy.mockRestore();
  });

  it('un error que NO es 23505 sí manda el item a retry', async () => {
    mockState.responses['products:upsert'] = { error: { code: '42P01', message: 'relation missing' } };
    const id = await seedQueueItem({ type: 'PRODUCT_SYNC',
      payload: { id: 'p-err', business_id: 'b1', name: 'Err' } });

    await processQueue();

    const item = await db.action_queue.get(id);
    expect(item?.status).toBe('pending'); // no se completó
    expect((item?.retries ?? 0)).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('syncLiveData — pull de fondo multi-dispositivo', () => {
  // Settings es prerequisito de syncLiveData (de ahí saca el business_id).
  async function seedSettings(overrides: Record<string, unknown> = {}) {
    await db.settings.put({
      id: 'b1', name: 'Negocio', status: 'active', sync_status: 'synced', ...overrides,
    } as never);
  }

  /** Espera un CustomEvent global durante la ejecución de `fn`. */
  async function captureEvent(name: string, fn: () => Promise<void>): Promise<CustomEvent | null> {
    let captured: CustomEvent | null = null;
    const handler = (e: Event) => { captured = e as CustomEvent; };
    window.addEventListener(name, handler);
    try { await fn(); } finally { window.removeEventListener(name, handler); }
    return captured;
  }

  beforeEach(() => {
    // Controlar el reloj de sync: incremental (no fetchAll) y sin disparar heavy sync.
    localStorage.setItem('nexus_last_sync_at', Date.now().toString());
    localStorage.setItem('nexus_last_heavy_sync_at', Date.now().toString());
  });

  it('baja a local el turno abierto remoto', async () => {
    await seedSettings();
    mockState.responses['cash_shifts:select'] = {
      data: [{ id: 'sh1', business_id: 'b1', staff_id: 'v1', start_amount: 100,
        opened_at: '', status: 'open' }],
    };

    await syncLiveData();

    const local = await db.cash_shifts.get('sh1');
    expect(local).toBeDefined();
    expect(local?.sync_status).toBe('synced');
  });

  it('mergea ventas hechas en otros dispositivos', async () => {
    await seedSettings();
    mockState.responses['cash_shifts:select'] = {
      data: [{ id: 'sh1', business_id: 'b1', staff_id: 'v1', start_amount: 0,
        opened_at: '', status: 'open' }],
    };
    mockState.responses['sales:select'] = {
      data: [
        { id: 'r1', business_id: 'b1', shift_id: 'sh1', date: '', total: 10, items: [], payment_method: 'efectivo' },
        { id: 'r2', business_id: 'b1', shift_id: 'sh1', date: '', total: 20, items: [], payment_method: 'efectivo' },
      ],
    };

    await syncLiveData();

    expect(await db.sales.get('r1')).toBeDefined();
    expect(await db.sales.get('r2')).toBeDefined();
  });

  it('NO pisa una venta local con cambios pendientes', async () => {
    await seedSettings();
    // Venta local editada localmente (dirty), aún sin subir.
    await db.sales.add({
      id: 'sLocal', business_id: 'b1', shift_id: 'sh1', date: '', total: 50,
      items: [], payment_method: 'efectivo', sync_status: 'pending_create',
    } as never);
    mockState.responses['cash_shifts:select'] = {
      data: [{ id: 'sh1', business_id: 'b1', staff_id: 'v1', start_amount: 0,
        opened_at: '', status: 'open' }],
    };
    // El remoto trae la MISMA venta con otro total — no debe sobrescribir el local pending.
    mockState.responses['sales:select'] = {
      data: [{ id: 'sLocal', business_id: 'b1', shift_id: 'sh1', date: '', total: 999, items: [], payment_method: 'efectivo' }],
    };

    await syncLiveData();

    expect((await db.sales.get('sLocal'))?.total).toBe(50); // preservado
  });

  it('baja productos por pull incremental', async () => {
    await seedSettings();
    mockState.responses['products:select'] = {
      data: [{ id: 'pNew', business_id: 'b1', name: 'Nuevo', price: 5, stock: 3, sku: null }],
    };

    await syncLiveData();

    const p = await db.products.get('pNew');
    expect(p).toBeDefined();
    expect(p?.sync_status).toBe('synced');
  });

  it('emite nexus-stock-alert ante stock negativo', async () => {
    await seedSettings();
    mockState.responses['products:select'] = {
      data: [{ id: 'pNeg', business_id: 'b1', name: 'Negativo', price: 5, stock: -2, sku: null }],
    };

    const ev = await captureEvent('nexus-stock-alert', () => syncLiveData());

    expect(ev).not.toBeNull();
    expect((ev?.detail as { products: Array<{ id: string }> }).products[0].id).toBe('pNeg');
  });

  it('emite nexus-trial-expired si el trial venció', async () => {
    await seedSettings({ status: 'trial', subscription_expires_at: '2020-01-01T00:00:00.000Z' });

    const ev = await captureEvent('nexus-trial-expired', () => syncLiveData());

    expect(ev).not.toBeNull();
  });

  it('sincroniza staff excluyendo al admin autenticado', async () => {
    await seedSettings();
    // auth.getUser del mock devuelve { id: 'admin-test-id' }
    mockState.responses['staff:select'] = {
      data: [
        { id: 'admin-test-id', business_id: 'b1', name: 'Jefe', role: 'admin', pin: 'x', active: true },
        { id: 'vend1', business_id: 'b1', name: 'Vendedor', role: 'vendedor', pin: 'y', active: true },
      ],
    };

    await syncLiveData();

    expect(await db.staff.get('vend1')).toBeDefined();
    expect(await db.staff.get('admin-test-id')).toBeUndefined(); // admin gestionado aparte
  });

  it('cierra el turno local cuando fue cerrado desde otro dispositivo', async () => {
    await seedSettings();
    // Turno local abierto y ya sincronizado.
    await db.cash_shifts.add({
      id: 'sh1', business_id: 'b1', staff_id: 'v1', start_amount: 0,
      opened_at: '', status: 'open', sync_status: 'synced',
    } as never);
    // 1er select (turno abierto remoto) → vacío; 2º (.single por id) → turno cerrado.
    mockState.responses['cash_shifts:select'] = [
      { data: [] },
      { data: { id: 'sh1', business_id: 'b1', staff_id: 'v1', start_amount: 0,
        opened_at: '', closed_at: '', status: 'closed' } },
    ];
    // Las ventas del turno se bajan ANTES de cerrarlo localmente.
    mockState.responses['sales:select'] = {
      data: [{ id: 'rClose', business_id: 'b1', shift_id: 'sh1', date: '', total: 7, items: [], payment_method: 'efectivo' }],
    };

    await syncLiveData();

    expect((await db.cash_shifts.get('sh1'))?.status).toBe('closed');
    expect(await db.sales.get('rClose')).toBeDefined();
  });

  it('no llama a Supabase si está offline', async () => {
    await seedSettings();
    setOnline(false);

    await syncLiveData();

    expect(mockState.calls.length).toBe(0);
  });

  it('no hace nada si no hay settings locales', async () => {
    // clearDb (beforeEach global) ya dejó settings vacío.
    await syncLiveData();
    expect(mockState.calls.length).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Modo restaurante — sync de mesas/comandas', () => {
  it('AREA_SYNC y TABLE_SYNC hacen upsert y marcan synced', async () => {
    await db.restaurant_areas.add({ id: 'a1', business_id: 'b1', name: 'Salón', sync_status: 'pending_create' } as never);
    await db.restaurant_tables.add({ id: 't1', business_id: 'b1', area_id: 'a1', name: 'Mesa 1', state: 'libre', sync_status: 'pending_create' } as never);
    await seedQueueItem({ type: 'AREA_SYNC', payload: { id: 'a1', business_id: 'b1', name: 'Salón' } });
    await seedQueueItem({ type: 'TABLE_SYNC', payload: { id: 't1', business_id: 'b1', area_id: 'a1', name: 'Mesa 1', state: 'libre' } });

    await processQueue();

    expect(await db.action_queue.count()).toBe(0);
    expect((await db.restaurant_areas.get('a1'))?.sync_status).toBe('synced');
    expect((await db.restaurant_tables.get('t1'))?.sync_status).toBe('synced');
  });

  it('COMANDA_CLOSE cierra la comanda y marca la venta synced', async () => {
    await db.comandas.add({ id: 'c1', business_id: 'b1', table_id: 't1', opened_at: '', status: 'open', sync_status: 'pending_update' } as never);
    await db.sales.add({ id: 'sale1', business_id: 'b1', date: '', shift_id: 'sh1', total: 30, items: [], payment_method: 'efectivo', comanda_id: 'c1', sync_status: 'pending_create' } as never);
    mockState.responses['rpc:close_comanda'] = { data: { ok: true } };
    await seedQueueItem({ type: 'COMANDA_CLOSE',
      payload: { comanda_id: 'c1', business_id: 'b1', idempotency_key: 'k1',
        sales: [{ id: 'sale1', business_id: 'b1', total: 30 }] } });

    await processQueue();

    expect(mockState.calls.some(c => c.op === 'rpc' && c.key === 'close_comanda')).toBe(true);
    expect(await db.action_queue.count()).toBe(0);
    expect((await db.comandas.get('c1'))?.status).toBe('closed');
    expect((await db.sales.get('sale1'))?.sync_status).toBe('synced');
  });

  it('COMANDA_CLOSE con conflicto de stock marca la venta en stock_conflict', async () => {
    await db.comandas.add({ id: 'c2', business_id: 'b1', table_id: 't1', opened_at: '', status: 'open', sync_status: 'pending_update' } as never);
    await db.sales.add({ id: 'sale2', business_id: 'b1', date: '', shift_id: 'sh1', total: 10, items: [], payment_method: 'efectivo', comanda_id: 'c2', sync_status: 'pending_create' } as never);
    mockState.responses['rpc:close_comanda'] = { data: { conflict: true, conflict_items: ['Mojito'] } };
    await seedQueueItem({ type: 'COMANDA_CLOSE',
      payload: { comanda_id: 'c2', business_id: 'b1', idempotency_key: 'k2',
        sales: [{ id: 'sale2', business_id: 'b1', total: 10 }] } });

    await processQueue();

    expect(await db.action_queue.count()).toBe(0);
    expect((await db.sales.get('sale2'))?.status).toBe('stock_conflict');
    // La comanda NO se cierra cuando hubo conflicto.
    expect((await db.comandas.get('c2'))?.status).toBe('open');
  });

  it('syncLiveData baja comandas y mesas solo en modo restaurante', async () => {
    await db.settings.put({ id: 'b1', name: 'Resto', status: 'active', business_type: 'restaurant', sync_status: 'synced' } as never);
    localStorage.setItem('nexus_last_sync_at', Date.now().toString());
    localStorage.setItem('nexus_last_heavy_sync_at', Date.now().toString());
    mockState.responses['restaurant_tables:select'] = { data: [{ id: 't1', business_id: 'b1', area_id: 'a1', name: 'Mesa 1', state: 'ocupada' }] };
    mockState.responses['comandas:select'] = { data: [{ id: 'c1', business_id: 'b1', table_id: 't1', opened_at: '', status: 'open' }] };
    mockState.responses['comanda_items:select'] = { data: [{ id: 'i1', comanda_id: 'c1', business_id: 'b1', product_id: 'p1', name: 'Café', quantity: 2, price: 5, kitchen_status: 'pending' }] };

    await syncLiveData();

    expect((await db.restaurant_tables.get('t1'))?.state).toBe('ocupada');
    expect(await db.comandas.get('c1')).toBeDefined();
    expect((await db.comanda_items.get('i1'))?.name).toBe('Café');
  });

  it('syncLiveData NO consulta tablas de restaurante en modo retail', async () => {
    await db.settings.put({ id: 'b1', name: 'Tienda', status: 'active', business_type: 'retail', sync_status: 'synced' } as never);
    localStorage.setItem('nexus_last_sync_at', Date.now().toString());
    localStorage.setItem('nexus_last_heavy_sync_at', Date.now().toString());

    await syncLiveData();

    expect(mockState.calls.some(c => c.key === 'comandas')).toBe(false);
    expect(mockState.calls.some(c => c.key === 'restaurant_tables')).toBe(false);
  });

  it('COMANDA_ITEM_SYNC usa el RPC upsert_comanda_item (columnas del mesero)', async () => {
    await db.comanda_items.add({ id: 'i2', comanda_id: 'c1', business_id: 'b1', product_id: 'p1', name: 'X', quantity: 1, price: 5, kitchen_status: 'pending', sync_status: 'pending_create' } as never);
    mockState.responses['rpc:upsert_comanda_item'] = { data: null };
    await seedQueueItem({ type: 'COMANDA_ITEM_SYNC',
      payload: { id: 'i2', comanda_id: 'c1', business_id: 'b1', product_id: 'p1', name: 'X', quantity: 1, price: 5, kitchen_status: 'pending' } });

    await processQueue();

    expect(mockState.calls.some(c => c.op === 'rpc' && c.key === 'upsert_comanda_item')).toBe(true);
    expect(await db.action_queue.count()).toBe(0);
    expect((await db.comanda_items.get('i2'))?.sync_status).toBe('synced');
  });

  it('KITCHEN_STATUS llama set_kitchen_status y marca el ítem synced', async () => {
    await db.comanda_items.add({ id: 'i3', comanda_id: 'c1', business_id: 'b1', product_id: 'p1', name: 'Y', quantity: 1, price: 5, kitchen_status: 'sent', sync_status: 'pending_update' } as never);
    mockState.responses['rpc:set_kitchen_status'] = { data: null };
    await seedQueueItem({ type: 'KITCHEN_STATUS',
      payload: { item_id: 'i3', comanda_id: 'c1', business_id: 'b1', kitchen_status: 'preparando', item_updated_at: new Date().toISOString() } });

    await processQueue();

    const call = mockState.calls.find(c => c.op === 'rpc' && c.key === 'set_kitchen_status');
    expect(call).toBeTruthy();
    expect((call?.payload as { p_status: string }).p_status).toBe('preparando');
    expect(await db.action_queue.count()).toBe(0);
    expect((await db.comanda_items.get('i3'))?.sync_status).toBe('synced');
  });
});
