import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Store, Mail, Lock, Loader2, ArrowRight, User, Phone, Shield, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

export function SuperAdminLogin() {
  const navigate = useNavigate();
  
  // Estados
  const [isRegistering, setIsRegistering] = useState(false);
  const [loading, setLoading] = useState(false);
  const [successMode, setSuccessMode] = useState(false); // Nuevo estado de éxito visual
  
  // Campos del formulario
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [businessName, setBusinessName] = useState('');

  // Verificación de sesión inicial
  useEffect(() => {
    let mounted = true;
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session && mounted) {
        const { data: profile } = await supabase
            .from('profiles')
            .select('is_super_admin')
            .eq('id', session.user.id)
            .single();

        if (profile?.is_super_admin) {
            navigate('/super-panel', { replace: true });
        }
      }
    };
    checkSession();
    return () => { mounted = false; };
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
        if (isRegistering) {
            // REGISTRO
            const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
            if (authError) throw authError;
            if (!authData.user) throw new Error("No se pudo crear el usuario");

            // Crear RPC para registro atómico (o llamada directa si prefieres como estaba)
            // Aquí mantengo tu lógica original de inserción directa que funciona bien
            const { data: businessData, error: businessError } = await supabase
                .from('businesses')
                .insert({ name: businessName, status: 'active', phone: phone })
                .select().single();

            if (businessError) throw businessError;

            const { error: profileError } = await supabase
                .from('profiles')
                .insert({
                    id: authData.user.id,
                    business_id: businessData.id,
                    full_name: fullName,
                    role: 'admin',
                    status: 'active',
                    email: email,
                    is_super_admin: false
                });

            if (profileError) throw profileError;

            // ✅ ÉXITO VISUAL (En lugar de alert)
            setSuccessMode(true);
            toast.success("Cuenta creada correctamente");

        } else {
            // LOGIN
            const { data: { user }, error: authError } = await supabase.auth.signInWithPassword({ email, password });
            if (authError) throw authError;
            if (!user) throw new Error("Credenciales inválidas");

            const { data: profile, error: profileError } = await supabase
                .from('profiles')
                .select('is_super_admin')
                .eq('id', user.id)
                .single();

            if (profileError) {
                await supabase.auth.signOut();
                throw new Error("Error verificando permisos.");
            }

            if (!profile?.is_super_admin) {
                await supabase.auth.signOut();
                throw new Error("⛔ ACCESO DENEGADO: Cuenta no autorizada.");
            }

            toast.success("Bienvenido al Panel Maestro");
            navigate('/super-panel', { replace: true });
        }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
        console.error(error);
        toast.error(error.message || "Ocurrió un error inesperado.");
        if (!isRegistering) await supabase.auth.signOut();
    } finally {
        setLoading(false);
    }
  };

  // --- VISTA DE ÉXITO (POST-REGISTRO) ---
  if (successMode) {
      return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
            <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-md text-center animate-in zoom-in duration-300">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                    <CheckCircle2 className="w-10 h-10 text-green-600" />
                </div>
                <h2 className="text-2xl font-black text-slate-800 mb-2">¡Solicitud Enviada!</h2>
                <p className="text-slate-500 mb-8 leading-relaxed">
                    Tu cuenta para <strong>{businessName}</strong> ha sido creada. 
                    <br/><br/>
                    Por favor, contacta al administrador para que active tu licencia y te proporcione tu <strong>PIN Maestro</strong>.
                </p>
                <button 
                    onClick={() => window.location.href = '/'} // Recarga limpia
                    className="w-full bg-slate-900 text-white font-bold py-3 rounded-xl hover:bg-black transition-colors"
                >
                    Volver al Inicio
                </button>
            </div>
        </div>
      );
  }

  // --- VISTA FORMULARIO ---
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl w-full max-w-md border border-slate-700 animate-in fade-in duration-300">
        
        <div className="flex flex-col items-center mb-8">
          <div className="bg-indigo-600 p-4 rounded-full mb-4 shadow-lg shadow-indigo-500/20">
            {isRegistering ? <Store className="w-8 h-8 text-white" /> : <Shield className="w-8 h-8 text-white" />}
          </div>
          <h1 className="text-2xl font-bold text-white">
            {isRegistering ? 'Crear Negocio' : 'Acceso Super Admin'}
          </h1>
          <p className="text-slate-400 text-sm mt-2 text-center">
            {isRegistering 
              ? 'Registra tu empresa para empezar a vender' 
              : 'Gestión de licencias y clientes'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          
          {isRegistering && (
            <div className="space-y-4 animate-in slide-in-from-bottom-2 duration-300">
              <div className="grid grid-cols-2 gap-4">
                  <div className="relative">
                    <User className="absolute left-3 top-3 text-slate-500 w-5 h-5" />
                    <input type="text" required className="w-full pl-10 pr-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white focus:border-indigo-500 outline-none text-sm placeholder:text-slate-600" placeholder="Nombre" value={fullName} onChange={e => setFullName(e.target.value)} />
                  </div>
                  <div className="relative">
                    <Phone className="absolute left-3 top-3 text-slate-500 w-5 h-5" />
                    <input type="tel" required className="w-full pl-10 pr-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white focus:border-indigo-500 outline-none text-sm placeholder:text-slate-600" placeholder="Teléfono" value={phone} onChange={e => setPhone(e.target.value)} />
                  </div>
              </div>
              <div className="relative">
                  <Store className="absolute left-3 top-3 text-slate-500 w-5 h-5" />
                  <input type="text" required className="w-full pl-10 pr-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white focus:border-indigo-500 outline-none text-sm placeholder:text-slate-600" placeholder="Nombre del Negocio" value={businessName} onChange={e => setBusinessName(e.target.value)} />
              </div>
            </div>
          )}

          <div className="relative">
            <Mail className="absolute left-3 top-3 text-slate-500 w-5 h-5" />
            <input type="email" required className="w-full pl-10 pr-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white focus:border-indigo-500 outline-none text-sm placeholder:text-slate-600" placeholder="correo@ejemplo.com" value={email} onChange={e => setEmail(e.target.value)} />
          </div>

          <div className="relative">
            <Lock className="absolute left-3 top-3 text-slate-500 w-5 h-5" />
            <input type="password" required className="w-full pl-10 pr-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white focus:border-indigo-500 outline-none text-sm placeholder:text-slate-600" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3.5 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-900/20 disabled:opacity-50 mt-6"
          >
            {loading ? <Loader2 className="animate-spin" /> : (isRegistering ? "Enviar Solicitud" : "Entrar al Panel")}
            {!loading && <ArrowRight size={20} />}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-slate-700 text-center">
            <button
              onClick={() => { setIsRegistering(!isRegistering); setEmail(''); setPassword(''); }}
              className="text-indigo-400 hover:text-indigo-300 text-sm font-semibold transition-colors"
              disabled={loading}
            >
              {isRegistering ? '¿Ya tienes cuenta? Inicia sesión' : '¿Nuevo cliente? Registra tu negocio'}
            </button>
        </div>
      </div>
    </div>
  );
}