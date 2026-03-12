import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Staff } from '../lib/db';
import { Users, Lock, ChevronRight, X, CheckCircle } from 'lucide-react';

interface StaffSelectorModalProps {
  businessId: string;
  onSelect: (staff: Staff) => void;
  onClose?: () => void; // Si no se pasa, la selección es obligatoria
}

export function StaffSelectorModal({ businessId, onSelect, onClose }: StaffSelectorModalProps) {
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const staffList = useLiveQuery(async () => {
    return await db.staff
      .where('business_id').equals(businessId)
      .filter(s => s.active !== false)
      .toArray();
  }, [businessId]) || [];

  const handleSelectStaff = (staff: Staff) => {
    setSelectedStaff(staff);
    setPin('');
    setError('');
  };

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStaff) return;

    setLoading(true);
    setError('');

    await new Promise(r => setTimeout(r, 300));

    if (pin === selectedStaff.pin) {
      localStorage.setItem('nexus_staff_id', selectedStaff.id);
      onSelect(selectedStaff);
    } else {
      setError('PIN incorrecto. Intenta de nuevo.');
      setPin('');
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-[#0B3B68]/95 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="bg-[#0B3B68] px-6 py-5 text-white flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-[#7AC142] p-2 rounded-xl">
              <Users size={20} className="text-[#0B3B68]" />
            </div>
            <div>
              <h2 className="font-black text-lg leading-tight">¿Quién está vendiendo?</h2>
              <p className="text-xs text-gray-300">Selecciona tu perfil para continuar</p>
            </div>
          </div>
          {onClose && (
            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg text-white transition-colors">
              <X size={20} />
            </button>
          )}
        </div>

        <div className="p-5">
          {!selectedStaff ? (
            // Lista de vendedores
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {staffList.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <Users size={40} className="mx-auto mb-2 stroke-1" />
                  <p className="font-bold text-sm">No hay personal configurado</p>
                </div>
              ) : (
                staffList.map(staff => (
                  <button
                    key={staff.id}
                    onClick={() => handleSelectStaff(staff)}
                    className="w-full flex items-center gap-4 p-4 rounded-2xl border border-gray-200 hover:border-[#0B3B68] hover:bg-[#0B3B68]/5 transition-all text-left group active:scale-[0.98]"
                  >
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-black text-lg shadow-sm border-2 flex-shrink-0 ${
                      staff.role === 'admin'
                        ? 'bg-[#7AC142] text-[#0B3B68] border-[#7AC142]'
                        : 'bg-[#0B3B68]/10 text-[#0B3B68] border-[#0B3B68]/20'
                    }`}>
                      {staff.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-[#1F2937] truncate">{staff.name}</p>
                      <p className="text-xs text-[#6B7280]">
                        {staff.role === 'admin' ? 'Administrador' : 'Vendedor'}
                      </p>
                    </div>
                    <ChevronRight size={18} className="text-gray-300 group-hover:text-[#0B3B68] transition-colors flex-shrink-0" />
                  </button>
                ))
              )}
            </div>
          ) : (
            // Input de PIN
            <form onSubmit={handlePinSubmit} className="animate-in slide-in-from-right-4 duration-200">
              <button
                type="button"
                onClick={() => { setSelectedStaff(null); setPin(''); setError(''); }}
                className="flex items-center gap-2 text-sm text-[#6B7280] hover:text-[#0B3B68] mb-5 transition-colors font-medium"
              >
                ← Volver
              </button>

              <div className="flex flex-col items-center mb-6">
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center font-black text-2xl shadow-lg mb-3 ${
                  selectedStaff.role === 'admin'
                    ? 'bg-[#7AC142] text-[#0B3B68]'
                    : 'bg-[#0B3B68] text-white'
                }`}>
                  {selectedStaff.name.substring(0, 2).toUpperCase()}
                </div>
                <h3 className="font-black text-xl text-[#1F2937]">{selectedStaff.name}</h3>
                <p className="text-sm text-[#6B7280]">
                  {selectedStaff.role === 'admin' ? 'Administrador' : 'Vendedor'}
                </p>
              </div>

              <div className="mb-5">
                <label className="block text-xs font-bold text-[#6B7280] uppercase tracking-wide mb-2 text-center">
                  PIN de acceso (4 dígitos)
                </label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-[#6B7280] w-5 h-5" />
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    autoFocus
                    value={pin}
                    onChange={e => {
                      setPin(e.target.value.replace(/\D/g, '').slice(0, 4));
                      setError('');
                    }}
                    className={`w-full pl-12 pr-4 py-4 text-center text-3xl font-mono tracking-[0.7em] border-2 rounded-2xl focus:outline-none transition-all ${
                      error
                        ? 'border-red-400 bg-red-50 focus:border-red-500'
                        : 'border-gray-200 focus:border-[#0B3B68] bg-gray-50 focus:bg-white'
                    }`}
                    placeholder="••••"
                  />
                </div>
                {error && (
                  <p className="text-center text-sm text-red-500 font-bold mt-2 animate-in fade-in">
                    {error}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={pin.length !== 4 || loading}
                className="w-full bg-[#0B3B68] text-white font-black py-4 rounded-2xl hover:bg-[#0B3B68]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 shadow-lg shadow-[#0B3B68]/20 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" />
                ) : (
                  <><CheckCircle size={20} /> Entrar al Sistema</>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
