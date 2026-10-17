/**
 * Inventario del día: por cada producto, lo que había al empezar, lo que entró,
 * lo que se vendió y lo que DEBERÍA quedar al cerrar (vitrina y almacén por
 * separado).
 *
 * Sirve para encontrar de dónde sale un faltante o sobrante de dinero: cuando la
 * caja no cuadra, se cuenta lo físico y se compara con el "final esperado". Un
 * producto con menos o más unidades de las esperadas señala dónde está el error.
 *
 * NO hay que guardar una foto del inventario al abrir el turno: se reconstruye
 * hacia atrás desde el stock de ahora y los movimientos de inventario, que la app
 * registra en cada venta, compra, merma, devolución y traslado:
 *
 *     final   = stock_ahora − Σ movimientos desde el fin del periodo
 *     inicial = final       − Σ movimientos dentro del periodo
 *
 * (así también funciona con días pasados). Funciones puras (sin Dexie ni React).
 */
import type { InventoryMovement, Product } from './db';

export type MovementKind = 'sale' | 'entry' | 'loss' | 'adjust' | 'transfer' | 'void' | 'return' | 'other';

export interface ClassifiedMovement {
  kind: MovementKind;
  /** Cambio en la VITRINA */
  display: number;
  /** Cambio en el ALMACÉN */
  warehouse: number;
}

const WAREHOUSE_SUFFIX = '_warehouse';

/**
 * Traduce un movimiento a su efecto en vitrina y almacén.
 *
 * Los motivos que acaban en `_warehouse` afectan al almacén; los traslados se
 * guardan UNA vez (con el signo de la vitrina) y su otra mitad es la contraria en
 * el almacén; el resto afecta a la vitrina.
 */
export function classifyMovement(m: Pick<InventoryMovement, 'reason' | 'qty_change'>): ClassifiedMovement {
  const q = Number(m.qty_change) || 0;
  const reason = m.reason || '';

  if (reason === 'transfer_to_display' || reason === 'transfer_to_warehouse') {
    // Registrado con el signo de la vitrina: el almacén se mueve al revés.
    return { kind: 'transfer', display: q, warehouse: -q };
  }

  const inWarehouse = reason.endsWith(WAREHOUSE_SUFFIX);
  const base = inWarehouse ? reason.slice(0, -WAREHOUSE_SUFFIX.length) : reason;

  let kind: MovementKind;
  if (base === 'sale') kind = 'sale';
  else if (base === 'restock' || base === 'initial') kind = 'entry';
  else if (base === 'damage') kind = 'loss';
  else if (base === 'correction') kind = 'adjust';
  else if (base === 'return') kind = 'return';
  else if (base.startsWith('Anulación') || base.startsWith('Devolución parcial')) kind = 'void';
  else kind = 'other';

  return inWarehouse
    ? { kind, display: 0, warehouse: q }
    : { kind, display: q, warehouse: 0 };
}

export interface ProductDayRow {
  product_id: string;
  name: string;
  price: number;
  unit?: string;
  start_display: number;
  start_warehouse: number;
  /** Compras, stock inicial al crear el producto */
  entries: number;
  /** Unidades vendidas (positivo) */
  sold: number;
  /** Ventas anuladas y devoluciones de clientes: mercancía que VUELVE (positivo) */
  returned: number;
  /** Mermas + ajustes/correcciones, con signo (negativo = salió) */
  other: number;
  /** Traslados netos hacia la vitrina (positivo = pasó de almacén a vitrina) */
  transfer_to_display: number;
  end_display: number;
  end_warehouse: number;
}

const round3 = (n: number): number => Math.round((n + Number.EPSILON) * 1000) / 1000;

/**
 * @param products     catálogo actual (con el stock de AHORA)
 * @param movements    movimientos del negocio desde `windowStart` en adelante
 *                     (los anteriores no hacen falta)
 * @param windowStart  inicio del periodo (incluido)
 * @param windowEnd    fin del periodo (excluido)
 *
 * Devuelve solo los productos que SE MOVIERON en el periodo, los más vendidos
 * (en valor) primero.
 */
export function buildDailyInventory(args: {
  products: Pick<Product, 'id' | 'name' | 'price' | 'unit' | 'stock' | 'stock_warehouse'>[];
  movements: Pick<InventoryMovement, 'product_id' | 'reason' | 'qty_change' | 'created_at'>[];
  windowStart: Date;
  windowEnd: Date;
}): ProductDayRow[] {
  const { products, movements, windowStart, windowEnd } = args;
  const t0 = windowStart.getTime();
  const t1 = windowEnd.getTime();

  const byProduct = new Map<string, typeof movements>();
  for (const m of movements) {
    const t = new Date(m.created_at).getTime();
    if (isNaN(t) || t < t0) continue;
    const list = byProduct.get(m.product_id) || [];
    list.push(m);
    byProduct.set(m.product_id, list);
  }

  const rows: ProductDayRow[] = [];
  for (const p of products) {
    const list = byProduct.get(p.id);
    if (!list) continue;

    let afterDisplay = 0, afterWarehouse = 0;      // movimientos DESPUÉS del periodo
    let inDisplay = 0, inWarehouse = 0;            // movimientos DENTRO del periodo
    let entries = 0, sold = 0, returned = 0, other = 0, transferToDisplay = 0;
    let moved = false;

    for (const m of list) {
      const t = new Date(m.created_at).getTime();
      const c = classifyMovement(m);
      if (t >= t1) {
        afterDisplay += c.display;
        afterWarehouse += c.warehouse;
        continue;
      }
      moved = true;
      inDisplay += c.display;
      inWarehouse += c.warehouse;
      const total = c.display + c.warehouse;
      switch (c.kind) {
        case 'entry': entries += total; break;
        case 'sale': sold += -total; break;
        case 'void': case 'return': returned += total; break;
        case 'loss': case 'adjust': case 'other': other += total; break;
        case 'transfer': transferToDisplay += c.display; break;
      }
    }
    if (!moved) continue;

    const endDisplay = round3((p.stock ?? 0) - afterDisplay);
    const endWarehouse = round3((p.stock_warehouse ?? 0) - afterWarehouse);
    rows.push({
      product_id: p.id,
      name: p.name,
      price: Number(p.price) || 0,
      unit: p.unit,
      start_display: round3(endDisplay - inDisplay),
      start_warehouse: round3(endWarehouse - inWarehouse),
      entries: round3(entries),
      sold: round3(sold),
      returned: round3(returned),
      other: round3(other),
      transfer_to_display: round3(transferToDisplay),
      end_display: endDisplay,
      end_warehouse: endWarehouse,
    });
  }

  return rows.sort((a, b) => b.sold * b.price - a.sold * a.price || a.name.localeCompare(b.name));
}
