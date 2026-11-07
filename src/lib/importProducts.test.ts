import { describe, it, expect } from 'vitest';
import type { Product } from './db';
import { analyzeImportRows, cellToText, mapHeaders, parseDateCell, parseDecimal } from './importProducts';

const existing = (over: Partial<Product>): Product => ({
  id: 'p1', business_id: 'b1', name: 'Café Cubita', price: 25, cost: 10, stock: 8, stock_warehouse: 2,
  sku: 'CAF-001', category: 'Bebidas', unit: 'un', sync_status: 'synced', ...over,
});

describe('parseDecimal — precios como los escribe la gente', () => {
  it.each([
    ['25', 25], ['25.50', 25.5], ['25,50', 25.5], ['25,5', 25.5],
    ['1.234,56', 1234.56], ['1,234.56', 1234.56], ['1,234', 1234], ['1.234', 1.234],
    ['$ 25', 25], ['25 CUP', 25], ['0', 0], ['0,00', 0],
  ])('%s → %s', (raw, esperado) => {
    expect(parseDecimal(raw)).toBe(esperado);
  });
  it('vacío es "no viene" y basura es inválido', () => {
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal(undefined)).toBeNull();
    expect(parseDecimal('abc')).toBeNaN();
  });
});

describe('parseDateCell — vencimientos de Excel y a mano', () => {
  it.each([
    ['2026-12-31', '2026-12-31'], ['31/12/2026', '2026-12-31'], ['31-12-2026', '2026-12-31'],
    ['31.12.2026', '2026-12-31'], ['1/2/26', '2026-02-01'], ['46387', '2026-12-31'],
    ['2026-12-31T00:00:00.000Z', '2026-12-31'],
  ])('%s → %s', (raw, esperado) => {
    expect(parseDateCell(raw)).toBe(esperado);
  });
  it('vacío = sin fecha; no entendido = null (error en la fila)', () => {
    expect(parseDateCell('')).toBe('');
    expect(parseDateCell('pronto')).toBeNull();
    expect(parseDateCell('31/13/2026')).toBeNull();
  });
  it('las celdas de fecha de Excel llegan como Date y se pasan a AAAA-MM-DD', () => {
    expect(cellToText(new Date(2026, 11, 31))).toBe('2026-12-31');
    expect(cellToText(25.5)).toBe('25.5');
    expect(cellToText(' Café ')).toBe('Café');
  });
});

describe('mapHeaders', () => {
  it('reconoce variantes y marca las desconocidas', () => {
    expect(mapHeaders(['Nombre del Producto', 'SKU', 'Precio Venta', 'Costo', 'Stock Vitrina', 'Vencimiento', 'Color'])).toEqual([
      'name', 'sku', 'price', 'cost', 'stock', 'expiration_date', null,
    ]);
  });
});

