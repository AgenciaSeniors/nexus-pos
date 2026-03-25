import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Staff } from '../lib/db';
import { Users, Delete, Shield, UserCircle2 } from 'lucide-react';

interface Props {
  businessId: string;
  onSelect: (staff: Staff) => void;
  onClose?: () => void;
}

export function StaffSelectorModal({ businessId, onSelect, onClose }: Props) {
  const [selected, setSelected] = useState<Staff | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const staffList = useLiveQuery(
    () => db.staff.where('business_id').equals(businessId).filter(s => s.active !== false).toArray(),
    [businessId]
  ) || [];

  const handleSelectStaff = (staff: Staff) => {
    setSelected(staff);
    setPin('');
    setError('');
  };

  const handlePinDigit = (digit: string) => {
    if (pin.length >= 4) return;
    const newPin = pin + digit;
    setPin(newPin);
    setError('');

    if (newPin.length === 4) {
      setTimeout(() => validatePin(newPin), 80);
    }
  };

  const handleDelete = () => {
    setPin(p => p.slice(0, -1));
    setError('');
  };

  const validatePin = (enteredPin: string) => {
    if (!selected) return;
    if (enteredPin === selected.pin) {
      localStorage.setItem('nexus_staff_id', selected.id);
      onSelect(selected);
    } else {
      setError('PIN incorrecto. Inténtalo de nuevo.');
      setPin('');
    }
  };

  if (!selected) {
    return (
      <div className="fixed inset-0 bg-[#0B3B68] flex flex-col items-center justify-center p-6 z-50">
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center mb-8">
            <div className="bg-[#7AC142] w-16 h-16 rounded-2xl flex items-center justify-center mb-4 shadow-xl shadow-[#7AC142]/30">
              <Users size={32} className="text-[#0B3B68]" />
            </div>
            <h1 className="text-3xl font-black text-white text-center">¿Quién eres?</h1>
            <p className="text-white/60 mt-2 text-center text-sm">Selecciona tu perfil para acceder al sistema</p>
          </div>

          {staffList.length === 0 ? (
            <div className="bg-white/10 rounded-2xl p-8 text-center text-white/50">
              <Users size={40} className="mx-auto mb-3 opacity-30" />
              <p>No hay perfiles disponibles</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {staffList.map(staff => (
                <button
                  key={staff.id}
                  onClick={() => handleSelectStaff(staff)}
                  className="flex items-center gap-4 bg-white/10 hover:bg-white/20 border border-white/10 hover:border-[#7AC142]/50 text-white p-4 rounded-2xl transition-all active:scale-95 text-left"
                >
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-black text-lg flex-shrink-0 ${
                    staff.role === 'admin' ? 'bg-[#7AC142] text-[#0B3B68]' : 'bg-white/20 text-white'
                  }`}>
                    {staff.name.substring(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-white truncate">{staff.name}</p>
                    <p className="text-xs text-white/50 flex items-center gap-1">
                      {staff.role === 'admin' ? <Shield size={10} /> : <UserCircle2 size={10} />}
                      {staff.role === 'admin' ? 'Administrador' : 'Vendedor'}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {onClose && (
            <button
              onClick={onClose}
              className="mt-6 w-full p-3 text-white/40 hover:text-white/70 text-sm font-bold transition-colors"
            >
              Cancelar
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-[#0B3B68] flex flex-col items-center justify-center p-6 z-50">
      <div className="w-full max-w-xs">
        <div className="flex flex-col items-center mb-8">
          <div className={`w-20 h-20 rounded-2xl flex items-center justify-center font-black text-3xl mb-4 shadow-xl ${
            selected.role === 'admin' ? 'bg-[#7AC142] text-[#0B3B68]' : 'bg-white/20 text-white'
          }`}>
            {selected.name.substring(0, 2).toUpperCase()}
          </div>
          <h2 className="text-2xl font-black text-white">{selected.name}</h2>
          <p className="text-white/50 text-sm mt-1">Ingresa tu PIN de 4 dígitos</p>
        </div>

        <div className="flex justify-center gap-4 mb-8">
          {[0, 1, 2, 3].map(i => (
            <div
              key={i}
              className={`w-4 h-4 rounded-full transition-all duration-150 ${
                i < pin.length ? 'bg-[#7AC142] scale-110' : 'bg-white/20'
              }`}
            />
          ))}
        </div>

        {error && (
          <p className="text-red-400 text-sm text-center mb-4 font-bold">
            {error}
          </p>
        )}

        <div className="grid grid-cols-3 gap-3 mb-4">
          {['1','2','3','4','5','6','7','8','9'].map(d => (
            <button
              key={d}
              onClick={() => handlePinDigit(d)}
              className="bg-white/10 hover:bg-white/20 active:bg-[#7AC142] active:text-[#0B3B68] text-white font-black text-2xl py-5 rounded-2xl transition-all active:scale-95 border border-white/5"
            >
              {d}
            </button>
          ))}
          <div />
          <button
            onClick={() => handlePinDigit('0')}
            className="bg-white/10 hover:bg-white/20 active:bg-[#7AC142] active:text-[#0B3B68] text-white font-black text-2xl py-5 rounded-2xl transition-all active:scale-95 border border-white/5"
          >
            0
          </button>
          <button
            onClick={handleDelete}
            className="bg-white/10 hover:bg-red-500/30 active:bg-red-500 text-white py-5 rounded-2xl transition-all active:scale-95 border border-white/5 flex items-center justify-center"
          >
            <Delete size={22} />
          </button>
        </div>

        <button
          onClick={() => { setSelected(null); setPin(''); setError(''); }}
          className="w-full p-3 text-white/40 hover:text-white/70 text-sm font-bold transition-colors"
        >
          ← Cambiar perfil
        </button>
      </div>
    </div>
  );
}
