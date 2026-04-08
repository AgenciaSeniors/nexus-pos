import { useState, useRef, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Staff } from '../lib/db';
import { verifyPin, hashPin } from '../lib/pin';
import { Users, Delete, Shield, UserCircle2, Lock, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  businessId: string;
  onSelect: (staff: Staff) => void;
  onClose?: () => void;
}

// Brute-force: max 5 intentos, bloqueo 5 minutos
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;

export function StaffSelectorModal({ businessId, onSelect, onClose }: Props) {
  const [selected, setSelected] = useState<Staff | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  // --- PIN setup mode (cuando el staff no tiene PIN) ---
  const [setupMode, setSetupMode] = useState(false);
  const [setupPin, setSetupPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [setupStep, setSetupStep] = useState<'enter' | 'confirm'>('enter');

  // --- Brute-force protection ---
  const attemptsRef = useRef(0);
  const lockedUntilRef = useRef(0);
  const [lockSecondsLeft, setLockSecondsLeft] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      if (lockedUntilRef.current <= Date.now()) {
        setLockSecondsLeft(0);
        if (lockedUntilRef.current > 0) {
          attemptsRef.current = 0;
          lockedUntilRef.current = 0;
        }
      } else {
        setLockSecondsLeft(Math.ceil((lockedUntilRef.current - Date.now()) / 1000));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const staffList = useLiveQuery(
    () => db.staff.where('business_id').equals(businessId).filter(s => s.active !== false).toArray(),
    [businessId]
  ) || [];

  const handleSelectStaff = (staff: Staff) => {
    setSelected(staff);
    setPin('');
    setError('');
    // Si el staff no tiene PIN, entrar en modo setup
    if (!staff.pin) {
      setSetupMode(true);
      setSetupPin('');
      setConfirmPin('');
      setSetupStep('enter');
    } else {
      setSetupMode(false);
    }
  };

  const isLocked = lockSecondsLeft > 0;

  const handlePinDigit = (digit: string) => {
    if (isLocked) return;

    if (setupMode) {
      handleSetupDigit(digit);
      return;
    }

    if (pin.length >= 4) return;
    const newPin = pin + digit;
    setPin(newPin);
    setError('');

    if (newPin.length === 4) {
      setTimeout(() => validatePin(newPin), 80);
    }
  };

  const handleDelete = () => {
    if (setupMode) {
      if (setupStep === 'enter') {
        setSetupPin(p => p.slice(0, -1));
      } else {
        setConfirmPin(p => p.slice(0, -1));
      }
    } else {
      setPin(p => p.slice(0, -1));
    }
    setError('');
  };

  // --- PIN Setup flow ---
  const handleSetupDigit = (digit: string) => {
    if (setupStep === 'enter') {
      if (setupPin.length >= 4) return;
      const newPin = setupPin + digit;
      setSetupPin(newPin);
      setError('');
      if (newPin.length === 4) {
        setTimeout(() => {
          setSetupStep('confirm');
        }, 200);
      }
    } else {
      if (confirmPin.length >= 4) return;
      const newConfirm = confirmPin + digit;
      setConfirmPin(newConfirm);
      setError('');
      if (newConfirm.length === 4) {
        setTimeout(() => confirmSetupPin(setupPin, newConfirm), 80);
      }
    }
  };

  const confirmSetupPin = async (pinA: string, pinB: string) => {
    if (!selected) return;
    if (pinA !== pinB) {
      setError('Los PINs no coinciden. Intenta de nuevo.');
      setSetupPin('');
      setConfirmPin('');
      setSetupStep('enter');
      return;
    }
    // Hash y guardar
    const hashed = await hashPin(pinA, selected.id);
    await db.staff.update(selected.id, { pin: hashed });
    toast.success('PIN configurado exitosamente');
    // Continuar con login
    localStorage.setItem('nexus_staff_id', selected.id);
    onSelect({ ...selected, pin: hashed });
  };

  const validatePin = async (enteredPin: string) => {
    if (!selected) return;

    // Brute-force check
    if (isLocked) {
      setError(`Bloqueado. Espera ${lockSecondsLeft}s`);
      setPin('');
      return;
    }

    const isValid = await verifyPin(enteredPin, selected.id, selected.pin || '');
    if (isValid) {
      attemptsRef.current = 0;
      localStorage.setItem('nexus_staff_id', selected.id);
      onSelect(selected);
    } else {
      attemptsRef.current++;
      if (attemptsRef.current >= MAX_ATTEMPTS) {
        lockedUntilRef.current = Date.now() + LOCKOUT_MS;
        setLockSecondsLeft(Math.ceil(LOCKOUT_MS / 1000));
        setError(`Demasiados intentos. Bloqueado por 5 minutos.`);
      } else {
        const left = MAX_ATTEMPTS - attemptsRef.current;
        setError(`PIN incorrecto — ${left} intento${left !== 1 ? 's' : ''} restante${left !== 1 ? 's' : ''}`);
      }
      setPin('');
    }
  };

  // --- Staff list screen ---
  if (!selected) {
    return (
      <div className="fixed inset-0 bg-[#0B3B68] flex flex-col items-center justify-center p-4 z-50 overflow-y-auto">
        <div className="w-full max-w-md my-auto">
          <div className="flex flex-col items-center mb-6">
            <div className="bg-[#7AC142] w-14 h-14 rounded-2xl flex items-center justify-center mb-3 shadow-xl shadow-[#7AC142]/30">
              <Users size={28} className="text-[#0B3B68]" />
            </div>
            <h1 className="text-2xl font-black text-white text-center">¿Quién eres?</h1>
            <p className="text-white/60 mt-1 text-center text-sm">Selecciona tu perfil para acceder al sistema</p>
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
                  {/* Indicador de PIN no configurado */}
                  {!staff.pin && (
                    <div className="bg-orange-500/20 text-orange-400 text-[10px] font-bold px-2 py-1 rounded-lg flex items-center gap-1">
                      <Lock size={10} /> Sin PIN
                    </div>
                  )}
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

  // --- PIN pad (entry or setup) ---
  const currentPin = setupMode
    ? (setupStep === 'enter' ? setupPin : confirmPin)
    : pin;

  const subtitle = setupMode
    ? (setupStep === 'enter' ? 'Crea un PIN de 4 dígitos' : 'Confirma tu PIN')
    : 'Ingresa tu PIN de 4 dígitos';

  return (
    <div className="fixed inset-0 bg-[#0B3B68] flex flex-col items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="w-full max-w-xs my-auto">
        <div className="flex flex-col items-center mb-5">
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center font-black text-2xl mb-3 shadow-xl ${
            selected.role === 'admin' ? 'bg-[#7AC142] text-[#0B3B68]' : 'bg-white/20 text-white'
          }`}>
            {selected.name.substring(0, 2).toUpperCase()}
          </div>
          <h2 className="text-xl font-black text-white">{selected.name}</h2>
          <p className="text-white/50 text-sm mt-1">{subtitle}</p>
          {setupMode && (
            <div className="flex items-center gap-1.5 mt-2 bg-orange-500/15 text-orange-400 text-xs font-bold px-3 py-1.5 rounded-lg">
              <AlertTriangle size={12} />
              Configura tu PIN para continuar
            </div>
          )}
        </div>

        {/* Lockout banner */}
        {isLocked && (
          <div className="bg-red-500/15 border border-red-500/30 rounded-xl p-3 mb-4 text-center">
            <p className="text-red-400 text-sm font-bold">Acceso bloqueado</p>
            <p className="text-red-400/70 text-xs mt-1">
              Espera {Math.floor(lockSecondsLeft / 60)}:{(lockSecondsLeft % 60).toString().padStart(2, '0')} para reintentar
            </p>
          </div>
        )}

        <div className="flex justify-center gap-4 mb-5">
          {[0, 1, 2, 3].map(i => (
            <div
              key={i}
              className={`w-4 h-4 rounded-full transition-all duration-150 ${
                i < currentPin.length ? 'bg-[#7AC142] scale-110' : 'bg-white/20'
              }`}
            />
          ))}
        </div>

        {error && (
          <p className="text-red-400 text-sm text-center mb-4 font-bold">
            {error}
          </p>
        )}

        {/* Attempts remaining indicator */}
        {!setupMode && attemptsRef.current > 0 && !isLocked && (
          <p className="text-center text-xs text-orange-400 font-bold mb-3">
            {MAX_ATTEMPTS - attemptsRef.current} intento{MAX_ATTEMPTS - attemptsRef.current !== 1 ? 's' : ''} restante{MAX_ATTEMPTS - attemptsRef.current !== 1 ? 's' : ''}
          </p>
        )}

        <div className="grid grid-cols-3 gap-2.5 mb-4">
          {['1','2','3','4','5','6','7','8','9'].map(d => (
            <button
              key={d}
              onClick={() => handlePinDigit(d)}
              disabled={isLocked}
              className="bg-white/10 hover:bg-white/20 active:bg-[#7AC142] active:text-[#0B3B68] text-white font-black text-xl py-4 rounded-2xl transition-all active:scale-95 border border-white/5 disabled:opacity-30 disabled:pointer-events-none"
            >
              {d}
            </button>
          ))}
          <div />
          <button
            onClick={() => handlePinDigit('0')}
            disabled={isLocked}
            className="bg-white/10 hover:bg-white/20 active:bg-[#7AC142] active:text-[#0B3B68] text-white font-black text-xl py-4 rounded-2xl transition-all active:scale-95 border border-white/5 disabled:opacity-30 disabled:pointer-events-none"
          >
            0
          </button>
          <button
            onClick={handleDelete}
            disabled={isLocked}
            className="bg-white/10 hover:bg-red-500/30 active:bg-red-500 text-white py-4 rounded-2xl transition-all active:scale-95 border border-white/5 flex items-center justify-center disabled:opacity-30 disabled:pointer-events-none"
          >
            <Delete size={20} />
          </button>
        </div>

        <button
          onClick={() => { setSelected(null); setPin(''); setError(''); setSetupMode(false); }}
          className="w-full p-3 text-white/40 hover:text-white/70 text-sm font-bold transition-colors"
        >
          ← Cambiar perfil
        </button>
      </div>
    </div>
  );
}
