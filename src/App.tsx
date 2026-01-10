import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import type { Session, AuthChangeEvent } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { db, type Staff } from './lib/db';

// Componentes y Páginas
import { Layout } from './components/Layout';
import { AuthGuard } from './components/AuthGuard';
import { PinPad } from './components/PinPad';
import { PosPage } from './pages/PosPage';
import { InventoryPage } from './pages/InventoryPage';
import { FinancePage } from './pages/FinancePage';
import { SettingsPage } from './pages/SettingsPage';
import { StaffPage } from './pages/StaffPage';
import { SuperAdminPage } from './pages/SuperAdminPage';
import { Loader2, Store, User, Lock } from 'lucide-react';

// --- COMPONENTE LOGIN (Solo para el Dueño/Instalación inicial) ---
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
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (err: unknown) {
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
                type="email" required 
                className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                placeholder="usuario@negocio.com"
                value={email} onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Contraseña</label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 text-slate-400 w-5 h-5" />
              <input 
                type="password" required 
                className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                placeholder="••••••••"
                value={password} onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>
          <button 
            type="submit" disabled={loading} 
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
  
  // ESTADO LOCAL: ¿Quién está usando la PC?
  const [currentStaff, setCurrentStaff] = useState<Staff | null>(null);
  const [isLocked, setIsLocked] = useState(false);

  // LOGICA DE RESCATE: Verificar si la DB está vacía al iniciar
  useEffect(() => {
    const checkRescueParams = async () => {
      try {
        const count = await db.staff.count();
        if (count === 0) {
          // Si no hay nadie, creamos al Admin de Emergencia
          await db.staff.add({
            id: 'admin-rescue',
            name: 'Admin Inicial',
            pin: '0000', // <--- TU PIN MAESTRO DE INICIO
            role: 'admin',
            active: true
          });
          console.log("⚠️ Modo Rescate: Admin (0000) creado.");
        }
      } catch (error) {
        console.error("Error verificando staff:", error);
      }
    };
    checkRescueParams();
  }, []);

  // LOGICA DE SESIÓN (SUPABASE)
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      setSession(session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleUnlock = (staffMember: Staff) => {
    setCurrentStaff(staffMember);
    setIsLocked(false);
  };

  const handleLock = () => {
    setCurrentStaff(null);
    setIsLocked(true);
  };

  if (loading) return <div className="h-screen w-full flex items-center justify-center text-slate-400"><Loader2 className="animate-spin" /></div>;

  // 1. Si no hay sesión de dueño, pedimos Login de Supabase (Requiere Internet la primera vez)
  if (!session) return <Login />;

  // 2. Si hay sesión, pero está bloqueado (o no se ha elegido empleado), pedimos PIN Local
  if (isLocked || !currentStaff) {
    return <PinPad onSuccess={handleUnlock} />;
  }

  // 3. Sistema desbloqueado: Mostramos Layout y Rutas
  return (
    <HashRouter>
      <AuthGuard>
        <Routes>
          <Route element={<Layout currentStaff={currentStaff} onLock={handleLock} />}>
            <Route path="/" element={<PosPage />} />
            <Route path="/inventario" element={<InventoryPage />} />
            <Route path="/finanzas" element={<FinancePage />} />
            <Route path="/configuracion" element={<SettingsPage />} />
            <Route path="/equipo" element={<StaffPage />} />
            
            {/* Ruta secreta para el técnico */}
            <Route path="/super-alta-secreta" element={<SuperAdminPage />} />
          </Route>
        </Routes>
      </AuthGuard>
    </HashRouter>
  );
}