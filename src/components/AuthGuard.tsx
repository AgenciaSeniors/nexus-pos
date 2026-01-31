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
        // 1. Verificamos sesión de Supabase (Online Check)
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!session) {
          if (isMounted) navigate('/login');
          return;
        }

        // 2. Sincronización Inteligente (Online)
        if (isOnline()) {
          const localSettings = await db.settings.toArray();
          
          if (localSettings.length > 0) {
            // CASO A: Ya tenemos datos, solo actualizamos la fecha de vencimiento
            if (isMounted) setCheckingLicense(true);
            await syncBusinessProfile(localSettings[0].id);
          } else {
            // CASO B (NUEVO): Primera vez o caché borrado. 
            // Buscamos el ID del negocio usando el usuario actual.
            if (isMounted) setCheckingLicense(true);
            
            // Buscamos en la tabla 'profiles' cuál es el negocio de este usuario
            const { data: profile } = await supabase
              .from('profiles')
              .select('business_id')
              .eq('id', session.user.id)
              .single();

            if (profile?.business_id) {
              console.log('📥 Descargando configuración inicial del negocio...');
              await syncBusinessProfile(profile.business_id);
            }
          }
        }

        // 3. Validación de Licencia (Offline/Local)
        // Ahora leemos la configuración (que acabamos de bajar si estaba vacía)
        const settings = await db.settings.toArray();
        const config = settings[0];

        if (config) {
          // A) Validación de Estado
          if (config.status === 'suspended') {
            alert('🚫 Su cuenta ha sido SUSPENDIDA. Contacte a soporte.');
            if (isMounted) navigate('/login');
            return;
          }

          // B) Validación de Fecha
          if (config.subscription_expires_at) {
            const expiryDate = new Date(config.subscription_expires_at);
            const now = new Date();
            
            // Pequeña validación para evitar bloqueos por zonas horarias incorrectas (opcional)
            // Se puede ser estricto: now > expiryDate
            if (now > expiryDate) {
              alert('⚠️ Su licencia ha VENCIDO. Por favor renueve para continuar.');
              if (isMounted) navigate('/login');
              return;
            }
          }
        } else {
          // Si llegamos aquí y sigue sin haber config, es un error crítico (login sin internet por primera vez)
          if (!isOnline()) {
             console.warn("⚠️ Iniciando sin configuración local (Offline mode restringido)");
             // Opcional: Podrías redirigir al login si quieres ser estricto
             // if (isMounted) navigate('/login'); 
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
            {checkingLicense ? 'Validando licencia...' : 'Verificando credenciales...'}
        </p>
      </div>
    );
  }

  return <>{children}</>;
}