import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { db, type Staff } from './lib/db';

// Componentes y Páginas
import { Layout } from './components/Layout';
import { AuthGuard } from './components/AuthGuard';
import { PinPad } from './components/PinPad';
import { TechGuard } from './components/TechGuard';
import { PosPage } from './pages/PosPage';
// ✅ CORRECCIÓN 1: Importar InventoryPage desde su archivo correcto
import { InventoryPage } from './pages/InventoryPage'; 
import { FinancePage } from './pages/FinancePage';
import { SettingsPage } from './pages/SettingsPage';
import { StaffPage } from './pages/StaffPage';
import { SuperAdminPage } from './pages/SuperAdminPage';
// ✅ CORRECCIÓN 2: Eliminado CheckCircle que no se usaba
import { Loader2, Store, User, Lock, WifiOff } from 'lucide-react';

// --- COMPONENTE LOGIN (Solo requiere internet la primera vez) ---
function Login({ onLoginSuccess }: { onLoginSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      // 1. Autenticación con Supabase (Requiere Internet)
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) throw new Error("Credenciales incorrectas o sin internet.");

      if (!data.session) throw new Error("No se pudo iniciar sesión");

      // 2. Verificación de Licencia (Business ID)
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('business_id, license_expiry')
        .eq('id', data.session.user.id)
        .single();

      if (profileError || !profile?.business_id) {
        throw new Error("⚠️ Este usuario no tiene una licencia activa.");
      }

      // 3. ¡ÉXITO! Guardamos TODO localmente
      localStorage.setItem('nexus_device_authorized', 'true');
      localStorage.setItem('nexus_business_id', profile.business_id);
      localStorage.setItem('nexus_last_verification', new Date().toISOString());
      
      onLoginSuccess();

    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Error desconocido al activar.');
      }
      localStorage.removeItem('nexus_device_authorized');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border border-slate-200">
        <div className="flex flex-col items-center mb-8">
          <div className="bg-indigo-600 p-3 rounded-xl shadow-lg shadow-indigo-200 mb-4">
            <Store className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">Nexus POS</h1>
          <p className="text-slate-500 text-sm">Activación de Dispositivo</p>
        </div>
        
        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100 flex items-center gap-2">
            <WifiOff size={16} /> {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Correo de Licencia</label>
            <div className="relative">
              <User className="absolute left-3 top-3 text-slate-400 w-5 h-5" />
              <input 
                type="email" required 
                className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
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
                className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                placeholder="••••••••"
                value={password} onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>
          <button 
            type="submit" disabled={loading} 
            className="w-full bg-slate-900 hover:bg-black text-white font-bold py-3 rounded-lg shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Activar Licencia'}
          </button>
        </form>
        <div className="mt-6 text-center text-xs text-slate-400">
          <p>Solo necesitas internet para activar este dispositivo.</p>
          <p className="mt-1">Después podrás trabajar 100% Offline.</p>
        </div>
      </div>
    </div>
  );
}

// --- APP PRINCIPAL ---
export default function App() {
  
  // 1. CARGA INSTANTÁNEA: Leemos localStorage INMEDIATAMENTE
  const [isAuthorized, setIsAuthorized] = useState(() => {
    return localStorage.getItem('nexus_device_authorized') === 'true';
  });

  const [currentStaff, setCurrentStaff] = useState<Staff | null>(null);
  const [isLocked, setIsLocked] = useState(false);

  // 2. VERIFICACIÓN EN SEGUNDO PLANO (SILENCIOSA)
  useEffect(() => {
    const backgroundLicenseCheck = async () => {
      if (!isAuthorized) return;

      try {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('business_id')
            .eq('id', session.user.id)
            .single();

          if (!profile?.business_id) {
            console.warn("Licencia revocada remotamente.");
            localStorage.removeItem('nexus_device_authorized');
            setIsAuthorized(false); 
          } else {
            localStorage.setItem('nexus_last_verification', new Date().toISOString());
          }
        }
      } catch {
        // ✅ CORRECCIÓN 3: Eliminado el 'err' no usado
        console.log("Modo Offline: Verificación en segundo plano omitida.");
      }
    };

    backgroundLicenseCheck();
  }, [isAuthorized]);

  // 3. MODO RESCATE
  useEffect(() => {
    const checkRescueParams = async () => {
      try {
        const count = await db.staff.count();
        if (count === 0) {
          await db.staff.add({
            id: 'admin-rescue',
            name: 'Admin Inicial',
            pin: '0000', 
            role: 'admin',
            active: true
          });
          console.log("⚠️ Modo Rescate: Admin (0000) creado.");
        }
      } catch (error) {
        console.error("Error Dexie:", error);
      }
    };
    checkRescueParams();
  }, []);

  const handleUnlock = (staffMember: Staff) => {
    setCurrentStaff(staffMember);
    setIsLocked(false);
  };

  const handleLock = () => {
    setCurrentStaff(null);
    setIsLocked(true);
  };

  const handleLoginSuccess = () => {
    setIsAuthorized(true);
  };

  if (!isAuthorized) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  if (isLocked || !currentStaff) {
    return <PinPad onSuccess={handleUnlock} />;
  }

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
            
            <Route 
              path="/super-alta-secreta" 
              element={
                <TechGuard>
                  <SuperAdminPage />
                </TechGuard>
              } 
            />
          </Route>
        </Routes>
      </AuthGuard>
    </HashRouter>
  );
}