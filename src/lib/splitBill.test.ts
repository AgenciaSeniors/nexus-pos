import { describe, it, expect } from 'vitest';
import { splitEqual, splitByItems, allItemsAssigned } from './splitBill';

const sum = (a: number[]) => a.reduce((s, x) => Math.round((s + x) * 100) / 100, 0);

describe('splitEqual', () => {
  it('divide exacto cuando es divisible', () => {
    expect(splitEqual(10, 2)).toEqual([5, 5]);
  });

  it('reparte los centavos de resto y la suma es exacta', () => {
    const parts = splitEqual(10, 3);
    expect(parts).toEqual([3.34, 3.33, 3.33]);
    expect(sum(parts)).toBe(10);
  });

  it('maneja restos mayores manteniendo la suma', () => {
    const parts = splitEqual(100, 7);
    expect(sum(parts)).toBe(100);
    expect(parts.length).toBe(7);
  });

  it('0 partes devuelve vacío', () => {
    expect(splitEqual(10, 0)).toEqual([]);
  });
});

describe('splitByItems', () => {
  const items = [
    { id: 'a', total: 10 },
    { id: 'b', total: 5 },
    { id: 'c', total: 7.5 },
  ];

  it('suma cada sub-cuenta según la asignación', () => {
    const totals = splitByItems(items, { a: 0, b: 1, c: 0 }, 2);
    expect(totals).toEqual([17.5, 5]);
  });

  it('ignora ítems sin asignar', () => {
    const totals = splitByItems(items, { a: 0, b: 1 }, 2);
    expect(totals).toEqual([10, 5]);
  });
});

describe('allItemsAssigned', () => {
  const items = [{ id: 'a', total: 1 }, { id: 'b', total: 2 }];
  it('true si todos asignados', () => {
    expect(allItemsAssigned(items, { a: 0, b: 1 }, 2)).toBe(true);
  });
  it('false si falta alguno', () => {
    expect(allItemsAssigned(items, { a: 0 }, 2)).toBe(false);
  });
});
