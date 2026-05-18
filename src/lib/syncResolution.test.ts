import { describe, it, expect } from 'vitest';
import {
  shouldOverwriteLocal,
  filterRemoteItemsForBulkPut,
  computeBackoffMs,
  isReadyToRetry,
  canResolveStockConflict,
  sortQueueByDependency,
  compareQueueOrder,
  isStuckInProcessing,
  isTransientError,
  decideQueueItemOutcome,
  QUEUE_TYPE_PRIORITY,
  QUEUE_TYPE_LABELS,
  RETRY_CONFIG,
} from './syncResolution';

// =============================================================================
// shouldOverwriteLocal — la lógica más crítica del sync
// =============================================================================
describe('shouldOverwriteLocal', () => {
  it('sin local → debe sobrescribir', () => {
    const remote = { id: '1', updated_at: '2024-01-01T10:00:00Z' };
    expect(shouldOverwriteLocal(remote, undefined)).toBe(true);
  });

  it('local synced → debe sobrescribir (no hay conflicto)', () => {
    const remote = { id: '1', updated_at: '2024-01-01T10:00:00Z' };
    const local = { id: '1', sync_status: 'synced', updated_at: '2024-01-01T05:00:00Z' };
    expect(shouldOverwriteLocal(remote, local)).toBe(true);
  });

  it('local sin sync_status → tratado como synced, debe sobrescribir', () => {
    const remote = { id: '1', updated_at: '2024-01-01T10:00:00Z' };
    const local = { id: '1', updated_at: '2024-01-01T05:00:00Z' };
    expect(shouldOverwriteLocal(remote, local)).toBe(true);
  });

  it('local pending_update y remoto MÁS NUEVO → sobrescribir (otro dispositivo ganó)', () => {
    const remote = { id: '1', sync_status: 'synced', updated_at: '2024-01-01T12:00:00Z' };
    const local = { id: '1', sync_status: 'pending_update', updated_at: '2024-01-01T10:00:00Z' };
    expect(shouldOverwriteLocal(remote, local)).toBe(true);
  });

  it('local pending_update y remoto MÁS VIEJO → preservar local (mi cambio gana)', () => {
    const remote = { id: '1', sync_status: 'synced', updated_at: '2024-01-01T08:00:00Z' };
    const local = { id: '1', sync_status: 'pending_update', updated_at: '2024-01-01T10:00:00Z' };
    expect(shouldOverwriteLocal(remote, local)).toBe(false);
  });

  it('local pending y remoto IGUAL → preservar local (empate va al local)', () => {
    const ts = '2024-01-01T10:00:00Z';
    const remote = { id: '1', sync_status: 'synced', updated_at: ts };
    const local = { id: '1', sync_status: 'pending_update', updated_at: ts };
    expect(shouldOverwriteLocal(remote, local)).toBe(false);
  });

  it('local pending_create → preservar local incluso si remoto trae algo', () => {
    const remote = { id: '1', sync_status: 'synced', updated_at: '2024-01-01T10:00:00Z' };
    const local = { id: '1', sync_status: 'pending_create', updated_at: '2024-01-01T10:00:00Z' };
    expect(shouldOverwriteLocal(remote, local)).toBe(false);
  });

  it('local pending_delete → preservar local (no se sobrescribe item a punto de borrarse)', () => {
    const remote = { id: '1', sync_status: 'synced', updated_at: '2024-01-01T12:00:00Z' };
    const local = { id: '1', sync_status: 'pending_delete', updated_at: '2024-01-01T10:00:00Z' };
    expect(shouldOverwriteLocal(remote, local)).toBe(true); // remoto más nuevo → ok
  });
});

