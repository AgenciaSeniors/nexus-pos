import { useState, useEffect, useCallback } from 'react';
import { Banknote, CreditCard, ArrowRight, X } from 'lucide-react';

interface PaymentModalProps {
  total: number;
  onConfirm: (method: 'efectivo' | 'transferencia', tendered: number, change: number) => void;
  onCancel: () => void;
}

export function PaymentModal({ total, onConfirm, onCancel }: PaymentModalProps) {
  const [method, setMethod] = useState<'efectivo' | 'transferencia'>('efectivo');
  const [tendered, setTendered] = useState<string>('');
  
  const suggestions = [50, 100, 200, 500, 1000].filter(amount => amount >= total);

  const tenderedValue = parseFloat(tendered) || 0;
  const change = tenderedValue - total;
  const isValid = method === 'transferencia' || (method === 'efectivo' && tenderedValue >= total);

  // CORRECCIÓN 1: Usamos useCallback para "congelar" la función y que no cambie en cada render innecesariamente
  const handleConfirm = useCallback(() => {
    if (!isValid) return;
    onConfirm(
      method, 
      method === 'efectivo' ? tenderedValue : total, 
      method === 'efectivo' ? change : 0
    );
  }, [isValid, onConfirm, method, tenderedValue, total, change]);

  // CORRECCIÓN 2: Ahora handleConfirm es estable y podemos ponerlo en las dependencias sin miedo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter' && isValid) handleConfirm();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel, isValid, handleConfirm]); 

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="bg-slate-900 p-6 text-white flex justify-between items-center">
          <div>
            <p className="text-slate-400 text-sm font-medium">Total a Pagar</p>
            <h2 className="text-4xl font-bold">${total.toFixed(2)}</h2>
          </div>
          <button onClick={onCancel} className="bg-white/10 p-2 rounded-full hover:bg-white/20 transition">
            <X size={24} />
          </button>
        </div>

        <div className="p-6 flex-1 overflow-y-auto">
          {/* Selector de Método */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <button
              onClick={() => setMethod('efectivo')}
              className={`p-4 rounded-xl border-2 flex flex-col items-center gap-2 transition-all ${
                method === 'efectivo' 
                ? 'border-indigo-600 bg-indigo-50 text-indigo-700' 
                : 'border-slate-100 text-slate-400 hover:bg-slate-50'
              }`}
            >
              <Banknote size={28} />
              <span className="font-bold text-sm">Efectivo</span>
            </button>
            <button
              onClick={() => { setMethod('transferencia'); setTendered(total.toString()); }}
              className={`p-4 rounded-xl border-2 flex flex-col items-center gap-2 transition-all ${
                method === 'transferencia' 
                ? 'border-indigo-600 bg-indigo-50 text-indigo-700' 
                : 'border-slate-100 text-slate-400 hover:bg-slate-50'
              }`}
            >
              <CreditCard size={28} />
              <span className="font-bold text-sm">Transferencia</span>
            </button>
          </div>

          {/* Input de Efectivo */}
          {method === 'efectivo' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">¿Con cuánto paga?</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-xl font-bold">$</span>
                  <input
                    type="number"
                    autoFocus
                    className="w-full pl-8 pr-4 py-3 text-2xl font-bold border-2 border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-0 outline-none transition-colors"
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
                    className="px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-sm font-bold hover:bg-indigo-100 hover:text-indigo-700 transition"
                  >
                    ${amount}
                  </button>
                ))}
                <button
                    onClick={() => setTendered(total.toString())}
                    className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-sm font-bold"
                  >
                    Exacto
                  </button>
              </div>

              {/* Resultado del Vuelto */}
              <div className={`p-4 rounded-xl flex justify-between items-center transition-all ${change >= 0 ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                <span className="font-medium">Su cambio:</span>
                <span className="text-2xl font-bold">${change >= 0 ? change.toFixed(2) : '---'}</span>
              </div>
            </div>
          )}

          {method === 'transferencia' && (
             <div className="p-4 bg-blue-50 text-blue-800 rounded-xl text-sm">
                <p>Confirma que has recibido la transferencia por <strong>${total.toFixed(2)}</strong>.</p>
             </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100">
          <button
            onClick={handleConfirm}
            disabled={!isValid}
            className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold text-lg hover:bg-black transition-transform active:scale-95 disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-2"
          >
            <span>Confirmar Cobro</span>
            <ArrowRight size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}