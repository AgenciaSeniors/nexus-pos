import { useEffect, useState } from 'react';
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

import { Loader2, Store, User, Lock, Mail, Phone, ArrowRight, CheckCircle } from 'lucide-react';

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
      // Limpiamos cualquier rastro anterior antes de intentar loguear
      localStorage.removeItem('nexus_business_id');
      localStorage.removeItem('nexus_current_staff');

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;
      toast.success("Bienvenido de nuevo");
      // No necesitamos navegar manual, el listener de auth lo hará
    } catch (error: unknown) {
      console.error(error);
      const errorMessage = error instanceof Error ? error.message : "Error desconocido";
      
      if (errorMessage.includes("Invalid login")) {
        toast.error("Credenciales incorrectas");
      } else {
        toast.error("Error al iniciar sesión: " + errorMessage);
      }
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (!fullName || !phone || !businessName) {
      toast.warning("Todos los campos son obligatorios");
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            phone: phone,
            business_name_request: businessName,
            role: 'admin',
            status: 'pending'
          }
        }
      });

      if (error) throw error;

      if (data.user) {
        toast.success("Cuenta creada exitosamente", {
          description: "Tu solicitud está pendiente de aprobación."
        });
        setMode('login');
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Error desconocido";
      toast.error("Error en registro: " + errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col md:flex-row h-auto md:h-[600px]">
        
        {/* Panel Izquierdo */}
        <div className="w-full md:w-1/2 bg-indigo-600 p-12 flex flex-col justify-between text-white relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-full bg-cover opacity-10 mix-blend-overlay"></div>
          <div className="relative z-10">
            <div className="w-16 h-16 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center mb-6 shadow-inner">
              <Store size={32} className="text-white" />
            </div>
            <h1 className="text-4xl font-bold mb-4">Nexus POS</h1>
            <p className="text-indigo-100 text-lg leading-relaxed">
              El sistema operativo para negocios modernos. Control total, incluso sin internet.
            </p>
          </div>
          <div className="relative z-10 flex items-center gap-2 text-indigo-200 text-sm">
            <CheckCircle size={16} />
            <span>Versión Enterprise 2.0</span>
          </div>
        </div>

        {/* Panel Derecho */}
        <div className="w-full md:w-1/2 p-8 md:p-12 bg-slate-50 flex flex-col justify-center">
          <div className="max-w-sm mx-auto w-full">
            <h2 className="text-2xl font-bold text-slate-800 mb-2">
              {mode === 'login' ? 'Iniciar Sesión' : 'Crear Cuenta'}
            </h2>
            <p className="text-slate-500 mb-8">
              {mode === 'login' ? 'Accede a tu terminal de punto de venta' : 'Solicita acceso para tu negocio'}
            </p>

            <form onSubmit={mode === 'login' ? handleLogin : handleRegister} className="space-y-4">
              
              {mode === 'register' && (
                <>
                  <div className="relative group">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 transition-colors" size={18} />
                    <input 
                      type="text" 
                      placeholder="Nombre Completo"
                      className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                      value={fullName}
                      onChange={e => setFullName(e.target.value)}
                      disabled={loading}
                    />
                  </div>
                  <div className="relative group">
                    <Store className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 transition-colors" size={18} />
                    <input 
                      type="text" 
                      placeholder="Nombre del Negocio"
                      className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                      value={businessName}
                      onChange={e => setBusinessName(e.target.value)}
                      disabled={loading}
                    />
                  </div>
                  <div className="relative group">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 transition-colors" size={18} />
                    <input 
                      type="tel" 
                      placeholder="Teléfono"
                      className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      disabled={loading}
                    />
                  </div>
                </>
              )}

              <div className="relative group">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 transition-colors" size={18} />
                <input 
                  type="email" 
                  placeholder="Correo electrónico"
                  className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  disabled={loading}
                  required
                />
              </div>

              <div className="relative group">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 transition-colors" size={18} />
                <input 
                  type="password" 
                  placeholder="Contraseña"
                  className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  disabled={loading}
                  required
                />
              </div>

              <button 
                type="submit" 
                disabled={loading}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-indigo-200 flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed mt-2"
              >
                {loading ? <Loader2 className="animate-spin" /> : (
                  <>
                    {mode === 'login' ? 'Ingresar al Sistema' : 'Solicitar Acceso'}
                    <ArrowRight size={18} />
                  </>
                )}
              </button>
            </form>

            <div className="mt-6 text-center">
              <button 
                onClick={() => {
                    setMode(mode === 'login' ? 'register' : 'login');
                    setEmail('');
                    setPassword('');
                }}
                disabled={loading}
                className="text-slate-500 hover:text-indigo-600 text-sm font-medium transition-colors"
              >
                {mode === 'login' 
                  ? '¿No tienes cuenta? Registra tu negocio' 
                  : '¿Ya tienes cuenta? Inicia sesión'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// 2. COMPONENTE BUSINESS APP
// =============================================================================
function BusinessApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [currentStaff, setCurrentStaff] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLocked, setIsLocked] = useState(false);

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
          // Casting seguro para incluir business_id
          business_id: data.business_id 
        } as unknown as Staff;

        // Limpieza de datos antiguos si existen
        localStorage.removeItem('nexus_business_id');
        localStorage.removeItem('nexus_current_staff');

        if (data.business_id) {
          localStorage.setItem('nexus_business_id', data.business_id);
        }
        localStorage.setItem('nexus_current_staff', JSON.stringify(staffData));
        
        // Actualizamos estado en memoria
        setCurrentStaff(staffData);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Error desconocido";
      console.error("Error crítico de perfil:", errorMessage);
      
      await supabase.auth.signOut();
      setSession(null);
      setCurrentStaff(null);
      localStorage.removeItem('nexus_business_id');
      localStorage.removeItem('nexus_current_staff');
      
      toast.error("Sesión inválida o usuario eliminado.");
    }
  };

  useEffect(() => {
    // 1. Carga Inicial
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
      setLoading(false); // Solo quitamos el loading inicial aquí
    };
    initSession();

    // 2. Escuchar cambios
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      
      if (event === 'SIGNED_IN' && newSession) {
        // Al entrar, limpiamos el staff anterior para evitar "nombres fantasmas"
        setCurrentStaff(null); 
        setSession(newSession);
        // NO activamos setLoading(true) global para evitar parpadeos molestos,
        // dejamos que fetchProfile actualice el estado cuando termine.
        await fetchProfile(newSession.user.id);
      } 
      else if (event === 'SIGNED_OUT') {
        // Limpieza total
        setSession(null);
        setCurrentStaff(null);
        setIsLocked(false);
        localStorage.removeItem('nexus_business_id');
        localStorage.removeItem('nexus_current_staff');
      }
      else if (event === 'TOKEN_REFRESHED') {
        // Solo actualizamos la sesión, NO recargamos perfil ni mostramos loading
        setSession(newSession);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-slate-50 gap-4">
        <Loader2 className="animate-spin text-indigo-600 w-10 h-10" />
        <p className="text-slate-500 font-medium animate-pulse">Cargando sistema...</p>
      </div>
    );
  }

  if (!session) {
    return <LoginScreen />; 
  }

  // Si hay sesión pero aún no se carga el staff (estamos en el limbo del fetchProfile)
  // mostramos un estado intermedio en lugar del login
  if (session && !currentStaff) {
     return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-slate-50 gap-4">
        <Loader2 className="animate-spin text-indigo-600 w-10 h-10" />
        <p className="text-slate-500 font-medium">Obteniendo perfil...</p>
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
// 3. RUTA PROTEGIDA SUPER ADMIN
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