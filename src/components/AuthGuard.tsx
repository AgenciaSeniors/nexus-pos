import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { db } from '../lib/db';
// 👇 Asegúrate de importar isOnline aquí
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
    let isMounted = true;

    async function checkSession() {
      try {
        // 1. Verificamos sesión de Supabase
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!session) {
          if (isMounted) navigate('/login');
          return;
        }

        // 2. Sincronización Inteligente (Online)
        if (isOnline()) { // <--- Aquí usamos la función
          const localSettings = await db.settings.toArray();
          
          if (localSettings.length > 0) {
            // CASO A: Ya conocemos el negocio (Usuario recurrente)
            // ⚡ TRUCO DE VELOCIDAD: No ponemos 'await' aquí.
            // Dejamos que se actualice en el fondo mientras el usuario entra YA.
            syncBusinessProfile(localSettings[0].id); 
          } else {
            // CASO B: Primera vez en este PC
            // Aquí SÍ ponemos 'await' porque necesitamos bajar los datos obligatoriamente
            if (isMounted) setCheckingLicense(true);
            
            const { data: profile } = await supabase
              .from('profiles')
              .select('business_id')
              .eq('id', session.user.id)
              .single();

            if (profile?.business_id) {
              console.log('📥 Descargando configuración inicial...');
              await syncBusinessProfile(profile.business_id);
            }
          }
        }

        // 3. Validación de Licencia (Con datos locales)
        const settings = await db.settings.toArray();
        const config = settings[0];

        if (config) {
          // A) ¿Suspendido?
          if (config.status === 'suspended') {
            alert('🚫 Su cuenta ha sido SUSPENDIDA. Contacte a soporte.');
            if (isMounted) navigate('/login');
            return;
          }

          // B) ¿Vencido?
          if (config.subscription_expires_at) {
            const expiryDate = new Date(config.subscription_expires_at);
            const now = new Date();
            
            if (now > expiryDate) {
              alert('⚠️ Su licencia ha VENCIDO. Por favor renueve para continuar.');
              if (isMounted) navigate('/login');
              return;
            }
          }
        } else {
          // Si llegamos aquí y no hay config ni internet, es un modo muy restringido
          if (!isOnline()) {
             console.warn("⚠️ Iniciando sin configuración (Offline mode)");
          }
        }

        // 4. Todo correcto, pase adelante
        if (isMounted) {
          setLoading(false);
          setCheckingLicense(false);
        }

      } catch (error) {
        console.error('Error crítico en AuthGuard:', error);
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
        <p className="text-gray-600">
            {checkingLicense ? 'Configurando sistema...' : 'Verificando credenciales...'}
        </p>
      </div>
    );
  }

  return <>{children}</>;
}