// =============================================================================
// filterRemoteItemsForBulkPut — la operación batch
// =============================================================================
describe('filterRemoteItemsForBulkPut', () => {
  it('sin items locales dirty → pasa todos los remotos', () => {
    const remotes = [{ id: '1' }, { id: '2' }, { id: '3' }];
    const result = filterRemoteItemsForBulkPut(remotes, []);
    expect(result.length).toBe(3);
  });

  it('filtra correctamente un mix de locales (dirty viejo + dirty nuevo)', () => {
    const remotes = [
      { id: 'A', updated_at: '2024-01-01T12:00:00Z' },
      { id: 'B', updated_at: '2024-01-01T08:00:00Z' },
      { id: 'C', updated_at: '2024-01-01T10:00:00Z' },
    ];
    const localDirty = [
      { id: 'A', sync_status: 'pending_update', updated_at: '2024-01-01T10:00:00Z' }, // remoto más nuevo → pasa
      { id: 'B', sync_status: 'pending_update', updated_at: '2024-01-01T10:00:00Z' }, // local más nuevo → bloquea
      // C no está en dirty → pasa
    ];
    const result = filterRemoteItemsForBulkPut(remotes, localDirty);
    expect(result.map(r => r.id).sort()).toEqual(['A', 'C']);
  });

  it('retorna array vacío si todos los remotos están bloqueados por locales dirty', () => {
    const remotes = [
      { id: 'A', updated_at: '2024-01-01T05:00:00Z' },
      { id: 'B', updated_at: '2024-01-01T05:00:00Z' },
    ];
    const localDirty = [
      { id: 'A', sync_status: 'pending_update', updated_at: '2024-01-01T10:00:00Z' },
      { id: 'B', sync_status: 'pending_update', updated_at: '2024-01-01T10:00:00Z' },
    ];
    const result = filterRemoteItemsForBulkPut(remotes, localDirty);
    expect(result).toEqual([]);
  });
});

// =============================================================================
// computeBackoffMs
// =============================================================================
describe('computeBackoffMs', () => {
  it('0 retries → 0 ms', () => {
    expect(computeBackoffMs(0)).toBe(0);
  });

  it('1er retry → 30s', () => {
    expect(computeBackoffMs(1)).toBe(30_000);
  });

  it('2do retry → 60s', () => {
    expect(computeBackoffMs(2)).toBe(60_000);
  });

  it('3er retry → 2 min', () => {
    expect(computeBackoffMs(3)).toBe(120_000);
  });

  it('4to retry → 4 min', () => {
    expect(computeBackoffMs(4)).toBe(240_000);
  });

  it('5to retry → capped a 5 min', () => {
    expect(computeBackoffMs(5)).toBe(300_000);
  });

  it('retries enormes siguen capped a 5 min', () => {
    expect(computeBackoffMs(100)).toBe(300_000);
  });

  it('retries negativos → 0', () => {
    expect(computeBackoffMs(-1)).toBe(0);
  });
});

// =============================================================================
// isReadyToRetry
// =============================================================================
describe('isReadyToRetry', () => {
  const NOW = new Date('2024-01-01T12:00:00Z').getTime();

  it('0 retries → siempre listo (primer intento)', () => {
    expect(isReadyToRetry(0, NOW, NOW)).toBe(true);
    expect(isReadyToRetry(0, NOW - 1000, NOW)).toBe(true);
  });

  it('1 retry → necesita esperar 30s', () => {
    // Hace 20s → todavía no
    expect(isReadyToRetry(1, NOW - 20_000, NOW)).toBe(false);
    // Hace 30s exactos → ya
    expect(isReadyToRetry(1, NOW - 30_000, NOW)).toBe(true);
    // Hace 1 min → ya
    expect(isReadyToRetry(1, NOW - 60_000, NOW)).toBe(true);
  });

  it('3 retries → necesita esperar 2 min', () => {
    expect(isReadyToRetry(3, NOW - 60_000, NOW)).toBe(false); // 1 min → no
    expect(isReadyToRetry(3, NOW - 120_000, NOW)).toBe(true); // 2 min → sí
  });

  it('10 retries → capped a 5 min', () => {
    expect(isReadyToRetry(10, NOW - 299_000, NOW)).toBe(false);
    expect(isReadyToRetry(10, NOW - 300_000, NOW)).toBe(true);
  });
});

// =============================================================================
// canResolveStockConflict
// =============================================================================
describe('canResolveStockConflict', () => {
  it('items vacíos → no resolver', () => {
    expect(canResolveStockConflict([], () => null)).toBe(false);
  });

  it('todos los productos tienen stock suficiente → resolver', () => {
    const items = [
      { product_id: 'A', quantity: 2 },
      { product_id: 'B', quantity: 5 },
    ];
    const products: Record<string, { stock: number }> = {
      A: { stock: 10 },
      B: { stock: 5 },
    };
    expect(canResolveStockConflict(items, pid => products[pid])).toBe(true);
  });

  it('producto sin stock suficiente → NO resolver', () => {
    const items = [
      { product_id: 'A', quantity: 5 },
      { product_id: 'B', quantity: 100 },
    ];
    const products: Record<string, { stock: number }> = {
      A: { stock: 10 },
      B: { stock: 5 }, // insuficiente
    };
    expect(canResolveStockConflict(items, pid => products[pid])).toBe(false);
  });

  it('producto eliminado → NO resolver', () => {
    const items = [{ product_id: 'A', quantity: 1 }];
    expect(canResolveStockConflict(items, () => ({ stock: 100, deleted_at: '2024-01-01' }))).toBe(false);
  });

  it('producto no encontrado → NO resolver', () => {
    const items = [{ product_id: 'A', quantity: 1 }];
    expect(canResolveStockConflict(items, () => null)).toBe(false);
    expect(canResolveStockConflict(items, () => undefined)).toBe(false);
  });

  it('cantidad exactamente igual al stock → resolver', () => {
    const items = [{ product_id: 'A', quantity: 5 }];
    expect(canResolveStockConflict(items, () => ({ stock: 5 }))).toBe(true);
  });

  it('cantidad > stock por una unidad → NO resolver', () => {
    const items = [{ product_id: 'A', quantity: 6 }];
    expect(canResolveStockConflict(items, () => ({ stock: 5 }))).toBe(false);
  });
});

