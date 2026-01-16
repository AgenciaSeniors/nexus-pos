import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Store, Mail, Lock, Loader2, ArrowRight, User, Phone, Shield, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

export function SuperAdminLogin() {
  const navigate = useNavigate();
  
  // --- ESTADOS (Toda tu lógica original) ---
  const [isRegistering, setIsRegistering] = useState(false);
  const [loading, setLoading] = useState(false);
  
  // Campos del formulario
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [businessName, setBusinessName] = useState('');

  // --- EFECTO DE SESIÓN (CORREGIDO) ---
  // Antes te mandaba a '/' y eso causaba conflictos. 
  // Ahora verifica si ya eres SuperAdmin para mandarte al panel, o no hace nada.
  useEffect(() => {
    let mounted = true;

    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session && mounted) {
        // Verificar si es super admin antes de redirigir
        const { data: profile } = await supabase
            .from('profiles')
            .select('is_super_admin')
            .eq('id', session.user.id)
            .single();

        if (profile?.is_super_admin) {
            navigate('/super-panel', { replace: true });
        }
        // Si no es super admin, nos quedamos aquí para que pueda cerrar sesión o cambiar de cuenta
      }
    };

    checkSession();

    return () => { mounted = false; };
  }, [navigate]);

  // --- MANEJADOR PRINCIPAL (Login + Registro) ---
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
        if (isRegistering) {
            // ============================================================
            // LOGICA VIEJA: REGISTRO DE NUEVO NEGOCIO
            // ============================================================
            
            // 1. Crear usuario en Auth
            const { data: authData, error: authError } = await supabase.auth.signUp({
                email,
                password,
            });
            if (authError) throw authError;
            if (!authData.user) throw new Error("No se pudo crear el usuario");

            // 2. Crear Negocio
            const { data: businessData, error: businessError } = await supabase
                .from('businesses')
                .insert({
                    name: businessName,
                    status: 'active', // O 'pending' si prefieres aprobación manual
                    phone: phone
                })
                .select()
                .single();

            if (businessError) throw businessError;

            // 3. Crear Perfil (Nota: NO lo hacemos super_admin por defecto por seguridad)
            const { error: profileError } = await supabase
                .from('profiles')
                .insert({
                    id: authData.user.id,
                    business_id: businessData.id,
                    full_name: fullName,
                    role: 'admin', // Admin de su negocio, no SuperAdmin del sistema
                    status: 'active',
                    email: email,
                    is_super_admin: false // Explícito
                });

            if (profileError) throw profileError;

            toast.success("Solicitud enviada. Espera aprobación o inicia sesión.");
            setIsRegistering(false); // Volver al login

        } else {
            // ============================================================
            // LOGICA NUEVA: LOGIN DE SUPER ADMIN (BLINDADO)
            // ============================================================

            // 1. Iniciar sesión (Verificar credenciales)
            const { data: { user }, error: authError } = await supabase.auth.signInWithPassword({
                email,
                password
            });

            if (authError) throw authError;
            if (!user) throw new Error("Credenciales inválidas");

            // 2. VERIFICACIÓN DE SEGURIDAD (La parte "Opción 2")
            // Consultamos si realmente tiene el flag de super admin
            const { data: profile, error: profileError } = await supabase
                .from('profiles')
                .select('is_super_admin')
                .eq('id', user.id)
                .single();

            if (profileError) {
                await supabase.auth.signOut();
                throw new Error("Error verificando permisos. Contacte a soporte.");
            }

            if (!profile?.is_super_admin) {
                // Si entra pero NO es super admin, lo sacamos inmediatamente
                await supabase.auth.signOut();
                throw new Error("⛔ ACCESO DENEGADO: Esta cuenta no es Super Admin.");
            }

            // 3. Éxito: Redirigir al panel
            toast.success("Bienvenido, Super Admin.");
            navigate('/super-panel', { replace: true });
        }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
        console.error(error);
        toast.error(error.message || "Ocurrió un error inesperado.");
        // Si falló el login, asegurarnos de limpiar cualquier sesión parcial
        if (!isRegistering) {
             await supabase.auth.signOut();
        }
    } finally {
        setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl w-full max-w-md border border-slate-700">
        
        {/* Encabezado */}
        <div className="flex flex-col items-center mb-8">
          <div className="bg-indigo-600 p-4 rounded-full mb-4 shadow-lg shadow-indigo-500/20">
            {isRegistering ? <Store className="w-8 h-8 text-white" /> : <Shield className="w-8 h-8 text-white" />}
          </div>
          <h1 className="text-2xl font-bold text-white">
            {isRegistering ? 'Registrar Negocio' : 'Acceso Super Admin'}
          </h1>
          <p className="text-slate-400 text-sm mt-2 text-center">
            {isRegistering 
              ? 'Crea una cuenta para gestionar tu punto de venta' 
              : 'Panel de control maestro y gestión de licencias'}
          </p>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="space-y-4">
          
          {/* Campos Extra de Registro */}
          {isRegistering && (
            <>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Nombre Completo</label>
                <div className="relative">
                  <User className="absolute left-3 top-3 text-slate-500 w-5 h-5" />
                  <input 
                    type="text" 
                    required={isRegistering}
                    className="w-full pl-10 pr-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all placeholder:text-slate-600"
                    placeholder="Tu Nombre"
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Nombre del Negocio</label>
                <div className="relative">
                  <Store className="absolute left-3 top-3 text-slate-500 w-5 h-5" />
                  <input 
                    type="text" 
                    required={isRegistering}
                    className="w-full pl-10 pr-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all placeholder:text-slate-600"
                    placeholder="Mi Tienda"
                    value={businessName}
                    onChange={e => setBusinessName(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Teléfono</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-3 text-slate-500 w-5 h-5" />
                  <input 
                    type="tel" 
                    required={isRegistering}
                    className="w-full pl-10 pr-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all placeholder:text-slate-600"
                    placeholder="+53 5555 5555"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                  />
                </div>
              </div>
            </>
          )}

          {/* Campos Comunes (Email/Pass) */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Correo Electrónico</label>
            <div className="relative">
              <Mail className="absolute left-3 top-3 text-slate-500 w-5 h-5" />
              <input 
                type="email" 
                required
                className="w-full pl-10 pr-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all placeholder:text-slate-600"
                placeholder="correo@ejemplo.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Contraseña</label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 text-slate-500 w-5 h-5" />
              <input 
                type="password" 
                required
                className="w-full pl-10 pr-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all placeholder:text-slate-600"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3.5 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-900/20 disabled:opacity-50 disabled:cursor-not-allowed mt-6"
          >
            {loading ? <Loader2 className="animate-spin" /> : (isRegistering ? "Solicitar Acceso" : "Entrar al Panel")}
            {!loading && <ArrowRight size={20} />}
          </button>
        </form>

        {/* Footer / Toggle */}
        <div className="mt-8 pt-6 border-t border-slate-700 text-center space-y-4">
            <button
              onClick={() => {
                  setIsRegistering(!isRegistering);
                  // Limpiar errores o estados si es necesario
              }}
              className="text-indigo-400 hover:text-indigo-300 text-sm font-semibold transition-colors"
              disabled={loading}
            >
              {isRegistering
                ? '¿Ya tienes cuenta? Inicia sesión como Admin'
                : '¿No tienes cuenta? Registra tu negocio aquí'}
            </button>

            {!isRegistering && (
                <p className="text-xs text-slate-500 flex items-center justify-center gap-2">
                    <AlertTriangle size={12} /> Acceso restringido a personal autorizado.
                </p>
            )}
        </div>
      </div>
    </div>
  );
}