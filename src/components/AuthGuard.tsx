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
    let isMounted = true;

    async function checkSession() {
      try {
        // 1. Verificamos sesión de Supabase
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!session) {
          if (isMounted) navigate('/login');
          return;
        }

        // 2. Lógica de Licencia Inteligente
        if (isOnline()) {
          const localSettings = await db.settings.toArray();
          
          if (localSettings.length > 0) {
            // CASO A: Ya conocemos el negocio, actualizamos licencia
            if (isMounted) setCheckingLicense(true);
            await syncBusinessProfile(localSettings[0].id);
          } else {
            // CASO B (CRÍTICO): Primera vez o caché borrado.
            // Buscamos el ID del negocio asociado a este usuario en la nube
            if (isMounted) setCheckingLicense(true);
            
            // Consultamos la tabla 'profiles' para saber el business_id
            const { data: profile } = await supabase
              .from('profiles')
              .select('business_id')
              .eq('id', session.user.id) // El ID de auth es el mismo que en profiles
              .single();

            if (profile?.business_id) {
              console.log('📥 Descargando configuración inicial del negocio...');
              await syncBusinessProfile(profile.business_id);
            }
          }
        }

        // 3. Validación Final (funciona Offline porque ya descargamos en el paso 2)
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
          // Si llegamos aquí y sigue sin haber config, es un login fallido sin datos
          if (!isOnline()) {
             console.warn("⚠️ Iniciando sin configuración (Offline mode restringido)");
          }
        }

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
            {checkingLicense ? 'Validando licencia...' : 'Verificando credenciales...'}
        </p>
      </div>
    );
  }

  return <>{children}</>;
}