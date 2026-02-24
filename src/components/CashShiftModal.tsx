import { useState } from 'react';
import { X, TrendingUp, TrendingDown, DollarSign, LogIn, LogOut, Loader2 } from 'lucide-react';
import { db, type CashShift, type CashMovement, type Staff } from '../lib/db';
import { addToQueue } from '../lib/sync';
import { logAuditAction } from '../lib/audit';
import { toast } from 'sonner';
import { currency } from '../lib/currency';

interface CashShiftModalProps {
  mode: 'open' | 'close' | 'movement';
  activeShift?: CashShift;
  currentStaff: Staff;
  expectedCash?: number;
  onClose: () => void;
  onSuccess: () => void;
}

export function CashShiftModal({
  mode,
  activeShift,
  currentStaff,
  expectedCash = 0,
  onClose,
  onSuccess,
}: CashShiftModalProps) {
  const businessId = localStorage.getItem('nexus_business_id') || '';
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [movType, setMovType] = useState<'in' | 'out'>('in');
  const [isLoading, setIsLoading] = useState(false);

  // --- ABRIR TURNO ---
  const handleOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    const startAmount = parseFloat(amount) || 0;
    if (startAmount < 0) return toast.error('El monto inicial no puede ser negativo');
    if (!businessId) return;

    setIsLoading(true);
    try {
      const shiftId = crypto.randomUUID();
      const newShift: CashShift = {
        id: shiftId,
        business_id: businessId,
        staff_id: currentStaff.id,
        start_amount: startAmount,
        opened_at: new Date().toISOString(),
        status: 'open',
        sync_status: 'pending_create',
      };

      await db.transaction('rw', [db.cash_shifts, db.action_queue, db.audit_logs], async () => {
        await db.cash_shifts.add(newShift);
        await addToQueue('SHIFT', newShift);
        await logAuditAction('OPEN_SHIFT', { start_amount: startAmount }, currentStaff);
      });

      toast.success(`Caja abierta con ${currency.format(startAmount)}`);
      onSuccess();
    } catch (err) {
      console.error(err);
      toast.error('Error al abrir la caja');
    } finally {
      setIsLoading(false);
    }
  };

  // --- CERRAR TURNO ---
  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShift || !businessId) return;

    const endAmount = parseFloat(amount);
    if (isNaN(endAmount) || endAmount < 0) return toast.error('Ingresa el efectivo contado en caja');

    setIsLoading(true);
    try {
      const difference = endAmount - expectedCash;
      const updatedShift: CashShift = {
        ...activeShift,
        end_amount: endAmount,
        expected_amount: expectedCash,
        difference,
        closed_at: new Date().toISOString(),
        status: 'closed',
        sync_status: 'pending_update',
      };

      await db.transaction('rw', [db.cash_shifts, db.action_queue, db.audit_logs], async () => {
        await db.cash_shifts.put(updatedShift);
        await addToQueue('SHIFT', updatedShift);
        await logAuditAction('CLOSE_SHIFT', {
          start_amount: activeShift.start_amount,
          end_amount: endAmount,
          expected_amount: expectedCash,
          difference,
        }, currentStaff);
      });

      if (Math.abs(difference) > 0.01) {
        toast.warning(`Caja cerrada. Diferencia: ${currency.format(difference)}`);
      } else {
        toast.success('Caja cerrada. Sin diferencias.');
      }
      onSuccess();
    } catch (err) {
      console.error(err);
      toast.error('Error al cerrar la caja');
    } finally {
      setIsLoading(false);
    }
  };

  // --- MOVIMIENTO MANUAL ---
  const handleMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShift || !businessId) return;

    const movAmount = parseFloat(amount);
    if (isNaN(movAmount) || movAmount <= 0) return toast.error('Monto inválido');
    if (!reason.trim()) return toast.error('Escribe el motivo del movimiento');

    setIsLoading(true);
    try {
      const movement: CashMovement = {
        id: crypto.randomUUID(),
        shift_id: activeShift.id,
        business_id: businessId,
        type: movType,
        amount: movAmount,
        reason: reason.trim(),
        staff_id: currentStaff.id,
        created_at: new Date().toISOString(),
        sync_status: 'pending_create',
      };

      await db.transaction('rw', [db.cash_movements, db.action_queue, db.audit_logs], async () => {
        await db.cash_movements.add(movement);
        await addToQueue('CASH_MOVEMENT', movement);
        await logAuditAction(movType === 'in' ? 'CASH_IN' : 'CASH_OUT', {
          amount: movAmount,
          reason: reason.trim(),
        }, currentStaff);
      });

      toast.success(`${movType === 'in' ? 'Ingreso' : 'Retiro'} registrado: ${currency.format(movAmount)}`);
      onSuccess();
    } catch (err) {
      console.error(err);
      toast.error('Error al registrar movimiento');
    } finally {
      setIsLoading(false);
    }
  };

  const isOpen = mode === 'open';
  const isClose = mode === 'close';
  const isMovement = mode === 'movement';

  const title = isOpen ? 'Abrir Caja' : isClose ? 'Cerrar Caja' : 'Movimiento de Efectivo';
  const Icon = isOpen ? LogIn : isClose ? LogOut : DollarSign;
  const iconBg = isOpen ? 'bg-[#7AC142]/10' : isClose ? 'bg-[#EF4444]/10' : 'bg-[#0B3B68]/10';
  const iconColor = isOpen ? 'text-[#7AC142]' : isClose ? 'text-[#EF4444]' : 'text-[#0B3B68]';
  const submitHandler = isOpen ? handleOpenShift : isClose ? handleCloseShift : handleMovement;

  return (
    <div className="fixed inset-0 bg-[#0B3B68]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-[#F3F4F6]">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center ${iconBg}`}>
              <Icon size={18} className={iconColor} />
            </div>
            <h3 className="font-bold text-[#1F2937]">{title}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 text-[#6B7280] hover:text-[#1F2937] hover:bg-gray-200 rounded-full transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submitHandler} className="p-5 space-y-4">

          {/* MODO MOVIMIENTO: selector de tipo */}
          {isMovement && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMovType('in')}
                className={`flex items-center justify-center gap-2 p-3 rounded-xl border-2 font-bold text-sm transition-all ${
                  movType === 'in'
                    ? 'border-[#7AC142] bg-[#7AC142]/10 text-[#7AC142]'
                    : 'border-gray-200 text-[#6B7280] hover:bg-gray-50'
                }`}
              >
                <TrendingUp size={16} /> Ingreso
              </button>
              <button
                type="button"
                onClick={() => setMovType('out')}
                className={`flex items-center justify-center gap-2 p-3 rounded-xl border-2 font-bold text-sm transition-all ${
                  movType === 'out'
                    ? 'border-[#EF4444] bg-[#EF4444]/10 text-[#EF4444]'
                    : 'border-gray-200 text-[#6B7280] hover:bg-gray-50'
                }`}
              >
                <TrendingDown size={16} /> Retiro
              </button>
            </div>
          )}

          {/* MODO CIERRE: mostrar efectivo esperado */}
          {isClose && (
            <div className="bg-[#F3F4F6] rounded-xl p-4 space-y-1">
              <p className="text-xs text-[#6B7280] font-bold uppercase">Efectivo esperado en caja</p>
              <p className="text-2xl font-black text-[#0B3B68]">{currency.format(expectedCash)}</p>
              <p className="text-xs text-[#6B7280]">Ingresa el efectivo físico que contaste abajo</p>
            </div>
          )}

          {/* CAMPO MONTO */}
          <div>
            <label className="block text-xs font-bold text-[#6B7280] uppercase mb-1">
              {isClose ? 'Efectivo contado en caja' : 'Monto'}
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6B7280] font-bold text-lg">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                autoFocus
                required
                placeholder="0.00"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full pl-8 pr-4 py-3 text-xl font-bold border-2 border-gray-200 rounded-xl focus:border-[#0B3B68] outline-none transition-colors"
              />
            </div>

            {/* Diferencia en tiempo real al cerrar */}
            {isClose && amount && !isNaN(parseFloat(amount)) && (
              <div className={`mt-2 p-2 rounded-lg text-sm font-bold flex justify-between ${
                Math.abs((parseFloat(amount) || 0) - expectedCash) < 0.01
                  ? 'bg-[#7AC142]/10 text-[#7AC142]'
                  : 'bg-[#EF4444]/10 text-[#EF4444]'
              }`}>
                <span>Diferencia:</span>
                <span>{currency.format((parseFloat(amount) || 0) - expectedCash)}</span>
              </div>
            )}
          </div>

          {/* CAMPO MOTIVO (solo en movimiento) */}
          {isMovement && (
            <div>
              <label className="block text-xs font-bold text-[#6B7280] uppercase mb-1">Motivo</label>
              <input
                type="text"
                required
                placeholder="Ej. Pago proveedor, Fondo cambio..."
                value={reason}
                onChange={e => setReason(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-[#0B3B68] outline-none transition-colors"
              />
            </div>
          )}

          {/* BOTONES */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 border border-gray-200 text-[#6B7280] font-bold rounded-xl hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className={`flex-1 py-3 text-white font-bold rounded-xl transition-all active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2 shadow-lg ${
                isClose ? 'bg-[#EF4444] hover:bg-[#EF4444]/90 shadow-[#EF4444]/20' : 'bg-[#0B3B68] hover:bg-[#0B3B68]/90 shadow-[#0B3B68]/20'
              }`}
            >
              {isLoading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <>
                  <Icon size={16} />
                  {isOpen ? 'Abrir Caja' : isClose ? 'Cerrar Caja' : movType === 'in' ? 'Registrar Ingreso' : 'Registrar Retiro'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
