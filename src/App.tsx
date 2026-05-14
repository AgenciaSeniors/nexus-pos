import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { HashRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { type Staff, db } from './lib/db';
import { type Session } from '@supabase/supabase-js';
import { Toaster, toast } from 'sonner';
import { syncCriticalData, syncHeavyData, stopSyncListeners } from './lib/sync';
import { startAutoBackup, stopAutoBackup } from './lib/backup';

import { ADMIN_WHATSAPP_PHONE } from './lib/config';
import { checkLockout, recordFailure, recordSuccess, formatLockoutTime, RATE_LIMIT_CONFIG, registerRateLimit } from './lib/loginRateLimit';
import { Layout } from './components/Layout';
import { StaffSelectorModal } from './components/StaffSelectorModal';

// Code splitting: páginas cargadas bajo demanda
const PosPage = lazy(() => import('./pages/PosPage').then(m => ({ default: m.PosPage })));
const InventoryPage = lazy(() => import('./pages/InventoryPage').then(m => ({ default: m.InventoryPage })));
const FinancePage = lazy(() => import('./pages/FinancePage').then(m => ({ default: m.FinancePage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const SuperAdminPage = lazy(() => import('./pages/SuperAdminPage').then(m => ({ default: m.SuperAdminPage })));
const SuperAdminLogin = lazy(() => import('./pages/SuperAdminLogin').then(m => ({ default: m.SuperAdminLogin })));
const CustomersPage = lazy(() => import('./components/CustomersPage').then(m => ({ default: m.CustomersPage })));

import { Loader2, Store, User, Lock, Mail, Phone, ArrowRight, CheckCircle, Shield, Eye, EyeOff } from 'lucide-react';

// =============================================================================
// 0. PANTALLA DE ACTUALIZAR CONTRASEÑA (Modo Recuperación)
// =============================================================================
function UpdatePasswordScreen({ onComplete }: { onComplete: () => void }) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return toast.error("La contraseña debe tener al menos 8 caracteres");
    
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
  onEnterApp: (userId: string) => void;
}

function LoginScreen({ onRegistrationStart, onRegistrationEnd, onEnterApp }: LoginScreenProps) {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);

  // Estado de rate limit (se actualiza al cambiar el email para mostrar al usuario)
  const [lockoutStatus, setLockoutStatus] = useState(() => checkLockout(''));

  // Re-evaluar el estado de bloqueo cada vez que el email cambia
  useEffect(() => {
    if (mode !== 'login') return;
    setLockoutStatus(checkLockout(email));
    // Si está bloqueado, actualizar cada segundo para mostrar el countdown
    if (!email.trim()) return;
    const status = checkLockout(email);
    if (!status.isLocked) return;
    const interval = setInterval(() => {
      const next = checkLockout(email);
      setLockoutStatus(next);
      if (!next.isLocked) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [email, mode]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    // Verificar rate limit ANTES de hacer la llamada
    const preCheck = checkLockout(email);
    if (preCheck.isLocked) {
      toast.error(`Demasiados intentos. Espera ${formatLockoutTime(preCheck.secondsLeft)} antes de intentar de nuevo.`);
      setLockoutStatus(preCheck);
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // Éxito → limpiar el contador de intentos para este email
      recordSuccess(email);
      setLockoutStatus({ isLocked: false, secondsLeft: 0, attemptsLeft: RATE_LIMIT_CONFIG.MAX_ATTEMPTS });
    } catch (error: any) {
      const isCredentialError = error.message === 'Invalid login credentials';
      // Solo penalizar errores de credenciales — no por red u otros fallos.
      if (isCredentialError) {
        const status = recordFailure(email);
        setLockoutStatus(status);
        if (status.isLocked) {
          toast.error(`Demasiados intentos fallidos. Cuenta bloqueada ${formatLockoutTime(status.secondsLeft)}.`);
        } else if (status.attemptsLeft <= 2) {
          toast.error(`Credenciales incorrectas. Te quedan ${status.attemptsLeft} intento(s) antes de bloquearse.`);
        } else {
          toast.error('Credenciales incorrectas');
        }
      } else {
        toast.error(error.message);
      }
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) return toast.error('El teléfono es obligatorio');

    // Rate limit: 3 intentos de registro / 30 min por email
    const regCheck = registerRateLimit.check(email);
    if (regCheck.isLocked) {
      toast.error(`Demasiados intentos de registro. Espera ${formatLockoutTime(regCheck.secondsLeft)}.`);
      return;
    }

    setLoading(true);
    onRegistrationStart();
    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
      if (authError) throw authError;
      if (!authData.user) throw new Error("No se pudo crear la cuenta. Intenta nuevamente.");

      if (!authData.session) {
        // Supabase requiere confirmación de correo (configuración del proyecto)
        toast.info("Confirma tu correo electrónico y luego inicia sesión.");
        setMode('login');
        onRegistrationEnd();
        setLoading(false);
        return;
      }

      // Crear negocio + perfil en Supabase con trial automático de 7 días
      const { error: rpcError } = await supabase.rpc('register_business', {
        p_owner_name:    fullName.trim(),
        p_business_name: businessName.trim(),
        p_phone:         phone.trim(),
      });
      if (rpcError) throw rpcError;

      toast.success('¡Bienvenido a Bisne con Talla! Tienes 7 días de prueba gratuita.', { duration: 6000 });

      // Marcar que es un registro nuevo para que Layout muestre la guía rápida
      sessionStorage.setItem('nexus_new_registration', '1');

      // Éxito: limpiar contador de intentos de registro para este email
      registerRateLimit.recordSuccess(email);

      // Entrar a la app directamente sin aprobación manual
      onRegistrationEnd();
      onEnterApp(authData.user.id);

    } catch (error: any) {
      console.error(error);
      await supabase.auth.signOut();
      // Penalizar errores reales (no de red): credenciales inválidas, email duplicado, etc.
      const msg = String(error.message || '');
      const isNetworkError = msg.includes('Failed to fetch') || msg.includes('NetworkError');
      if (!isNetworkError) {
        const status = registerRateLimit.recordFailure(email);
        if (status.isLocked) {
          toast.error(`Demasiados intentos. Registro bloqueado ${formatLockoutTime(status.secondsLeft)}.`);
        } else if (status.attemptsLeft <= 1) {
          toast.error(`${error.message} — te queda ${status.attemptsLeft} intento.`);
        } else {
          toast.error(error.message || "Error al crear la cuenta.");
        }
      } else {
        toast.error(error.message || "Error al crear la cuenta.");
      }
      onRegistrationEnd();
      setLoading(false);
    }
  };

  const handleForgotPassword = (e: React.FormEvent) => {
      e.preventDefault();
      if (!email) return toast.error("Por favor, ingresa tu correo electrónico");
      const msg = `Hola, olvidé mi contraseña de Bisne con Talla.\nMi correo es: ${email}\nNecesito que me la restablezcan. Gracias.`;
      window.open(`https://wa.me/${ADMIN_WHATSAPP_PHONE}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  // ✅ MENSAJE DINÁMICO DE WHATSAPP
  const defaultWhatsAppMessage = mode === 'register' 
        ? "Hola administrador, acabo de registrar mi negocio en Bisne con Talla y necesito que aprueben mi cuenta."
        : "Hola soporte de Bisne con Talla, necesito ayuda para acceder a mi cuenta.";
  const whatsappUrl = `https://wa.me/${ADMIN_WHATSAPP_PHONE}?text=${encodeURIComponent(defaultWhatsAppMessage)}`;

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
                      <input type="tel" required className="w-full pl-10 pr-4 py-3 bg-[#F3F4F6] border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] focus:bg-white outline-none transition-all font-medium text-[#1F2937]" placeholder="+53 5555 5555" value={phone} onChange={e => setPhone(e.target.value)} />
                    </div>
                  </div>
                  <div className="bg-[#7AC142]/10 border border-[#7AC142]/30 rounded-xl px-4 py-3 flex items-center gap-3">
                    <span className="text-2xl">🎁</span>
                    <div>
                      <p className="text-sm font-black text-[#0B3B68]">7 días de prueba gratuita</p>
                      <p className="text-xs text-[#6B7280]">Sin costo. Sin tarjeta. Cancela cuando quieras.</p>
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

              {/* Aviso de rate limit (solo en modo login) */}
              {mode === 'login' && lockoutStatus.isLocked && (
                <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-xl text-center">
                  <p className="text-xs font-bold text-red-700">
                    Cuenta bloqueada temporalmente
                  </p>
                  <p className="text-[11px] text-red-600 mt-0.5">
                    Demasiados intentos fallidos. Vuelve a intentar en {formatLockoutTime(lockoutStatus.secondsLeft)}.
                  </p>
                </div>
              )}

              <button disabled={loading || (mode === 'login' && lockoutStatus.isLocked)} type="submit" className="w-full bg-[#0B3B68] text-white font-bold py-3.5 rounded-xl hover:bg-[#092b4d] transition-all flex items-center justify-center gap-2 mt-6 shadow-xl shadow-[#0B3B68]/20 disabled:opacity-70 disabled:cursor-not-allowed active:scale-95 text-lg">
                {loading && <Loader2 className="animate-spin w-5 h-5" />}
                {mode === 'login' && lockoutStatus.isLocked
                  ? `Bloqueado · ${formatLockoutTime(lockoutStatus.secondsLeft)}`
                  : mode === 'login' ? 'Entrar al Sistema' : mode === 'forgot' ? 'Contactar por WhatsApp' : 'Registrar Negocio'}
                {!loading && mode !== 'forgot' && !(mode === 'login' && lockoutStatus.isLocked) && <ArrowRight className="w-5 h-5" />}
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
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [currentStaff, setCurrentStaff] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(true);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [showStaffSelector, setShowStaffSelector] = useState(false);
  // Bandera para evitar que onAuthStateChange procese SIGNED_IN durante el registro
  const isRegisteringRef = useRef(false);
  // Bandera para saber si el staff ya fue cargado (evita doble-carga y loop de efectos)
  const isStaffLoadedRef = useRef(false);
  // Bandera: hay datos locales en IndexedDB (permite modo offline si la sesión expira)
  const hasLocalDataRef = useRef(false);
  // Bandera: el logout fue solicitado explícitamente por el usuario o por el sistema
  // (NO por expiración de token). Evita sacar al usuario cuando el token expira offline.
  const intentionalLogoutRef = useRef(false);

  // BOTÓN DE PÁNICO: Destruye todo rastro de caché corrupta
  // No es async: redirige inmediatamente para evitar que el timer de sync
  // dispare sobre la DB eliminada (DatabaseClosedError).
  const handleForceLogout = () => {
      try {
          intentionalLogoutRef.current = true; // Marcar como logout intencional
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
          intentionalLogoutRef.current = true;
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
          pin: existingAdmin?.pin || '',
          active: true,
          business_id: data.business_id
        };

        // Poner admin en DB local
        await db.staff.put(adminStaff);

        isStaffLoadedRef.current = true;
        if (!isBackgroundSync) setLoading(false);

        if (!isBackgroundSync) {
          // Decidir qué mostrar ANTES del sync para respuesta inmediata de la UI.
          // syncCriticalData ya no sobreescribe el registro del admin (ver sync.ts),
          // y los vendedores que llegan del sync aparecen reactivamente en el selector
          // gracias a useLiveQuery.
          const savedStaffId = localStorage.getItem('nexus_staff_id');
          const allActive = await db.staff
            .where('business_id').equals(data.business_id)
            .filter(s => s.active !== false)
            .toArray();
          const savedStaff = savedStaffId ? allActive.find(s => s.id === savedStaffId) : null;

          if (savedStaff) {
            setCurrentStaff(savedStaff);
          } else if (allActive.length > 1) {
            setShowStaffSelector(true); // Admin + vendedores → seleccionar
          } else {
            setCurrentStaff(adminStaff); // Solo admin → entrar directo
          }
        }

        // Sync en segundo plano — no afecta al registro del admin (filtrado en sync.ts)
        await syncCriticalData(data.business_id);

        // Deduplicar: eliminar cualquier otro registro admin con UUID distinto
        const duplicateAdmins = await db.staff
          .where('business_id').equals(data.business_id)
          .filter(s => s.role === 'admin' && s.id !== data.id)
          .toArray();
        if (duplicateAdmins.length > 0) {
          await db.staff.bulkDelete(duplicateAdmins.map(s => s.id));
        }

        try {
          const result = await syncHeavyData(data.business_id);
          if (!isBackgroundSync && (result.products > 0 || result.customers > 0)) {
            toast.success(`Sincronizado: ${result.products} productos, ${result.customers} clientes`, { duration: 3000 });
          }
        } catch (syncErr) {
          console.warn("Error en syncHeavyData:", syncErr);
          if (!isBackgroundSync) {
            toast.warning("No se pudo descargar todo el inventario. Sincroniza manualmente desde Ajustes.", { duration: 5000 });
          }
        }
      }
    } catch (error: any) {
      console.error("Error obteniendo perfil:", error);
      
      // Si el perfil no se encuentra (PGRST116), es usuario recién creado sin perfil aún
      if (error?.code === 'PGRST116') {
          if (!isBackgroundSync) {
            setLoading(false);
            toast.error("El perfil de tu cuenta aún no está configurado. Contacta al administrador.");
          }
          intentionalLogoutRef.current = true;
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
              hasLocalDataRef.current = true; // Marcar para proteger contra SIGNED_OUT offline

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
                      // Sesión expirada — pero tenemos datos locales, no sacar al usuario.
                      // Puede seguir trabajando offline; al reconectarse Supabase renovará el token.
                      console.log('Sesión expirada con datos locales — manteniendo modo offline');
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

    // Backup automático cada 15 minutos (protección contra apagones)
    startAutoBackup();

    // Android: registrar handler del botón Back hardware + lifecycle pause/resume.
    // Sin esto, el back nativo cierra la app inmediatamente desde cualquier pantalla
    // (pierde ventas en curso, parked orders, modales). En web/desktop es no-op.
    import('./lib/androidBackHandler').then(({ registerBackHandler }) => {
      registerBackHandler(
        (to) => navigate(to),
        () => {
          // Al volver del background, intentar sincronizar (puede haber estado
          // varios minutos pausado y los datos remotos podrían haber cambiado)
          import('./lib/sync').then(({ processQueue, syncLiveData }) => {
            processQueue().catch(() => {});
            syncLiveData().catch(() => {});
          });
        },
      ).catch(() => {});
    });

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
      else if (event === 'TOKEN_REFRESHED' && newSession) {
        // Token renovado exitosamente — actualizar sesión en estado
        setSession(newSession);
        // Reintentar items que fallaron por 401 mientras el token estaba expirado.
        // Sin esto, los items quedan en `failed` hasta sync manual aunque la
        // conexión vuelva (degrada la confianza del usuario en el offline-first).
        import('./lib/sync').then(({ retryFailedItems }) =>
          retryFailedItems().catch(err => console.warn('Retry post-refresh falló:', err))
        );
      }
      else if (event === 'SIGNED_OUT') {
        const wasIntentional = intentionalLogoutRef.current;
        intentionalLogoutRef.current = false; // Reset siempre
        isStaffLoadedRef.current = false;
        setSession(null);

        if (!wasIntentional && hasLocalDataRef.current) {
          // El token expiró (no fue logout del usuario).
          // Mantenemos al usuario en la app: sus datos están en IndexedDB y puede seguir
          // trabajando. El sync fallará hasta que reconecte y Supabase renueve el token.
          toast.warning("Tu sesión expiró, pero tus datos están seguros. Reconecta cuando puedas.", {
            duration: 8000
          });
          // NO limpiar currentStaff ni showStaffSelector → usuario permanece en la app
          return;
        }

        // Logout real o sin datos locales → ir al login
        setCurrentStaff(null);
        setShowStaffSelector(false);
      }
    });

    return () => {
        mounted = false;
        subscription.unsubscribe();
        stopAutoBackup();
        stopSyncListeners();
        // Desregistrar el handler de back/lifecycle de Android
        import('./lib/androidBackHandler').then(({ unregisterBackHandler }) => {
          unregisterBackHandler();
        }).catch(() => {});
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

  // Si no hay sesión activa PERO hay un staff cargado (token expiró offline),
  // mantener al usuario en la app. Los datos están en IndexedDB. Al reconectarse,
  // TOKEN_REFRESHED actualizará la sesión automáticamente.
  if (!session && !currentStaff) return (
    <LoginScreen
      onRegistrationStart={() => { isRegisteringRef.current = true; }}
      onRegistrationEnd={() => { isRegisteringRef.current = false; }}
      onEnterApp={async (userId: string) => {
        // Llamado justo después de que el registro con trial está completo.
        // isRegisteringRef ya es false, la sesión sigue activa → cargar perfil.
        isStaffLoadedRef.current = false;
        setLoading(true);
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (currentSession) {
          setSession(currentSession);
          await fetchProfileAndSync(userId, false);
        }
      }}
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
      <Suspense fallback={<div className="flex items-center justify-center h-screen"><Loader2 className="animate-spin text-[#0B3B68]" size={32} /></div>}>
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
      </Suspense>
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
        <Suspense fallback={<div className="flex items-center justify-center h-screen"><Loader2 className="animate-spin text-[#0B3B68]" size={32} /></div>}>
          <Routes>
            <Route path="/admin-login" element={<SuperAdminLogin />} />
            <Route path="/super-panel" element={<AdminRoute><SuperAdminPage /></AdminRoute>} />
            <Route path="/*" element={<BusinessApp />} />
          </Routes>
        </Suspense>
      </HashRouter>
    </>
  );
}