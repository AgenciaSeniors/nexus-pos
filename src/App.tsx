import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { SettingsPage } from './pages/SettingsPage';
import { AuthGuard } from './components/AuthGuard';
import { Layout } from './components/Layout';
import { PosPage } from './pages/PosPage';
import { InventoryPage } from './pages/InventoryPage';
import { FinancePage } from './pages/FinancePage';
import { Store, User, Lock, Loader2 } from 'lucide-react';
import { SuperAdminPage } from './pages/SuperAdminPage';

// --- COMPONENTE LOGIN ---
function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
    } catch (err: unknown) { // <--- CORRECCIÓN AQUÍ: Usamos 'unknown' en lugar de 'any'
      // Verificamos si el error tiene un mensaje antes de usarlo
      if (err instanceof Error) {
        setError(err.message);
      } else if (typeof err === 'object' && err !== null && 'message' in err) {
        setError(String((err as { message: unknown }).message));
      } else {
        setError('Error al iniciar sesión');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border border-slate-200">
        <div className="flex flex-col items-center mb-8">
          <div className="bg-blue-600 p-3 rounded-xl shadow-lg shadow-blue-200 mb-4">
            <Store className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">Nexus POS</h1>
          <p className="text-slate-500 text-sm">Sistema de Punto de Venta</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100 flex items-center justify-center">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Correo Electrónico</label>
            <div className="relative">
              <User className="absolute left-3 top-3 text-slate-400 w-5 h-5" />
              <input 
                type="email" 
                required 
                className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                placeholder="usuario@negocio.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Contraseña</label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 text-slate-400 w-5 h-5" />
              <input 
                type="password" 
                required 
                className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-slate-900 hover:bg-black text-white font-bold py-3 rounded-lg shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Iniciar Sesión'}
          </button>
        </form>
        
        <div className="mt-6 text-center text-xs text-slate-400">
          Nexus POS v1.0 • Agencia Seniors
        </div>
      </div>
    </div>
  );
}

// --- APP PRINCIPAL ---
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
     return <div className="h-screen w-full flex items-center justify-center text-slate-400"><Loader2 className="animate-spin" /></div>;
  }

  if (!session) return <Login />; 

  return (
    <HashRouter>
      <AuthGuard>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<PosPage />} />
            <Route path="/inventario" element={<InventoryPage />} />
            <Route path="/finanzas" element={<FinancePage />} />
            <Route path="/configuracion" element={<SettingsPage />} />
            <Route path="/super-alta-secreta" element={<SuperAdminPage />} />
          </Route>
        </Routes>
      </AuthGuard>
    </HashRouter>
  );
}