import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Shield, Mail, Lock, Loader2, ArrowRight, AlertTriangle, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';

export function SuperAdminLogin() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Si ya hay sesión de super admin, lo mandamos directo al panel
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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // 1. Iniciamos sesión en Supabase
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      // 2. Verificamos que sea un Super Admin
      if (data.user) {
          const { data: profile } = await supabase
              .from('profiles')
              .select('is_super_admin')
              .eq('id', data.user.id)
              .single();
          
          if (profile?.is_super_admin) {
              toast.success('Bienvenido, Administrador');
              navigate('/super-panel', { replace: true });
          } else {
              // Si un usuario normal intenta entrar aquí, lo bloqueamos y lo deslogueamos
              await supabase.auth.signOut();
              throw new Error("Acceso Denegado. Este panel es exclusivo para el Super Administrador.");
          }
      }
    } catch (error) {
      console.error(error);
      const errorMessage = error instanceof Error ? error.message : "Error en la autenticación";
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans">
      
      {/* Fondo decorativo */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none opacity-20">
          <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-red-600 rounded-full blur-[120px]"></div>
          <div className="absolute top-[60%] -right-[10%] w-[40%] h-[60%] bg-indigo-600 rounded-full blur-[100px]"></div>
      </div>

      {/* ✅ NUEVO BOTÓN DE REGRESAR AL INICIO */}
      <button 
        onClick={() => navigate('/')} 
        className="absolute top-6 left-6 md:top-8 md:left-8 text-slate-400 hover:text-white flex items-center gap-2 text-sm font-bold transition-all hover:-translate-x-1 z-20"
        title="Volver al acceso de clientes"
      >
        <ArrowLeft size={18} /> Volver al Inicio
      </button>

      <div className="w-full max-w-sm z-10">
        
        {/* Header */}
        <div className="text-center mb-8 animate-in slide-in-from-top-5 duration-700">
          <div className="inline-flex items-center justify-center p-4 bg-red-500/20 rounded-2xl mb-4 backdrop-blur-sm border border-red-500/30">
            <Shield className="w-10 h-10 text-red-500" />
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight">
            ACCESO MAESTRO
          </h1>
          <p className="text-slate-400 mt-2 text-sm">
            Solo personal autorizado
          </p>
        </div>

        {/* Formulario */}
        <div className="bg-slate-800/80 rounded-3xl shadow-2xl p-6 md:p-8 border border-slate-700 backdrop-blur-md animate-in fade-in zoom-in-95 duration-500">
            <form onSubmit={handleLogin} className="space-y-5">
                <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-300 uppercase tracking-wider ml-1">Correo Electrónico</label>
                    <div className="relative group">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 w-5 h-5 group-focus-within:text-red-400 transition-colors" />
                        <input 
                            type="email" required 
                            className="w-full pl-12 pr-4 py-3.5 bg-slate-900 border border-slate-700 rounded-xl text-white focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none transition-all placeholder:text-slate-600" 
                            placeholder="admin@bisne.com" 
                            value={email} onChange={e => setEmail(e.target.value)} 
                        />
                    </div>
                </div>

                <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-300 uppercase tracking-wider ml-1">Contraseña</label>
                    <div className="relative group">
                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 w-5 h-5 group-focus-within:text-red-400 transition-colors" />
                        <input 
                            type="password" required 
                            className="w-full pl-12 pr-4 py-3.5 bg-slate-900 border border-slate-700 rounded-xl text-white focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none transition-all placeholder:text-slate-600" 
                            placeholder="••••••••" 
                            value={password} onChange={e => setPassword(e.target.value)} 
                        />
                    </div>
                </div>

                <button 
                    type="submit" disabled={loading}
                    className="w-full bg-red-600 text-white font-bold py-4 rounded-xl hover:bg-red-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-red-900/50 active:scale-[0.98] disabled:opacity-70 mt-4"
                >
                    {loading ? <Loader2 className="animate-spin w-5 h-5" /> : "Verificar Credenciales"}
                    {!loading && <ArrowRight size={20} />}
                </button>
            </form>
        </div>

        <div className="mt-8 text-center flex items-center justify-center gap-2 text-slate-500 text-xs">
            <AlertTriangle size={14}/> Acceso restringido. Monitoreo activo.
        </div>
      </div>
    </div>
  );
}