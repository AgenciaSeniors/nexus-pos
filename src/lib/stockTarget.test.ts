import { describe, it, expect } from 'vitest';
import { resolveStockTarget, movementReason, parseInitialStock } from './stockTarget';

describe('resolveStockTarget', () => {
  it('una compra ya NO cae forzosamente en almacén', () => {
    // Este era el bug: 'restock' devolvía 'warehouse' pasara lo que pasara, así
    // que para dejar mercancía en vitrina hacía falta un traslado extra.
    expect(resolveStockTarget('restock', 'display')).toBe('display');
  });

  it('una compra respeta almacén cuando el usuario lo elige', () => {
    expect(resolveStockTarget('restock', 'warehouse')).toBe('warehouse');
  });

  it('una devolución de cliente siempre entra a vitrina', () => {
    expect(resolveStockTarget('return', 'display')).toBe('display');
    expect(resolveStockTarget('return', 'warehouse')).toBe('display');
  });

  it('merma y corrección respetan lo elegido', () => {
    expect(resolveStockTarget('damage', 'warehouse')).toBe('warehouse');
    expect(resolveStockTarget('damage', 'display')).toBe('display');
    expect(resolveStockTarget('correction', 'warehouse')).toBe('warehouse');
    expect(resolveStockTarget('correction', 'display')).toBe('display');
  });
});

describe('movementReason', () => {
  it('en vitrina usa el motivo tal cual', () => {
    expect(movementReason('restock', 'display')).toBe('restock');
    expect(movementReason('damage', 'display')).toBe('damage');
    expect(movementReason('return', 'display')).toBe('return');
  });

  it('la compra a almacén conserva su clave histórica', () => {
    // 'restock_warehouse' ya existe en movimientos guardados y en las etiquetas
    // de InventoryHistory; no puede pasar a 'restock_warehouse' por otra vía.
    expect(movementReason('restock', 'warehouse')).toBe('restock_warehouse');
  });

  it('el resto de motivos en almacén llevan sufijo', () => {
    expect(movementReason('damage', 'warehouse')).toBe('damage_warehouse');
    expect(movementReason('correction', 'warehouse')).toBe('correction_warehouse');
  });
});

describe('parseInitialStock', () => {
  it('vacío es 0 (producto sin existencias todavía)', () => {
    expect(parseInitialStock('')).toBe(0);
    expect(parseInitialStock('   ')).toBe(0);
  });

  it('texto no numérico es 0', () => {
    expect(parseInitialStock('abc')).toBe(0);
    expect(parseInitialStock('-')).toBe(0);
  });

  it('negativo es 0: crear con stock negativo no significa nada', () => {
    expect(parseInitialStock('-5')).toBe(0);
    expect(parseInitialStock('-0.5')).toBe(0);
  });

  it('lee enteros y decimales', () => {
    expect(parseInitialStock('12')).toBe(12);
    expect(parseInitialStock('0.5')).toBe(0.5);
  });

  it('redondea a 3 decimales como el resto del stock', () => {
    // Misma regla que las demás mutaciones de stock, para no arrastrar deriva
    // de coma flotante a la vitrina.
    expect(parseInitialStock('0.6000000000000001')).toBe(0.6);
    expect(parseInitialStock('1.23456')).toBe(1.235);
  });

  it('cero explícito es 0', () => {
    expect(parseInitialStock('0')).toBe(0);
  });
});
