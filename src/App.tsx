import { useEffect, useRef, useState } from 'react';
import { HashRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { type Staff, db } from './lib/db'; 
import { type Session } from '@supabase/supabase-js';
import { Toaster, toast } from 'sonner';
import { syncCriticalData, syncHeavyData } from './lib/sync';

import { Layout } from './components/Layout';
import { PosPage } from './pages/PosPage';
import { InventoryPage } from './pages/InventoryPage';
import { FinancePage } from './pages/FinancePage';
import { SettingsPage } from './pages/SettingsPage';
import { SuperAdminPage } from './pages/SuperAdminPage';
import { SuperAdminLogin } from './pages/SuperAdminLogin';
import { CustomersPage } from './components/CustomersPage';
import { StaffSelectorModal } from './components/StaffSelectorModal';

import { Loader2, Store, User, Lock, Mail, Phone, ArrowRight, CheckCircle, Shield, Eye, EyeOff } from 'lucide-react';

// =============================================================================
// 0. PANTALLA DE ACTUALIZAR CONTRASEÑA (Modo Recuperación)
// =============================================================================
function UpdatePasswordScreen({ onComplete }: { onComplete: () => void }) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) return toast.error("La contraseña debe tener al menos 6 caracteres");
    
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Contraseña actualizada exitosamente.");
      onComplete();
    } catch (error: any) {
      toast.error(error.message || "Error al actualizar la contraseña");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl max-w-sm w-full border border-slate-200 animate-in zoom-in-95 duration-300">
        <div className="bg-[#0B3B68] w-14 h-14 rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-[#0B3B68]/20">
           <Lock className="text-white w-7 h-7" />
        </div>
        <h2 className="text-2xl font-black text-slate-900 mb-2">Nueva Contraseña</h2>
        <p className="text-slate-500 mb-6 text-sm">Ingresa una nueva contraseña segura para recuperar el acceso a tu cuenta.</p>
        <form onSubmit={handleUpdate} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">Nueva Contraseña</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
              <input 
                type="password" required minLength={6} autoFocus
                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] outline-none transition-all font-medium" 
                placeholder="••••••••" 
                value={password} onChange={e => setPassword(e.target.value)} 
              />
            </div>
          </div>
          <button disabled={loading} type="submit" className="w-full bg-[#7AC142] text-white font-bold py-3.5 rounded-xl hover:bg-[#5e9631] transition-all flex items-center justify-center gap-2 mt-4 shadow-lg shadow-[#7AC142]/20 active:scale-95 disabled:opacity-70">
            {loading ? <Loader2 className="animate-spin w-5 h-5" /> : "Guardar Contraseña"}
          </button>
        </form>
      </div>
    </div>
  );
}

// =============================================================================
// 1. COMPONENTE LOGIN SCREEN (Clientes y Empleados)
// =============================================================================
interface LoginScreenProps {
  onRegistrationStart: () => void;
  onRegistrationEnd: () => void;
}

