import { useState, useEffect, useCallback } from 'react';
import { Banknote, ArrowRight, X, Smartphone } from 'lucide-react';

type PaymentMethod = 'efectivo' | 'transferencia';

interface PaymentModalProps {
  total: number;
  onConfirm: (method: PaymentMethod, tendered: number, change: number) => void;
  onCancel: () => void;
}

export function PaymentModal({ total, onConfirm, onCancel }: PaymentModalProps) {
  const [method, setMethod] = useState<PaymentMethod>('efectivo');
  const [tendered, setTendered] = useState<string>('');

  const suggestions = [50, 100, 200, 500, 1000].filter(amount => amount >= total);

  const tenderedValue = parseFloat(tendered) || 0;
  const change = tenderedValue - total;
  const isCashless = method === 'transferencia';
  const isValid = isCashless || (method === 'efectivo' && tenderedValue >= total);

  const handleConfirm = useCallback(() => {
    if (!isValid) return;
    onConfirm(
      method,
      isCashless ? total : tenderedValue,
      isCashless ? 0 : change
    );
  }, [isValid, onConfirm, method, isCashless, tenderedValue, total, change]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter' && isValid) handleConfirm();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel, isValid, handleConfirm]); 

  return (
    <div className="fixed inset-0 bg-[#0B3B68]/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="bg-[#0B3B68] p-6 text-white flex justify-between items-center">
          <div>
            <p className="text-white/70 text-sm font-bold uppercase tracking-wider mb-1">Total a Pagar</p>
            <h2 className="text-4xl font-black">${total.toFixed(2)}</h2>
          </div>
          <button onClick={onCancel} className="bg-white/10 p-2 rounded-full hover:bg-white/20 transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="p-6 flex-1 overflow-y-auto">
          {/* Selector de Método (Reducido a 2 opciones) */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <button
              onClick={() => { setMethod('efectivo'); setTendered(''); }}
              className={`p-4 rounded-2xl border-2 flex flex-col items-center gap-2 transition-all ${
                method === 'efectivo'
                ? 'border-[#0B3B68] bg-[#0B3B68]/5 text-[#0B3B68]'
                : 'border-gray-100 text-gray-400 hover:bg-gray-50'
              }`}
            >
              <Banknote size={28} />
              <span className="font-bold text-sm">Efectivo</span>
            </button>
            <button
              onClick={() => { setMethod('transferencia'); setTendered(total.toString()); }}
              className={`p-4 rounded-2xl border-2 flex flex-col items-center gap-2 transition-all ${
                method === 'transferencia'
                ? 'border-[#0B3B68] bg-[#0B3B68]/5 text-[#0B3B68]'
                : 'border-gray-100 text-gray-400 hover:bg-gray-50'
              }`}
            >
              <Smartphone size={28} />
              <span className="font-bold text-sm">Transferencia</span>
            </button>
          </div>

          {/* Input de Efectivo */}
          {method === 'efectivo' && (
            <div className="space-y-5 animate-in slide-in-from-right-4 duration-300">
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

              {/* Botones rápidos */}
              <div className="flex gap-2 flex-wrap">
                {suggestions.map(amount => (
                  <button
                    key={amount}
                    onClick={() => setTendered(amount.toString())}
                    className="px-4 py-2 bg-gray-100 text-[#1F2937] rounded-xl text-sm font-bold hover:bg-[#0B3B68]/10 hover:text-[#0B3B68] transition-colors"
                  >
                    ${amount}
                  </button>
                ))}
                <button
                    onClick={() => setTendered(total.toString())}
                    className="px-4 py-2 bg-[#7AC142]/10 text-[#7AC142] border border-[#7AC142]/20 rounded-xl text-sm font-bold hover:bg-[#7AC142]/20 transition-colors"
                  >
                    Monto Exacto
                  </button>
              </div>

              {/* Resultado del Vuelto */}
              <div className={`p-5 rounded-2xl flex justify-between items-center transition-all ${change >= 0 ? 'bg-[#7AC142]/10 text-[#7AC142] border border-[#7AC142]/20' : 'bg-red-50 text-red-600 border border-red-100'}`}>
                <span className="font-bold uppercase text-xs tracking-wider">Su cambio:</span>
                <span className="text-3xl font-black">${change >= 0 ? change.toFixed(2) : '---'}</span>
              </div>
            </div>
          )}

          {isCashless && (
             <div className="p-5 bg-[#0B3B68]/5 border border-[#0B3B68]/10 text-[#0B3B68] rounded-2xl text-sm animate-in slide-in-from-left-4 duration-300">
                <p className="flex items-center gap-2 font-bold mb-1"><Smartphone size={18}/> Pago Digital</p>
                <p>Confirma que has recibido el pago exacto de <strong className="font-black text-lg">${total.toFixed(2)}</strong> mediante transferencia antes de continuar.</p>
             </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-gray-100 bg-gray-50">
          <button
            onClick={handleConfirm}
            disabled={!isValid}
            className="w-full bg-[#7AC142] text-white py-4 rounded-2xl font-black text-lg hover:bg-[#7AC142]/90 transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-2 shadow-lg shadow-[#7AC142]/20"
          >
            <span>Confirmar Cobro</span>
            <ArrowRight size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}