import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { db } from '../lib/db';
import { syncCriticalData, syncHeavyData, isOnline } from '../lib/sync';
import { Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Verificando credenciales...');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function checkSessionAndData() {
      try {
        // 1. Verificar Sesión en Supabase
        const { data: { session }, error: authError } = await supabase.auth.getSession();
        
        if (authError || !session) {
          console.warn("Sesión no válida o expirada:", authError);
          if (isMounted) navigate('/login');
          return;
        }

        // 2. Intentar leer configuración local (Verificar si ya somos usuarios activos)
        let localSettings = null;
        try {
            const settings = await db.settings.toArray();
            localSettings = settings[0];
        } catch (dbError) {
            console.error("Error crítico leyendo DB local:", dbError);
            setError("Error de base de datos local. Intenta recargar la página.");
            return;
        }

        // === CASO A: USUARIO YA TIENE DATOS (Entrada Rápida) ===
        if (localSettings) {
          // Validar estado de la cuenta
          if (localSettings.status === 'suspended') {
            if (isMounted) {
                alert('🚫 Tu cuenta está suspendida. Contacta a soporte.');
                navigate('/login');
            }
            return;
          }

          // Permitir entrada inmediata a la interfaz
          if (isMounted) setLoading(false);

          // Sincronización en segundo plano (Background Sync)
          if (isOnline()) {
            console.log("🌐 Conexión detectada. Iniciando sincronización silenciosa...");
            syncCriticalData(localSettings.id)
                .then(() => syncHeavyData(localSettings.id))
                .catch(err => console.error("Error en sync silencioso:", err));
          }
          return;
        }

        // === CASO B: PRIMERA VEZ / DATOS BORRADOS (Carga Inicial) ===
        if (isOnline()) {
            if (isMounted) setLoadingMessage('Configurando tu negocio por primera vez...');
            
            // Obtener el ID del negocio desde el perfil del usuario
            const { data: profile, error: profileError } = await supabase
              .from('profiles')
              .select('business_id, status')
              .eq('id', session.user.id)
              .single();

            if (profileError || !profile?.business_id) {
                console.error("Usuario sin negocio asignado:", profileError);
                if (isMounted) navigate('/login'); // O redirigir a una página de "Crear Negocio"
                return;
            }

            if (profile.status === 'suspended') {
                alert('🚫 Cuenta suspendida.');
                if (isMounted) navigate('/login');
                return;
            }

            // Paso 1: Descarga CRÍTICA (Bloqueante)
            // Necesitamos saber quiénes son los empleados y la config de caja antes de entrar
            if (isMounted) setLoadingMessage('Descargando configuración y personal...');
            await syncCriticalData(profile.business_id);
            
            // Paso 2: Descarga PESADA (Semi-bloqueante o Segundo plano)
            // Lanzamos la descarga de productos pero dejamos entrar al usuario
            toast.info("Descargando inventario...", { description: "Puedes empezar a trabajar, los productos aparecerán pronto." });
            
            // No usamos 'await' aquí para no tener al usuario esperando 1 minuto si tiene 5000 productos
            syncHeavyData(profile.business_id).then(() => {
                toast.success("Inventario completado.");
            });
            
            // ¡Entrada Exitosa!
            if (isMounted) setLoading(false);

        } else {
            // Caso Borde: Primera vez Y sin internet
            setError("Es tu primera vez entrando en este dispositivo. Necesitas internet para descargar los datos iniciales.");
        }

      } catch (err) {
        console.error('Error fatal en AuthGuard:', err);
        setError("Ocurrió un error inesperado al iniciar el sistema.");
      }
    }

    checkSessionAndData();

    return () => { isMounted = false; };
  }, [navigate]);

  // Pantalla de Carga
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-4">
        {error ? (
            <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md text-center border border-red-100">
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <AlertTriangle className="text-red-600 w-8 h-8" />
                </div>
                <h3 className="text-lg font-bold text-slate-800 mb-2">No se pudo iniciar</h3>
                <p className="text-slate-500 mb-6 text-sm">{error}</p>
                <button 
                    onClick={() => window.location.reload()} 
                    className="flex items-center justify-center gap-2 w-full py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-black transition-colors"
                >
                    <RefreshCw size={18} /> Reintentar
                </button>
            </div>
        ) : (
            <div className="text-center">
                <div className="relative w-24 h-24 mx-auto mb-6">
                    <div className="absolute inset-0 border-4 border-slate-200 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
                    <Loader2 className="absolute inset-0 m-auto text-indigo-600 w-8 h-8 animate-pulse" />
                </div>
                <h2 className="text-xl font-bold text-slate-800 mb-2">Nexus POS</h2>
                <p className="text-slate-500 font-medium animate-pulse">{loadingMessage}</p>
            </div>
        )}
      </div>
    );
  }

  return <>{children}</>;
}