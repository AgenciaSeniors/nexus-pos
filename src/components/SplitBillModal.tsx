import { useMemo, useRef, useState } from 'react';
import type { ComandaItem, Sale, SaleItem } from '../lib/db';
import { splitEqual, splitByItems, allItemsAssigned } from '../lib/splitBill';
import { comandaItemTotal } from '../lib/comanda';
import { PaymentModal } from './PaymentModal';
import { Users, ListChecks, Check, CreditCard } from 'lucide-react';
import { Modal, Button, SegmentedControl, Stepper } from './ui';

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
    <>
      {/* zIndex 40: el PaymentModal anidado (z-50) queda siempre por encima. */}
      <Modal title={`Dividir cuenta · $${grandTotal.toFixed(2)}`} onClose={onCancel} size="lg" zIndex={40}>
        <div className="p-4 space-y-4">
          {/* Modo */}
          <SegmentedControl
            fullWidth
            aria-label="Modo de división"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'equal', label: 'Partes iguales', icon: <Users size={18} /> },
              { value: 'item', label: 'Por ítem', icon: <ListChecks size={18} /> },
            ]}
          />

          {/* Número de cuentas */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-[#6B7280]">Cuentas</span>
            <Stepper value={parts} min={2} max={10} label="Número de cuentas"
              onDecrement={() => setParts(p => Math.max(2, p - 1))}
              onIncrement={() => setParts(p => Math.min(10, p + 1))} />
          </div>

          {/* Asignación por ítem */}
          {mode === 'item' && (
            <div className="space-y-2">
              {liveItems.map(it => (
                <div key={it.id} className="flex items-center gap-2 p-2 rounded-xl bg-gray-50">
                  <span className="flex-1 min-w-0 text-sm font-bold text-[#1F2937] truncate">{it.quantity}× {it.name}</span>
                  <span className="text-xs text-[#6B7280]">${comandaItemTotal(it).toFixed(2)}</span>
                  <select value={assignment[it.id] ?? ''} onChange={e => setAssignment(a => ({ ...a, [it.id]: Number(e.target.value) }))}
                    aria-label={`Asignar ${it.name} a una cuenta`}
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white outline-none focus:ring-2 focus:ring-[#0B3B68]">
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
            <div className="flex items-center justify-between text-xs font-bold text-[#6B7280]">
              <span className="uppercase tracking-wide">Cuentas</span>
              <span>{Object.keys(paid).length} de {parts} pagadas</span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-grad-green rounded-full transition-all duration-300"
                style={{ width: `${(Object.keys(paid).length / parts) * 100}%` }} />
            </div>
            {Array.from({ length: parts }).map((_, i) => {
              const disabled = !canPayItemMode || (partTotals[i] ?? 0) <= 0;
              const isPaid = !!paid[i];
              return (
                <div key={i} className={`flex items-center justify-between p-3 rounded-xl border transition-colors ${isPaid ? 'border-[#7AC142]/40 bg-[#7AC142]/5' : 'border-gray-200'}`}>
                  <div>
                    <p className="font-bold text-[#1F2937]">Cuenta {i + 1}</p>
                    <p className="text-sm text-[#0B3B68] font-black">${(partTotals[i] ?? 0).toFixed(2)}</p>
                  </div>
                  {isPaid ? (
                    <span className="flex items-center gap-1 text-[#4f7d24] font-bold text-sm"><Check size={16} /> Pagada</span>
                  ) : (
                    <Button size="sm" disabled={disabled} onClick={() => setPayingPart(i)} icon={<CreditCard size={16} />}>
                      Cobrar
                    </Button>
                  )}
                </div>
              );
            })}
          </div>

          {allPaid && <p className="text-center text-[#4f7d24] font-bold">Todas las cuentas pagadas ✓</p>}
        </div>
      </Modal>

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
    </>
  );
}