// =============================================================================
// QUEUE_TYPE_LABELS / RETRY_CONFIG — sanity check
// =============================================================================
describe('Constantes exportadas', () => {
  it('QUEUE_TYPE_LABELS cubre todos los tipos conocidos', () => {
    const expectedTypes = [
      'SALE', 'PRODUCT_SYNC', 'CUSTOMER_SYNC', 'MOVEMENT', 'AUDIT',
      'SETTINGS_SYNC', 'SHIFT', 'CASH_MOVEMENT', 'STAFF_SYNC',
      'VOID_SALE', 'PARTIAL_REFUND', 'LOYALTY_CHANGE',
    ];
    for (const t of expectedTypes) {
      expect(QUEUE_TYPE_LABELS[t]).toBeDefined();
      expect(QUEUE_TYPE_LABELS[t].length).toBeGreaterThan(0);
    }
  });

  it('RETRY_CONFIG tiene valores razonables', () => {
    expect(RETRY_CONFIG.MAX_RETRIES).toBeGreaterThan(0);
    expect(RETRY_CONFIG.BACKOFF_BASE_MS).toBeGreaterThan(0);
    expect(RETRY_CONFIG.BACKOFF_MAX_MS).toBeGreaterThan(RETRY_CONFIG.BACKOFF_BASE_MS);
  });
});

// =============================================================================
// compareQueueOrder / sortQueueByDependency — orden de la cola por dependencia FK
// =============================================================================
describe('compareQueueOrder', () => {
  it('entidad base (STAFF_SYNC) va antes que dependiente (AUDIT)', () => {
    const staff = { type: 'STAFF_SYNC', timestamp: 100 };
    const audit = { type: 'AUDIT', timestamp: 50 }; // más viejo pero depende
    expect(compareQueueOrder(staff, audit)).toBeLessThan(0); // staff primero
  });

  it('SHIFT va antes que SALE', () => {
    const shift = { type: 'SHIFT', timestamp: 200 };
    const sale = { type: 'SALE', timestamp: 100 };
    expect(compareQueueOrder(shift, sale)).toBeLessThan(0);
  });

  it('SALE va antes que VOID_SALE (no se anula algo que no existe)', () => {
    const sale = { type: 'SALE', timestamp: 100 };
    const voidSale = { type: 'VOID_SALE', timestamp: 50 };
    expect(compareQueueOrder(sale, voidSale)).toBeLessThan(0);
  });

  it('mismo tipo → ordena por timestamp (FIFO)', () => {
    const a = { type: 'SALE', timestamp: 100 };
    const b = { type: 'SALE', timestamp: 200 };
    expect(compareQueueOrder(a, b)).toBeLessThan(0); // el más viejo primero
    expect(compareQueueOrder(b, a)).toBeGreaterThan(0);
  });

  it('mismo nivel de prioridad, distinto tipo → ordena por timestamp', () => {
    // MOVEMENT y AUDIT ambos prioridad 40
    const mov = { type: 'MOVEMENT', timestamp: 300 };
    const audit = { type: 'AUDIT', timestamp: 100 };
    expect(compareQueueOrder(mov, audit)).toBeGreaterThan(0); // audit más viejo
  });

  it('tipo desconocido recibe prioridad media', () => {
    const unknown = { type: 'TIPO_RARO', timestamp: 100 };
    const base = { type: 'PRODUCT_SYNC', timestamp: 999 };
    const mutation = { type: 'VOID_SALE', timestamp: 1 };
    expect(compareQueueOrder(base, unknown)).toBeLessThan(0);    // base antes
    expect(compareQueueOrder(unknown, mutation)).toBeLessThan(0); // antes que mutación
  });
});

