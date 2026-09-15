import { useMemo, useState } from 'react';
import { Search, PackageCheck, AlertTriangle, RotateCcw } from 'lucide-react';
import { currency } from '../lib/currency';
import { round3 } from '../lib/recipe';
import type { CountLine } from '../lib/shiftCount';

export interface CountDraft {
  product_id: string;
  product_name: string;
  unit_price: number;
  opening_qty: number;
  /** Texto, no número: el input debe poder estar vacío mientras se teclea. */
  closing_input?: string;
  loss_input?: string;
  loss_reason?: string;
}

interface ShiftCountPanelProps {
  mode: 'open' | 'close';
  drafts: CountDraft[];
  /** Cantidad que el sistema espera de cada producto (para precargar y comparar). */
  expectedByProduct: Record<string, number>;
  onChange: (productId: string, patch: Partial<CountDraft>) => void;
  /** Solo en cierre: líneas ya calculadas, para mostrar sobrantes y dinero. */
  lines?: CountLine[];
}

const LOSS_REASONS = ['Rotura', 'Consumo propio', 'Regalo', 'Vencido'];

export function ShiftCountPanel({ mode, drafts, expectedByProduct, onChange, lines }: ShiftCountPanelProps) {
  const [search, setSearch] = useState('');
  const [onlyDifferences, setOnlyDifferences] = useState(false);

  const isClose = mode === 'close';
  const lineByProduct = useMemo(
    () => Object.fromEntries((lines ?? []).map(l => [l.product_id, l])),
    [lines],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return drafts.filter(d => {
      if (q && !d.product_name.toLowerCase().includes(q)) return false;
      if (onlyDifferences) {
        const typed = isClose ? d.closing_input : d.closing_input;
        if (typed === undefined || typed === '') return false;
        const expected = isClose ? (expectedByProduct[d.product_id] ?? 0) : d.opening_qty;
        if (round3(parseFloat(typed)) === round3(expected)) return false;
      }
      return true;
    });
  }, [drafts, search, onlyDifferences, isClose, expectedByProduct]);

  /** Deja cada casilla en lo que el sistema espera: el atajo del "todo conforme". */
  const fillAllExpected = () => {
    for (const d of drafts) {
      const expected = isClose ? (expectedByProduct[d.product_id] ?? 0) : d.opening_qty;
      onChange(d.product_id, { closing_input: String(round3(expected)) });
    }
  };

  const pending = drafts.filter(d => d.closing_input === undefined || d.closing_input === '').length;

  return (
    <div className="flex flex-col min-h-0 gap-3">
      {/* Barra de herramientas */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]" />
          <input
            type="text"
            placeholder="Buscar producto..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#0B3B68]"
          />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={fillAllExpected}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-[#7AC142] text-[#7AC142] text-xs font-bold hover:bg-[#7AC142]/5 active:scale-95 transition-all whitespace-nowrap"
          >
            <PackageCheck size={14} /> Todo conforme
          </button>
          <button
            type="button"
            onClick={() => setOnlyDifferences(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl border text-xs font-bold transition-all active:scale-95 whitespace-nowrap ${
              onlyDifferences ? 'bg-[#F59E0B]/10 border-[#F59E0B] text-[#F59E0B]' : 'bg-white border-gray-200 text-[#6B7280]'
            }`}
          >
            <AlertTriangle size={14} /> Solo diferencias
          </button>
        </div>
      </div>

      {pending > 0 && (
        <p className="text-[11px] text-[#6B7280]">
          <strong className="text-[#F59E0B]">{pending}</strong> producto{pending > 1 ? 's' : ''} sin contar —
          se tomará{pending > 1 ? 'n' : ''} como lo que el sistema espera.
        </p>
      )}

      {/* Lista */}
      <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1 space-y-1.5">
        {visible.length === 0 && (
          <p className="text-center text-sm text-[#6B7280] py-8">Sin productos que mostrar</p>
        )}

        {visible.map(d => {
          const expected = isClose ? (expectedByProduct[d.product_id] ?? 0) : d.opening_qty;
          const typed = d.closing_input;
          const hasValue = typed !== undefined && typed !== '';
          const parsed = hasValue ? round3(parseFloat(typed)) : NaN;
          const differs = hasValue && !isNaN(parsed) && parsed !== round3(expected);
          const line = lineByProduct[d.product_id];

          return (
            <div
              key={d.product_id}
              className={`rounded-xl border p-2.5 transition-colors ${
                differs ? 'border-[#F59E0B]/50 bg-[#F59E0B]/[0.04]' : 'border-gray-200 bg-white'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-[#1F2937] truncate">{d.product_name}</p>
                  <p className="text-[11px] text-[#6B7280]">
                    {isClose ? 'Debería quedar' : 'Stock del sistema'}: <strong>{round3(expected)}</strong>
                    {' · '}{currency.format(d.unit_price)}
                  </p>
                </div>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  inputMode="decimal"
                  placeholder={String(round3(expected))}
                  aria-label={`Conteo de ${d.product_name}`}
                  value={typed ?? ''}
                  onChange={e => onChange(d.product_id, { closing_input: e.target.value })}
                  className="w-24 flex-shrink-0 p-2.5 border-2 border-gray-200 rounded-xl text-center font-bold outline-none focus:border-[#0B3B68]"
                />
              </div>

              {/* Merma + resultado, solo al cerrar */}
              {isClose && (
                <div className="mt-2 pt-2 border-t border-gray-100 flex flex-wrap items-center gap-2">
                  <label className="text-[10px] font-bold text-[#6B7280] uppercase">Merma</label>
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    inputMode="decimal"
                    placeholder="0"
                    aria-label={`Merma de ${d.product_name}`}
                    value={d.loss_input ?? ''}
                    onChange={e => onChange(d.product_id, { loss_input: e.target.value })}
                    className="w-16 p-1.5 border border-gray-200 rounded-lg text-center text-sm outline-none focus:border-[#EF4444]"
                  />
                  {(d.loss_input ?? '') !== '' && parseFloat(d.loss_input!) > 0 && (
                    <select
                      value={d.loss_reason ?? LOSS_REASONS[0]}
                      onChange={e => onChange(d.product_id, { loss_reason: e.target.value })}
                      className="p-1.5 border border-gray-200 rounded-lg text-xs outline-none focus:border-[#EF4444]"
                    >
                      {LOSS_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  )}

                  {line && (
                    <span className="ml-auto text-xs font-bold text-right">
                      {line.surplus_qty > 0 ? (
                        <span className="text-[#F59E0B] flex items-center gap-1">
                          <RotateCcw size={12} /> Sobran {round3(line.surplus_qty)}
                        </span>
                      ) : (
                        <span className="text-[#0B3B68]">
                          Vendido {round3(line.sold_qty)} · {currency.format(line.amount)}
                        </span>
                      )}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