function LoginScreen({ onRegistrationStart, onRegistrationEnd }: LoginScreenProps) {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const navigate = useNavigate();

  // ✅ NÚMERO DE WHATSAPP OFICIAL GUARDADO
  const ADMIN_PHONE = "5359887863"; 

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [monthsRequested, setMonthsRequested] = useState(1);
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (error: any) {
      toast.error(error.message === 'Invalid login credentials' ? 'Credenciales incorrectas' : error.message);
      setLoading(false);
    } 
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    onRegistrationStart();
    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
      if (authError) throw authError;
      if (!authData.user) {
        throw new Error("No se pudo crear la cuenta. Intenta nuevamente.");
      }
      if (!authData.session) {
        toast.info("Confirma tu correo electrónico y luego vuelve para completar el registro.");
        setMode('login');
        return;
      }
      const { error: rpcError } = await supabase.rpc('submit_registration_request', {
        p_owner_name: fullName, p_business_name: businessName, p_phone: phone, p_months_requested: monthsRequested
      });
      if (rpcError) throw rpcError;
      await supabase.auth.signOut();

      toast.success("Solicitud enviada. Toca el botón de WhatsApp abajo para pedir tu aprobación.", { duration: 8000 });
      setMode('login');
      setEmail('');
      setPassword('');
    } catch (error: any) {
      console.error(error);
      await supabase.auth.signOut();
      toast.error(error.message || "Error al enviar solicitud.");
    } finally {
      setLoading(false);
      onRegistrationEnd();
    }
  };

  const handleForgotPassword = (e: React.FormEvent) => {
      e.preventDefault();
      if (!email) return toast.error("Por favor, ingresa tu correo electrónico");
      const msg = `Hola, olvidé mi contraseña de Bisne con Talla.\nMi correo es: ${email}\nNecesito que me la restablezcan. Gracias.`;
      window.open(`https://wa.me/${ADMIN_PHONE}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  // ✅ MENSAJE DINÁMICO DE WHATSAPP
  const defaultWhatsAppMessage = mode === 'register' 
        ? "Hola administrador, acabo de registrar mi negocio en Bisne con Talla y necesito que aprueben mi cuenta."
        : "Hola soporte de Bisne con Talla, necesito ayuda para acceder a mi cuenta.";
  const whatsappUrl = `https://wa.me/${ADMIN_PHONE}?text=${encodeURIComponent(defaultWhatsAppMessage)}`;

  return (
    <div className="min-h-screen bg-[#F3F4F6] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-4xl rounded-[2rem] shadow-2xl overflow-hidden flex flex-col md:flex-row">
        
        {/* LADO IZQUIERDO: DECORATIVO (SOLO PC) */}
        <div className="w-full md:w-1/2 bg-[#0B3B68] p-10 flex flex-col justify-between text-white relative overflow-hidden hidden md:flex">
          <div className="absolute top-0 left-0 w-full h-full opacity-20 pointer-events-none">
             <div className="absolute top-10 left-10 w-40 h-40 bg-[#7AC142] rounded-full blur-3xl"></div>
             <div className="absolute bottom-10 right-10 w-56 h-56 bg-blue-400 rounded-full blur-[100px]"></div>
          </div>
          
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-10">
              <div className="bg-[#7AC142] p-2.5 rounded-xl shadow-lg shadow-[#7AC142]/20"><Store className="w-7 h-7 text-[#0B3B68]" /></div>
              <span className="text-2xl font-black tracking-tight drop-shadow-md">Bisne con Talla</span>
            </div>
            
            {/* ✅ TITULARES MEJORADOS Y EN VERDE PARA QUE RESALTEN */}
            <h1 className="text-5xl font-black mb-5 leading-tight drop-shadow-xl text-[#7AC142]">
              {mode === 'login' ? 'Bienvenido' : mode === 'forgot' ? 'Recupera tu acceso' : 'Comienza tu negocio'}
            </h1>
            <p className="text-slate-300 text-lg font-medium leading-relaxed drop-shadow-md">
              {mode === 'login' ? 'Gestiona tus ventas, inventario y clientes desde un solo lugar.' : mode === 'forgot' ? 'Escribe tu correo y el administrador te ayudará por WhatsApp.' : 'Únete a los negocios que confían en nuestro sistema.'}
            </p>
          </div>

          <div className="relative z-10 mt-8 md:mt-0">
            <div className="flex flex-col gap-3 text-sm text-slate-200 font-medium">
              <span className="flex items-center gap-2"><CheckCircle className="w-5 h-5 text-[#7AC142]"/> Base de Datos Offline-First</span>
              <span className="flex items-center gap-2"><CheckCircle className="w-5 h-5 text-[#7AC142]"/> Sincronización Inmediata</span>
            </div>
          </div>
        </div>

        {/* LADO DERECHO: FORMULARIOS (MÓVIL Y PC) */}
        <div className="w-full md:w-1/2 p-6 sm:p-10 md:p-12 bg-white flex flex-col justify-center relative">
          
          <div className="max-w-sm mx-auto w-full">
            
            {/* ✅ ENCABEZADO MÓVIL */}
            <div className="md:hidden flex flex-col items-center mb-8 text-center animate-in fade-in slide-in-from-top-4 duration-500">
                <div className="bg-[#0B3B68] p-3.5 rounded-2xl mb-4 shadow-xl shadow-[#0B3B68]/20">
                    <Store className="w-8 h-8 text-[#7AC142]" />
                </div>
                <h1 className="text-3xl font-black text-[#0B3B68] tracking-tight">Bisne con Talla</h1>
                <p className="text-[#7AC142] text-sm mt-1 font-bold">
                    {mode === 'login' ? 'Bienvenido' : mode === 'register' ? 'Crea tu cuenta ahora' : 'Restablecer Acceso'}
                </p>
            </div>

            <h2 className="text-2xl font-black text-[#1F2937] mb-2 hidden md:block">
                {mode === 'login' ? 'Iniciar Sesión' : mode === 'forgot' ? 'Recuperar Contraseña' : 'Crear Cuenta'}
            </h2>
            <p className="text-[#6B7280] mb-8 text-sm hidden md:block">
                {mode === 'login' ? 'Ingresa tus credenciales para acceder' : mode === 'forgot' ? 'Escribe tu correo y te contactamos por WhatsApp para restablecerla.' : 'Completa los datos de tu negocio'}
            </p>

            <form onSubmit={mode === 'login' ? handleLogin : mode === 'register' ? handleRegister : handleForgotPassword} className="space-y-4">
              
              {mode === 'register' && (
                <div className="animate-in slide-in-from-right-4 duration-300 space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-[#6B7280] uppercase tracking-wide">Nombre Completo</label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280] w-5 h-5" />
                      <input type="text" required className="w-full pl-10 pr-4 py-3 bg-[#F3F4F6] border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] focus:bg-white outline-none transition-all font-medium text-[#1F2937]" placeholder="Ej. Juan Pérez" value={fullName} onChange={e => setFullName(e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-[#6B7280] uppercase tracking-wide">Nombre del Negocio</label>
                    <div className="relative">
                      <Store className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280] w-5 h-5" />
                      <input type="text" required className="w-full pl-10 pr-4 py-3 bg-[#F3F4F6] border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] focus:bg-white outline-none transition-all font-medium text-[#1F2937]" placeholder="Ej. Cafetería Central" value={businessName} onChange={e => setBusinessName(e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-[#6B7280] uppercase tracking-wide">Teléfono</label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280] w-5 h-5" />
                      <input type="tel" className="w-full pl-10 pr-4 py-3 bg-[#F3F4F6] border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] focus:bg-white outline-none transition-all font-medium text-[#1F2937]" placeholder="+53 5555 5555" value={phone} onChange={e => setPhone(e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-[#6B7280] uppercase tracking-wide">¿Cuántos meses deseas contratar?</label>
                    <div className="grid grid-cols-4 gap-2">
                      {[1, 3, 6, 12].map(m => (
                        <button key={m} type="button" onClick={() => setMonthsRequested(m)}
                          className={`py-2.5 text-sm font-bold rounded-xl border transition-all ${monthsRequested === m ? 'bg-[#0B3B68] text-white border-[#0B3B68] shadow-md' : 'bg-[#F3F4F6] text-[#6B7280] hover:bg-gray-200 border-gray-200'}`}>
                          {m}M
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs font-bold text-[#6B7280] uppercase tracking-wide">Correo Electrónico</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280] w-5 h-5" />
                  <input type="email" required className="w-full pl-10 pr-4 py-3 bg-[#F3F4F6] border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] focus:bg-white outline-none transition-all font-medium text-[#1F2937]" placeholder="correo@ejemplo.com" value={email} onChange={e => setEmail(e.target.value)} />
                </div>
              </div>

              {mode !== 'forgot' && (
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-[#6B7280] uppercase tracking-wide">Contraseña</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280] w-5 h-5" />
                      <input type={showPassword ? 'text' : 'password'} required className="w-full pl-10 pr-11 py-3 bg-[#F3F4F6] border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] focus:bg-white outline-none transition-all font-medium text-[#1F2937]" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} />
                      <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#0B3B68] transition-colors p-1">
                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>
              )}

              <button disabled={loading} type="submit" className="w-full bg-[#0B3B68] text-white font-bold py-3.5 rounded-xl hover:bg-[#092b4d] transition-all flex items-center justify-center gap-2 mt-6 shadow-xl shadow-[#0B3B68]/20 disabled:opacity-70 active:scale-95 text-lg">
                {loading && <Loader2 className="animate-spin w-5 h-5" />}
                {mode === 'login' ? 'Entrar al Sistema' : mode === 'forgot' ? 'Contactar por WhatsApp' : 'Registrar Negocio'}
                {!loading && mode !== 'forgot' && <ArrowRight className="w-5 h-5" />}
              </button>
            </form>

            <div className="mt-6 text-center space-y-3">
              {mode === 'login' && (
                  <button type="button" onClick={() => setMode('forgot')} className="text-sm font-bold text-[#6B7280] hover:text-[#0B3B68] transition-colors">
                    ¿Olvidaste tu contraseña?
                  </button>
              )}
              
              <div className="text-[#6B7280] text-sm">
                {mode === 'login' ? '¿No tienes cuenta?' : mode === 'register' ? '¿Ya tienes cuenta?' : ''}
                {mode !== 'forgot' ? (
                    <button onClick={() => setMode(mode === 'login' ? 'register' : 'login')} className="ml-2 font-black text-[#7AC142] hover:text-[#5e9631] transition-colors">
                      {mode === 'login' ? 'Regístrate Aquí' : 'Inicia Sesión'}
                    </button>
                ) : (
                    <button onClick={() => setMode('login')} className="font-black text-[#0B3B68] hover:text-[#092b4d] transition-colors">
                      Volver a Iniciar Sesión
                    </button>
                )}
              </div>
            </div>

            {/* ✅ BOTÓN DE WHATSAPP INTEGRADO OFICIALMENTE */}
            <div className="mt-8 pt-6 border-t border-gray-100">
                <p className="text-center text-[10px] text-gray-400 font-black uppercase tracking-widest mb-3">¿Problemas con tu cuenta?</p>
                <a 
                    href={whatsappUrl} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="flex items-center justify-center gap-2 w-full p-3.5 rounded-xl bg-[#25D366]/10 text-[#128C7E] hover:bg-[#25D366]/20 border border-[#25D366]/30 font-bold transition-all shadow-sm active:scale-95"
                >
                    <svg width="22" height="22" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.305-.885-.653-1.482-1.459-1.656-1.756-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>
                    </svg>
                    Contactar Soporte por WhatsApp
                </a>
            </div>

            <div className="mt-4 pt-4 flex justify-center">
                <button onClick={() => navigate('/admin-login')} className="flex items-center gap-1.5 text-gray-400 hover:text-[#0B3B68] transition-colors text-[10px] font-bold uppercase tracking-wider">
                    <Shield size={12} /> Acceso Super Admin
                </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// 2. COMPONENTE BUSINESS APP (ROBUSTO Y LINEAL)
// =============================================================================
function BusinessApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [currentStaff, setCurrentStaff] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(true);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [showStaffSelector, setShowStaffSelector] = useState(false);
  // Bandera para evitar que onAuthStateChange procese SIGNED_IN durante el registro
  const isRegisteringRef = useRef(false);
  // Bandera para saber si el staff ya fue cargado (evita doble-carga y loop de efectos)
  const isStaffLoadedRef = useRef(false);

  // BOTÓN DE PÁNICO: Destruye todo rastro de caché corrupta
  // No es async: redirige inmediatamente para evitar que el timer de sync
  // dispare sobre la DB eliminada (DatabaseClosedError).
  const handleForceLogout = () => {
      try {
          Object.keys(localStorage).forEach(key => {
              if (key.startsWith('sb-') || key.startsWith('nexus_')) {
                  localStorage.removeItem(key);
              }
          });
          sessionStorage.clear();
          // Fire-and-forget: no bloqueamos la redirección
          supabase.auth.signOut().catch(() => {});
          db.delete().catch(() => {});
      } catch (e) {
          // Ignoramos errores durante el cierre
      } finally {
          window.location.replace('/');
      }
  };

  // Función controlada para descargar el perfil de Supabase
  const fetchProfileAndSync = async (userId: string, isBackgroundSync = false) => {
    try {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();

      if (error) throw error;

      if (data) {
        if (data.status !== 'active') {
          if (!isBackgroundSync) {
            setLoading(false);
            toast.error("Tu cuenta está pendiente de aprobación. Espera la confirmación del administrador.");
          }
          await supabase.auth.signOut();
          return;
        }

        localStorage.setItem('nexus_business_id', data.business_id);

        // Preservar PIN del admin si ya existe en la DB local
        const existingAdmin = await db.staff.get(data.id);
        const adminStaff: Staff = {
          id: data.id,
          name: data.full_name || data.email,
          role: 'admin',
          pin: existingAdmin?.pin || '0000',
          active: true,
          business_id: data.business_id
        };

        // Solo upsert del admin — NO borrar el resto del equipo
        await db.staff.put(adminStaff);

        isStaffLoadedRef.current = true;
        if (!isBackgroundSync) setLoading(false);

        if (!isBackgroundSync) {
          // Determinar qué vendedor mostrar en este dispositivo
          const savedStaffId = localStorage.getItem('nexus_staff_id');
          const allActive = await db.staff
            .where('business_id').equals(data.business_id)
            .filter(s => s.active !== false)
            .toArray();
          const savedStaff = savedStaffId ? allActive.find(s => s.id === savedStaffId) : null;

          if (savedStaff) {
            setCurrentStaff(savedStaff);
          } else if (allActive.length > 1) {
            setShowStaffSelector(true); // Múltiples vendedores → seleccionar
          } else {
            setCurrentStaff(adminStaff);
          }
        }
        // En background: no tocamos currentStaff para no interrumpir al vendedor activo

        // Sincronización secundaria silenciosa
        await syncCriticalData(data.business_id);
        syncHeavyData(data.business_id).catch(() => {});
      }
    } catch (error: any) {
      console.error("Error obteniendo perfil:", error);
      
      // Si el perfil no se encuentra (PGRST116), es usuario recién creado sin perfil aún
      if (error?.code === 'PGRST116') {
          if (!isBackgroundSync) {
            setLoading(false);
            toast.error("El perfil de tu cuenta aún no está configurado. Contacta al administrador.");
          }
          await supabase.auth.signOut();
          return;
      }

      // Si fue error de internet, pero tenemos datos locales, lo dejamos entrar (Offline-First)
      if (!isBackgroundSync) {
          const localStaff = await db.staff.toArray().catch(() => []);
          if (localStaff.length > 0) {
              toast.info("Conexión lenta. Modo sin conexión activado.");
              const savedStaffId = localStorage.getItem('nexus_staff_id');
              const activeLocal = localStaff.filter(s => s.active !== false);
              const savedStaff = savedStaffId ? activeLocal.find(s => s.id === savedStaffId) : null;
              setCurrentStaff(savedStaff || localStaff.find(s => s.role === 'admin') || localStaff[0]);
              isStaffLoadedRef.current = true;
              setLoading(false);
          } else {
              toast.error("Error de conexión. Necesitas internet para tu primer inicio.");
              await handleForceLogout(); // Lo devolvemos al login si no tiene datos locales
          }
      }
    }
  };

  // Carga inicial al abrir la página
  useEffect(() => {
    let mounted = true;

    const initApp = async () => {
      if (window.location.hash.includes('type=recovery')) {
          setRecoveryMode(true);
          return; // El hash de recovery lo maneja onAuthStateChange
      }

      try {
          // 1. PRIMERO: Revisar datos locales (IndexedDB + localStorage) — no requiere red
          const localStaff = await db.staff.toArray().catch(() => []);
          const localBizId = localStorage.getItem('nexus_business_id');

          if (!mounted) return;

          if (localStaff.length > 0 && localBizId) {
              // Tenemos datos locales: mostrar la app inmediatamente sin esperar la red
              isStaffLoadedRef.current = true;

              // Restaurar selección de vendedor guardada en este dispositivo
              const savedStaffId = localStorage.getItem('nexus_staff_id');
              const activeLocal = localStaff.filter(s => s.active !== false);
              const savedStaff = savedStaffId ? activeLocal.find(s => s.id === savedStaffId) : null;
              const adminStaffLocal = localStaff.find(s => s.role === 'admin') || localStaff[0];

              if (savedStaff) {
                setCurrentStaff(savedStaff);
              } else if (activeLocal.length > 1) {
                setShowStaffSelector(true);
              } else {
                setCurrentStaff(adminStaffLocal);
              }
              setLoading(false);

              // 2. LUEGO: Validar sesión y sincronizar en el fondo (no bloquea la UI)
              supabase.auth.getSession().then(({ data: { session } }) => {
                  if (!mounted) return;
                  if (session) {
                      setSession(session);
                      fetchProfileAndSync(session.user.id, true).catch(() => {});
                  } else {
                      // Sesión expirada y no renovable: cerrar sesión limpiamente
                      toast.error("Tu sesión expiró. Por favor inicia sesión de nuevo.");
                      setCurrentStaff(null);
                      setSession(null);
                      isStaffLoadedRef.current = false;
                  }
              }).catch(() => {
                  // Error de red validando: se queda en modo offline, no hace nada
              });
              return;
          }

          // 3. Sin datos locales (primer inicio): necesitamos la sesión de la red
          const { data: { session }, error } = await supabase.auth.getSession();
          if (error) throw error;
          if (!mounted) return;

          if (session) {
              setSession(session);
              isStaffLoadedRef.current = true;
              await fetchProfileAndSync(session.user.id, false);
          } else {
              setSession(null);
              setCurrentStaff(null);
              setLoading(false);
          }
      } catch (error: any) {
          if (error.name === 'AbortError' || error.message?.includes('AbortError')) return;
          console.error("Error crítico de inicialización:", error);
          setSession(null);
          setCurrentStaff(null);
          setLoading(false);
      }
    };

    initApp();

    // Escuchador de cambios (Ej: Cuando alguien inicia sesión exitosamente en LoginScreen)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (!mounted) return;
      
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);

      if (event === 'SIGNED_IN' && newSession) {
        // Ignorar eventos durante el flujo de registro
        if (isRegisteringRef.current) return;
        // Ignorar si initApp ya está manejando la carga (evita doble-fetch y loop)
        if (isStaffLoadedRef.current) return;

        setSession(newSession);
        if (!window.location.hash.includes('type=recovery')) {
            setLoading(true);
            await fetchProfileAndSync(newSession.user.id, false);
        }
      }
      else if (event === 'SIGNED_OUT') {
        isStaffLoadedRef.current = false;
        setSession(null);
        setCurrentStaff(null);
        setShowStaffSelector(false);
      }
    });

    return () => {
        mounted = false;
        subscription.unsubscribe();
    };
  }, []); // Sin dependencias: el efecto corre solo al montar. Los refs evitan race conditions.

  if (recoveryMode) {
      return <UpdatePasswordScreen onComplete={() => {
          setRecoveryMode(false);
          window.location.hash = ''; 
          window.location.replace('/'); 
      }} />;
  }

  if (loading) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-slate-50 gap-6 p-4">
         <div className="flex flex-col items-center gap-2">
            <Loader2 className="animate-spin text-[#0B3B68] w-10 h-10 mb-4" />
            <p className="text-slate-700 font-bold text-lg tracking-tight">Verificando Credenciales...</p>
            <p className="text-slate-400 text-xs mt-2">Conectando con Bisne con Talla</p>
         </div>
         {/* Botón de pánico oculto por si acaso */}
         <button onClick={handleForceLogout} className="mt-8 text-xs text-slate-400 underline hover:text-slate-600">
             Forzar reinicio
         </button>
      </div>
    );
  }

  if (!session) return (
    <LoginScreen
      onRegistrationStart={() => { isRegisteringRef.current = true; }}
      onRegistrationEnd={() => { isRegisteringRef.current = false; }}
    />
  );

  const businessId = localStorage.getItem('nexus_business_id') || '';

  // Selector obligatorio: múltiples vendedores y ninguno seleccionado aún
  if (!currentStaff && showStaffSelector) {
    return (
      <StaffSelectorModal
        businessId={businessId}
        onSelect={(staff) => {
          setCurrentStaff(staff);
          setShowStaffSelector(false);
        }}
      />
    );
  }

  if (!currentStaff) return null;

  return (
    <>
      {/* Selector opcional (cambio de vendedor desde Layout) */}
      {showStaffSelector && (
        <StaffSelectorModal
          businessId={businessId}
          onSelect={(staff) => {
            setCurrentStaff(staff);
            setShowStaffSelector(false);
          }}
          onClose={() => setShowStaffSelector(false)}
        />
      )}
      <Routes>
        <Route element={<Layout currentStaff={currentStaff} onChangeStaff={() => setShowStaffSelector(true)} />}>
          <Route path="/" element={<PosPage />} />
          <Route path="/clientes" element={<CustomersPage />} />
          <Route path="/inventario" element={<InventoryPage />} />
          <Route path="/finanzas" element={<FinancePage />} />
          <Route path="/configuracion" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </>
  );
}

// =============================================================================
// 3. ADMIN ROUTE (Protector de Panel)
// =============================================================================
function AdminRoute({ children }: { children: React.ReactNode }) {
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    const checkAdmin = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { if (mounted) setAuthorized(false); return; }

        const { data, error } = await supabase.from('profiles').select('is_super_admin').eq('id', user.id).single();
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
            <Loader2 className="animate-spin text-red-500 w-10 h-10"/>
            <p className="text-slate-400 text-sm font-bold tracking-widest uppercase">Verificando Credenciales</p>
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