describe('analyzeImportRows', () => {
  const headers = mapHeaders(['Nombre', 'SKU', 'Precio', 'Costo', 'Stock Vitrina', 'Stock Almacén', 'Vencimiento']);

  it('crea productos nuevos leyendo coma decimal y fecha de Excel', () => {
    const r = analyzeImportRows([['Pan', 'PAN-1', '25,50', '18,25', '10', '', '31/12/2026']], headers, [], 'skip');
    expect(r.errors).toEqual([]);
    expect(r.valid).toHaveLength(1);
    expect(r.valid[0]).toMatchObject({ name: 'Pan', sku: 'PAN-1', price: 25.5, cost: 18.25, stock: 10, expiration_date: '2026-12-31' });
    expect(r.valid[0].stock_warehouse).toBeUndefined();
  });

  it('una fecha que no se entiende es un error, no se pierde en silencio', () => {
    const r = analyzeImportRows([['Pan', 'PAN-1', '25', '', '', '', 'diciembre']], headers, [], 'skip');
    expect(r.valid).toEqual([]);
    expect(r.errors[0].message).toContain('Fecha de vencimiento no entendida');
  });

  it('precio inválido o vacío en un producto nuevo', () => {
    const r = analyzeImportRows([['Pan', 'PAN-1', 'gratis', '', '', '', ''], ['Leche', 'LEC-1', '', '', '', '', '']], headers, [], 'skip');
    expect(r.errors.map(e => e.message)).toEqual(['Precio inválido: "gratis"', 'Precio vacío (obligatorio para productos nuevos)']);
  });

  it('modo "saltar": el SKU existente se salta (como siempre)', () => {
    const r = analyzeImportRows([['Café Cubita', 'CAF-001', '30', '', '', '', '']], headers, [existing({})], 'skip');
    expect(r.skipped).toEqual([{ row: 2, sku: 'CAF-001', name: 'Café Cubita' }]);
    expect(r.updates).toEqual([]);
  });

  it('modo "actualizar": cambia precio y costo del existente y NO toca el stock', () => {
    const r = analyzeImportRows([['Café Cubita', 'caf-001', '30,00', '12', '99', '99', '']], headers, [existing({})], 'update');
    expect(r.valid).toEqual([]);
    expect(r.updates).toHaveLength(1);
    expect(r.updates[0].existing.id).toBe('p1');
    expect(r.updates[0].changes).toEqual({ price: 30, cost: 12 });
    expect(r.updates[0].stockDelta).toBe(0);
  });

  it('modo "actualizar con stock": deja el stock como el archivo y calcula el ajuste', () => {
    const r = analyzeImportRows([['Café Cubita', 'CAF-001', '25', '10', '20', '0', '']], headers, [existing({})], 'update_stock');
    expect(r.updates[0].changes).toEqual({ stock: 20, stock_warehouse: 0 });
    expect(r.updates[0].stockDelta).toBe(12);
    expect(r.updates[0].warehouseDelta).toBe(-2);
  });

  it('una fila sin cambios reales se informa como saltada, no como actualización', () => {
    const r = analyzeImportRows([['Café Cubita', 'CAF-001', '25', '10', '', '', '']], headers, [existing({})], 'update');
    expect(r.updates).toEqual([]);
    expect(r.skipped[0].name).toContain('sin cambios');
  });

  it('sin columna SKU empareja por nombre (sin tildes ni mayúsculas) y no toca el nombre', () => {
    const sinSku = mapHeaders(['Nombre', 'Precio']);
    const r = analyzeImportRows([['cafe cubita', '40']], sinSku, [existing({})], 'update');
    expect(r.updates).toHaveLength(1);
    expect(r.updates[0].changes).toEqual({ price: 40 });
  });

  it('con SKU, un nombre distinto renombra el producto', () => {
    const r = analyzeImportRows([['Café Cubita 250g', 'CAF-001', '25', '10', '', '', '']], headers, [existing({})], 'update');
    expect(r.updates[0].changes).toEqual({ name: 'Café Cubita 250g' });
  });

  it('duplicados dentro del archivo', () => {
    const r = analyzeImportRows([['Pan', 'PAN-1', '25', '', '', '', ''], ['Pan grande', 'PAN-1', '30', '', '', '', '']], headers, [], 'skip');
    expect(r.valid).toHaveLength(1);
    expect(r.errors[0].message).toContain('duplicado en el archivo');
    const sinSku = mapHeaders(['Nombre', 'Precio']);
    const r2 = analyzeImportRows([['Pan', '25'], ['PAN', '30']], sinSku, [], 'skip');
    expect(r2.valid).toHaveLength(1);
    expect(r2.errors[0].message).toContain('repetido en el archivo');
  });

  it('un archivo con nuevos y existentes mezcla los dos resultados', () => {
    const r = analyzeImportRows([
      ['Café Cubita', 'CAF-001', '28', '', '', '', ''],
      ['Pan', 'PAN-1', '5', '', '12', '', ''],
    ], headers, [existing({})], 'update');
    expect(r.updates).toHaveLength(1);
    expect(r.valid).toHaveLength(1);
    expect(r.valid[0].sku).toBe('PAN-1');
  });
});
