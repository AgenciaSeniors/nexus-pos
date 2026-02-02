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
  const [loadingMessage, setLoadingMessage] = useState('Iniciando sistema...');
  const [error, setError] = useState<string | null>(null);
  
  // Evitar doble ejecución en React StrictMode
  const isChecking = useRef(false);

  useEffect(() => {
    if (isChecking.current) return;
    isChecking.current = true;

    let isMounted = true;

    async function checkSessionAndData() {
      try {
        // 1. VERIFICAR SESIÓN (Supabase)
        const { data: { session }, error: authError } = await supabase.auth.getSession();
        
        if (authError || !session) {
          if (isMounted) navigate('/login');
          return;
        }

        // 2. VERIFICAR DATOS LOCALES (Modo Offline/Rápido)
        let localSettings = null;
        try {
            const settings = await db.settings.toArray();
            localSettings = settings[0];
        } catch (dbError) {
            console.error("Error DB local:", dbError);
            // No bloqueamos por error de DB, intentamos seguir
        }

        // === ESCENARIO A: USUARIO YA ACTIVO (Entrada Rápida) ===
        if (localSettings) {
          if (localSettings.status === 'suspended') {
             throw new Error("Cuenta suspendida. Contacta a soporte.");
          }

          // ¡Luz verde inmediata!
          if (isMounted) setLoading(false);

          // Sincronización silenciosa en background (solo si hay red)
          if (isOnline()) {
            console.log("⚡ Sync en segundo plano iniciado...");
            syncCriticalData(localSettings.id)
                .then(() => syncHeavyData(localSettings.id))
                .catch(err => console.warn("Background sync info:", err));
          }
          return;
        }

        // === ESCENARIO B: PRIMERA INSTALACIÓN (Carga Inicial) ===
        if (isOnline()) {
            if (isMounted) setLoadingMessage('Configurando tu terminal...');
            
            // Buscar perfil para saber el Business ID
            const { data: profile, error: profileError } = await supabase
              .from('profiles')
              .select('business_id, status')
              .eq('id', session.user.id)
              .single();

            if (profileError || !profile?.business_id) {
                console.error("Perfil incompleto:", profileError);
                // Si no tiene negocio, quizás deba crearlo (redirigir a wizard si existiera)
                throw new Error("No tienes un negocio asignado.");
            }

            if (profile.status === 'suspended') {
                throw new Error("Tu cuenta ha sido suspendida.");
            }

            // Descarga Crítica (Bloqueante)
            if (isMounted) setLoadingMessage('Sincronizando perfil...');
            await syncCriticalData(profile.business_id);
            
            // Descarga Pesada (No bloqueante para UX, pero iniciada)
            toast.info("Descargando catálogo...", { 
                description: "Puedes empezar a trabajar mientras terminamos.",
                duration: 5000 
            });
            syncHeavyData(profile.business_id); // "Fire and forget"
            
            if (isMounted) setLoading(false);

        } else {
            // Caso Borde: Primera vez sin internet
            setError("Es tu primera conexión en este dispositivo. Necesitas internet para la configuración inicial.");
        }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        console.error('AuthGuard Error:', err);
        if (isMounted) {
            setError(err.message || "Error de inicio de sesión");
            setLoading(true); // Mantener pantalla de carga/error
        }
      }
    }

    checkSessionAndData();

    return () => { isMounted = false; };
  }, [navigate]);

  // --- PANTALLA DE CARGA / ERROR ---
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
                        onClick={() => window.location.reload()} 
                        className="flex items-center justify-center gap-2 w-full py-3.5 bg-slate-900 text-white rounded-xl font-bold hover:bg-black transition-all active:scale-95 shadow-lg shadow-slate-200"
                    >
                        <RefreshCw size={18} /> Reintentar
                    </button>
                    <button 
                        onClick={async () => { await supabase.auth.signOut(); navigate('/login'); }} 
                        className="flex items-center justify-center gap-2 w-full py-3.5 bg-white text-slate-600 border border-slate-200 rounded-xl font-bold hover:bg-slate-50 transition-all"
                    >
                        <LogOut size={18} /> Cerrar Sesión
                    </button>
                </div>
            </div>
        ) : (
            <div className="text-center">
                <div className="relative w-24 h-24 mx-auto mb-8">
                    {/* Efecto de onda */}
                    <div className="absolute inset-0 border-4 border-indigo-100 rounded-full animate-ping opacity-20"></div>
                    <div className="absolute inset-0 border-4 border-indigo-100 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Loader2 className="text-indigo-600 w-8 h-8 animate-pulse" />
                    </div>
                </div>
                <h2 className="text-2xl font-black text-slate-800 mb-2 tracking-tight">Bisne con Talla</h2>
                <p className="text-slate-400 font-medium text-sm animate-pulse">{loadingMessage}</p>
            </div>
        )}
      </div>
    );
  }

  return <>{children}</>;
}