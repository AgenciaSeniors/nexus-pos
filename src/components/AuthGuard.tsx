import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { db } from '../lib/db';
import { syncCriticalData, syncHeavyData, isOnline } from '../lib/sync';
import { Loader2, AlertTriangle, RefreshCw, LogOut } from 'lucide-react';
import { toast } from 'sonner';

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Conectando con el servidor...');
  const [error, setError] = useState<string | null>(null);
  
  const isChecking = useRef(false);

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

          if (isMounted) setLoading(false);

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

            if (isMounted) setLoadingMessage('Sincronizando configuración y catálogo...');
            await syncCriticalData(profile.business_id);
            
            toast.info("Descargando inventario de fondo...", { duration: 5000 });
            syncHeavyData(profile.business_id);
            
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