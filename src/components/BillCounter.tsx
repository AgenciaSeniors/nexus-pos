import { useState, useEffect, useMemo } from 'react';
import { X, Calculator, RotateCcw, Copy, CheckCircle2, Banknote, Coins } from 'lucide-react';
import { toast } from 'sonner';

// Denominaciones de pesos cubanos (CUP)
const BILLS: number[] = [5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 3, 1];
const COINS: number[] = [5, 3, 1];

type Counts = Record<string, string>; // key: 'bill_5000' | 'coin_5' → string para input controlado

const STORAGE_KEY_PREFIX = 'nexus_bill_counter_';

const formatMoney = (n: number) =>
  new Intl.NumberFormat('es-CU', { style: 'currency', currency: 'CUP', maximumFractionDigits: 2 }).format(n);

const formatNumber = (n: number) =>
  new Intl.NumberFormat('es-CU').format(n);

interface BillCounterProps {
  isOpen: boolean;
  onClose: () => void;
  /** Callback opcional: si se provee, aparece un botón "Aplicar" que pasa el total al padre */
  onApply?: (total: number) => void;
  /** Texto del botón Aplicar (default: "Usar este total") */
  applyLabel?: string;
}

export function BillCounter({ isOpen, onClose, onApply, applyLabel = 'Usar este total' }: BillCounterProps) {
  const businessId = typeof window !== 'undefined' ? localStorage.getItem('nexus_business_id') : null;

  // No abrir el contador si no hay business_id: evita mezclar conteos entre negocios.
  // Esto puede pasar si la sesión aún no terminó de cargar.
  if (isOpen && !businessId) {
    return (
      <div className="fixed inset-0 bg-[#0B3B68]/80 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
        <div className="bg-white rounded-2xl p-6 max-w-xs text-center shadow-2xl">
          <p className="text-sm text-slate-600 mb-4">El contador necesita que tu sesión esté completamente cargada. Inténtalo en unos segundos.</p>
          <button onClick={onClose} className="px-4 py-2 bg-[#0B3B68] text-white font-bold rounded-xl text-sm">Entendido</button>
        </div>
      </div>
    );
  }

  const storageKey = `${STORAGE_KEY_PREFIX}${businessId}`;

  const [counts, setCounts] = useState<Counts>({});
  const [copied, setCopied] = useState(false);

  // Cargar de localStorage al montar
  useEffect(() => {
    if (!isOpen) return;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') setCounts(parsed);
      }
    } catch {
      /* ignorar JSON corrupto */
    }
  }, [isOpen, storageKey]);

  // Persistir en localStorage cada vez que cambia counts
  useEffect(() => {
    if (!isOpen) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(counts));
    } catch {
      /* localStorage lleno o no disponible */
    }
  }, [counts, isOpen, storageKey]);

  const updateCount = (key: string, value: string) => {
    // Solo dígitos, sin negativos ni decimales (cantidad de billetes/monedas)
    const cleaned = value.replace(/[^\d]/g, '');
    setCounts(prev => ({ ...prev, [key]: cleaned }));
  };

  const getCountNum = (key: string): number => {
    const v = counts[key];
    if (!v) return 0;
    const n = parseInt(v, 10);
    return isNaN(n) || n < 0 ? 0 : n;
  };

  const billsTotal = useMemo(() => {
    return BILLS.reduce((sum, denom) => sum + getCountNum(`bill_${denom}`) * denom, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts]);

  const coinsTotal = useMemo(() => {
    return COINS.reduce((sum, denom) => sum + getCountNum(`coin_${denom}`) * denom, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts]);

  const totalPieces = useMemo(() => {
    let total = 0;
    BILLS.forEach(d => total += getCountNum(`bill_${d}`));
    COINS.forEach(d => total += getCountNum(`coin_${d}`));
    return total;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts]);

  const grandTotal = billsTotal + coinsTotal;

  const handleClear = () => {
    setCounts({});
    try { localStorage.removeItem(storageKey); } catch { /* nada */ }
    toast.success('Contador limpiado');
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(grandTotal.toFixed(2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('No se pudo copiar al portapapeles');
    }
  };

  const handleApply = () => {
    if (onApply) {
      onApply(grandTotal);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-[#0B3B68]/80 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[95vh] sm:max-h-[90vh] animate-in slide-in-from-bottom sm:zoom-in-95 duration-300">

        {/* HEADER */}
        <div className="bg-[#0B3B68] px-5 py-4 text-white flex justify-between items-center flex-shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#7AC142]/20 flex items-center justify-center flex-shrink-0">
              <Calculator size={18} className="text-[#7AC142]" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-black truncate">Contador de Efectivo</h2>
              <p className="text-[10px] text-white/60 font-medium">Cuenta billetes y monedas</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors flex-shrink-0"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </div>

        {/* TOTAL GRANDE STICKY */}
        <div className="bg-gradient-to-r from-[#0B3B68] to-[#092b4d] text-white px-5 py-4 flex items-center justify-between flex-shrink-0 border-b-4 border-[#7AC142]">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-white/60">Total contado</p>
            <p className="text-3xl font-black tracking-tight">{formatMoney(grandTotal)}</p>
            {totalPieces > 0 && (
              <p className="text-[10px] font-medium text-white/70 mt-0.5">
                {formatNumber(totalPieces)} pieza{totalPieces !== 1 ? 's' : ''}
              </p>
            )}
          </div>
          <button
            onClick={handleCopy}
            disabled={grandTotal === 0}
            className="w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Copiar total"
          >
            {copied ? <CheckCircle2 size={18} className="text-[#7AC142]" /> : <Copy size={16} />}
          </button>
        </div>

        {/* CUERPO SCROLL */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">

          {/* BILLETES */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-black uppercase tracking-wider text-[#0B3B68] flex items-center gap-1.5">
                <Banknote size={14} /> Billetes
              </h3>
              <span className="text-xs font-bold text-[#0B3B68]">{formatMoney(billsTotal)}</span>
            </div>
            <div className="space-y-1.5">
              {BILLS.map(denom => {
                const key = `bill_${denom}`;
                const qty = getCountNum(key);
                const subtotal = qty * denom;
                return (
                  <div key={key} className={`flex items-center gap-2 p-2.5 rounded-xl border transition-colors ${qty > 0 ? 'bg-blue-50/50 border-blue-100' : 'bg-gray-50/60 border-gray-100'}`}>
                    <div className={`w-16 text-center px-2 py-1.5 rounded-lg font-black text-xs flex-shrink-0 ${denom >= 1000 ? 'bg-[#0B3B68] text-white' : denom >= 100 ? 'bg-blue-100 text-blue-800' : 'bg-gray-200 text-gray-700'}`}>
                      ${formatNumber(denom)}
                    </div>
                    <span className="text-xl font-light text-gray-400 flex-shrink-0">×</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={counts[key] || ''}
                      onChange={e => updateCount(key, e.target.value)}
                      placeholder="0"
                      className="w-16 text-center px-2 py-1.5 border border-gray-200 rounded-lg font-bold text-sm focus:border-[#0B3B68] focus:ring-2 focus:ring-[#0B3B68]/10 outline-none transition-all bg-white"
                    />
                    <div className="flex-1 text-right">
                      <span className={`font-bold text-sm font-mono ${qty > 0 ? 'text-[#0B3B68]' : 'text-gray-300'}`}>
                        {formatMoney(subtotal)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* MONEDAS */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-black uppercase tracking-wider text-[#0B3B68] flex items-center gap-1.5">
                <Coins size={14} /> Monedas
              </h3>
              <span className="text-xs font-bold text-[#0B3B68]">{formatMoney(coinsTotal)}</span>
            </div>
            <div className="space-y-1.5">
              {COINS.map(denom => {
                const key = `coin_${denom}`;
                const qty = getCountNum(key);
                const subtotal = qty * denom;
                return (
                  <div key={key} className={`flex items-center gap-2 p-2.5 rounded-xl border transition-colors ${qty > 0 ? 'bg-amber-50/50 border-amber-100' : 'bg-gray-50/60 border-gray-100'}`}>
                    <div className="w-16 text-center px-2 py-1.5 rounded-full bg-amber-100 text-amber-800 font-black text-xs flex-shrink-0 border border-amber-200">
                      ${denom}
                    </div>
                    <span className="text-xl font-light text-gray-400 flex-shrink-0">×</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={counts[key] || ''}
                      onChange={e => updateCount(key, e.target.value)}
                      placeholder="0"
                      className="w-16 text-center px-2 py-1.5 border border-gray-200 rounded-lg font-bold text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none transition-all bg-white"
                    />
                    <div className="flex-1 text-right">
                      <span className={`font-bold text-sm font-mono ${qty > 0 ? 'text-amber-700' : 'text-gray-300'}`}>
                        {formatMoney(subtotal)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* FOOTER ACCIONES */}
        <div className="border-t border-gray-100 p-3 flex gap-2 flex-shrink-0 bg-gray-50/50">
          <button
            onClick={handleClear}
            disabled={grandTotal === 0}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 bg-white text-[#6B7280] hover:text-red-600 hover:border-red-200 hover:bg-red-50 border border-gray-200 rounded-xl text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RotateCcw size={13} /> Limpiar
          </button>
          {onApply ? (
            <button
              onClick={handleApply}
              disabled={grandTotal === 0}
              className="flex-1 px-3 py-2.5 bg-[#7AC142] text-[#0B3B68] hover:bg-[#7AC142]/90 rounded-xl text-sm font-black transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-[#7AC142]/20"
            >
              {applyLabel}
            </button>
          ) : (
            <button
              onClick={onClose}
              className="flex-1 px-3 py-2.5 bg-[#0B3B68] text-white hover:bg-[#092b4d] rounded-xl text-sm font-black transition-colors"
            >
              Cerrar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
