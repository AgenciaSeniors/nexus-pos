import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { db } from '../lib/db';
import { syncCriticalData, syncHeavyData, isOnline } from '../lib/sync';
import { Loader2, AlertTriangle, RefreshCw, LogOut, Clock, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { ADMIN_WHATSAPP_PHONE } from '../lib/config';

function SubscriptionExpiredScreen({ isTrial, onSignOut }: { isTrial: boolean; onSignOut: () => void }) {
  const waMsg = encodeURIComponent(
    isTrial
      ? "Hola, mi período de prueba de Bisne con Talla ha vencido y deseo activar mi cuenta."
      : "Hola, mi suscripción de Bisne con Talla ha vencido y deseo renovarla."
  );
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6 animate-in fade-in duration-500">
      <div className="bg-white p-8 rounded-3xl shadow-xl max-w-sm w-full text-center border border-amber-100">
        <div className="w-20 h-20 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-6">
          <Clock className="text-amber-500 w-10 h-10" />
        </div>
        <h3 className="text-2xl font-black text-slate-800 mb-2">
          {isTrial ? 'Prueba Vencida' : 'Suscripción Vencida'}
        </h3>
        <p className="text-slate-500 mb-2 text-sm leading-relaxed">
          {isTrial
            ? 'Tu período de prueba gratuito ha terminado.'
            : 'Tu suscripción ha expirado.'}
        </p>
        <p className="text-slate-500 mb-8 text-sm leading-relaxed">
          Tus datos están seguros. Contacta al administrador para {isTrial ? 'activar tu cuenta' : 'renovar tu suscripción'} y seguir usando <strong>Bisne con Talla</strong>.
        </p>
        <div className="space-y-3">
          <a
            href={`https://wa.me/${ADMIN_WHATSAPP_PHONE}?text=${waMsg}`}
            target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-3.5 bg-[#25D366] text-white rounded-xl font-bold hover:bg-[#1fba59] transition-all shadow-lg active:scale-95"
          >
            <MessageCircle size={20} /> Contactar por WhatsApp
          </a>
          <button
            onClick={onSignOut}
            className="flex items-center justify-center gap-2 w-full py-3.5 bg-white text-slate-600 border border-slate-200 rounded-xl font-bold hover:bg-slate-50 transition-all"
          >
            <LogOut size={18} /> Cerrar Sesión
          </button>
        </div>
      </div>
    </div>
  );
}

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Conectando con el servidor...');
  const [error, setError] = useState<string | null>(null);
  const [expiredStatus, setExpiredStatus] = useState<'trial' | 'active' | null>(null);

  const isChecking = useRef(false);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/super-admin-login');
  };

  /**
   * Retorna el status si la suscripción está vencida, null si está vigente.
   * Cubre tanto trial como suscripciones activas con fecha expirada.
   */
  function checkExpired(status?: string, subscriptionExpiresAt?: string): 'trial' | 'active' | null {
    if (status === 'trial') {
      if (!subscriptionExpiresAt) return null; // Sin fecha → trial activo
      return new Date() > new Date(subscriptionExpiresAt) ? 'trial' : null;
    }
    if (status === 'active') {
      if (!subscriptionExpiresAt) return null; // Sin fecha → activo permanente
      return new Date() > new Date(subscriptionExpiresAt) ? 'active' : null;
    }
    return null;
  }

  useEffect(() => {
    if (isChecking.current) return;
    isChecking.current = true;

    let isMounted = true;

    async function checkSessionAndData() {
      try {
        // AUMENTAMOS EL TIEMPO DE ESPERA A 15 SEGUNDOS (15000ms)
        const sessionPromise = supabase.auth.getSession();
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 15000)
        );

        const { data: sessionData, error: authError } = await Promise.race([sessionPromise, timeoutPromise]) as any;
        
        if (authError || !sessionData?.session) {
          if (isMounted) navigate('/super-admin-login');
          return;
        }

        const session = sessionData.session;

        let localSettings = null;
        try {
            const settings = await db.settings.toArray();
            localSettings = settings[0];
        } catch (dbError) {
            console.error("Error DB local:", dbError);
        }

        // Si ya hay datos, entra al momento
        if (localSettings) {
          if (localSettings.status === 'suspended') {
             throw new Error("Cuenta suspendida. Contacta a soporte.");
          }

          const expired = checkExpired(localSettings.status, localSettings.subscription_expires_at);
          if (expired) {
            if (isMounted) { setExpiredStatus(expired); setLoading(false); }
            return;
          }

          if (isMounted) setLoading(false);

          // Sync en background — puede actualizar estado del trial
          if (isOnline()) {
            syncCriticalData(localSettings.id)
                .then(() => syncHeavyData(localSettings.id))
                .catch(err => console.warn("Background sync info:", err));
          }
          return;
        }

        // Si es la primera instalación o se borró la memoria
        if (isOnline()) {
            if (isMounted) setLoadingMessage('Descargando tu perfil (esto puede tardar unos segundos)...');

            const { data: profile, error: profileError } = await supabase
              .from('profiles')
              .select('business_id, status')
              .eq('id', session.user.id)
              .single();

            if (profileError || !profile?.business_id) {
                throw new Error("No tienes un negocio asignado. Contacta al soporte.");
            }

            if (profile.status === 'suspended') {
                throw new Error("Tu cuenta ha sido suspendida.");
            }

            if (isMounted) setLoadingMessage('Sincronizando configuración...');
            await syncCriticalData(profile.business_id);

            // Verificar trial después de sincronizar (businesses.status se habrá descargado)
            const freshSettings = await db.settings.toArray();
            const freshConfig = freshSettings[0];
            const expiredFresh = freshConfig && checkExpired(freshConfig.status, freshConfig.subscription_expires_at);
            if (expiredFresh) {
              if (isMounted) { setExpiredStatus(expiredFresh); setLoading(false); }
              return;
            }

            if (isMounted) setLoadingMessage('Descargando productos y clientes...');
            try {
              const result = await syncHeavyData(profile.business_id);
              if (result.products > 0 || result.customers > 0) {
                toast.success(`Listo: ${result.products} productos, ${result.customers} clientes descargados.`, { duration: 4000 });
              }
            } catch (syncErr) {
              console.warn("Error descargando inventario:", syncErr);
              toast.warning("No se pudo descargar el inventario completo. Usa el botón de Sincronizar para reintentar.", { duration: 6000 });
            }

            if (isMounted) setLoading(false);

        } else {
            setError("No hay internet y no se encontraron datos guardados. Necesitas conexión para el primer inicio.");
        }

      } catch (err: any) {
        console.error('AuthGuard Error:', err);
        
        if (err.message === 'Timeout' || err.message === 'Failed to fetch') {
           const settings = await db.settings.toArray();
           if (settings.length > 0 && isMounted) {
               console.log("Entrando en modo Offline Forzado.");
               setLoading(false);
               return;
           } else {
               setError("La conexión con la base de datos es muy lenta o inestable. Por favor, reintenta.");
           }
        } else {
            if (isMounted) {
                setError(err.message || "Error desconocido al iniciar sesión.");
            }
        }
        
        if (isMounted) setLoading(true); // Muestra la pantalla de error
      }
    }

    checkSessionAndData();

    return () => { isMounted = false; };
  }, [navigate]);

  if (expiredStatus) {
    return <SubscriptionExpiredScreen isTrial={expiredStatus === 'trial'} onSignOut={handleSignOut} />;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6 animate-in fade-in duration-500">
        {error ? (
            <div className="bg-white p-8 rounded-3xl shadow-xl max-w-sm text-center border border-red-100">
                <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6 animate-bounce">
                    <AlertTriangle className="text-red-500 w-10 h-10" />
                </div>
                <h3 className="text-xl font-black text-slate-800 mb-2">Acceso Interrumpido</h3>
                <p className="text-slate-500 mb-8 text-sm leading-relaxed">{error}</p>
                
                <div className="space-y-3">
                    <button 
                        onClick={() => { window.location.reload(); }} 
                        className="flex items-center justify-center gap-2 w-full py-3.5 bg-slate-900 text-white rounded-xl font-bold hover:bg-black transition-all active:scale-95 shadow-lg shadow-slate-200"
                    >
                        <RefreshCw size={18} /> Reintentar Conexión
                    </button>
                    <button 
                        onClick={async () => { await supabase.auth.signOut(); navigate('/super-admin-login'); }} 
                        className="flex items-center justify-center gap-2 w-full py-3.5 bg-white text-slate-600 border border-slate-200 rounded-xl font-bold hover:bg-slate-50 transition-all"
                    >
                        <LogOut size={18} /> Cerrar Sesión
                    </button>
                </div>
            </div>
        ) : (
            <div className="text-center">
                <div className="relative w-24 h-24 mx-auto mb-8">
                    <div className="absolute inset-0 border-4 border-indigo-100 rounded-full animate-ping opacity-20"></div>
                    <div className="absolute inset-0 border-4 border-indigo-100 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Loader2 className="text-indigo-600 w-8 h-8 animate-pulse" />
                    </div>
                </div>
                <h2 className="text-2xl font-black text-slate-800 mb-2 tracking-tight">Bisne con Talla</h2>
                <p className="text-slate-500 font-medium text-sm animate-pulse">{loadingMessage}</p>
            </div>
        )}
      </div>
    );
  }

  return <>{children}</>;
}