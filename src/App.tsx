import { useEffect, useState, useRef } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { type Staff } from './lib/db';
import { type Session } from '@supabase/supabase-js';
import { Toaster, toast } from 'sonner';

// --- IMPORTACIONES DE PÁGINAS Y COMPONENTES ---
import { Layout } from './components/Layout';
import { PinPad } from './components/PinPad';
import { PosPage } from './pages/PosPage';
import { InventoryPage } from './pages/InventoryPage'; 
import { FinancePage } from './pages/FinancePage';
import { SettingsPage } from './pages/SettingsPage';
import { StaffPage } from './pages/StaffPage';
import { SuperAdminPage } from './pages/SuperAdminPage';
import { SuperAdminLogin } from './pages/SuperAdminLogin';
import { CustomersPage } from './components/CustomersPage';

// Iconos (Agregados WifiOff, RefreshCcw, LogOut para el feedback de carga)
import { Loader2, Store, User, Lock, Mail, Phone, ArrowRight, CheckCircle, WifiOff, RefreshCcw, LogOut } from 'lucide-react';

// =============================================================================
// 1. COMPONENTE LOGIN SCREEN
// =============================================================================
function LoginScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [businessName, setBusinessName] = useState('');
  
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;
      
      // Verificamos si tiene perfil
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single();

      if (!profile) {
        throw new Error("Usuario sin perfil asociado");
      }

      if (profile.status === 'suspended') {
        await supabase.auth.signOut();
        toast.error("Cuenta suspendida. Contacte soporte.");
      }

    } catch (error: unknown) {
      // ✅ CORRECCIÓN 1: Manejo de error tipado
      const message = error instanceof Error ? error.message : "Error al iniciar sesión";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // 1. Crear usuario auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (authError) throw authError;
      if (!authData.user) throw new Error("No se pudo crear el usuario");

      // 2. Crear negocio
      const { data: businessData, error: businessError } = await supabase
        .from('businesses')
        .insert({
          name: businessName,
          status: 'active', // O 'pending' si requieres aprobación
          phone: phone
        })
        .select()
        .single();

      if (businessError) throw businessError;

      // 3. Crear perfil vinculado
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({
          id: authData.user.id,
          business_id: businessData.id,
          full_name: fullName,
          role: 'admin', // El que registra es admin
          status: 'active',
          email: email
        });

      if (profileError) throw profileError;

      toast.success("Cuenta creada exitosamente");
      // Autologin o pedir login
      
    } catch (error: unknown) {
      // ✅ CORRECCIÓN 2: Manejo de error tipado
      console.error(error);
      const message = error instanceof Error ? error.message : "Error en el registro";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-4xl rounded-2xl shadow-xl overflow-hidden flex flex-col md:flex-row">
        
        {/* Lado Izquierdo - Branding */}
        <div className="w-full md:w-1/2 bg-slate-900 p-8 flex flex-col justify-between text-white relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
             <div className="absolute top-10 left-10 w-32 h-32 bg-indigo-500 rounded-full blur-3xl"></div>
             <div className="absolute bottom-10 right-10 w-40 h-40 bg-blue-500 rounded-full blur-3xl"></div>
          </div>
          
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-8">
              <div className="bg-indigo-500 p-2 rounded-lg">
                <Store className="w-6 h-6 text-white" />
              </div>
              <span className="text-2xl font-bold tracking-tight">Nexus POS</span>
            </div>
            
            <h1 className="text-4xl font-bold mb-4 leading-tight">
              {mode === 'login' ? 'Bienvenido de nuevo' : 'Comienza tu negocio hoy'}
            </h1>
            <p className="text-slate-400 text-lg">
              {mode === 'login' 
                ? 'Gestiona tus ventas, inventario y clientes desde un solo lugar.' 
                : 'Únete a miles de negocios que confían en Nexus para crecer.'}
            </p>
          </div>

          <div className="relative z-10 mt-8 md:mt-0">
            <div className="flex items-center gap-4 text-sm text-slate-400">
              <span className="flex items-center gap-1"><CheckCircle className="w-4 h-4 text-green-400"/> Offline First</span>
              <span className="flex items-center gap-1"><CheckCircle className="w-4 h-4 text-green-400"/> Multi-caja</span>
            </div>
          </div>
        </div>

        {/* Lado Derecho - Formulario */}
        <div className="w-full md:w-1/2 p-8 md:p-12 bg-white">
          <div className="max-w-sm mx-auto">
            <h2 className="text-2xl font-bold text-slate-900 mb-2">
              {mode === 'login' ? 'Iniciar Sesión' : 'Crear Cuenta'}
            </h2>
            <p className="text-slate-500 mb-8 text-sm">
              {mode === 'login' ? 'Ingresa tus credenciales para acceder' : 'Completa los datos de tu negocio'}
            </p>

            <form onSubmit={mode === 'login' ? handleLogin : handleRegister} className="space-y-4">
              
              {mode === 'register' && (
                <>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-700 uppercase">Nombre Completo</label>
                    <div className="relative">
                      <User className="absolute left-3 top-3 text-slate-400 w-5 h-5" />
                      <input 
                        type="text" 
                        required
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                        placeholder="Ej. Juan Pérez"
                        value={fullName}
                        onChange={e => setFullName(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-700 uppercase">Nombre del Negocio</label>
                    <div className="relative">
                      <Store className="absolute left-3 top-3 text-slate-400 w-5 h-5" />
                      <input 
                        type="text" 
                        required
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                        placeholder="Ej. Cafetería Central"
                        value={businessName}
                        onChange={e => setBusinessName(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-700 uppercase">Teléfono</label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-3 text-slate-400 w-5 h-5" />
                      <input 
                        type="tel" 
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                        placeholder="+53 5555 5555"
                        value={phone}
                        onChange={e => setPhone(e.target.value)}
                      />
                    </div>
                  </div>
                </>
              )}

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 uppercase">Correo Electrónico</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 text-slate-400 w-5 h-5" />
                  <input 
                    type="email" 
                    required
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                    placeholder="correo@ejemplo.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 uppercase">Contraseña</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 text-slate-400 w-5 h-5" />
                  <input 
                    type="password" 
                    required
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                  />
                </div>
              </div>

              <button 
                disabled={loading}
                type="submit" 
                className="w-full bg-slate-900 text-white font-bold py-3 rounded-xl hover:bg-slate-800 transition-all flex items-center justify-center gap-2 mt-4 shadow-lg shadow-slate-200 disabled:opacity-70"
              >
                {loading && <Loader2 className="animate-spin w-5 h-5" />}
                {mode === 'login' ? 'Entrar al Sistema' : 'Registrar Negocio'}
                {!loading && <ArrowRight className="w-5 h-5" />}
              </button>

            </form>

            <div className="mt-6 text-center">
              <p className="text-slate-500 text-sm">
                {mode === 'login' ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?'}
                <button 
                  onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
                  className="ml-2 font-bold text-indigo-600 hover:text-indigo-700 transition-colors"
                >
                  {mode === 'login' ? 'Regístrate' : 'Inicia Sesión'}
                </button>
              </p>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// 2. COMPONENTE BUSINESS APP (MEJORADO CON WATCHDOG Y ANTI-LOOP)
// =============================================================================
function BusinessApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [currentStaff, setCurrentStaff] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLocked, setIsLocked] = useState(false);
  
  // Estado para mostrar feedback si tarda mucho
  const [showTimeout, setShowTimeout] = useState(false);

  // 🛡️ REF CRÍTICA: Evita el bucle de recargas infinitas en React 18+
  const lastLoadedUserId = useRef<string | null>(null);

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) throw error;

      if (data) {
        if (data.status === 'pending') {
          toast.info("Tu cuenta está pendiente de aprobación.");
          await supabase.auth.signOut();
          return;
        }
        if (data.status === 'suspended' || data.status === 'rejected') {
          toast.error("Acceso denegado. Contacta a soporte.");
          await supabase.auth.signOut();
          return;
        }

        const staffData: Staff = {
          id: data.id,
          name: data.full_name || data.email,
          role: (data.role === 'admin' || data.role === 'super_admin') ? 'admin' : 'vendedor',
          pin: data.initial_pin || '0000',
          active: true,
          business_id: data.business_id 
        } as unknown as Staff;

        localStorage.setItem('nexus_business_id', data.business_id);
        localStorage.setItem('nexus_current_staff', JSON.stringify(staffData));
        
        // Marcamos como cargado para evitar re-fetches
        lastLoadedUserId.current = userId; 
        
        setCurrentStaff(staffData);
      }
    } catch (error: unknown) {
      console.error("Error perfil:", error);
      // No forzamos logout inmediato aquí para dar oportunidad al usuario de reintentar si fue red
    }
  };

  // ✅ WATCHDOG TIMER: Vigila el tiempo de carga
  useEffect(() => {
    // ✅ CORRECCIÓN 3: Uso de ReturnType para compatibilidad browser/node
    let timer: ReturnType<typeof setTimeout>;
    
    if (loading) {
      // Si lleva 7 segundos cargando, activamos la UI de timeout
      timer = setTimeout(() => setShowTimeout(true), 7000);
    } else {
      setShowTimeout(false);
    }
    return () => clearTimeout(timer);
  }, [loading]);

  useEffect(() => {
    const initSession = async () => {
      const { data: { session: initialSession } } = await supabase.auth.getSession();
      if (initialSession) {
        setSession(initialSession);
        await fetchProfile(initialSession.user.id);
      } else {
        setSession(null);
        setCurrentStaff(null);
        localStorage.removeItem('nexus_business_id');
      }
      setLoading(false);
    };
    initSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      
      if (event === 'SIGNED_IN' && newSession) {
        // 🛡️ FIX: Si es el mismo usuario, NO reiniciamos (Evita bucle infinito)
        if (lastLoadedUserId.current === newSession.user.id) {
            setSession(newSession); 
            return; 
        }

        setCurrentStaff(null); 
        setSession(newSession);
        setLoading(true); // Esto iniciará el timer visual
        await fetchProfile(newSession.user.id);
        setLoading(false);
      } 
      else if (event === 'SIGNED_OUT') {
        setSession(null);
        setCurrentStaff(null);
        lastLoadedUserId.current = null;
        setIsLocked(false);
        localStorage.removeItem('nexus_business_id');
        localStorage.removeItem('nexus_current_staff');
      }
      else if (event === 'TOKEN_REFRESHED') {
        setSession(newSession);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // --- RENDERIZADO CONDICIONAL ---

  if (loading) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-slate-50 gap-6 p-4">
        {showTimeout ? (
          // 🚨 UI DE TIMEOUT (Aparece a los 7s)
          <div className="flex flex-col items-center text-center animate-in fade-in zoom-in duration-300 max-w-sm bg-white p-8 rounded-2xl shadow-xl border border-slate-200">
            <div className="bg-amber-100 p-4 rounded-full mb-4">
              <WifiOff className="w-8 h-8 text-amber-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-800 mb-2">Conexión lenta</h2>
            <p className="text-slate-500 mb-6 text-sm">
              Estamos tardando más de lo normal en conectar.
            </p>
            <div className="flex flex-col gap-3 w-full">
              <button 
                onClick={() => window.location.reload()}
                className="flex items-center justify-center gap-2 bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 transition-colors"
              >
                <RefreshCcw size={18} /> Recargar Página
              </button>
              <button 
                onClick={async () => {
                  await supabase.auth.signOut();
                  window.location.reload();
                }}
                className="flex items-center justify-center gap-2 bg-white text-slate-600 border border-slate-200 py-3 rounded-xl font-bold hover:bg-slate-50 transition-colors"
              >
                <LogOut size={18} /> Cerrar Sesión
              </button>
            </div>
          </div>
        ) : (
          // 🔄 SPINNER NORMAL
          <>
            <div className="relative">
              <div className="absolute inset-0 bg-indigo-100 rounded-full animate-ping opacity-75"></div>
              <div className="relative bg-white p-4 rounded-full shadow-sm border border-slate-100">
                <Loader2 className="animate-spin text-indigo-600 w-8 h-8" />
              </div>
            </div>
            <div className="flex flex-col items-center gap-1">
              <p className="text-slate-700 font-bold text-lg">Iniciando Nexus POS...</p>
              <p className="text-slate-400 text-sm">Verificando credenciales</p>
            </div>
          </>
        )}
      </div>
    );
  }

  if (!session) {
    return <LoginScreen />; 
  }

  if (session && !currentStaff) {
     return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-slate-50 gap-4">
        <Loader2 className="animate-spin text-indigo-600 w-10 h-10" />
        <p className="text-slate-500 font-medium">Cargando perfil...</p>
      </div>
     );
  }

  if (isLocked) {
    return (
      <PinPad 
        onSuccess={(staff) => {
          setCurrentStaff(staff);
          setIsLocked(false);
        }} 
      />
    );
  }

  return (
    <Routes>
      <Route element={<Layout currentStaff={currentStaff} onLock={() => setIsLocked(true)} />}>
        <Route path="/" element={<PosPage />} />
        <Route path="/clientes" element={<CustomersPage />} />
        <Route path="/inventario" element={<InventoryPage />} />
        <Route path="/finanzas" element={<FinancePage />} />
        <Route path="/equipo" element={<StaffPage />} />
        <Route path="/configuracion" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

// =============================================================================
// 3. ADMIN ROUTE (PROTECCIÓN SUPER ADMIN)
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
    <>
      <Toaster position="top-right" richColors />
      <HashRouter>
        <Routes>
          <Route path="/admin-login" element={<SuperAdminLogin />} />
          <Route path="/super-panel" element={<AdminRoute><SuperAdminPage /></AdminRoute>} />
          <Route path="/*" element={<BusinessApp />} />
        </Routes>
      </HashRouter>
    </>
  );
}