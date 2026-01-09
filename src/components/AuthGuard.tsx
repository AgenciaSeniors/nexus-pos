import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Ban } from 'lucide-react'; // Quitamos LogOut que no se usaba

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<'loading' | 'active' | 'suspended' | 'error'>('loading');

  useEffect(() => {
    // Definimos la función DENTRO del efecto para evitar errores de linting
    async function checkBusinessStatus() {
      const { data: { session } } = await supabase.auth.getSession();
      
      // Si no hay sesión, dejamos pasar (el Login se encargará después) o mostramos error
      // Para este caso, si no hay sesión asumimos que está cargando o dejamos pasar al Login
      if (!session) {
        setStatus('active'); 
        return;
      }

      // 1. Buscamos el perfil
      const { data: perfil } = await supabase
        .from('profiles')
        .select('business_id')
        .eq('id', session.user.id)
        .single();

      if (perfil?.business_id) {
        // 2. Buscamos el estado del negocio
        const { data: business } = await supabase
          .from('businesses')
          .select('status')
          .eq('id', perfil.business_id)
          .single();
        
        // Si es 'active' pasa, si no, 'suspended'
        setStatus(business?.status === 'active' ? 'active' : 'suspended');
      } else {
        // Si tiene usuario pero no perfil/negocio, algo anda mal, pero lo dejamos activo para que no se bloquee
        setStatus('active');
      }
    }

    checkBusinessStatus();
  }, []);

  if (status === 'loading') return <div className="h-screen flex items-center justify-center text-slate-400">Verificando licencia...</div>;

  if (status === 'suspended') {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-slate-50 p-4 text-center">
        <Ban size={64} className="text-red-500 mb-4" />
        <h1 className="text-2xl font-bold text-slate-800">Servicio Suspendido</h1>
        <p className="text-slate-500 mt-2 max-w-md">
          La licencia de este negocio ha expirado o está pausada. 
          Por favor, contacta al administrador para reactivar el servicio.
        </p>
        <button 
          onClick={() => supabase.auth.signOut()}
          className="mt-8 px-6 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-900 transition-colors"
        >
          Cerrar Sesión
        </button>
      </div>
    );
  }

  return <>{children}</>;
}