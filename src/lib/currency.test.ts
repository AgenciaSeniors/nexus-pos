import { describe, it, expect } from 'vitest';
import { currency } from './currency';

describe('currency.toCents / fromCents', () => {
  it('convierte 10.50 → 1050 cents', () => {
    expect(currency.toCents(10.50)).toBe(1050);
  });

  it('convierte 0.01 → 1 cent', () => {
    expect(currency.toCents(0.01)).toBe(1);
  });

  it('redondea 10.005 → 1001 (banker rounding hacia arriba en 5)', () => {
    expect(currency.toCents(10.005)).toBe(1001);
  });

  it('maneja 0 correctamente', () => {
    expect(currency.toCents(0)).toBe(0);
    expect(currency.fromCents(0)).toBe(0);
  });

  it('fromCents revierte toCents', () => {
    expect(currency.fromCents(currency.toCents(123.45))).toBe(123.45);
  });

  it('maneja números negativos', () => {
    expect(currency.toCents(-50.25)).toBe(-5025);
    expect(currency.fromCents(-5025)).toBe(-50.25);
  });
});

describe('currency.add', () => {
  it('arregla el clásico 0.1 + 0.2 ≠ 0.3', () => {
    // En JS plano: 0.1 + 0.2 === 0.30000000000000004
    expect(currency.add(0.1, 0.2)).toBe(0.3);
  });

  it('suma normal', () => {
    expect(currency.add(10.50, 5.25)).toBe(15.75);
  });

  it('suma con cero', () => {
    expect(currency.add(0, 99.99)).toBe(99.99);
    expect(currency.add(99.99, 0)).toBe(99.99);
  });

  it('suma muchos decimales sin acumular error', () => {
    let total = 0;
    for (let i = 0; i < 100; i++) {
      total = currency.add(total, 0.01);
    }
    expect(total).toBe(1.00);
  });

  it('suma con negativo (equivale a resta)', () => {
    expect(currency.add(10, -3)).toBe(7);
  });
});

describe('currency.subtract', () => {
  it('arregla 1 - 0.9 ≠ 0.1 del JS plano', () => {
    // En JS plano: 1 - 0.9 === 0.09999999999999998
    expect(currency.subtract(1, 0.9)).toBe(0.1);
  });

  it('resta normal', () => {
    expect(currency.subtract(100, 25.50)).toBe(74.50);
  });

  it('resta dando 0', () => {
    expect(currency.subtract(50, 50)).toBe(0);
  });

  it('resta dando negativo', () => {
    expect(currency.subtract(10, 25)).toBe(-15);
  });
});

describe('currency.multiply', () => {
  it('multiplica precio × cantidad entera', () => {
    expect(currency.multiply(9.99, 3)).toBe(29.97);
  });

  it('multiplica con cantidad fraccionaria (0.5 kg de algo)', () => {
    expect(currency.multiply(10.00, 0.5)).toBe(5.00);
  });

  it('multiplica con cantidad fraccionaria que causaría imprecisión', () => {
    // 1.75 × $19.99 — caso clásico de imprecisión flotante
    expect(currency.multiply(19.99, 1.75)).toBe(34.98);
  });

  it('multiplica por 0', () => {
    expect(currency.multiply(100, 0)).toBe(0);
    expect(currency.multiply(0, 100)).toBe(0);
  });

  it('multiplica por 1', () => {
    expect(currency.multiply(123.45, 1)).toBe(123.45);
  });

  it('multiplica precios con muchos decimales', () => {
    expect(currency.multiply(0.99, 100)).toBe(99);
  });

  it('multiplica $0.10 × 0.5 — debe dar $0.05', () => {
    expect(currency.multiply(0.10, 0.5)).toBe(0.05);
  });
});

describe('currency.calculateTotal', () => {
  it('total de un carrito vacío es 0', () => {
    expect(currency.calculateTotal([])).toBe(0);
  });

  it('total de un solo item', () => {
    expect(currency.calculateTotal([{ price: 19.99, quantity: 2 }])).toBe(39.98);
  });

  it('total de múltiples items', () => {
    expect(currency.calculateTotal([
      { price: 10.00, quantity: 1 },
      { price: 5.50, quantity: 2 },
      { price: 1.99, quantity: 3 },
    ])).toBe(26.97);
  });

  it('total con cantidades fraccionarias', () => {
    expect(currency.calculateTotal([
      { price: 20.00, quantity: 0.5 },  // 10
      { price: 15.00, quantity: 1.5 },  // 22.50
    ])).toBe(32.50);
  });

  it('total con muchos items pequeños — sin acumular error flotante', () => {
    const items = Array.from({ length: 100 }, () => ({ price: 0.01, quantity: 1 }));
    expect(currency.calculateTotal(items)).toBe(1.00);
  });

  it('total con descuentos representados como precios negativos', () => {
    expect(currency.calculateTotal([
      { price: 100, quantity: 1 },
      { price: -10, quantity: 1 },
    ])).toBe(90);
  });
});

describe('currency.format', () => {
  it('formatea un número entero', () => {
    const result = currency.format(1000);
    // El resultado depende del locale del entorno de test (Node puede no tener es-CU completo)
    // Verificamos que contiene los componentes esperados
    expect(result).toMatch(/1[\s.,]?000/);
  });

  it('formatea un número con decimales', () => {
    const result = currency.format(1234.56);
    expect(result).toMatch(/1[\s.,]?234[.,]56/);
  });

  it('formatea 0', () => {
    expect(currency.format(0)).toMatch(/0[.,]00/);
  });
});
