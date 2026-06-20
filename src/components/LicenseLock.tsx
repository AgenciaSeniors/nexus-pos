import { ShieldAlert, WifiOff, RefreshCw, LogOut, MessageCircle, Loader2 } from 'lucide-react';
import { ADMIN_WHATSAPP_PHONE } from '../lib/config';
import type { LicenseLockState } from '../lib/licenseClock';

interface LicenseLockProps {
  state: LicenseLockState;
  retrying: boolean;
  onRetry: () => void;
  onLogout: () => void;
}

/**
 * Pantalla de bloqueo a pantalla completa cuando la licencia/trial venció
 * (EXPIRED / SUSPENDED) o cuando hace falta reconectar para validar
 * (NEEDS_REVALIDATION). Reemplaza por completo a la app hasta que se resuelva.
 */
export function LicenseLock({ state, retrying, onRetry, onLogout }: LicenseLockProps) {
  const isReval = state === 'NEEDS_REVALIDATION';
  const isSuspended = state === 'SUSPENDED';

  const title = isReval
    ? 'Conéctate para validar'
    : isSuspended
      ? 'Cuenta suspendida'
      : 'Tu acceso terminó';

  const subtitle = isReval
    ? 'Llevas más de 7 días sin conexión. Conéctate a internet un momento para validar tu licencia y seguir trabajando. Tus datos están a salvo.'
    : isSuspended
      ? 'Tu cuenta fue suspendida. Contacta al administrador para reactivarla.'
      : 'Tu semana gratis (o tu licencia) venció. Renueva para seguir vendiendo con Bisne con Talla.';

  const waMsg = encodeURIComponent(
    isSuspended
      ? 'Hola, mi cuenta de Bisne con Talla aparece suspendida. ¿Pueden ayudarme?'
      : 'Hola, quiero renovar / pagar mi licencia de Bisne con Talla.',
  );
  const waUrl = `https://wa.me/${ADMIN_WHATSAPP_PHONE}?text=${waMsg}`;

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6 text-center">
      <div className="w-full max-w-sm">
        <div
          className={`inline-flex items-center justify-center w-20 h-20 rounded-3xl mb-6 ${
            isReval ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'
          }`}
        >
          {isReval ? <WifiOff className="w-10 h-10" /> : <ShieldAlert className="w-10 h-10" />}
        </div>

        <h1 className="text-2xl font-black text-white mb-3">{title}</h1>
        <p className="text-slate-400 text-sm leading-relaxed mb-8">{subtitle}</p>

        <div className="space-y-3">
          {!isReval && (
            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl bg-[#7AC142] text-white font-bold shadow-lg shadow-[#7AC142]/20 active:scale-95 transition-all"
            >
              <MessageCircle className="w-5 h-5" />
              {isSuspended ? 'Contactar al administrador' : 'Renovar / Pagar'}
            </a>
          )}

          <button
            onClick={onRetry}
            disabled={retrying}
            className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl bg-[#0B3B68] text-white font-bold active:scale-95 transition-all disabled:opacity-60"
          >
            {retrying ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
            {isReval ? 'Reintentar' : 'Ya pagué · Reintentar'}
          </button>

          <button
            onClick={onLogout}
            className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-slate-400 hover:text-white font-bold transition-colors"
          >
            <LogOut className="w-4 h-4" /> Cerrar sesión
          </button>
        </div>

        <p className="text-slate-600 text-xs mt-8">Bisne con Talla · Agencia Señores</p>
      </div>
    </div>
  );
}
