/**
 * Importación de productos desde CSV / Excel: funciones PURAS (sin React ni Dexie) para
 * poder probarlas.
 *
 * Lo que arregla respecto a la versión anterior (que vivía dentro de InventoryPage):
 *  - Precios con coma decimal ("25,50") se leían como 25 sin aviso. Ahora se entienden
 *    "25,50", "1.234,56", "1,234.56" y "$25".
 *  - Las fechas de vencimiento que venían de Excel ("31/12/2026", o el número de serie de
 *    Excel) se ignoraban en silencio. Ahora se aceptan varios formatos y, si no se entiende,
 *    la fila sale como error en vez de perder la fecha.
 *  - Solo creaba productos nuevos: un SKU existente se saltaba. Ahora hay un modo
 *    "actualizar": el mismo archivo sirve para cambiar precios/costos (y, si se pide, el
 *    stock) de productos que ya existen, emparejando por SKU o, si no hay SKU, por nombre.
 */
import type { Product } from './db';
import { normalizeText } from './textSearch';

export type ImportField =
  | 'name' | 'sku' | 'category' | 'price' | 'cost' | 'stock' | 'stock_warehouse'
  | 'unit' | 'expiration_date' | 'low_stock_threshold';

/** Encabezados aceptados (en minúsculas, sin comillas) → campo interno. */
export const HEADER_MAP: Record<string, ImportField> = {
  'nombre del producto': 'name', 'nombre': 'name', 'product name': 'name', 'producto': 'name', 'descripcion': 'name', 'descripción': 'name',
  'sku': 'sku', 'codigo': 'sku', 'código': 'sku', 'code': 'sku', 'codigo de barras': 'sku', 'código de barras': 'sku',
  'categoria': 'category', 'categoría': 'category', 'category': 'category',
  'precio venta': 'price', 'precio de venta': 'price', 'precio': 'price', 'price': 'price', 'sale price': 'price',
  'costo': 'cost', 'cost': 'cost', 'precio costo': 'cost', 'precio de costo': 'cost',
  'stock vitrina': 'stock', 'stock': 'stock', 'display stock': 'stock', 'existencia': 'stock', 'cantidad': 'stock', 'vitrina': 'stock',
  'stock almacen': 'stock_warehouse', 'stock almacén': 'stock_warehouse', 'warehouse stock': 'stock_warehouse', 'almacen': 'stock_warehouse', 'almacén': 'stock_warehouse',
  'unidad de medida': 'unit', 'unidad': 'unit', 'unit': 'unit',
  'vencimiento': 'expiration_date', 'expiration': 'expiration_date', 'expiration date': 'expiration_date', 'fecha vencimiento': 'expiration_date', 'fecha de vencimiento': 'expiration_date',
  'alerta stock': 'low_stock_threshold', 'low stock': 'low_stock_threshold', 'stock minimo': 'low_stock_threshold', 'stock mínimo': 'low_stock_threshold',
};

/** Qué hacer con las filas cuyo producto ya existe. */
export type ExistingMode =
  /** Saltarlas (comportamiento de siempre). */
  | 'skip'
  /** Actualizar precio, costo, categoría, unidad, vencimiento y alerta; el stock NO se toca. */
  | 'update'
  /** Lo anterior y además dejar el stock como dice el archivo (se registra el ajuste). */
  | 'update_stock';

export interface ImportRowError { row: number; message: string }
export interface ImportSkipped { row: number; sku: string; name: string }

/** Producto nuevo listo para crear. */
export interface NewProductRow {
  row: number;
  name: string;
  sku: string;
  price: number;
  cost: number;
  category: string;
  unit: string;
  stock: number;
  stock_warehouse?: number;
  expiration_date?: string;
  low_stock_threshold?: number;
}

/** Producto existente con lo que cambia. */
export interface UpdateProductRow {
  row: number;
  existing: Product;
  /** Campos que cambian (solo los presentes en el archivo y distintos del valor actual). */
  changes: Partial<Pick<Product, 'name' | 'price' | 'cost' | 'category' | 'unit' | 'expiration_date' | 'low_stock_threshold' | 'stock' | 'stock_warehouse'>>;
  /** Diferencia de stock vitrina / almacén si el modo lo pide (positivo = entra). */
  stockDelta: number;
  warehouseDelta: number;
}

export interface ImportAnalysis {
  valid: NewProductRow[];
  updates: UpdateProductRow[];
  errors: ImportRowError[];
  skipped: ImportSkipped[];
  /** Columnas reconocidas, en el orden del archivo (null = ignorada). */
  fieldMap: (ImportField | null)[];
}

