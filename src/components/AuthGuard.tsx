import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { db } from '../lib/db';
import { syncBusinessProfile, isOnline } from '../lib/sync';
import { Loader2 } from 'lucide-react';

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [checkingLicense, setCheckingLicense] = useState(false);

  useEffect(() => {
    let isMounted = true; // Bandera para evitar actualizar estado si el componente se desmonta

    async function checkSession() {
      try {
        // 1. Verificamos sesión de Supabase (básico)
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!session) {
          if (isMounted) navigate('/login');
          return;
        }

        // 2. Intentamos actualizar licencia si hay internet
        // Esto refresca la fecha de vencimiento en Dexie
        if (isOnline()) {
          const localSettings = await db.settings.toArray();
          // Solo intentamos sincronizar si ya sabemos qué negocio es (tenemos datos locales)
          if (localSettings.length > 0) {
             if (isMounted) setCheckingLicense(true);
             await syncBusinessProfile(localSettings[0].id);
          }
        }

        // 3. Validamos fecha de vencimiento local
        // Leemos la configuración (ya sea la vieja o la que acabamos de bajar)
        const settings = await db.settings.toArray();
        const config = settings[0]; // Asumimos un solo negocio por dispositivo

        if (config) {
          // A) ¿Está suspendido manualmente?
          if (config.status === 'suspended') {
            alert('🚫 Su cuenta ha sido SUSPENDIDA. Contacte a soporte.');
            if (isMounted) navigate('/login');
            return;
          }

          // B) ¿Caducó la fecha?
          if (config.subscription_expires_at) {
            const expiryDate = new Date(config.subscription_expires_at);
            const now = new Date();
            
            // Damos un pequeño margen de gracia o comparamos estrictamente
            if (now > expiryDate) {
              alert('⚠️ Su licencia ha VENCIDO. Por favor renueve para continuar.');
              if (isMounted) navigate('/login');
              return;
            }
          }
        }

        // Si pasamos todas las pruebas, dejamos entrar
        if (isMounted) {
          setLoading(false);
          setCheckingLicense(false);
        }

      } catch (error) {
        console.error('Error verificando sesión:', error);
        if (isMounted) navigate('/login');
      }
    }

    checkSession();

    return () => { isMounted = false; };
  }, [navigate]);

  if (loading || checkingLicense) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-4" />
        <p className="text-gray-600">Verificando credenciales y licencia...</p>
      </div>
    );
  }

  return <>{children}</>;
}