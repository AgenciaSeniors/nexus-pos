import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Lock, Mail, Loader2, AlertTriangle } from 'lucide-react';

export function SuperAdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // 1. Iniciar sesión en Supabase
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (authError) throw authError;
      if (!authData.user) throw new Error("No se pudo identificar al usuario.");

      // 2. VERIFICACIÓN DE SEGURIDAD (¿Es realmente Super Admin?)
      // Consultamos la base de datos para ver si tiene la "corona" (is_super_admin)
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('is_super_admin')
        .eq('id', authData.user.id)
        .single();

      if (profileError || !profile?.is_super_admin) {
        // Si entra aquí, es un usuario normal intentando hackear
        await supabase.auth.signOut(); // Lo expulsamos inmediatamente
        throw new Error("⛔ ACCESO DENEGADO: No tienes privilegios de Super Administrador.");
      }

      // 3. Éxito: Pase usted, Jefe.
      navigate('/super-panel'); 

    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Error de autenticación";
        setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl w-full max-w-md border border-slate-700">
        <div className="flex flex-col items-center mb-8">
          <div className="bg-red-600 p-4 rounded-full shadow-lg shadow-red-900/50 mb-4">
            <ShieldCheck className="w-12 h-12 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Acceso Restringido</h1>
          <p className="text-slate-400 text-sm mt-2">Solo personal autorizado</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-800 text-red-200 text-sm rounded-lg flex items-center gap-3">
            <AlertTriangle className="shrink-0" size={18} />
            {error}
          </div>
        )}

        <form onSubmit={handleAdminLogin} className="space-y-5">
          <div className="relative">
            <Mail className="absolute left-3 top-3.5 text-slate-500 w-5 h-5" />
            <input 
              type="email" 
              required
              className="w-full bg-slate-900 border border-slate-700 text-white pl-10 pr-4 py-3 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none transition-all placeholder:text-slate-600"
              placeholder="admin@nexus.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-3.5 text-slate-500 w-5 h-5" />
            <input 
              type="password" 
              required
              className="w-full bg-slate-900 border border-slate-700 text-white pl-10 pr-4 py-3 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none transition-all placeholder:text-slate-600"
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-red-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 mt-4"
          >
            {loading ? <Loader2 className="animate-spin" /> : "Entrar al Sistema"}
          </button>
        </form>
        
        <div className="mt-8 text-center">
            <p className="text-slate-600 text-xs">Sistema de Seguridad Nexus v2.0</p>
        </div>
      </div>
    </div>
  );
}