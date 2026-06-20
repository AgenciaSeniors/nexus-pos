import { describe, it, expect } from 'vitest';
import { computeStockDeductions, findStockConflicts, round3 } from './recipe';
import type { RecipeIngredient } from './db';

const ing = (dish: string, ingredient: string, quantity: number): RecipeIngredient =>
  ({ id: `${dish}-${ingredient}`, business_id: 'b1', dish_product_id: dish, ingredient_product_id: ingredient, quantity, sync_status: 'synced' });

describe('round3', () => {
  it('redondea a 3 decimales sin deriva de float', () => {
    expect(round3(0.1 + 0.2)).toBe(0.3);
    expect(round3(0.15 * 3)).toBe(0.45);
  });
});

describe('computeStockDeductions', () => {
  it('producto sin receta descuenta su propio stock', () => {
    const d = computeStockDeductions([{ product_id: 'p1', quantity: 2 }], new Map());
    expect(d.get('p1')).toBe(2);
  });

  it('producto con receta descuenta ingredientes (cantidad fraccional × vendido)', () => {
    const recipes = new Map<string, RecipeIngredient[]>([
      ['burger', [ing('burger', 'pan', 1), ing('burger', 'carne', 0.15)]],
    ]);
    const d = computeStockDeductions([{ product_id: 'burger', quantity: 2 }], recipes);
    expect(d.get('pan')).toBe(2);
    expect(d.get('carne')).toBe(0.3);
    expect(d.has('burger')).toBe(false); // el plato no descuenta su propio stock
  });

  it('acumula ingredientes compartidos entre platos', () => {
    const recipes = new Map<string, RecipeIngredient[]>([
      ['burger', [ing('burger', 'pan', 1)]],
      ['hotdog', [ing('hotdog', 'pan', 1)]],
    ]);
    const d = computeStockDeductions([
      { product_id: 'burger', quantity: 1 },
      { product_id: 'hotdog', quantity: 2 },
    ], recipes);
    expect(d.get('pan')).toBe(3);
  });
});

describe('findStockConflicts', () => {
  it('detecta ingredientes con stock insuficiente', () => {
    const deductions = new Map([['carne', 0.5], ['pan', 2]]);
    const products = new Map([
      ['carne', { id: 'carne', name: 'Carne', stock: 0.3 }],
      ['pan', { id: 'pan', name: 'Pan', stock: 10 }],
    ]);
    expect(findStockConflicts(deductions, products)).toEqual(['Carne']);
  });

  it('sin conflictos si hay stock suficiente', () => {
    const deductions = new Map([['pan', 2]]);
    const products = new Map([['pan', { id: 'pan', name: 'Pan', stock: 10 }]]);
    expect(findStockConflicts(deductions, products)).toEqual([]);
  });
});
