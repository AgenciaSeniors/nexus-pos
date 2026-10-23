import type { ProductDayRow } from '../lib/dailyInventory';

interface Props {
  rows: ProductDayRow[];
}

const q = (n: number) => String(Math.round(n * 1000) / 1000);

/** "15" si no hay almacén; "15 · 10" (vitrina · almacén) si lo hay. */
function split(display: number, warehouse: number, hasWarehouse: boolean): string {
  return hasWarehouse ? `${q(display)} · ${q(warehouse)}` : q(display);
}

/**
 * Inventario del día dentro del Corte Z: lo que había al empezar, lo que entró,
 * lo que se vendió y lo que DEBERÍA quedar. Si la caja no cuadra, se cuenta lo
 * físico y se compara con la última columna.
 *
 *   Inicial + Entró − Vendió ± Otros = Final esperado
 */
export function DailyInventoryTable({ rows }: Props) {
  const hasWarehouse = rows.some(r =>
    r.start_warehouse !== 0 || r.end_warehouse !== 0 || r.transfer_to_display !== 0);

  if (rows.length === 0) {
    return <p className="text-center text-[#6B7280] italic text-xs">Ningún producto se movió este día.</p>;
  }

  return (
    <div data-testid="z-inventario">
      <div className="overflow-x-auto -mx-2 px-2">
        <table className="w-full text-xs font-mono text-[#1F2937] min-w-[460px]">
          <thead className="text-[#6B7280] border-b border-gray-200 text-[10px] uppercase">
            <tr>
              <th className="text-left py-2 pr-2">Producto</th>
              <th className="text-right py-2 px-1">Inicial</th>
              <th className="text-right py-2 px-1">Entró</th>
              <th className="text-right py-2 px-1">Vendió</th>
              <th className="text-right py-2 px-1" title="Mermas, ajustes, devoluciones y ventas anuladas">Otros</th>
              <th className="text-right py-2 pl-1">Final esperado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-dashed divide-gray-200">
            {rows.map(r => {
              const otros = Math.round((r.other + r.returned) * 1000) / 1000;
              return (
                <tr key={r.product_id}>
                  <td className="py-1.5 pr-2 font-sans text-[11px] leading-tight">{r.name}</td>
                  <td className="py-1.5 px-1 text-right">{split(r.start_display, r.start_warehouse, hasWarehouse)}</td>
                  <td className="py-1.5 px-1 text-right">{r.entries > 0 ? `+${q(r.entries)}` : '–'}</td>
                  <td className="py-1.5 px-1 text-right">{r.sold > 0 ? `−${q(r.sold)}` : '–'}</td>
                  <td className="py-1.5 px-1 text-right">{otros !== 0 ? `${otros > 0 ? '+' : '−'}${q(Math.abs(otros))}` : '–'}</td>
                  <td className="py-1.5 pl-1 text-right font-black text-[#0040FC]">{split(r.end_display, r.end_warehouse, hasWarehouse)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hasWarehouse && (
        <p className="mt-2 text-[10px] text-[#6B7280]">Las cantidades con dos números son vitrina · almacén. Los traslados entre ellos cambian el reparto, no el total.</p>
      )}
    </div>
  );
}
