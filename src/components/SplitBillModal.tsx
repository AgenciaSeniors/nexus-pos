import { useMemo, useRef, useState } from 'react';
import type { ComandaItem, Sale, SaleItem } from '../lib/db';
import { splitEqual, splitByItems, allItemsAssigned } from '../lib/splitBill';
import { comandaItemTotal } from '../lib/comanda';
import { PaymentModal } from './PaymentModal';
import { X, Users, ListChecks, Check, CreditCard } from 'lucide-react';

interface Props {
  liveItems: ComandaItem[];
  grandTotal: number;
  shiftId: string;
  businessId: string;
  comandaId: string;
  staffId?: string;
  staffName?: string;
  staffList: { id: string; name: string }[];
  buildSaleItem: (i: ComandaItem) => SaleItem;
  onCancel: () => void;
  onComplete: (sales: Sale[]) => void;
}

export function SplitBillModal({
  liveItems, grandTotal, shiftId, businessId, comandaId, staffId, staffName, staffList, buildSaleItem, onCancel, onComplete,
}: Props) {
  const [mode, setMode] = useState<'equal' | 'item'>('equal');
  const [parts, setParts] = useState(2);
  const [assignment, setAssignment] = useState<Record<string, number>>({});
  const [paid, setPaid] = useState<Record<number, Sale>>({});
  const [payingPart, setPayingPart] = useState<number | null>(null);
  const splitGroupId = useRef(crypto.randomUUID());

  const partTotals = useMemo(() => {
    if (mode === 'equal') return splitEqual(grandTotal, parts);
    return splitByItems(liveItems.map(i => ({ id: i.id, total: comandaItemTotal(i) })), assignment, parts);
  }, [mode, parts, grandTotal, liveItems, assignment]);

  const itemsForPart = (index: number) => liveItems.filter(i => assignment[i.id] === index);

  const canPayItemMode = mode === 'item'
    ? allItemsAssigned(liveItems.map(i => ({ id: i.id, total: comandaItemTotal(i) })), assignment, parts)
    : true;

  const makeSale = (
    index: number, method: string, tendered: number, change: number,
    cash?: number, transfer?: number, tip?: number, tipStaff?: string,
  ): Sale => ({
    id: crypto.randomUUID(), business_id: businessId, date: new Date().toISOString(), shift_id: shiftId,
    staff_id: staffId, staff_name: staffName ?? 'Cajero',
    total: partTotals[index] ?? 0,
    payment_method: method as Sale['payment_method'], amount_tendered: tendered, change,
    items: mode === 'item' ? itemsForPart(index).map(buildSaleItem) : [],
    comanda_id: comandaId,
    split_group_id: splitGroupId.current, split_index: index + 1,
    ...(cash !== undefined && { cash_amount: cash }),
    ...(transfer !== undefined && { transfer_amount: transfer }),
    ...(tip ? { tip_amount: tip, ...(tipStaff ? { tip_staff_id: tipStaff } : {}) } : {}),
    sync_status: 'pending_create',
  });

  const onPartPaid = (
    index: number, method: string, tendered: number, change: number,
    cash?: number, transfer?: number, _pts?: number, tip?: number, tipStaff?: string,
  ) => {
    const sale = makeSale(index, method, tendered, change, cash, transfer, tip, tipStaff);
    const next = { ...paid, [index]: sale };
    setPaid(next);
    setPayingPart(null);
    if (Object.keys(next).length === parts) {
      onComplete(Object.values(next));
    }
  };

  const allPaid = Object.keys(paid).length === parts;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center sm:p-4">
      <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <h2 className="font-black text-[#1F2937]">Dividir cuenta · ${grandTotal.toFixed(2)}</h2>
          <button onClick={onCancel} className="p-1.5 rounded-full hover:bg-gray-100"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Modo */}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setMode('equal')}
              className={`p-3 rounded-xl border-2 flex items-center justify-center gap-2 font-bold ${mode === 'equal' ? 'border-[#0B3B68] bg-[#0B3B68]/5 text-[#0B3B68]' : 'border-gray-200 text-[#6B7280]'}`}>
              <Users size={18} /> Partes iguales
            </button>
            <button onClick={() => setMode('item')}
              className={`p-3 rounded-xl border-2 flex items-center justify-center gap-2 font-bold ${mode === 'item' ? 'border-[#0B3B68] bg-[#0B3B68]/5 text-[#0B3B68]' : 'border-gray-200 text-[#6B7280]'}`}>
              <ListChecks size={18} /> Por ítem
            </button>
          </div>

          {/* Número de cuentas */}
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-[#6B7280]">Cuentas:</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setParts(p => Math.max(2, p - 1))} className="w-8 h-8 rounded-lg bg-gray-100 font-bold">−</button>
              <span className="w-8 text-center font-black">{parts}</span>
              <button onClick={() => setParts(p => Math.min(10, p + 1))} className="w-8 h-8 rounded-lg bg-gray-100 font-bold">+</button>
            </div>
          </div>

          {/* Asignación por ítem */}
          {mode === 'item' && (
            <div className="space-y-2">
              {liveItems.map(it => (
                <div key={it.id} className="flex items-center gap-2 p-2 rounded-xl bg-gray-50">
                  <span className="flex-1 min-w-0 text-sm font-bold text-[#1F2937] truncate">{it.quantity}× {it.name}</span>
                  <span className="text-xs text-[#6B7280]">${comandaItemTotal(it).toFixed(2)}</span>
                  <select value={assignment[it.id] ?? ''} onChange={e => setAssignment(a => ({ ...a, [it.id]: Number(e.target.value) }))}
                    className="border border-gray-200 rounded-lg px-2 py-1 text-sm bg-white">
                    <option value="">—</option>
                    {Array.from({ length: parts }).map((_, i) => <option key={i} value={i}>Cuenta {i + 1}</option>)}
                  </select>
                </div>
              ))}
              {!canPayItemMode && <p className="text-xs text-amber-600">Asigna todos los ítems a una cuenta para poder cobrar.</p>}
            </div>
          )}

          {/* Cuentas */}
          <div className="space-y-2">
            {Array.from({ length: parts }).map((_, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-xl border border-gray-200">
                <div>
                  <p className="font-bold text-[#1F2937]">Cuenta {i + 1}</p>
                  <p className="text-sm text-[#0B3B68] font-black">${(partTotals[i] ?? 0).toFixed(2)}</p>
                </div>
                {paid[i] ? (
                  <span className="flex items-center gap-1 text-[#7AC142] font-bold text-sm"><Check size={16} /> Pagada</span>
                ) : (
                  <button disabled={!canPayItemMode || (partTotals[i] ?? 0) <= 0} onClick={() => setPayingPart(i)}
                    className={`px-4 py-2 rounded-xl font-bold flex items-center gap-1.5 ${!canPayItemMode || (partTotals[i] ?? 0) <= 0 ? 'bg-gray-200 text-gray-400' : 'bg-[#7AC142] text-white'}`}>
                    <CreditCard size={16} /> Cobrar
                  </button>
                )}
              </div>
            ))}
          </div>

          {allPaid && <p className="text-center text-[#7AC142] font-bold">Todas las cuentas pagadas…</p>}
        </div>
      </div>

      {payingPart !== null && (
        <PaymentModal
          total={partTotals[payingPart] ?? 0}
          customer={null}
          tipEnabled
          staffList={staffList}
          onCancel={() => setPayingPart(null)}
          onConfirm={(m, t, c, cash, tr, pts, tip, tipStaff) => onPartPaid(payingPart, m, t, c, cash, tr, pts, tip, tipStaff)}
        />
      )}
    </div>
  );
}
