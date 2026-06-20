import { describe, it, expect } from 'vitest';
import { comandaItemTotal, comandaTotal } from './comanda';

describe('comandaItemTotal', () => {
  it('usa precio base * cantidad', () => {
    expect(comandaItemTotal({ price: 10, quantity: 3 })).toBe(30);
  });

  it('custom_price reemplaza al precio base', () => {
    expect(comandaItemTotal({ price: 10, custom_price: 8, quantity: 2 })).toBe(16);
  });

  it('suma modifiers_total por unidad', () => {
    expect(comandaItemTotal({ price: 10, quantity: 1, modifiers_total: 2.5 })).toBe(12.5);
  });

  it('modifiers_total es por unidad: se multiplica por la cantidad', () => {
    // (10 + 2) * 2 = 24
    expect(comandaItemTotal({ price: 10, quantity: 2, modifiers_total: 2 })).toBe(24);
  });

  it('una línea anulada no suma', () => {
    expect(comandaItemTotal({ price: 10, quantity: 5, voided: true })).toBe(0);
  });

  it('maneja decimales sin error de punto flotante', () => {
    // 0.1 * 3 = 0.30000000000000004 en float crudo
    expect(comandaItemTotal({ price: 0.1, quantity: 3 })).toBe(0.3);
  });
});

describe('comandaTotal', () => {
  it('suma las líneas no anuladas', () => {
    const total = comandaTotal([
      { price: 10, quantity: 2 },           // 20
      { price: 5, quantity: 1, modifiers_total: 1 }, // 6
      { price: 100, quantity: 1, voided: true },     // 0
    ]);
    expect(total).toBe(26);
  });

  it('comanda vacía suma 0', () => {
    expect(comandaTotal([])).toBe(0);
  });
});
