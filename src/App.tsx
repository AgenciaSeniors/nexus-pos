import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { db, type Staff } from './lib/db';

// --- IMPORTACIONES DE PÁGINAS Y COMPONENTES ---
import { Layout } from './components/Layout';
import { AuthGuard } from './components/AuthGuard';
import { PinPad } from './components/PinPad';
import { PosPage } from './pages/PosPage';
import { InventoryPage } from './pages/InventoryPage'; 
import { FinancePage } from './pages/FinancePage';
import { SettingsPage } from './pages/SettingsPage';
import { StaffPage } from './pages/StaffPage';
import { SuperAdminPage } from './pages/SuperAdminPage';
import { SuperAdminLogin } from './pages/SuperAdminLogin';
import { CustomersPage } from './components/CustomersPage'; // Asegúrate de tener esto importado si lo usas

import { Loader2, Store, User, Lock, WifiOff, UserPlus, LogIn, CheckCircle, AlertTriangle, LogOut } from 'lucide-react';

// =============================================================================
// 1. COMPONENTE LOGIN SCREEN (Para Clientes/Negocios)
// =============================================================================
function LoginScreen({ onLoginSuccess }: { onLoginSuccess: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  
  // Estados Login
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  // Estados Registro
  const [fullName, setFullName] = useState(''); 
  const [phone, setPhone] = useState(''); 
  const [months, setMonths] = useState(1); 
  const [userPin, setUserPin] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // --- LÓGICA DE REGISTRO ---
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (userPin.length !== 4 || isNaN(Number(userPin))) {
      setError("El PIN debe ser de 4 números exactos.");
      setLoading(false); return;
    }

    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email, 
        password, 
        options: { data: { full_name: fullName } }
      });

      if (authError) throw authError;
      
      if (authData.user) {
        const { error: profileError } = await supabase
          .from('profiles')
          .upsert({
            id: authData.user.id,
            email: email,
            full_name: fullName,
            phone: phone,
            months_requested: months,
            initial_pin: userPin,
            status: 'pending',
            role: 'admin',
            business_id: null
          });

        if (profileError) console.error("Error perfil:", profileError);
      }

      setSuccessMsg("¡Solicitud enviada! Espera a que el administrador active tu licencia.");
      setMode('login'); 
      setPassword(''); 
      setUserPin('');

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al registrarse";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // --- LÓGICA DE LOGIN (Verificación y Protección de Datos) ---
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    try {
      // 1. Autenticar credenciales
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
      
      if (authError) throw new Error("Credenciales incorrectas o problema de conexión.");
      if (!data.session) throw new Error("No se pudo iniciar sesión.");
      
      // 2. Verificar estado del perfil
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('business_id, status, initial_pin, full_name, role')
        .eq('id', data.session.user.id)
        .single();

      if (profileError) throw new Error("Error verificando tu perfil.");

      // 3. Validaciones de Estado
      if (profile?.status === 'pending') throw new Error("⏳ Tu cuenta está en revisión.");
      if (profile?.status === 'rejected') throw new Error("⛔ Tu solicitud ha sido rechazada.");
      if (profile?.status === 'suspended') throw new Error("⚠️ Tu licencia ha sido suspendida.");
      if (profile?.status === 'deleted') throw new Error("⛔ Cuenta eliminada.");
      if (!profile?.business_id) throw new Error("⚠️ Cuenta sin negocio asignado.");

      // 4. 🛡️ PROTECCIÓN DE DATOS AL CAMBIAR DE CUENTA
      const previousBusinessId = localStorage.getItem('nexus_business_id');
      
      if (previousBusinessId && previousBusinessId !== profile.business_id) {
        // Verificar si hay ventas sin sincronizar antes de borrar la DB local
        const pendingSales = await db.sales.where('synced').equals(0).count();
        
        if (pendingSales > 0) {
          throw new Error(`⚠️ ¡ALTO! Hay ${pendingSales} ventas NO sincronizadas. Entra con el usuario anterior para subirlas.`);
        }

        console.log("♻️ Cambio seguro. Limpiando datos locales...");
        await db.delete(); 
        await db.open(); 
      }

      // 5. Configuración Local
      localStorage.setItem('nexus_device_authorized', 'true');
      localStorage.setItem('nexus_business_id', profile.business_id);
      localStorage.setItem('nexus_last_verification', new Date().toISOString());

      // 6. Autoconfiguración Admin Local
      const staffCount = await db.staff.count();
      if (staffCount === 0 && profile.initial_pin) {
        await db.staff.add({
          id: 'admin-owner', 
          name: profile.full_name || 'Admin', 
          pin: profile.initial_pin, 
          role: 'admin', 
          active: true
        });
      }
      
      onLoginSuccess();

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error de acceso";
      setError(msg);
      localStorage.removeItem('nexus_device_authorized');
      await supabase.auth.signOut();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border border-slate-200">
        <div className="flex flex-col items-center mb-6">
          <div className="bg-indigo-600 p-3 rounded-xl shadow-lg shadow-indigo-200 mb-4">
            <Store className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">Nexus POS</h1>
          <p className="text-slate-500 text-sm">{mode === 'login' ? 'Acceso Clientes' : 'Solicitar Licencia'}</p>
        </div>

        <div className="flex bg-slate-100 p-1 rounded-lg mb-6">
          <button onClick={() => { setMode('login'); setError(null); }} className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${mode === 'login' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}>Iniciar Sesión</button>
          <button onClick={() => { setMode('register'); setError(null); }} className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${mode === 'register' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}>Crear Cuenta</button>
        </div>
        
        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg flex items-center gap-2 border border-red-100">
            <WifiOff size={16} /> {error}
          </div>
        )}
        {successMsg && (
          <div className="mb-4 p-3 bg-green-50 text-green-700 text-sm rounded-lg flex items-center gap-2 border border-green-100">
            <CheckCircle size={16} /> {successMsg}
          </div>
        )}

        {mode === 'login' ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="relative">
              <User className="absolute left-3 top-3 text-slate-400 w-5 h-5" />
              <input type="email" required className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg outline-none focus:border-indigo-500" placeholder="correo@ejemplo.com" value={email} onChange={(e) => setEmail(e.target.value)}/>
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-3 text-slate-400 w-5 h-5" />
              <input type="password" required className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg outline-none focus:border-indigo-500" placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)}/>
            </div>
            <button type="submit" disabled={loading} className="w-full bg-slate-900 hover:bg-black text-white font-bold py-3 rounded-lg shadow-lg flex items-center justify-center gap-2 active:scale-95 transition-transform">
              {loading ? <Loader2 className="animate-spin" /> : <><LogIn size={18}/> Entrar</>}
            </button>
          </form>
        ) : (
          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase">Nombre Negocio</label>
              <input type="text" required className="w-full px-3 py-2 border rounded-lg outline-none focus:border-indigo-500" placeholder="Mi Tienda" value={fullName} onChange={(e) => setFullName(e.target.value)}/>
            </div>
            <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase">Teléfono</label>
                  <input type="tel" required className="w-full px-3 py-2 border rounded-lg outline-none focus:border-indigo-500" value={phone} onChange={(e) => setPhone(e.target.value)}/>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase">PIN (4 #)</label>
                  <input type="text" maxLength={4} required className="w-full px-3 py-2 border rounded-lg outline-none text-center font-mono font-bold focus:border-indigo-500" placeholder="0000" value={userPin} onChange={(e) => setUserPin(e.target.value)}/>
                </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase">Correo</label>
                  <input type="email" required className="w-full px-3 py-2 border rounded-lg outline-none focus:border-indigo-500" value={email} onChange={(e) => setEmail(e.target.value)}/>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase">Clave</label>
                  <input type="password" required className="w-full px-3 py-2 border rounded-lg outline-none focus:border-indigo-500" value={password} onChange={(e) => setPassword(e.target.value)}/>
                </div>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase">Plan Solicitado</label>
              <select value={months} onChange={(e) => setMonths(Number(e.target.value))} className="w-full px-3 py-2 border rounded-lg bg-white outline-none focus:border-indigo-500">
                <option value={1}>1 Mes</option>
                <option value={3}>3 Meses</option>
                <option value={6}>6 Meses</option>
                <option value={12}>1 Año</option>
              </select>
            </div>
            <button type="submit" disabled={loading} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-lg shadow-lg flex items-center justify-center gap-2 active:scale-95 transition-transform">
              {loading ? <Loader2 className="animate-spin" /> : <><UserPlus size={18}/> Enviar Solicitud</>}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// 2. COMPONENTE BUSINESS APP (Con Watchdog y Pantalla de Bloqueo)
// =============================================================================
function BusinessApp() {
  const [isAuthorized, setIsAuthorized] = useState(() => localStorage.getItem('nexus_device_authorized') === 'true');
  const [currentStaff, setCurrentStaff] = useState<Staff | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [blockReason, setBlockReason] = useState<string | null>(null);

  // 🐕 WATCHDOG: Vigila la licencia en tiempo real
  useEffect(() => {
    const verifyLicenseStatus = async () => {
      if (!isAuthorized || !navigator.onLine) return; // Solo online y si ya entró

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const { data: profile } = await supabase
          .from('profiles')
          .select('status, license_expiry, business_id')
          .eq('id', session.user.id)
          .single();

        if (!profile) return;

        let reason = null;
        if (profile.status === 'suspended') reason = "Licencia Suspendida";
        if (profile.status === 'deleted') reason = "Cuenta Eliminada";
        if (profile.license_expiry && new Date(profile.license_expiry) < new Date()) {
          reason = "Licencia Expirada";
        }

        // Si detecta bloqueo, activa la pantalla roja
        if (reason) {
          setBlockReason(reason);
        }

      } catch (err) {
        console.error("Error watchdog:", err);
      }
    };

    // Revisar cada 1 minuto
    const interval = setInterval(verifyLicenseStatus, 60000);
    verifyLicenseStatus(); // Revisar al montar

    return () => clearInterval(interval);
  }, [isAuthorized]);

  // FUNCIÓN DE SALIDA DE EMERGENCIA (Para el botón de la pantalla roja)
  const handleForceLogout = async () => {
    // 1. Limpieza Local
    localStorage.removeItem('nexus_device_authorized');
    localStorage.removeItem('nexus_business_id');
    localStorage.removeItem('nexus_last_verification');
    
    // 2. Limpieza Servidor
    await supabase.auth.signOut();
    
    // 3. Recarga Total (Rompe bucles)
    window.location.href = '/';
  };

  // --- RENDERS CONDICIONALES ---

  // A. Si no está autorizado, mostrar Login
  if (!isAuthorized) return <LoginScreen onLoginSuccess={() => setIsAuthorized(true)} />;

  // B. PANTALLA DE SERVICIO SUSPENDIDO (La que pediste recuperar)
  if (blockReason) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-2xl max-w-md w-full text-center border border-slate-200">
          <div className="bg-red-100 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="w-10 h-10 text-red-600" />
          </div>
          
          <h1 className="text-2xl font-bold text-slate-800">Servicio Suspendido</h1>
          
          <p className="text-slate-500 mt-4 mb-8">
            {blockReason === "Licencia Expirada" 
              ? "El periodo de vigencia de tu licencia ha terminado. Por favor renueva tu suscripción."
              : "El acceso a este negocio ha sido revocado temporal o permanentemente."}
            <br/><br/>
            Contacta al administrador para reactivar el servicio.
          </p>
          
          <button 
            onClick={handleForceLogout}
            className="w-full px-6 py-3 bg-slate-800 text-white font-bold rounded-xl hover:bg-slate-900 transition-colors flex items-center justify-center gap-2"
          >
            <LogOut size={20}/> Cerrar Sesión
          </button>
        </div>
      </div>
    );
  }

  // C. PinPad o Layout Principal
  if (isLocked || !currentStaff) {
    return <PinPad onSuccess={(s) => { setCurrentStaff(s); setIsLocked(false); }} />;
  }

  return (
    <AuthGuard>
      <Routes>
        <Route element={<Layout currentStaff={currentStaff} onLock={() => { setCurrentStaff(null); setIsLocked(true); }} />}>
          <Route path="/" element={<PosPage />} />
          <Route path="/inventario" element={<InventoryPage />} />
          <Route path="/finanzas" element={<FinancePage />} />
          <Route path="/configuracion" element={<SettingsPage />} />
          <Route path="/equipo" element={<StaffPage />} />
          <Route path="/clientes" element={<CustomersPage />} /> 
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AuthGuard>
  );
}

// =============================================================================
// 3. ADMIN ROUTE (Protección Super Admin)
// =============================================================================
function AdminRoute({ children }: { children: React.ReactNode }) {
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    const checkAdmin = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setAuthorized(false); return; }

        const { data, error } = await supabase
          .from('profiles')
          .select('is_super_admin')
          .eq('id', user.id)
          .single();
        
        setAuthorized(!error && data?.is_super_admin);
      } catch {
        setAuthorized(false);
      }
    };
    checkAdmin();
  }, []);

  if (authorized === null) return <div className="min-h-screen bg-slate-900 flex items-center justify-center"><Loader2 className="animate-spin text-white w-8 h-8"/></div>;
  
  return authorized ? <>{children}</> : <Navigate to="/admin-login" replace />;
}

// =============================================================================
// 4. APP PRINCIPAL
// =============================================================================
export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/admin-login" element={<SuperAdminLogin />} />
        <Route path="/super-panel" element={<AdminRoute><SuperAdminPage /></AdminRoute>} />
        <Route path="/*" element={<BusinessApp />} />
      </Routes>
    </HashRouter>
  );
}