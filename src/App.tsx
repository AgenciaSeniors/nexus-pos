import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { db, type Staff } from './lib/db';

// Componentes y Páginas
import { Layout } from './components/Layout';
import { AuthGuard } from './components/AuthGuard';
import { PinPad } from './components/PinPad';
import { TechGuard } from './components/TechGuard';
import { PosPage } from './pages/PosPage';
import { InventoryPage } from './pages/InventoryPage'; 
import { FinancePage } from './pages/FinancePage';
import { SettingsPage } from './pages/SettingsPage';
import { StaffPage } from './pages/StaffPage';
import { SuperAdminPage } from './pages/SuperAdminPage';
import { Loader2, Store, User, Lock, WifiOff, UserPlus, LogIn, CheckCircle, KeyRound } from 'lucide-react';

// ============================================================================
// 1. COMPONENTE DE LOGIN Y REGISTRO
// ============================================================================
function LoginScreen({ onLoginSuccess }: { onLoginSuccess: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  
  // Login State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  // Register State
  const [fullName, setFullName] = useState(''); 
  const [phone, setPhone] = useState(''); 
  const [months, setMonths] = useState(1); 
  const [userPin, setUserPin] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (userPin.length !== 4 || isNaN(Number(userPin))) {
      setError("El PIN debe ser de 4 números exactos.");
      setLoading(false); return;
    }

    try {
      // Crear usuario en Auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email, password, options: { data: { full_name: fullName } }
      });

      if (authError) throw authError;
      if (!authData.session) throw new Error("Revisa tu email para confirmar o contacta soporte.");

      // Actualizar perfil
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          full_name: fullName,
          phone: phone,
          months_requested: months,
          initial_pin: userPin,
          status: 'pending', 
          business_id: null 
        })
        .eq('id', authData.session.user.id);

      if (profileError) throw profileError;

      setSuccessMsg("¡Solicitud enviada! Tu cuenta está en revisión.");
      setMode('login'); setPassword(''); setUserPin('');

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al registrarse";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) throw new Error("Credenciales incorrectas o sin internet.");
      if (!data.session) throw new Error("No se pudo iniciar sesión.");
      
      const { data: profile } = await supabase
        .from('profiles')
        .select('business_id, status, initial_pin, full_name')
        .eq('id', data.session.user.id)
        .single();

      if (profile?.status === 'pending') throw new Error("⏳ Solicitud en revisión.");
      if (profile?.status === 'rejected') throw new Error("⛔ Solicitud rechazada.");
      if (!profile?.business_id) throw new Error("⚠️ Sin licencia asignada.");

      localStorage.setItem('nexus_device_authorized', 'true');
      localStorage.setItem('nexus_business_id', profile.business_id);
      localStorage.setItem('nexus_last_verification', new Date().toISOString());

      // Crear Admin Local con el PIN remoto si la DB está vacía
      const staffCount = await db.staff.count();
      if (staffCount === 0 && profile.initial_pin) {
        await db.staff.add({
          id: 'admin-owner', name: profile.full_name || 'Admin', 
          pin: profile.initial_pin, role: 'admin', active: true
        });
      }
      
      onLoginSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error de acceso";
      setError(msg);
      localStorage.removeItem('nexus_device_authorized');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border border-slate-200">
        <div className="flex flex-col items-center mb-6">
          <div className="bg-indigo-600 p-3 rounded-xl shadow-lg shadow-indigo-200 mb-4"><Store className="w-10 h-10 text-white" /></div>
          <h1 className="text-2xl font-bold text-slate-800">Nexus POS</h1>
          <p className="text-slate-500 text-sm">{mode === 'login' ? 'Acceso Clientes' : 'Solicitar Licencia'}</p>
        </div>

        <div className="flex bg-slate-100 p-1 rounded-lg mb-6">
          <button onClick={() => { setMode('login'); setError(null); }} className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${mode === 'login' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}>Iniciar Sesión</button>
          <button onClick={() => { setMode('register'); setError(null); }} className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${mode === 'register' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}>Crear Cuenta</button>
        </div>
        
        {error && <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg flex items-center gap-2"><WifiOff size={16} /> {error}</div>}
        {successMsg && <div className="mb-4 p-3 bg-green-50 text-green-700 text-sm rounded-lg flex items-center gap-2"><CheckCircle size={16} /> {successMsg}</div>}

        {mode === 'login' ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="relative"><User className="absolute left-3 top-3 text-slate-400 w-5 h-5" /><input type="email" required className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg outline-none" placeholder="correo@ejemplo.com" value={email} onChange={(e) => setEmail(e.target.value)}/></div>
            <div className="relative"><Lock className="absolute left-3 top-3 text-slate-400 w-5 h-5" /><input type="password" required className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg outline-none" placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)}/></div>
            <button type="submit" disabled={loading} className="w-full bg-slate-900 hover:bg-black text-white font-bold py-3 rounded-lg shadow-lg disabled:opacity-50 flex items-center justify-center gap-2">{loading ? <Loader2 className="animate-spin" /> : <><LogIn size={18}/> Entrar</>}</button>
          </form>
        ) : (
          <form onSubmit={handleRegister} className="space-y-4">
            <div><label className="text-xs font-bold text-slate-500 uppercase">Nombre</label><input type="text" required className="w-full px-3 py-2 border rounded-lg outline-none" placeholder="Nombre Negocio" value={fullName} onChange={(e) => setFullName(e.target.value)}/></div>
            <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs font-bold text-slate-500 uppercase">Teléfono</label><input type="tel" required className="w-full px-3 py-2 border rounded-lg outline-none" value={phone} onChange={(e) => setPhone(e.target.value)}/></div>
                <div><label className="text-xs font-bold text-slate-500 uppercase">PIN (4 #)</label><div className="relative"><KeyRound className="absolute left-2 top-2 text-slate-400 w-4 h-4"/><input type="text" maxLength={4} required className="w-full pl-8 pr-2 py-2 border rounded-lg outline-none text-center font-mono font-bold" placeholder="0000" value={userPin} onChange={(e) => setUserPin(e.target.value)}/></div></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs font-bold text-slate-500 uppercase">Correo</label><input type="email" required className="w-full px-3 py-2 border rounded-lg outline-none" value={email} onChange={(e) => setEmail(e.target.value)}/></div>
                <div><label className="text-xs font-bold text-slate-500 uppercase">Clave</label><input type="password" required className="w-full px-3 py-2 border rounded-lg outline-none" value={password} onChange={(e) => setPassword(e.target.value)}/></div>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase">Meses</label>
              <select value={months} onChange={(e) => setMonths(Number(e.target.value))} className="w-full px-3 py-2 border rounded-lg bg-white outline-none">
                <option value={1}>1 Mes</option><option value={3}>3 Meses</option><option value={6}>6 Meses</option><option value={12}>1 Año</option>
              </select>
            </div>
            <button type="submit" disabled={loading} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-lg shadow-lg disabled:opacity-50 flex items-center justify-center gap-2">{loading ? <Loader2 className="animate-spin" /> : <><UserPlus size={18}/> Enviar Solicitud</>}</button>
          </form>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 2. COMPONENTE PRINCIPAL DEL NEGOCIO (POS, Inventario, etc.)
// ============================================================================
function BusinessApp() {
  const [isAuthorized, setIsAuthorized] = useState(() => localStorage.getItem('nexus_device_authorized') === 'true');
  const [currentStaff, setCurrentStaff] = useState<Staff | null>(null);
  const [isLocked, setIsLocked] = useState(false);

  useEffect(() => {
    const check = async () => {
      if (!isAuthorized) return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const { data } = await supabase.from('profiles').select('business_id, status').eq('id', session.user.id).single();
          if (!data?.business_id || data?.status !== 'active') {
            localStorage.removeItem('nexus_device_authorized');
            setIsAuthorized(false);
          }
        }
      } catch { /* Ignorar errores offline */ }
    };
    check();
  }, [isAuthorized]);

  if (!isAuthorized) return <LoginScreen onLoginSuccess={() => setIsAuthorized(true)} />;
  if (isLocked || !currentStaff) return <PinPad onSuccess={(s) => { setCurrentStaff(s); setIsLocked(false); }} />;

  return (
    <AuthGuard>
      <Routes>
        {/* ✅ SOLUCIÓN: Usamos Layout como 'element' de una Route padre, no como wrapper */}
        <Route element={<Layout currentStaff={currentStaff} onLock={() => { setCurrentStaff(null); setIsLocked(true); }} />}>
          <Route path="/" element={<PosPage />} />
          <Route path="/inventario" element={<InventoryPage />} />
          <Route path="/finanzas" element={<FinancePage />} />
          <Route path="/configuracion" element={<SettingsPage />} />
          <Route path="/equipo" element={<StaffPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AuthGuard>
  );
}

// ============================================================================
// 3. ENRUTADOR GLOBAL
// ============================================================================
export default function App() {
  return (
    <HashRouter>
      <Routes>
        {/* RUTA 1: SUPER ADMIN (Independiente, solo requiere clave maestra) */}
        <Route 
          path="/super-alta-secreta" 
          element={
            <TechGuard>
              <SuperAdminPage />
            </TechGuard>
          } 
        />

        {/* RUTA 2: APLICACIÓN DEL NEGOCIO (Requiere Login/PIN) */}
        <Route path="/*" element={<BusinessApp />} />
      </Routes>
    </HashRouter>
  );
}