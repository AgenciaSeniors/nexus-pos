import { useMemo, useState } from 'react';
import { X, Search, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { ProductDayRow } from '../lib/dailyInventory';
import { evaluateCounts, interpretShortfall, type CountEntry, type ShortfallVerdict } from '../lib/shortfall';
import { matchesSearch } from '../lib/textSearch';

interface Props {
  rows: ProductDayRow[];
  /** Diferencia de efectivo del día (contado − esperado). null = no hay cierre de caja. */
  cashDifference: number | null;
  dateLabel: string;
  fmt: (n: number) => string;
  onClose: () => void;
}

const FIRST_PAGE = 25;

const VERDICT_STYLE: Record<ShortfallVerdict, string> = {
  no_data: 'bg-gray-100 text-[#1F2937] border-gray-200',
  no_cash: 'bg-blue-50 text-blue-900 border-blue-200',
  all_ok: 'bg-[#16A34A]/15 text-[#166534] border-[#16A34A]/40',
  explained: 'bg-[#16A34A]/15 text-[#166534] border-[#16A34A]/40',
  partial: 'bg-[#F59E0B]/15 text-[#92400E] border-[#F59E0B]/40',
  unexplained: 'bg-[#EF4444]/10 text-[#991B1B] border-[#EF4444]/30',
  goods_lost: 'bg-[#F59E0B]/15 text-[#92400E] border-[#F59E0B]/40',
};

const qty = (n: number) => String(Math.round(n * 1000) / 1000);

/**
 * "Buscar el faltante": se cuenta lo físico producto por producto y la app dice
 * cuánto dinero explica cada diferencia y si, en total, explica el faltante o
 * sobrante de caja. Empieza por los productos que más dinero movieron.
 */
export function ShortfallFinder({ rows, cashDifference, dateLabel, fmt, onClose }: Props) {
  const [counts, setCounts] = useState<Record<string, CountEntry>>({});
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);

  const summary = useMemo(() => evaluateCounts(rows, counts), [rows, counts]);
  const verdict = useMemo(
    () => interpretShortfall({
      cashDifference, missingValue: summary.missingValue, extraValue: summary.extraValue,
      countedProducts: summary.countedProducts, fmt,
    }),
    [cashDifference, summary, fmt],
  );

  const hasWarehouse = rows.some(r => r.end_warehouse !== 0 || r.start_warehouse !== 0);
  const filtered = rows.filter(r => matchesSearch(search, r.name));
  const visible = search || showAll ? filtered : filtered.slice(0, FIRST_PAGE);

  const set = (id: string, field: keyof CountEntry, value: string) =>
    setCounts(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));

  const cashLabel = cashDifference === null
    ? 'Sin cierre de caja'
    : Math.abs(cashDifference) < 0.005 ? 'La caja cuadra'
    : cashDifference > 0 ? `Sobra ${fmt(cashDifference)}` : `Falta ${fmt(Math.abs(cashDifference))}`;

  return (
    <div className="fixed inset-0 bg-[#0040FC]/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-sm" data-testid="shortfall-finder">
      <div className="bg-white w-full sm:max-w-2xl max-h-[94vh] rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col overflow-hidden">
        <div className="p-4 border-b border-gray-100 bg-[#F3F4F6] flex items-start justify-between gap-3 flex-shrink-0">
          <div>
            <h3 className="font-black text-lg text-[#0040FC] flex items-center gap-2"><Search size={18} /> Buscar el faltante</h3>
            <p className="text-xs text-[#6B7280] mt-0.5">{dateLabel} · <span className="font-bold text-[#1F2937]" data-testid="shortfall-cash">{cashLabel}</span></p>
          </div>
          <button onClick={onClose} aria-label="Cerrar"><X className="text-gray-400 hover:text-gray-600" /></button>
        </div>

        <div className={`m-4 mb-2 p-3 rounded-xl border text-sm flex-shrink-0 ${VERDICT_STYLE[verdict.verdict]}`} data-testid="shortfall-verdict">
          <p className="font-black flex items-center gap-1.5">
            {verdict.verdict === 'explained' || verdict.verdict === 'all_ok' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            {verdict.headline}
          </p>
          <p className="text-xs mt-1 leading-relaxed">{verdict.detail}</p>
          {summary.countedProducts > 0 && (
            <p className="text-[11px] mt-2 opacity-80">
              {summary.countedProducts} producto{summary.countedProducts !== 1 ? 's' : ''} contado{summary.countedProducts !== 1 ? 's' : ''} ·
              faltan {qty(summary.missingUnits)} u. ({fmt(summary.missingValue)}) · sobran {qty(summary.extraUnits)} u. ({fmt(summary.extraValue)})
            </p>
          )}
        </div>

        <div className="px-4 pb-2 flex-shrink-0">
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar producto..."
            className="w-full p-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#0040FC]"
          />
          <p className="text-[10px] text-[#6B7280] mt-1.5">
            Cuenta lo que hay ahora y escríbelo. Empieza por los de arriba: son los que más dinero movieron. Deja en blanco lo que no cuentes.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {visible.length === 0 && <p className="text-center text-[#6B7280] italic text-xs py-6">No hay productos que coincidan.</p>}
          <div className="space-y-2">
            {visible.map(r => {
              const line = summary.lines.find(l => l.product_id === r.product_id)!;
              const tone = line.value_diff === null ? '' : line.value_diff === 0 ? 'text-[#166534]' : line.value_diff < 0 ? 'text-[#B91C1C]' : 'text-[#B45309]';
              return (
                <div key={r.product_id} className="border border-gray-200 rounded-xl p-2.5" data-testid="shortfall-row">
                  <div className="flex justify-between items-start gap-2">
                    <p className="text-sm font-bold text-[#1F2937] leading-tight">{r.name}</p>
                    <p className="text-[10px] text-[#6B7280] whitespace-nowrap">{fmt(r.price)} · vendió {qty(r.sold)}</p>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    <label className="flex items-center gap-1.5 text-[11px] text-[#6B7280]">
                      Vitrina (esperado <b className="text-[#0040FC]">{qty(r.end_display)}</b>)
                      <input
                        type="number" inputMode="decimal" min="0" step="any" value={counts[r.product_id]?.display ?? ''}
                        onChange={e => set(r.product_id, 'display', e.target.value)} aria-label={`Vitrina de ${r.name}`}
                        className="w-20 p-1.5 border border-gray-300 rounded-lg text-sm font-bold text-[#1F2937] outline-none focus:ring-2 focus:ring-[#0040FC]"
                      />
                    </label>
                    {(hasWarehouse && (r.end_warehouse !== 0 || r.start_warehouse !== 0)) && (
                      <label className="flex items-center gap-1.5 text-[11px] text-[#6B7280]">
                        Almacén (esperado <b className="text-[#0040FC]">{qty(r.end_warehouse)}</b>)
                        <input
                          type="number" inputMode="decimal" min="0" step="any" value={counts[r.product_id]?.warehouse ?? ''}
                          onChange={e => set(r.product_id, 'warehouse', e.target.value)} aria-label={`Almacén de ${r.name}`}
                          className="w-20 p-1.5 border border-gray-300 rounded-lg text-sm font-bold text-[#1F2937] outline-none focus:ring-2 focus:ring-[#0040FC]"
                        />
                      </label>
                    )}
                    {line.unit_diff !== null && (
                      <span className={`text-xs font-black ml-auto ${tone}`} data-testid="shortfall-line-diff">
                        {line.unit_diff === 0 ? 'Cuadra ✓' : `${line.unit_diff > 0 ? 'Sobran' : 'Faltan'} ${qty(Math.abs(line.unit_diff))} (${fmt(Math.abs(line.value_diff ?? 0))})`}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {!search && !showAll && filtered.length > FIRST_PAGE && (
            <button onClick={() => setShowAll(true)} className="mt-3 w-full py-2 text-xs font-bold text-[#0040FC] border border-[#0040FC]/30 rounded-xl hover:bg-[#0040FC]/5">
              Mostrar los {filtered.length - FIRST_PAGE} productos restantes
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
