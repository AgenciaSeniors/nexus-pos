import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Store, Mail, Lock, Loader2, ArrowRight, User, Phone } from 'lucide-react';
import { toast } from 'sonner';

export function SuperAdminLogin() {
  const navigate = useNavigate();
  
  // Estados
  const [isRegistering, setIsRegistering] = useState(false);
  const [loading, setLoading] = useState(false); // Inicializado en false para no bloquear inputs
  
  // Formulario
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [businessName, setBusinessName] = useState('');

  // Verificación de sesión NO bloqueante
  useEffect(() => {
    let mounted = true;

    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      
      if (data.session && mounted) {
        navigate('/'); 
      }
    };

    checkSession();

    return () => { mounted = false; };
  }, [navigate]);

  // Manejo de Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); // Bloqueamos solo al intentar entrar

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          toast.error('Credenciales incorrectas');
        } else {
          toast.error(error.message);
        }
      } else {
        // El onAuthStateChange en App.tsx manejará la redirección
        toast.success('Bienvenido de nuevo');
      }
    } catch (error) {
      console.error(error);
      toast.error('Error de conexión');
    } finally {
      // ✅ CORRECCIÓN (no-unsafe-finally): Eliminamos el return dentro del finally.
      // Simplemente desbloqueamos. Si la navegación ocurre por el éxito del login,
      // el componente se desmontará de todas formas.
      setLoading(false);
    }
  };

  // Manejo de Registro
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (!fullName || !phone || !businessName) {
        toast.warning("Por favor completa todos los campos");
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
            business_name_request: businessName, // Dato para el SuperAdmin aprobar
            role: 'admin', // Solicitud de rol inicial
            status: 'pending' // Estado pendiente de aprobación
          },
        },
      });

      if (error) throw error;

      if (data.user) {
        toast.success('Cuenta creada exitosamente', {
            description: 'Espera la aprobación del administrador para acceder.'
        });
        setIsRegistering(false); // Volver al login
      }
    } catch (error: unknown) { // ✅ CORRECCIÓN (no-explicit-any): Usamos unknown
      const errorMessage = error instanceof Error ? error.message : "Error desconocido";
      toast.error('Error al registrarse', {
          description: errorMessage
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col md:flex-row h-auto md:h-[600px] max-h-[90vh]">
        
        {/* Panel Izquierdo (Imagen/Logo) - Visible solo en desktop */}
        <div className="hidden md:flex w-2/5 bg-indigo-600 p-8 flex-col justify-between text-white relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-indigo-600 to-purple-700 opacity-90"></div>
          <div className="relative z-10">
            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center mb-6 backdrop-blur-sm">
              <Store size={28} className="text-white" />
            </div>
            <h1 className="text-3xl font-bold mb-2">Nexus POS</h1>
            <p className="text-indigo-100 text-sm">Gestiona tu negocio con inteligencia y velocidad.</p>
          </div>
          <div className="relative z-10 text-xs text-indigo-200">
            © 2024 Agencia Seniors
          </div>
        </div>

        {/* Panel Derecho (Formulario) */}
        <div className="w-full md:w-3/5 p-8 flex flex-col justify-center bg-slate-50 overflow-y-auto">
          <div className="text-center mb-8 md:hidden">
             <h2 className="text-2xl font-bold text-slate-800">Nexus POS</h2>
          </div>

          <h2 className="text-2xl font-bold text-slate-800 mb-2">
            {isRegistering ? 'Crear Cuenta' : 'Iniciar Sesión'}
          </h2>
          <p className="text-slate-500 mb-6 text-sm">
            {isRegistering ? 'Completa tus datos para solicitar acceso.' : 'Ingresa tus credenciales para continuar.'}
          </p>

          <form onSubmit={isRegistering ? handleRegister : handleLogin} className="space-y-4">
            
            {/* Campos extra para Registro */}
            {isRegistering && (
              <>
                <div className="space-y-1 animate-in slide-in-from-top duration-300">
                    <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input
                        type="text"
                        placeholder="Nombre Completo"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none text-sm transition-all"
                        required={isRegistering}
                        disabled={loading}
                        />
                    </div>
                </div>
                <div className="space-y-1 animate-in slide-in-from-top duration-300 delay-75">
                    <div className="relative">
                        <Store className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input
                        type="text"
                        placeholder="Nombre del Negocio"
                        value={businessName}
                        onChange={(e) => setBusinessName(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none text-sm transition-all"
                        required={isRegistering}
                        disabled={loading}
                        />
                    </div>
                </div>
                <div className="space-y-1 animate-in slide-in-from-top duration-300 delay-100">
                    <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input
                        type="tel"
                        placeholder="Teléfono"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none text-sm transition-all"
                        required={isRegistering}
                        disabled={loading}
                        />
                    </div>
                </div>
              </>
            )}

            {/* Campos Comunes */}
            <div className="space-y-1">
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input
                  type="email"
                  placeholder="Correo electrónico"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none text-sm transition-all"
                  required
                  disabled={loading} 
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input
                  type="password"
                  placeholder="Contraseña"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none text-sm transition-all"
                  required
                  disabled={loading}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl shadow-lg shadow-indigo-200 flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed mt-4"
            >
              {loading ? (
                <Loader2 className="animate-spin" size={20} />
              ) : (
                <>
                  <span>{isRegistering ? 'Solicitar Acceso' : 'Entrar'}</span>
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => {
                  setIsRegistering(!isRegistering);
                  setEmail('');
                  setPassword('');
              }}
              className="text-indigo-600 hover:text-indigo-800 text-sm font-semibold transition-colors"
              disabled={loading}
            >
              {isRegistering
                ? '¿Ya tienes cuenta? Inicia sesión'
                : '¿No tienes cuenta? Regístrate aquí'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}