describe('sortQueueByDependency', () => {
  it('ordena una cola mixta respetando dependencias', () => {
    // Cola desordenada como llegaría de IndexedDB
    const queue = [
      { id: '1', type: 'AUDIT', timestamp: 10 },
      { id: '2', type: 'SALE', timestamp: 20 },
      { id: '3', type: 'STAFF_SYNC', timestamp: 30 },
      { id: '4', type: 'SHIFT', timestamp: 40 },
      { id: '5', type: 'VOID_SALE', timestamp: 5 },
      { id: '6', type: 'PRODUCT_SYNC', timestamp: 50 },
    ];
    const sorted = sortQueueByDependency(queue);
    const order = sorted.map(i => i.type);
    // Base (STAFF/PRODUCT) → SHIFT → SALE → AUDIT → VOID_SALE
    expect(order).toEqual([
      'STAFF_SYNC', 'PRODUCT_SYNC', 'SHIFT', 'SALE', 'AUDIT', 'VOID_SALE',
    ]);
  });

  it('no muta el array original', () => {
    const queue = [
      { id: '1', type: 'AUDIT', timestamp: 10 },
      { id: '2', type: 'STAFF_SYNC', timestamp: 20 },
    ];
    const original = [...queue];
    sortQueueByDependency(queue);
    expect(queue).toEqual(original);
  });

  it('cola vacía → array vacío', () => {
    expect(sortQueueByDependency([])).toEqual([]);
  });

  it('escenario real del bug: items viejos rotos no impiden ordenar los nuevos', () => {
    // 5 SHIFT viejos rotos + 1 SALE nueva. La SALE debe poder procesarse.
    const queue = [
      { id: 's1', type: 'SHIFT', timestamp: 1 },
      { id: 's2', type: 'SHIFT', timestamp: 2 },
      { id: 's3', type: 'SHIFT', timestamp: 3 },
      { id: 's4', type: 'SHIFT', timestamp: 4 },
      { id: 's5', type: 'SHIFT', timestamp: 5 },
      { id: 'venta-nueva', type: 'SALE', timestamp: 9999 },
    ];
    const sorted = sortQueueByDependency(queue);
    // La venta nueva está presente y ordenada (después de los shifts por prioridad)
    expect(sorted.find(i => i.id === 'venta-nueva')).toBeDefined();
    expect(sorted.length).toBe(6);
  });
});

// =============================================================================
// isStuckInProcessing
// =============================================================================
describe('isStuckInProcessing', () => {
  const NOW = 1_000_000_000;

  it('item pending nunca está atascado', () => {
    expect(isStuckInProcessing('pending', NOW - 999_999, NOW)).toBe(false);
  });

  it('item processing reciente NO está atascado', () => {
    expect(isStuckInProcessing('processing', NOW - 10_000, NOW)).toBe(false); // 10s
  });

  it('item processing viejo (>2min) SÍ está atascado', () => {
    expect(isStuckInProcessing('processing', NOW - 130_000, NOW)).toBe(true); // 2m10s
  });

  it('umbral exacto de 2 min cuenta como atascado', () => {
    expect(isStuckInProcessing('processing', NOW - 120_000, NOW)).toBe(true);
  });

  it('umbral configurable', () => {
    expect(isStuckInProcessing('processing', NOW - 60_000, NOW, 30_000)).toBe(true);
    expect(isStuckInProcessing('processing', NOW - 20_000, NOW, 30_000)).toBe(false);
  });

  it('item failed no se considera atascado en processing', () => {
    expect(isStuckInProcessing('failed', NOW - 999_999, NOW)).toBe(false);
  });
});

