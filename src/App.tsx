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
// Asegúrate de haber creado este archivo (SuperAdminLogin.tsx) como vimos en el paso anterior
import { SuperAdminLogin } from './pages/SuperAdminLogin'; 

import { Loader2, Store, User, Lock, WifiOff, UserPlus, LogIn, CheckCircle, KeyRound, } from 'lucide-react';

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

  // --- LÓGICA DE REGISTRO ROBUSTA ---
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Validación básica del PIN
    if (userPin.length !== 4 || isNaN(Number(userPin))) {
      setError("El PIN debe ser de 4 números exactos.");
      setLoading(false); return;
    }

    try {
      // 1. Crear usuario en Auth de Supabase
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email, 
        password, 
        options: { data: { full_name: fullName } }
      });

      if (authError) throw authError;
      
      // 2. Guardar perfil en base de datos (UPSERT para evitar conflictos)
      // Esto asegura que el PIN y los meses se guarden sí o sí.
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
            status: 'pending',     // Estado inicial
            role: 'admin',         // Rol por defecto: Dueño/Admin
            business_id: null      // Se llenará cuando el SuperAdmin apruebe
          });

        if (profileError) {
          console.error("Error guardando perfil:", profileError);
          // Intentamos continuar, pero avisamos en consola
        }
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

  // --- LÓGICA DE LOGIN (Verificación de Licencia) ---
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    try {
      // 1. Autenticar credenciales
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
      
      if (authError) throw new Error("Credenciales incorrectas o problema de conexión.");
      if (!data.session) throw new Error("No se pudo iniciar sesión.");
      
      // 2. Verificar estado de la cuenta (Perfil)
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('business_id, status, initial_pin, full_name, role')
        .eq('id', data.session.user.id)
        .single();

      if (profileError) throw new Error("Error verificando tu perfil. Contacta soporte.");

      // 3. Validaciones de Estado
      if (profile?.status === 'pending') throw new Error("⏳ Tu cuenta está en revisión. Espera la aprobación.");
      if (profile?.status === 'rejected') throw new Error("⛔ Tu solicitud ha sido rechazada.");
      if (profile?.status === 'suspended') throw new Error("⚠️ Tu licencia ha sido suspendida.");
      if (!profile?.business_id) throw new Error("⚠️ Tu cuenta no tiene una licencia/negocio asignado aún.");

      // 4. DETECTOR DE CAMBIO DE CUENTA (LIMPIEZA DE BASURA) 🧹
      const previousBusinessId = localStorage.getItem('nexus_business_id');
      
      if (previousBusinessId && previousBusinessId !== profile.business_id) {
        // A. Verificar si hay datos vitales sin sincronizar antes de borrar
        const pendingSales = await db.sales.where('synced').equals(0).count();
        
        if (pendingSales > 0) {
          // ⛔ BLOQUEO TOTAL: No dejamos pasar si hay riesgo de perder dinero
          throw new Error(`⚠️ ¡ALTO! Hay ${pendingSales} ventas NO sincronizadas en este dispositivo. Debes entrar con el usuario anterior y esperar a que se suban los datos antes de cambiar de cuenta.`);
        }

        console.log("♻️ Cambio de negocio seguro. Limpiando base de datos local...");
        await db.delete(); 
        await db.open(); 
      }

      // 5. Configuración Local (Éxito)
      localStorage.setItem('nexus_device_authorized', 'true');
      localStorage.setItem('nexus_business_id', profile.business_id);
      localStorage.setItem('nexus_last_verification', new Date().toISOString());

      // 6. Autoconfiguración del primer Admin Local
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

        {/* Switch Login/Register */}
        <div className="flex bg-slate-100 p-1 rounded-lg mb-6">
          <button 
            onClick={() => { setMode('login'); setError(null); }} 
            className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${mode === 'login' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}
          >
            Iniciar Sesión
          </button>
          <button 
            onClick={() => { setMode('register'); setError(null); }} 
            className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${mode === 'register' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}
          >
            Crear Cuenta
          </button>
        </div>
        
        {/* Mensajes de Error / Éxito */}
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

        {/* FORMULARIO DE LOGIN */}
        {mode === 'login' ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="relative">
              <User className="absolute left-3 top-3 text-slate-400 w-5 h-5" />
              <input type="email" required className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg outline-none focus:border-indigo-500 transition-colors" placeholder="correo@ejemplo.com" value={email} onChange={(e) => setEmail(e.target.value)}/>
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-3 text-slate-400 w-5 h-5" />
              <input type="password" required className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg outline-none focus:border-indigo-500 transition-colors" placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)}/>
            </div>
            <button type="submit" disabled={loading} className="w-full bg-slate-900 hover:bg-black text-white font-bold py-3 rounded-lg shadow-lg disabled:opacity-50 flex items-center justify-center gap-2 transition-transform active:scale-95">
              {loading ? <Loader2 className="animate-spin" /> : <><LogIn size={18}/> Entrar</>}
            </button>
          </form>
        ) : (
          /* FORMULARIO DE REGISTRO */
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
                  <div className="relative">
                    <KeyRound className="absolute left-2 top-2 text-slate-400 w-4 h-4"/>
                    <input type="text" maxLength={4} required className="w-full pl-8 pr-2 py-2 border rounded-lg outline-none text-center font-mono font-bold focus:border-indigo-500" placeholder="0000" value={userPin} onChange={(e) => setUserPin(e.target.value)}/>
                  </div>
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
            <button type="submit" disabled={loading} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-lg shadow-lg disabled:opacity-50 flex items-center justify-center gap-2 transition-transform active:scale-95">
              {loading ? <Loader2 className="animate-spin" /> : <><UserPlus size={18}/> Enviar Solicitud</>}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// 2. COMPONENTE BUSINESS APP (Aplicación Principal)
// =============================================================================
function BusinessApp() {
  const [isAuthorized, setIsAuthorized] = useState(() => localStorage.getItem('nexus_device_authorized') === 'true');
  const [currentStaff, setCurrentStaff] = useState<Staff | null>(null);
  const [isLocked, setIsLocked] = useState(false);

  // Verificación periódica de la sesión/licencia en segundo plano
  useEffect(() => {
    const checkStatus = async () => {
      if (!isAuthorized) return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          // Consultamos si sigue activo en tiempo real
          const { data } = await supabase
            .from('profiles')
            .select('business_id, status')
            .eq('id', session.user.id)
            .single();
          
          if (!data?.business_id || data?.status !== 'active') {
            console.warn("Sesión invalidada o licencia expirada.");
            localStorage.removeItem('nexus_device_authorized');
            setIsAuthorized(false);
          }
        }
      } catch (err) { 
        // Si hay error de red, no bloqueamos inmediatamente (modo offline)
        console.error("Check status failed (offline?)", err);
      }
    };
    
    checkStatus();
    // Podríamos poner un intervalo aquí si quisiéramos polling
  }, [isAuthorized]);

  // Pantallas de Bloqueo / Login
  if (!isAuthorized) return <LoginScreen onLoginSuccess={() => setIsAuthorized(true)} />;
  if (isLocked || !currentStaff) return <PinPad onSuccess={(s) => { setCurrentStaff(s); setIsLocked(false); }} />;

  // App Principal con Rutas
  return (
    <AuthGuard>
      <Routes>
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

// =============================================================================
// 3. COMPONENTE ADMIN ROUTE (Protección para Super Admin)
// =============================================================================
function AdminRoute({ children }: { children: React.ReactNode }) {
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    const checkAdmin = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setAuthorized(false);
          return;
        }

        // Consultamos la "corona" en la base de datos
        const { data, error } = await supabase
          .from('profiles')
          .select('is_super_admin')
          .eq('id', user.id)
          .single();
        
        if (error || !data?.is_super_admin) {
          setAuthorized(false);
        } else {
          setAuthorized(true);
        }
      } catch {
        setAuthorized(false);
      }
    };
    checkAdmin();
  }, []);

  if (authorized === null) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <Loader2 className="animate-spin text-white w-8 h-8"/>
      </div>
    );
  }
  
  // Si no es admin, lo mandamos al login de admin
  return authorized ? <>{children}</> : <Navigate to="/admin-login" replace />;
}

// =============================================================================
// 4. APP PRINCIPAL (Enrutador Maestro)
// =============================================================================
export default function App() {
  return (
    <HashRouter>
      <Routes>
        {/* RUTA PÚBLICA PARA EL LOGIN DEL SUPER ADMIN */}
        <Route path="/admin-login" element={<SuperAdminLogin />} />
        
        {/* RUTA PROTEGIDA PARA EL PANEL DE CONTROL (SUPER ADMIN) */}
        <Route path="/super-panel" element={
          <AdminRoute>
            <SuperAdminPage />
          </AdminRoute>
        } />

        {/* RUTAS DE LA APP DEL CLIENTE (Cualquier otra ruta) */}
        <Route path="/*" element={<BusinessApp />} />
      </Routes>
    </HashRouter>
  );
}