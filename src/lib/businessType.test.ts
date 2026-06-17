import { describe, it, expect } from 'vitest';
import { resolveBusinessType, isRestaurantMode } from './businessType';

describe('resolveBusinessType', () => {
  it('devuelve retail si no hay settings', () => {
    expect(resolveBusinessType(undefined)).toBe('retail');
    expect(resolveBusinessType(null)).toBe('retail');
    expect(resolveBusinessType([])).toBe('retail');
  });

  it('devuelve retail si el campo está ausente (tenant existente)', () => {
    expect(resolveBusinessType([{}])).toBe('retail');
  });

  it('devuelve retail explícito', () => {
    expect(resolveBusinessType([{ business_type: 'retail' }])).toBe('retail');
  });

  it('devuelve restaurant cuando el campo lo indica', () => {
    expect(resolveBusinessType([{ business_type: 'restaurant' }])).toBe('restaurant');
  });

  it('usa la primera fila de settings', () => {
    expect(resolveBusinessType([{ business_type: 'restaurant' }, { business_type: 'retail' }])).toBe('restaurant');
  });

  it('trata valores inválidos como retail', () => {
    // @ts-expect-error valor fuera del union, debe degradar a retail
    expect(resolveBusinessType([{ business_type: 'foo' }])).toBe('retail');
  });

  it('isRestaurantMode refleja el helper', () => {
    expect(isRestaurantMode([{ business_type: 'restaurant' }])).toBe(true);
    expect(isRestaurantMode([{ business_type: 'retail' }])).toBe(false);
    expect(isRestaurantMode(undefined)).toBe(false);
  });
});
