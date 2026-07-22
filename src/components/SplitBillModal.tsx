import { useMemo, useRef, useState } from 'react';
import type { ComandaItem, Sale, SaleItem } from '../lib/db';
import { splitEqual, splitByItems, allItemsAssigned } from '../lib/splitBill';
import { comandaItemTotal } from '../lib/comanda';
import { PaymentModal } from './PaymentModal';
import { Users, ListChecks, Check, CreditCard, AlertTriangle } from 'lucide-react';
import { Modal, Button, SegmentedControl, Stepper, ConfirmDialog } from './ui';
import { loadSplitState, saveSplitState, clearSplitState, type SavedSplitState } from '../lib/splitState';

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
  // Restaurar progreso previo (si la app/modal se cerró con cuentas cobradas)
  const saved = useMemo(() => loadSplitState(comandaId), [comandaId]);
  const [mode, setMode] = useState<'equal' | 'item'>(saved?.mode ?? 'equal');
  const [parts, setParts] = useState(saved?.parts ?? 2);
  const [assignment, setAssignment] = useState<Record<string, number>>(saved?.assignment ?? {});
  const [paid, setPaid] = useState<Record<number, Sale>>(saved?.paid ?? {});
  const [payingPart, setPayingPart] = useState<number | null>(null);
  const [confirmExit, setConfirmExit] = useState(false);
  const splitGroupId = useRef(saved?.splitGroupId ?? crypto.randomUUID());
  // Totales congelados al primer cobro (o los restaurados): garantizan que la
  // suma de las cuentas sea exactamente el total acordado al iniciar los cobros.
  const [frozenTotals, setFrozenTotals] = useState<number[] | null>(saved?.partTotals ?? null);
  // Total de referencia (constante por montaje): el vigente al restaurar o al abrir.
  const [frozenGrandTotal] = useState(saved?.grandTotal ?? grandTotal);

  const livePartTotals = useMemo(() => {
    if (mode === 'equal') return splitEqual(grandTotal, parts);
    return splitByItems(liveItems.map(i => ({ id: i.id, total: comandaItemTotal(i) })), assignment, parts);
  }, [mode, parts, grandTotal, liveItems, assignment]);

  const partTotals = frozenTotals ?? livePartTotals;

  // La comanda cambió DESPUÉS de cobrar cuentas (se agregaron/anularon ítems
  // desde fuera del modal): avisar — los totales congelados ya no la reflejan.
  const comandaChangedAfterPayments =
    frozenTotals !== null && Math.abs(frozenGrandTotal - grandTotal) >= 0.005;

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

    // Congelar los totales en el primer cobro y persistir el progreso: si la
    // app se cierra ahora, la división se retoma exactamente donde quedó.
    const totalsSnapshot = frozenTotals ?? livePartTotals;
    if (!frozenTotals) setFrozenTotals(totalsSnapshot);
    if (Object.keys(next).length === parts) {
      clearSplitState(comandaId);
      onComplete(Object.values(next));
      return;
    }
    const state: SavedSplitState = {
      mode, parts, assignment, paid: next,
      splitGroupId: splitGroupId.current,
      grandTotal: frozenGrandTotal,
      partTotals: totalsSnapshot,
    };
    saveSplitState(comandaId, state);
  };

  const paidCount = Object.keys(paid).length;
  const allPaid = paidCount === parts;
  // Con la primera cuenta cobrada, la división queda BLOQUEADA: cambiar el
  // modo, el número de partes o la asignación recalcularía los totales y la
  // suma de las cuentas dejaría de coincidir con el total de la comanda.
  const locked = paidCount > 0;

  const handleClose = () => {
    if (locked && !allPaid) setConfirmExit(true);
    else onCancel();
  };

  return (
    <>
      {/* zIndex 40: el PaymentModal anidado (z-50) queda siempre por encima. */}
      <Modal title={`Dividir cuenta · $${frozenGrandTotal.toFixed(2)}`} onClose={handleClose} size="lg" zIndex={40}>
        <div className="p-4 space-y-4">
          {saved && paidCount > 0 && !allPaid && (
            <p className="text-xs text-[#0B3B68] bg-[#0B3B68]/5 border border-[#0B3B68]/15 rounded-lg px-3 py-2">
              División retomada: {paidCount} de {parts} cuenta{paidCount !== 1 ? 's' : ''} ya cobrada{paidCount !== 1 ? 's' : ''}.
            </p>
          )}
          {comandaChangedAfterPayments && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                La comanda cambió después de cobrar cuentas (total actual ${grandTotal.toFixed(2)} vs ${frozenGrandTotal.toFixed(2)} al iniciar).
                Las cuentas mantienen los montos acordados; revisa la diferencia antes de terminar.
              </span>
            </p>
          )}

          {/* Modo */}
          <SegmentedControl
            fullWidth
            aria-label="Modo de división"
            value={mode}
            onChange={(m) => { if (!locked) setMode(m); }}
            options={[
              { value: 'equal', label: 'Partes iguales', icon: <Users size={18} /> },
              { value: 'item', label: 'Por ítem', icon: <ListChecks size={18} /> },
            ]}
          />

          {/* Número de cuentas */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-[#6B7280]">Cuentas</span>
            <Stepper value={parts} min={locked ? parts : 2} max={locked ? parts : 10} label="Número de cuentas"
              onDecrement={() => { if (!locked) setParts(p => Math.max(2, p - 1)); }}
              onIncrement={() => { if (!locked) setParts(p => Math.min(10, p + 1)); }} />
          </div>

          {locked && !allPaid && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              Ya hay cuentas cobradas: la división quedó fija para que la suma coincida con el total.
            </p>
          )}

          {/* Asignación por ítem */}
          {mode === 'item' && (
            <div className="space-y-2">
              {liveItems.map(it => (
                <div key={it.id} className="flex items-center gap-2 p-2 rounded-xl bg-gray-50">
                  <span className="flex-1 min-w-0 text-sm font-bold text-[#1F2937] truncate">{it.quantity}× {it.name}</span>
                  <span className="text-xs text-[#6B7280]">${comandaItemTotal(it).toFixed(2)}</span>
                  <select value={assignment[it.id] ?? ''} disabled={locked} onChange={e => setAssignment(a => ({ ...a, [it.id]: Number(e.target.value) }))}
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
              <span>{paidCount} de {parts} pagadas</span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-grad-green rounded-full transition-all duration-300"
                style={{ width: `${(paidCount / parts) * 100}%` }} />
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

      {confirmExit && (
        <ConfirmDialog
          title="¿Salir de la división?"
          message={`Hay ${paidCount} cuenta${paidCount !== 1 ? 's' : ''} cobrada${paidCount !== 1 ? 's' : ''}. El progreso queda GUARDADO: al volver a "Dividir" en esta comanda retomarás exactamente donde quedaste.`}
          confirmLabel="Salir (guardado)"
          cancelLabel="Seguir cobrando"
          confirmVariant="navy"
          zIndex={70}
          onConfirm={() => { setConfirmExit(false); onCancel(); }}
          onCancel={() => setConfirmExit(false)}
        />
      )}
    </>
  );
}
