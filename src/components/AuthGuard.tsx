import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { db } from '../lib/db';
// Importamos las funciones detalladas y el helper isOnline
import { syncCriticalData, syncHeavyData, isOnline } from '../lib/sync';
import { Loader2 } from 'lucide-react';

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Iniciando Nexus Pro...');

  useEffect(() => {
    let isMounted = true;

    async function checkSession() {
      try {
        // 1. Verificamos sesión de Supabase
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!session) {
          if (isMounted) navigate('/login');
          return;
        }

        // 2. Lógica de Acceso Inteligente
        const localSettings = await db.settings.toArray();
        const config = localSettings[0];

        // --- ESCENARIO A: USUARIO RECURRENTE (DATOS EXISTEN) ---
        if (config) {
          // A1. Validar Licencia Local (Prioridad de Seguridad)
          if (config.status === 'suspended') {
            alert('🚫 Su cuenta ha sido SUSPENDIDA. Contacte a soporte.');
            if (isMounted) navigate('/login');
            return;
          }

          if (config.subscription_expires_at) {
            const expiryDate = new Date(config.subscription_expires_at);
            const now = new Date();
            
            if (now > expiryDate) {
              alert('⚠️ Su licencia ha VENCIDO. Por favor renueve para continuar.');
              if (isMounted) navigate('/login');
              return;
            }
          }

          // A2. ¡Luz Verde! Entrar inmediatamente (Sin esperas)
          if (isMounted) setLoading(false);

          // A3. Actualización Silenciosa (Background Sync)
          if (isOnline()) {
            console.log('🔄 Actualizando datos en segundo plano...');
            // Primero lo rápido (Licencia/Staff)
            syncCriticalData(config.id).then(() => {
                // Luego lo pesado (Inventario)
                syncHeavyData(config.id); 
            });
          }
          return; // Fin del flujo para usuario recurrente
        }

        // --- ESCENARIO B: INSTALACIÓN LIMPIA (PRIMERA VEZ) ---
        // Aquí NO tenemos datos locales, así que estamos obligados a esperar la descarga.
        if (isOnline()) {
            if (isMounted) setLoadingMessage('Configurando su negocio por primera vez...');
            
            // 1. Obtener ID del negocio
            const { data: profile } = await supabase
              .from('profiles')
              .select('business_id')
              .eq('id', session.user.id)
              .single();

            if (profile?.business_id) {
                // 2. Descarga Bloqueante (Necesaria para no mostrar pantalla blanca)
                await syncCriticalData(profile.business_id);
                
                if (isMounted) setLoadingMessage('Descargando catálogo de productos...');
                await syncHeavyData(profile.business_id);
                
                // 3. Todo listo, entrar
                if (isMounted) setLoading(false);
            } else {
                console.error("No se encontró perfil de negocio para este usuario");
                if (isMounted) navigate('/login');
            }
        } else {
            // Caso Borde: Borró caché y no tiene internet
            alert("⚠️ Se requiere conexión a internet para la configuración inicial.");
            if (isMounted) navigate('/login');
        }

      } catch (error) {
        console.error('Error crítico en AuthGuard:', error);
        if (isMounted) navigate('/login');
      }
    }

    checkSession();

    return () => { isMounted = false; };
  }, [navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-4" />
        <p className="text-gray-600 font-medium">{loadingMessage}</p>
      </div>
    );
  }

  return <>{children}</>;
}