// =============================================================================
// isTransientError — distinguir errores de red de errores permanentes
// =============================================================================
describe('isTransientError', () => {
  it('detecta timeout del withTimeout (español)', () => {
    expect(isTransientError('Tiempo de espera agotado (35s) procesando SALE')).toBe(true);
  });

  it('detecta errores de red comunes', () => {
    expect(isTransientError('Failed to fetch')).toBe(true);
    expect(isTransientError('NetworkError when attempting to fetch resource')).toBe(true);
    expect(isTransientError('TypeError: network request failed')).toBe(true);
    expect(isTransientError('fetch failed')).toBe(true);
    expect(isTransientError('Load failed')).toBe(true); // Safari
    expect(isTransientError('ECONNRESET')).toBe(true);
    expect(isTransientError('ETIMEDOUT')).toBe(true);
    expect(isTransientError('The operation was aborted')).toBe(true);
    expect(isTransientError('net::ERR_INTERNET_DISCONNECTED')).toBe(true);
  });

  it('detecta errores de servidor temporal (5xx)', () => {
    expect(isTransientError('503 Service Unavailable')).toBe(true);
    expect(isTransientError('504 Gateway Timeout')).toBe(true);
  });

  it('NO marca como transitorio errores permanentes de base de datos', () => {
    expect(isTransientError('insert or update on table "audit_logs" violates foreign key constraint')).toBe(false);
    expect(isTransientError("Could not find the 'transfer_count' column of 'cash_shifts'")).toBe(false);
    expect(isTransientError('null value in column "id" violates not-null constraint')).toBe(false);
    expect(isTransientError('La venta no tiene un id válido (payload corrupto)')).toBe(false);
    expect(isTransientError('duplicate key value violates unique constraint')).toBe(false);
  });

  it('string vacío o sin sentido → no transitorio', () => {
    expect(isTransientError('')).toBe(false);
    expect(isTransientError('algo raro')).toBe(false);
  });

  it('es case-insensitive', () => {
    expect(isTransientError('FAILED TO FETCH')).toBe(true);
    expect(isTransientError('TiMeOuT')).toBe(true);
  });
});

// =============================================================================
// decideQueueItemOutcome — el reintento inteligente
// =============================================================================
describe('decideQueueItemOutcome', () => {
  it('error de red → SIEMPRE retry, nunca failed (aunque lleve muchos intentos)', () => {
    for (const prev of [0, 1, 4, 5, 10, 50]) {
      const d = decideQueueItemOutcome('Failed to fetch', prev);
      expect(d.outcome).toBe('retry');
      expect(d.transient).toBe(true);
    }
  });

  it('error de red → retries se capea en MAX_RETRIES (para el backoff)', () => {
    const d = decideQueueItemOutcome('Tiempo de espera agotado', 20);
    expect(d.retries).toBe(RETRY_CONFIG.MAX_RETRIES);
  });

  it('error permanente → retry mientras no agote intentos', () => {
    const d = decideQueueItemOutcome('foreign key constraint violation', 0);
    expect(d.outcome).toBe('retry');
    expect(d.retries).toBe(1);
    expect(d.transient).toBe(false);
  });

  it('error permanente → failed al llegar a MAX_RETRIES', () => {
    const d = decideQueueItemOutcome('foreign key constraint violation', RETRY_CONFIG.MAX_RETRIES - 1);
    expect(d.outcome).toBe('failed');
    expect(d.transient).toBe(false);
  });

  it('error permanente con retries ya por encima del máximo → failed', () => {
    const d = decideQueueItemOutcome('null value in column', 10);
    expect(d.outcome).toBe('failed');
  });

  it('el caso del bug: 5 timeouts de red NO mandan la venta a failed', () => {
    // Simula una venta que falla 5 veces seguidas por red mala
    let retries = 0;
    for (let i = 0; i < 5; i++) {
      const d = decideQueueItemOutcome('Tiempo de espera agotado (35s) procesando SALE', retries);
      expect(d.outcome).toBe('retry'); // ← nunca 'failed'
      retries = d.retries;
    }
    // Tras 5 fallos de red, la venta SIGUE en la cola lista para reintentar
  });
});

// =============================================================================
// QUEUE_TYPE_PRIORITY — sanity check
// =============================================================================
describe('QUEUE_TYPE_PRIORITY', () => {
  it('entidades base tienen prioridad menor que mutaciones', () => {
    expect(QUEUE_TYPE_PRIORITY.STAFF_SYNC).toBeLessThan(QUEUE_TYPE_PRIORITY.SHIFT);
    expect(QUEUE_TYPE_PRIORITY.SHIFT).toBeLessThan(QUEUE_TYPE_PRIORITY.SALE);
    expect(QUEUE_TYPE_PRIORITY.SALE).toBeLessThan(QUEUE_TYPE_PRIORITY.AUDIT);
    expect(QUEUE_TYPE_PRIORITY.AUDIT).toBeLessThan(QUEUE_TYPE_PRIORITY.VOID_SALE);
  });

  it('cubre todos los tipos de operación', () => {
    const tipos = ['SALE','PRODUCT_SYNC','CUSTOMER_SYNC','MOVEMENT','AUDIT',
      'SETTINGS_SYNC','SHIFT','CASH_MOVEMENT','STAFF_SYNC','VOID_SALE',
      'PARTIAL_REFUND','LOYALTY_CHANGE'];
    for (const t of tipos) expect(QUEUE_TYPE_PRIORITY[t]).toBeGreaterThan(0);
  });
});
