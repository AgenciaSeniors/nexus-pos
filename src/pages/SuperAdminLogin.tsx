import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Store, Mail, Lock, Loader2, ArrowRight, User, Phone, Shield, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

export function SuperAdminLogin() {
  const navigate = useNavigate();
  
  // Estados
  const [isRegistering, setIsRegistering] = useState(false);
  const [loading, setLoading] = useState(false);
  const [successMode, setSuccessMode] = useState(false);
  
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
        // Verificamos si es super admin antes de redirigir
        const { data: profile } = await supabase
            .from('profiles')
            .select('is_super_admin')
            .eq('id', session.user.id)
            .single();

        if (profile?.is_super_admin) {
            navigate('/super-panel', { replace: true });
        } else {
            // Si existe sesión pero no es super admin, redirigir al POS normal
            navigate('/', { replace: true });
        }
      }
    };
    checkSession();
    return () => { mounted = false; };
  }, [navigate]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isRegistering) {
        // 1. Registro (Sign Up)
        const { data: authData, error: authError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
              phone: phone,
            }
          }
        });

        if (authError) throw authError;
        if (!authData.user) throw new Error("No se pudo crear el usuario");

        // Simulación de éxito para UX
        setSuccessMode(true);
        toast.success("Cuenta creada exitosamente");

      } else {
        // Login Normal
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;

        // Verificar rol
        if (data.user) {
            // CORRECCIÓN 1: Eliminamos 'profileError' de la destructuración porque no se usaba
            const { data: profile } = await supabase
                .from('profiles')
                .select('is_super_admin')
                .eq('id', data.user.id)
                .single();
            
            if (profile?.is_super_admin) {
                toast.success(`Bienvenido, Socio Experto`);
                navigate('/super-panel');
            } else {
                toast.success(`Sesión iniciada`);
                navigate('/');
            }
        }
      }
    } catch (error) {
      // CORRECCIÓN 2: Quitamos ': any' y manejamos el tipo de error de forma segura
      console.error(error);
      const errorMessage = error instanceof Error ? error.message : "Error en la autenticación";
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // --- RENDERIZADO VISUAL (IDENTIDAD BISNE CON TALLA) ---
  return (
    <div className="min-h-screen bg-bisne-navy flex flex-col items-center justify-center p-4 relative overflow-hidden">
      
      {/* Elementos de fondo decorativos */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none opacity-10">
          <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-talla-growth rounded-full blur-[120px]"></div>
          <div className="absolute top-[60%] -right-[10%] w-[40%] h-[60%] bg-blue-400 rounded-full blur-[100px]"></div>
      </div>

      <div className="w-full max-w-md z-10">
        
        {/* Header de Marca */}
        <div className="text-center mb-8 animate-in slide-in-from-top-5 duration-700">
          <div className="inline-flex items-center justify-center p-3 bg-white/10 rounded-2xl mb-4 backdrop-blur-sm shadow-lg border border-white/10">
            <Store className="w-8 h-8 text-talla-growth" />
          </div>
          <h1 className="text-4xl md:text-5xl font-heading font-extrabold text-white tracking-tight">
            Bisne<span className="text-talla-growth">ConTalla</span>
          </h1>
          <p className="text-gray-300 mt-2 font-body font-medium">
            {isRegistering ? "Comienza a crecer hoy mismo" : "Tu Socio Experto en Gestión"}
          </p>
        </div>

        {/* Tarjeta Principal */}
        <div className="bg-surface rounded-2xl shadow-2xl p-6 md:p-8 border border-white/20 backdrop-blur-sm animate-in fade-in zoom-in-95 duration-500">
          
          {successMode ? (
             // --- ESTADO DE ÉXITO ---
             <div className="text-center py-8">
                <div className="w-20 h-20 bg-talla-growth/20 rounded-full flex items-center justify-center mx-auto mb-4 animate-bounce">
                    <CheckCircle2 className="w-10 h-10 text-talla-growth" />
                </div>
                <h2 className="text-2xl font-heading font-bold text-bisne-navy mb-2">¡Cuenta Creada!</h2>
                <p className="text-text-secondary mb-6 font-body">
                    Tu registro ha sido exitoso. Por favor revisa tu correo para verificar tu cuenta o inicia sesión.
                </p>
                <button 
                    onClick={() => { setSuccessMode(false); setIsRegistering(false); }}
                    className="btn-primary w-full justify-center"
                >
                    Ir al Inicio de Sesión
                </button>
             </div>
          ) : (
            // --- FORMULARIO ---
            <>
                <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100">
                    <div className={`p-2 rounded-lg ${isRegistering ? 'bg-talla-growth/10' : 'bg-bisne-navy/10'}`}>
                        {isRegistering ? <User className="w-6 h-6 text-talla-growth"/> : <Lock className="w-6 h-6 text-bisne-navy"/>}
                    </div>
                    <div>
                        <h2 className="text-xl font-heading font-bold text-bisne-navy">
                            {isRegistering ? "Crear Cuenta Nueva" : "Acceso al Sistema"}
                        </h2>
                        <p className="text-xs text-text-secondary font-body">
                            {isRegistering ? "Completa tus datos" : "Ingresa tus credenciales"}
                        </p>
                    </div>
                </div>

                <form onSubmit={handleAuth} className="space-y-4">
                    
                    {/* Campos extra para Registro */}
                    {isRegistering && (
                        <div className="space-y-4 animate-in slide-in-from-left-4 duration-300">
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-bisne-navy uppercase tracking-wider ml-1">Nombre Completo</label>
                                <div className="relative group">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5 group-focus-within:text-talla-growth transition-colors" />
                                    <input 
                                        type="text" 
                                        required 
                                        className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-text-main focus:ring-2 focus:ring-talla-growth focus:border-transparent outline-none transition-all font-body placeholder:text-gray-400" 
                                        placeholder="Ej. Juan Pérez" 
                                        value={fullName} 
                                        onChange={e => setFullName(e.target.value)} 
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-bisne-navy uppercase tracking-wider ml-1">Teléfono</label>
                                    <div className="relative group">
                                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5 group-focus-within:text-talla-growth transition-colors" />
                                        <input 
                                            type="tel" 
                                            required 
                                            className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-text-main focus:ring-2 focus:ring-talla-growth focus:border-transparent outline-none transition-all font-body placeholder:text-gray-400" 
                                            placeholder="53 55555555" 
                                            value={phone} 
                                            onChange={e => setPhone(e.target.value)} 
                                        />
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-bisne-navy uppercase tracking-wider ml-1">Negocio</label>
                                    <div className="relative group">
                                        <Store className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5 group-focus-within:text-talla-growth transition-colors" />
                                        <input 
                                            type="text" 
                                            required 
                                            className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-text-main focus:ring-2 focus:ring-talla-growth focus:border-transparent outline-none transition-all font-body placeholder:text-gray-400" 
                                            placeholder="Ej. Cafetería" 
                                            value={businessName} 
                                            onChange={e => setBusinessName(e.target.value)} 
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Campos Comunes: Email y Password */}
                    <div className="space-y-1">
                        <label className="text-xs font-bold text-bisne-navy uppercase tracking-wider ml-1">Correo Electrónico</label>
                        <div className="relative group">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5 group-focus-within:text-bisne-navy transition-colors" />
                            <input 
                                type="email" 
                                required 
                                className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-text-main focus:ring-2 focus:ring-bisne-navy focus:border-transparent outline-none transition-all font-body placeholder:text-gray-400" 
                                placeholder="usuario@bisne.com" 
                                value={email} 
                                onChange={e => setEmail(e.target.value)} 
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs font-bold text-bisne-navy uppercase tracking-wider ml-1">Contraseña</label>
                        <div className="relative group">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5 group-focus-within:text-bisne-navy transition-colors" />
                            <input 
                                type="password" 
                                required 
                                className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-text-main focus:ring-2 focus:ring-bisne-navy focus:border-transparent outline-none transition-all font-body placeholder:text-gray-400" 
                                placeholder="••••••••" 
                                value={password} 
                                onChange={e => setPassword(e.target.value)} 
                            />
                        </div>
                    </div>

                    <button 
                        type="submit" 
                        disabled={loading}
                        className={`w-full font-heading font-bold py-3.5 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg hover:shadow-xl active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed mt-6 text-white
                            ${isRegistering 
                                ? 'bg-talla-growth hover:bg-talla-dark shadow-talla-growth/20' 
                                : 'bg-bisne-navy hover:bg-[#092b4d] shadow-bisne-navy/20'
                            }`}
                    >
                        {loading ? <Loader2 className="animate-spin" /> : (isRegistering ? "Registrar Negocio" : "Iniciar Sesión")}
                        {!loading && <ArrowRight size={20} />}
                    </button>
                </form>

                {/* Footer del Formulario */}
                <div className="mt-8 pt-6 border-t border-gray-100 text-center">
                    <p className="text-sm text-text-secondary mb-3 font-body">
                        {isRegistering ? "¿Ya tienes una cuenta?" : "¿Nuevo en Bisne con Talla?"}
                    </p>
                    <button
                        onClick={() => { setIsRegistering(!isRegistering); setEmail(''); setPassword(''); }}
                        className="text-bisne-navy hover:text-talla-growth font-bold transition-colors flex items-center justify-center gap-2 mx-auto font-heading"
                    >
                        {isRegistering ? "Volver al Login" : "Crear una Cuenta Gratis"}
                    </button>
                </div>
            </>
          )}
        </div>
        
        {/* Footer de Página */}
        <div className="mt-8 text-center space-y-2 opacity-60">
            <div className="flex justify-center gap-4 text-white/80 text-xs">
                <span className="flex items-center gap-1"><Shield size={12}/> Seguro y Encriptado</span>
                <span>•</span>
                <span className="flex items-center gap-1"><AlertTriangle size={12}/> Versión Beta</span>
            </div>
            <p className="text-white/40 text-[10px] font-mono">
                Bisne con Talla v1.2 • Sancti Spíritus, Cuba
            </p>
        </div>

      </div>
    </div>
  );
}