import { useEffect, useState } from 'react';
import { Navigate, useLocation, Outlet } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Loader2, WifiOff } from 'lucide-react';

export function AuthGuard() {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const location = useLocation();

  useEffect(() => {
    let mounted = true;

    const checkSession = async () => {
      try {
        // 1. Intentamos obtener sesión con un TIMEOUT de 3 segundos
        const sessionPromise = supabase.auth.getSession();
        
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 3000)
        );

        // Carrera: ¿Quién gana? ¿La red o el reloj?
        const { data } = await Promise.race([sessionPromise, timeoutPromise]) as any;

        if (mounted) {
          if (data?.session) {
            setIsAuthenticated(true);
          } else {
            setIsAuthenticated(false);
          }
        }
      } catch (error) {
        console.warn("⚠️ Red lenta o desconectada en AuthGuard:", error);
        
        // 2. PLAN B: Si falló la red, verificamos si hay token en localStorage
        const hasLocalToken = Object.keys(localStorage).some(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
        
        if (mounted) {
          if (hasLocalToken) {
            console.log("🟢 Usando sesión local cacheada (Modo Offline)");
            setIsAuthenticated(true);
            setIsOfflineMode(true);
          } else {
            setIsAuthenticated(false);
          }
        }
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    checkSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) {
        setIsAuthenticated(!!session);
        setIsLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  if (isLoading) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-gray-50 gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
        <p className="text-gray-500 text-sm font-medium animate-pulse">Verificando acceso...</p>
        
        <button 
            onClick={() => window.location.href = '/super-admin-login'}
            className="mt-8 text-xs text-gray-400 hover:text-blue-600 underline"
        >
            ¿Problemas de conexión? Ir al Login manual
        </button>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/super-admin-login" state={{ from: location }} replace />;
  }

  return (
    <>
      {isOfflineMode && (
        <div className="bg-amber-100 text-amber-800 text-[10px] py-1 px-4 text-center font-bold flex items-center justify-center gap-2 border-b border-amber-200">
            <WifiOff size={10}/> MODO OFFLINE: Se está usando la sesión local guardada
        </div>
      )}
      <Outlet />
    </>
  );
}