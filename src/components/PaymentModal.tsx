import { useState, useEffect, useCallback } from 'react';
import { Banknote, Smartphone, ArrowLeftRight, X, Star, ChevronUp, ChevronDown, ArrowRight } from 'lucide-react';
import type { Customer } from '../lib/db';

type PaymentMethod = 'efectivo' | 'transferencia' | 'mixto';

interface PaymentModalProps {
  total: number;
  customer?: Customer | null;
  onConfirm: (
    method: PaymentMethod,
    tendered: number,
    change: number,
    cashAmount?: number,
    transferAmount?: number,
    redeemedPoints?: number
  ) => void;
  onCancel: () => void;
}

export function PaymentModal({ total, customer, onConfirm, onCancel }: PaymentModalProps) {
  const [method, setMethod] = useState<PaymentMethod>('efectivo');

  // Efectivo
  const [tendered, setTendered] = useState<string>('');

  // Mixto
  const [cashInput, setCashInput] = useState<string>('');
  const [transferInput, setTransferInput] = useState<string>('');

  // Puntos
  const [redeemedPoints, setRedeemedPoints] = useState(0);

  const availablePoints = customer?.loyalty_points || 0;
  const maxRedeemable = Math.min(availablePoints, Math.floor(total / 0.10));
  const pointsDiscount = Math.round(redeemedPoints * 0.10 * 100) / 100;
  const effectiveTotal = Math.max(0, Math.round((total - pointsDiscount) * 100) / 100);

  // Efectivo
  const tenderedValue = parseFloat(tendered) || 0;
  const change = Math.round((tenderedValue - effectiveTotal) * 100) / 100;
  const suggestions = [50, 100, 200, 500, 1000].filter(a => a >= effectiveTotal);

  // Mixto
  const cashValue = parseFloat(cashInput) || 0;
  const transferValue = parseFloat(transferInput) || 0;
  const remaining = Math.round((effectiveTotal - cashValue - transferValue) * 100) / 100;
  const mixtoValid = Math.abs(remaining) < 0.005 && cashValue > 0 && transferValue > 0;

  const isValid =
    method === 'efectivo' ? tenderedValue >= effectiveTotal :
    method === 'transferencia' ? true :
    mixtoValid;

  // Auto-completar el campo transferencia en modo mixto
  const handleCashInputChange = (val: string) => {
    setCashInput(val);
    const cv = parseFloat(val) || 0;
    const rest = Math.max(0, Math.round((effectiveTotal - cv) * 100) / 100);
    setTransferInput(rest > 0 ? rest.toFixed(2) : '');
  };

  const handleConfirm = useCallback(() => {
    if (!isValid) return;
    if (method === 'efectivo') {
      onConfirm('efectivo', tenderedValue, Math.max(0, change), undefined, undefined, redeemedPoints || undefined);
    } else if (method === 'transferencia') {
      onConfirm('transferencia', effectiveTotal, 0, undefined, undefined, redeemedPoints || undefined);
    } else {
      onConfirm('mixto', cashValue, 0, cashValue, transferValue, redeemedPoints || undefined);
    }
  }, [isValid, method, tenderedValue, change, effectiveTotal, cashValue, transferValue, redeemedPoints, onConfirm]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter' && isValid) handleConfirm();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel, isValid, handleConfirm]);

  // Resetear campos al cambiar método
  const selectMethod = (m: PaymentMethod) => {
    setMethod(m);
    setTendered('');
    setCashInput('');
    setTransferInput('');
  };

  return (
    <div className="fixed inset-0 bg-[#0B3B68]/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">

        {/* Header */}
        <div className="bg-[#0B3B68] p-5 text-white flex justify-between items-start">
          <div>
            <p className="text-white/60 text-xs font-bold uppercase tracking-wider mb-0.5">Total a Pagar</p>
            {pointsDiscount > 0 ? (
              <>
                <p className="text-white/50 text-sm line-through">${total.toFixed(2)}</p>
                <h2 className="text-4xl font-black">${effectiveTotal.toFixed(2)}</h2>
              </>
            ) : (
              <h2 className="text-4xl font-black">${total.toFixed(2)}</h2>
            )}
          </div>
          <button onClick={onCancel} className="bg-white/10 p-2 rounded-full hover:bg-white/20 transition-colors mt-1">
            <X size={22} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">

          {/* Puntos de lealtad */}
          {availablePoints > 0 && (
            <div className="mx-5 mt-4 bg-indigo-50 border border-indigo-100 rounded-2xl p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Star size={15} className="text-indigo-500" fill="currentColor"/>
                  <span className="text-xs font-bold text-indigo-700">
                    {customer?.name.split(' ')[0]} tiene {availablePoints} puntos
                    <span className="font-normal text-indigo-500 ml-1">(máx. ${(maxRedeemable * 0.10).toFixed(2)} desc.)</span>
                  </span>
                </div>
                {redeemedPoints > 0 && (
                  <span className="text-xs font-black text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded-full">
                    -{(redeemedPoints * 0.10).toFixed(2)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setRedeemedPoints(Math.max(0, redeemedPoints - 10))}
                  disabled={redeemedPoints === 0}
                  className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center hover:bg-indigo-200 disabled:opacity-40 transition-colors font-bold"
                ><ChevronDown size={16}/></button>
                <div className="flex-1 text-center">
                  <span className="text-lg font-black text-indigo-700">{redeemedPoints}</span>
                  <span className="text-xs text-indigo-500 ml-1">puntos</span>
                </div>
                <button
                  onClick={() => setRedeemedPoints(Math.min(maxRedeemable, redeemedPoints + 10))}
                  disabled={redeemedPoints >= maxRedeemable}
                  className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center hover:bg-indigo-200 disabled:opacity-40 transition-colors font-bold"
                ><ChevronUp size={16}/></button>
                <button
                  onClick={() => setRedeemedPoints(maxRedeemable)}
                  className="px-3 py-1.5 bg-indigo-500 text-white rounded-xl text-xs font-bold hover:bg-indigo-600 transition-colors"
                >Todos</button>
                {redeemedPoints > 0 && (
                  <button
                    onClick={() => setRedeemedPoints(0)}
                    className="px-3 py-1.5 bg-white border border-indigo-200 text-indigo-500 rounded-xl text-xs font-bold hover:bg-indigo-50 transition-colors"
                  >Reset</button>
                )}
              </div>
            </div>
          )}

          <div className="p-5">
            {/* Selector de método */}
            <div className="grid grid-cols-3 gap-2 mb-5">
              {([
                { key: 'efectivo', label: 'Efectivo', icon: <Banknote size={22}/> },
                { key: 'transferencia', label: 'Transfer.', icon: <Smartphone size={22}/> },
                { key: 'mixto', label: 'Mixto', icon: <ArrowLeftRight size={22}/> },
              ] as const).map(({ key, label, icon }) => (
                <button
                  key={key}
                  onClick={() => selectMethod(key)}
                  className={`p-3 rounded-2xl border-2 flex flex-col items-center gap-1.5 transition-all ${
                    method === key
                      ? 'border-[#0B3B68] bg-[#0B3B68]/5 text-[#0B3B68]'
                      : 'border-gray-100 text-gray-400 hover:bg-gray-50 hover:border-gray-200'
                  }`}
                >
                  {icon}
                  <span className="font-bold text-xs">{label}</span>
                </button>
              ))}
            </div>

            {/* Panel: Efectivo */}
            {method === 'efectivo' && (
              <div className="space-y-4 animate-in slide-in-from-right-4 duration-200">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-2">¿Con cuánto paga el cliente?</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-2xl font-bold">$</span>
                    <input
                      type="number"
                      autoFocus
                      className="w-full pl-10 pr-4 py-4 text-3xl font-black border-2 border-gray-200 rounded-2xl focus:border-[#0B3B68] focus:ring-0 outline-none transition-colors text-[#1F2937]"
                      placeholder="0.00"
                      value={tendered}
                      onChange={e => setTendered(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {suggestions.map(amount => (
                    <button key={amount} onClick={() => setTendered(amount.toString())}
                      className="px-4 py-2 bg-gray-100 text-[#1F2937] rounded-xl text-sm font-bold hover:bg-[#0B3B68]/10 hover:text-[#0B3B68] transition-colors">
                      ${amount}
                    </button>
                  ))}
                  <button onClick={() => setTendered(effectiveTotal.toFixed(2))}
                    className="px-4 py-2 bg-[#7AC142]/10 text-[#7AC142] border border-[#7AC142]/20 rounded-xl text-sm font-bold hover:bg-[#7AC142]/20 transition-colors">
                    Monto Exacto
                  </button>
                </div>
                <div className={`p-4 rounded-2xl flex justify-between items-center transition-all ${change >= 0 ? 'bg-[#7AC142]/10 text-[#7AC142] border border-[#7AC142]/20' : 'bg-red-50 text-red-500 border border-red-100'}`}>
                  <span className="font-bold uppercase text-xs tracking-wider">Cambio:</span>
                  <span className="text-3xl font-black">{change >= 0 ? `$${change.toFixed(2)}` : '---'}</span>
                </div>
              </div>
            )}

            {/* Panel: Transferencia */}
            {method === 'transferencia' && (
              <div className="p-4 bg-[#0B3B68]/5 border border-[#0B3B68]/10 text-[#0B3B68] rounded-2xl text-sm animate-in slide-in-from-left-4 duration-200">
                <p className="flex items-center gap-2 font-bold mb-1"><Smartphone size={18}/> Pago Digital</p>
                <p>Confirma que has recibido el pago exacto de <strong className="font-black text-lg">${effectiveTotal.toFixed(2)}</strong> mediante transferencia antes de continuar.</p>
              </div>
            )}

            {/* Panel: Mixto */}
            {method === 'mixto' && (
              <div className="space-y-3 animate-in slide-in-from-bottom-4 duration-200">
                <p className="text-xs font-bold text-gray-500 uppercase">Distribuir ${effectiveTotal.toFixed(2)} entre:</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="flex items-center gap-1 text-xs font-bold text-gray-500 mb-1.5"><Banknote size={12}/> Efectivo</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">$</span>
                      <input
                        type="number"
                        autoFocus
                        min="0"
                        className="w-full pl-7 pr-3 py-3 text-xl font-black border-2 border-gray-200 rounded-xl focus:border-[#0B3B68] focus:ring-0 outline-none text-[#1F2937]"
                        placeholder="0.00"
                        value={cashInput}
                        onChange={e => handleCashInputChange(e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="flex items-center gap-1 text-xs font-bold text-gray-500 mb-1.5"><Smartphone size={12}/> Transferencia</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">$</span>
                      <input
                        type="number"
                        min="0"
                        className="w-full pl-7 pr-3 py-3 text-xl font-black border-2 border-gray-200 rounded-xl focus:border-[#0B3B68] focus:ring-0 outline-none text-[#1F2937]"
                        placeholder="0.00"
                        value={transferInput}
                        onChange={e => setTransferInput(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
                <div className={`p-3 rounded-xl flex justify-between items-center text-sm font-bold transition-all ${mixtoValid ? 'bg-[#7AC142]/10 text-[#7AC142] border border-[#7AC142]/20' : Math.abs(remaining) < 0.01 ? 'bg-[#7AC142]/10 text-[#7AC142] border border-[#7AC142]/20' : remaining > 0 ? 'bg-amber-50 text-amber-600 border border-amber-200' : 'bg-red-50 text-red-500 border border-red-100'}`}>
                  <span>Faltante / Sobrante</span>
                  <span className="text-lg font-black">{remaining === 0 ? '✓ Correcto' : remaining > 0 ? `-$${remaining.toFixed(2)}` : `+$${Math.abs(remaining).toFixed(2)}`}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-gray-100 bg-gray-50">
          <button
            onClick={handleConfirm}
            disabled={!isValid}
            className="w-full bg-[#7AC142] text-white py-4 rounded-2xl font-black text-lg hover:bg-[#7AC142]/90 transition-all active:scale-95 disabled:opacity-40 disabled:active:scale-100 flex items-center justify-center gap-2 shadow-lg shadow-[#7AC142]/20"
          >
            <span>Confirmar Cobro</span>
            <ArrowRight size={20}/>
          </button>
        </div>
      </div>
    </div>
  );
}
