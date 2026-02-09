/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState, useRef } from 'react';
// ✅ CAMBIO 1: Agregamos useNavigate para poder redirigir
import { HashRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { type Staff, db } from './lib/db'; 
import { type Session } from '@supabase/supabase-js';
import { Toaster, toast } from 'sonner';
import { syncCriticalData, syncHeavyData } from './lib/sync';

// --- IMPORTACIONES DE PÁGINAS Y COMPONENTES ---
import { Layout } from './components/Layout';
import { PosPage } from './pages/PosPage';
import { InventoryPage } from './pages/InventoryPage'; 
import { FinancePage } from './pages/FinancePage';
import { SettingsPage } from './pages/SettingsPage';
import { SuperAdminPage } from './pages/SuperAdminPage';
import { SuperAdminLogin } from './pages/SuperAdminLogin';
import { CustomersPage } from './components/CustomersPage';

// ✅ CAMBIO 2: Agregamos el icono Shield para el botón de admin
import { Loader2, Store, User, Lock, Mail, Phone, ArrowRight, CheckCircle, WifiOff, RefreshCcw, LogOut, Shield } from 'lucide-react';

// =============================================================================
// 1. COMPONENTE LOGIN SCREEN
// =============================================================================
function LoginScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  
  // ✅ CAMBIO 3: Inicializamos el hook de navegación
  const navigate = useNavigate();

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
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;
    } catch (error: unknown) {
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
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (authError) throw authError;
      if (!authData.session) {
         toast.warning("Desactiva 'Confirm Email' en Supabase para continuar.");
         return;
      }

      const { error: rpcError } = await supabase.rpc('submit_registration_request', {
        p_owner_name: fullName,
        p_business_name: businessName,
        p_phone: phone
      });

      if (rpcError) throw rpcError;

      await supabase.auth.signOut();
      
      toast.success("Solicitud enviada correctamente.");
      alert("✅ REGISTRO EXITOSO\n\nTu cuenta ha sido creada y está PENDIENTE de aprobación.\nContacta al administrador para que la active.");
      
      setMode('login');
      setEmail('');
      setPassword('');

    } catch (error: any) {
      console.error(error);
      await supabase.auth.signOut();
      toast.error(error.message || "Error al enviar solicitud.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-4xl rounded-2xl shadow-xl overflow-hidden flex flex-col md:flex-row">
        
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
              <span className="text-2xl font-bold tracking-tight">Bisne con Talla</span>
            </div>
            
            <h1 className="text-4xl font-bold mb-4 leading-tight">
              {mode === 'login' ? 'Bienvenido de nuevo' : 'Comienza tu negocio hoy'}
            </h1>
            <p className="text-slate-400 text-lg">
              {mode === 'login' 
                ? 'Gestiona tus ventas, inventario y clientes desde un solo lugar.' 
                : 'Únete a miles de negocios que confían en Bisne con Talla para crecer.'}
            </p>
          </div>

          <div className="relative z-10 mt-8 md:mt-0">
            <div className="flex items-center gap-4 text-sm text-slate-400">
              <span className="flex items-center gap-1"><CheckCircle className="w-4 h-4 text-green-400"/> Offline First</span>
              <span className="flex items-center gap-1"><CheckCircle className="w-4 h-4 text-green-400"/> Multi-caja</span>
            </div>
          </div>
        </div>

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

            {/* ✅ CAMBIO 4: Botón de acceso a Super Admin al final */}
            <div className="mt-8 pt-6 border-t border-slate-100 flex justify-center">
                <button
                    onClick={() => navigate('/admin-login')}
                    className="flex items-center gap-2 text-slate-400 hover:text-slate-600 transition-colors text-xs font-semibold uppercase tracking-wider"
                >
                    <Shield size={14} />
                    Acceso Super Admin
                </button>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// 2. COMPONENTE BUSINESS APP (OPTIMIZADO)
// =============================================================================
function BusinessApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [currentStaff, setCurrentStaff] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [showTimeout, setShowTimeout] = useState(false);
  const lastLoadedUserId = useRef<string | null>(null);

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
             console.error("Perfil no encontrado. Cerrando sesión...");
             setSession(null);
             return;
        }
        throw error;
      }

      if (data) {
        if (data.status === 'pending') {
          toast.info("Cuenta pendiente de aprobación.");
          await supabase.auth.signOut();
          setSession(null);
          return;
        }
        if (data.status === 'suspended' || data.status === 'rejected') {
          toast.error("Cuenta suspendida.");
          await supabase.auth.signOut();
          return;
        }

        // Actualizar datos de licencia (rápido)
        const { data: bizData } = await supabase
            .from('businesses')
            .select('subscription_expires_at')
            .eq('id', data.business_id)
            .single();

        if (bizData?.subscription_expires_at) {
            localStorage.setItem('nexus_license_expiry', bizData.subscription_expires_at);
            localStorage.setItem('nexus_last_sync', new Date().toISOString());
        }

        const adminStaff: Staff = {
          id: data.id,
          name: data.full_name || data.email,
          role: 'admin', 
          pin: '0000', 
          active: true,
          business_id: data.business_id 
        };

        localStorage.setItem('nexus_business_id', data.business_id);

        // ✅ CAMBIO CLAVE: Carga Inteligente en 2 Pasos
        // Paso 1: Carga crítica (Config, Turnos) -> BLOQUEA UN INSTANTE
        await syncCriticalData(data.business_id);
        
        // Paso 2: Carga pesada (Productos, Clientes) -> SEGUNDO PLANO (NO BLOQUEA)
        syncHeavyData(data.business_id).then(() => {
            console.log("🔄 Inventario sincronizado en segundo plano");
        }).catch(err => console.warn("Sync background warning:", err));
        
        // Entramos rápido a la app
        await db.staff.filter(s => s.business_id !== data.business_id).delete();
        await db.staff.put(adminStaff);

        lastLoadedUserId.current = userId; 
        setCurrentStaff(adminStaff); 
      }
    } catch (error: unknown) {
      console.error("Error perfil:", error);
    }
  };

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (loading) {
      timer = setTimeout(() => setShowTimeout(true), 25000);
    } else {
      setShowTimeout(false);
    }
    return () => clearTimeout(timer);
  }, [loading]);

  useEffect(() => {
    const initSession = async () => {
      try {
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Tiempo de espera de red agotado')), 30000)
        );

        const { data, error } = await Promise.race([
          supabase.auth.getSession(),
          timeoutPromise
        ]) as any;

        if (error) throw error;

        if (data?.session) {
          setSession(data.session);
          await fetchProfile(data.session.user.id).catch(err => {
             console.error("No se pudo cargar perfil (posible modo offline):", err);
          });
        } else {
          setSession(null);
          setCurrentStaff(null);
          localStorage.removeItem('nexus_business_id');
        }

      } catch (error) {
        console.error("🔴 Error crítico o Timeout al iniciar:", error);
        setSession(null);
        // Intentar recuperar sesión local si falla red
        const localBiz = localStorage.getItem('nexus_business_id');
        if(localBiz) toast.error("Modo Offline: Verifica tu conexión");
      } finally {
        setLoading(false);
      }
    };

    initSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (event === 'SIGNED_IN' && newSession) {
        if (lastLoadedUserId.current === newSession.user.id) {
            setSession(newSession); 
            return; 
        }
        setCurrentStaff(null); 
        setSession(newSession);
        setLoading(true);
        await fetchProfile(newSession.user.id);
        setLoading(false);
      } 
      else if (event === 'SIGNED_OUT') {
        setSession(null);
        setCurrentStaff(null);
        lastLoadedUserId.current = null;
        localStorage.clear(); 
      }
      else if (event === 'TOKEN_REFRESHED') {
        setSession(newSession);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-slate-50 gap-6 p-4">
        {showTimeout ? (
          <div className="flex flex-col items-center text-center animate-in fade-in zoom-in duration-300 max-w-sm bg-white p-8 rounded-2xl shadow-xl border border-slate-200">
            <div className="bg-amber-100 p-4 rounded-full mb-4">
              <WifiOff className="w-8 h-8 text-amber-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-800 mb-2">Conexión lenta</h2>
            <div className="flex flex-col gap-3 w-full mt-4">
              <button onClick={() => window.location.reload()} className="bg-indigo-600 text-white py-3 rounded-xl font-bold">
                <RefreshCcw size={18} className="inline mr-2"/> Recargar
              </button>
              <button onClick={async () => { await supabase.auth.signOut(); window.location.reload(); }} className="bg-white text-slate-600 border border-slate-200 py-3 rounded-xl font-bold">
                <LogOut size={18} className="inline mr-2"/> Salir
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1">
            <Loader2 className="animate-spin text-indigo-600 w-8 h-8 mb-4" />
            <p className="text-slate-700 font-bold text-lg">Iniciando Bisne con Talla...</p>
          </div>
        )}
      </div>
    );
  }

  if (!session) {
    return <LoginScreen />; 
  }

  if (!currentStaff) {
     return (
        <div className="h-screen w-full flex flex-col items-center justify-center bg-slate-50 gap-6 p-4 text-center">
            <div className="bg-white p-8 rounded-2xl shadow-lg max-w-sm w-full border border-slate-200">
                <Loader2 className="w-12 h-12 text-indigo-500 mx-auto mb-4 animate-spin" />
                <h2 className="text-xl font-bold text-slate-800">Cargando perfil...</h2>
                <button onClick={async () => { await supabase.auth.signOut(); localStorage.clear(); window.location.reload(); }} className="mt-6 w-full bg-slate-100 text-slate-600 py-2 rounded-xl font-bold text-sm">
                    Cancelar / Salir
                </button>
            </div>
        </div>
     );
  }

  return (
    <Routes>
      <Route element={<Layout currentStaff={currentStaff} />}>
        <Route path="/" element={<PosPage />} />
        <Route path="/clientes" element={<CustomersPage />} />
        <Route path="/inventario" element={<InventoryPage />} />
        <Route path="/finanzas" element={<FinancePage />} />
        <Route path="/configuracion" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

// =============================================================================
// 3. ADMIN ROUTE
// =============================================================================
function AdminRoute({ children }: { children: React.ReactNode }) {
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;

    const checkAdmin = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user) { if (mounted) setAuthorized(false); return; }

        const { data, error } = await supabase
          .from('profiles')
          .select('is_super_admin')
          .eq('id', user.id)
          .single();
        
        if (mounted) setAuthorized(!error && data?.is_super_admin);
        
      } catch { 
        if (mounted) setAuthorized(false);
      }
    };

    checkAdmin();
    return () => { mounted = false; };
  }, []);

  if (authorized === null) {
      return (
        <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center gap-4">
            <Loader2 className="animate-spin text-indigo-500 w-10 h-10"/>
            <p className="text-slate-400 text-sm">Verificando credenciales...</p>
        </div>
      );
  }
  
  return authorized ? <>{children}</> : <Navigate to="/admin-login" replace />;
}

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