import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Staff } from '../lib/db';
import { Lock } from 'lucide-react';

interface Props {
  onSuccess: (staff: Staff) => void;
  onCancel?: () => void;
}

export function PinPad({ onSuccess, onCancel }: Props) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  
  // Buscamos todos los empleados para ver si el PIN coincide con alguno
  const staffMembers = useLiveQuery(() => db.staff.toArray()) || [];

  const handleNum = (num: string) => {
    if (pin.length < 4) {
      const newPin = pin + num;
      setPin(newPin);
      setError(false);
      
      // Si ya escribieron 4 números, verificamos
      if (newPin.length === 4) {
        checkPin(newPin);
      }
    }
  };

  const checkPin = (inputPin: string) => {
    const found = staffMembers.find(s => s.pin === inputPin);
    if (found) {
      onSuccess(found); // ¡PIN Correcto!
    } else {
      setError(true); // PIN Incorrecto
      setTimeout(() => setPin(''), 500);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/95 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="w-full max-w-xs animate-in fade-in zoom-in duration-300">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg shadow-black/20">
            <Lock className="text-white w-8 h-8" />
          </div>
          <h2 className="text-white text-xl font-bold">Ingrese su PIN</h2>
          <p className="text-slate-400 text-sm mt-1">Identifíquese para continuar</p>
        </div>

        {/* Indicadores (Bolitas) */}
        <div className="flex justify-center gap-4 mb-8">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className={`w-4 h-4 rounded-full transition-all duration-300 ${pin.length > i ? 'bg-blue-500 scale-110 shadow-[0_0_10px_rgba(59,130,246,0.5)]' : 'bg-slate-700'} ${error ? 'bg-red-500 animate-pulse' : ''}`} />
          ))}
        </div>

        {/* Teclado Numérico */}
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
            <button key={n} onClick={() => handleNum(n.toString())} className="h-16 rounded-full bg-slate-800 text-white text-2xl font-bold hover:bg-slate-700 active:scale-95 transition-all shadow-lg border-b-4 border-slate-950 active:border-b-0 active:translate-y-1">
              {n}
            </button>
          ))}
          <button onClick={() => { setPin(''); if(onCancel) onCancel(); }} className="h-16 rounded-full text-slate-400 hover:text-white flex items-center justify-center text-sm font-medium">Cancelar</button>
          <button onClick={() => handleNum('0')} className="h-16 rounded-full bg-slate-800 text-white text-2xl font-bold hover:bg-slate-700 border-b-4 border-slate-950 active:border-b-0 active:translate-y-1">0</button>
          <button onClick={() => setPin(prev => prev.slice(0, -1))} className="h-16 rounded-full text-slate-400 hover:text-white flex items-center justify-center text-sm font-medium">Borrar</button>
        </div>
      </div>
    </div>
  );
}