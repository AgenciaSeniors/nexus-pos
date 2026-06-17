import { describe, it, expect } from 'vitest';
import { modifiersTotal, lineUnitPrice, validateGroupSelection } from './modifiers';

const mod = (price_delta: number) => ({ price_delta });

describe('modifiersTotal', () => {
  it('suma los price_delta', () => {
    expect(modifiersTotal([mod(1), mod(2.5), mod(0)])).toBe(3.5);
  });
  it('sin modificadores = 0', () => {
    expect(modifiersTotal([])).toBe(0);
  });
  it('maneja decimales sin error de float', () => {
    expect(modifiersTotal([mod(0.1), mod(0.2)])).toBe(0.3);
  });
});

describe('lineUnitPrice', () => {
  it('precio base + extras', () => {
    expect(lineUnitPrice(10, [mod(2), mod(1.5)])).toBe(13.5);
  });
});

describe('validateGroupSelection', () => {
  it('grupo requerido exige al menos 1', () => {
    expect(validateGroupSelection({ required: true }, 0)).toBe('Elige una opción');
    expect(validateGroupSelection({ required: true }, 1)).toBeNull();
  });
  it('respeta min_select', () => {
    expect(validateGroupSelection({ min_select: 2 }, 1)).toBe('Elige al menos 2');
    expect(validateGroupSelection({ min_select: 2 }, 2)).toBeNull();
  });
  it('respeta max_select (única opción)', () => {
    expect(validateGroupSelection({ max_select: 1 }, 2)).toBe('Elige solo una opción');
    expect(validateGroupSelection({ max_select: 1 }, 1)).toBeNull();
  });
  it('respeta max_select múltiple', () => {
    expect(validateGroupSelection({ max_select: 3 }, 4)).toBe('Elige máximo 3');
    expect(validateGroupSelection({ max_select: 3 }, 3)).toBeNull();
  });
  it('sin reglas, cualquier cantidad es válida', () => {
    expect(validateGroupSelection({}, 0)).toBeNull();
    expect(validateGroupSelection({}, 5)).toBeNull();
  });
});
