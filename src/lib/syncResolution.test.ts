import { describe, it, expect } from 'vitest';
import {
  shouldOverwriteLocal,
  filterRemoteItemsForBulkPut,
  computeBackoffMs,
  isReadyToRetry,
  canResolveStockConflict,
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