const clean = (v: string | undefined): string => (v ?? '').replace(/^["']|["']$/g, '').trim();

/** Encabezados del archivo → campos internos. */
export function mapHeaders(headers: string[]): (ImportField | null)[] {
  return headers.map(h => HEADER_MAP[clean(h).toLowerCase().replace(/\s+/g, ' ')] ?? null);
}

/**
 * Número con coma o punto decimal, miles opcionales y símbolo de moneda.
 * "25,50" → 25.5 · "1.234,56" → 1234.56 · "1,234.56" → 1234.56 · "$ 25" → 25 · "" → null · "abc" → NaN
 */
export function parseDecimal(raw: string | undefined): number | null {
  const original = clean(raw);
  if (!original) return null;
  let s = original.replace(/[^\d.,-]/g, '');
  if (!s) return NaN; // había texto pero ningún número ("gratis")
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // Los dos presentes: el que va último es el decimal; el otro, miles.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    // Solo comas: una sola coma con 1-2 decimales es decimal ("25,5"); si no, miles ("1,234").
    const parts = s.split(',');
    s = parts.length === 2 && parts[1].length <= 2 ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (lastDot >= 0) {
    const parts = s.split('.');
    // "1.234" con tres dígitos tras el punto y más de un grupo = miles; "25.5" = decimal.
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3 && parts[0] !== '0')) {
      // ambiguo ("1.234"): en Cuba lo normal es miles con punto
      s = parts.length > 2 ? s.replace(/\./g, '') : s;
    }
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (y: number, m: number, d: number): string | null => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
};

/**
 * Fecha de vencimiento → "AAAA-MM-DD". Acepta AAAA-MM-DD, DD/MM/AAAA, DD-MM-AAAA, DD.MM.AAAA,
 * D/M/AA y el número de serie de Excel. Vacío → '' (sin fecha); no entendida → null.
 */
export function parseDateCell(raw: string | undefined): string | '' | null {
  const s = clean(raw);
  if (!s) return '';
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return isoDate(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return isoDate(y, +m[2], +m[1]);
  }
  // Número de serie de Excel (días desde 1899-12-30): entre 2000 y 2100
  if (/^\d{5}$/.test(s)) {
    const serial = +s;
    if (serial >= 36526 && serial <= 73050) {
      const dt = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
      return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
    }
  }
  return null;
}

/**
 * Analiza las filas del archivo contra los productos existentes.
 *
 * @param dataRows   Filas de datos (sin encabezado), como texto.
 * @param fieldMap   Resultado de `mapHeaders`.
 * @param existing   Productos actuales del negocio (sin borrados).
 * @param mode       Qué hacer con los que ya existen.
 */
export function analyzeImportRows(
  dataRows: string[][],
  fieldMap: (ImportField | null)[],
  existing: Product[],
  mode: ExistingMode,
): ImportAnalysis {
  const valid: NewProductRow[] = [];
  const updates: UpdateProductRow[] = [];
  const errors: ImportRowError[] = [];
  const skipped: ImportSkipped[] = [];

  const bySku = new Map<string, Product>();
  const byName = new Map<string, Product>();
  for (const p of existing) {
    if (p.sku) bySku.set(p.sku.toLowerCase(), p);
    const n = normalizeText(p.name);
    if (n && !byName.has(n)) byName.set(n, p);
  }
  const has = (f: ImportField) => fieldMap.includes(f);
  const seenSku = new Set<string>();
  const seenName = new Set<string>();

  for (let i = 0; i < dataRows.length; i++) {
    const values = dataRows[i];
    const row: Partial<Record<ImportField, string>> = {};
    fieldMap.forEach((field, idx) => { if (field && values[idx] !== undefined) row[field] = values[idx]; });
    const rowNum = i + 2; // +1 base 0, +1 encabezado

    const name = clean(row.name);
    if (!name) { errors.push({ row: rowNum, message: 'Nombre vacío' }); continue; }

    const price = parseDecimal(row.price);
    const cost = parseDecimal(row.cost);
    const stock = parseDecimal(row.stock);
    const stockWarehouse = parseDecimal(row.stock_warehouse);
    const threshold = parseDecimal(row.low_stock_threshold);
    const expiration = parseDateCell(row.expiration_date);

    if (price !== null && (Number.isNaN(price) || price < 0)) { errors.push({ row: rowNum, message: `Precio inválido: "${clean(row.price)}"` }); continue; }
    if (cost !== null && (Number.isNaN(cost) || cost < 0)) { errors.push({ row: rowNum, message: `Costo inválido: "${clean(row.cost)}"` }); continue; }
    if (stock !== null && (Number.isNaN(stock) || stock < 0)) { errors.push({ row: rowNum, message: `Stock inválido: "${clean(row.stock)}"` }); continue; }
    if (stockWarehouse !== null && (Number.isNaN(stockWarehouse) || stockWarehouse < 0)) { errors.push({ row: rowNum, message: `Stock almacén inválido: "${clean(row.stock_warehouse)}"` }); continue; }
    if (expiration === null) { errors.push({ row: rowNum, message: `Fecha de vencimiento no entendida: "${clean(row.expiration_date)}" (usa DD/MM/AAAA o AAAA-MM-DD)` }); continue; }

    const skuRaw = clean(row.sku);
    const nameKey = normalizeText(name);

    // ¿Ya existe? Por SKU si hay; si no, por nombre.
    const found = skuRaw ? bySku.get(skuRaw.toLowerCase()) : byName.get(nameKey);

    if (found) {
      if (mode === 'skip') { skipped.push({ row: rowNum, sku: found.sku || skuRaw || '—', name }); continue; }
      const changes: UpdateProductRow['changes'] = {};
      if (has('name') && skuRaw && name !== found.name) changes.name = name;
      if (price !== null && price !== found.price) changes.price = price;
      if (cost !== null && cost !== (found.cost ?? 0)) changes.cost = cost;
      const category = clean(row.category);
      if (category && category !== (found.category || '')) changes.category = category;
      const unit = clean(row.unit);
      if (unit && unit !== (found.unit || '')) changes.unit = unit;
      if (has('expiration_date') && expiration !== (found.expiration_date || '')) changes.expiration_date = expiration || undefined;
      if (threshold !== null && !Number.isNaN(threshold) && threshold >= 0 && Math.floor(threshold) !== found.low_stock_threshold) changes.low_stock_threshold = Math.floor(threshold);
      let stockDelta = 0, warehouseDelta = 0;
      if (mode === 'update_stock') {
        if (stock !== null && stock !== found.stock) { changes.stock = stock; stockDelta = stock - found.stock; }
        if (stockWarehouse !== null && stockWarehouse !== (found.stock_warehouse ?? 0)) { changes.stock_warehouse = stockWarehouse; warehouseDelta = stockWarehouse - (found.stock_warehouse ?? 0); }
      }
      if (Object.keys(changes).length === 0) { skipped.push({ row: rowNum, sku: found.sku || '—', name: `${name} (sin cambios)` }); continue; }
      updates.push({ row: rowNum, existing: found, changes, stockDelta, warehouseDelta });
      continue;
    }

    // Nuevo
    if (price === null) { errors.push({ row: rowNum, message: 'Precio vacío (obligatorio para productos nuevos)' }); continue; }
    const sku = skuRaw || `IMP-${String(i + 1).padStart(4, '0')}`;
    if (seenSku.has(sku.toLowerCase())) { errors.push({ row: rowNum, message: `SKU "${sku}" duplicado en el archivo` }); continue; }
    if (!skuRaw && seenName.has(nameKey)) { errors.push({ row: rowNum, message: `"${name}" repetido en el archivo` }); continue; }
    seenSku.add(sku.toLowerCase());
    seenName.add(nameKey);

    valid.push({
      row: rowNum,
      name, sku, price,
      cost: cost ?? 0,
      category: clean(row.category) || 'General',
      unit: clean(row.unit) || 'un',
      stock: stock ?? 0,
      stock_warehouse: stockWarehouse && stockWarehouse > 0 ? stockWarehouse : undefined,
      expiration_date: expiration || undefined,
      low_stock_threshold: threshold !== null && !Number.isNaN(threshold) && threshold >= 0 ? Math.floor(threshold) : undefined,
    });
  }

  return { valid, updates, errors, skipped, fieldMap };
}

/** Celda tal como la da SheetJS (fecha, número o texto) → texto para el analizador. */
export function cellToText(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) {
    if (isNaN(cell.getTime())) return '';
    return `${cell.getFullYear()}-${pad(cell.getMonth() + 1)}-${pad(cell.getDate())}`;
  }
  if (typeof cell === 'number') return Number.isInteger(cell) ? String(cell) : String(Math.round(cell * 1000) / 1000);
  return String(cell).trim();
}
