import { useState } from 'react'; // Quitamos useEffect
import { ShieldAlert, ArrowRight, Lock } from 'lucide-react';

interface Props {
  children: React.ReactNode;
}

// ⚠️ CONTRASEÑA MAESTRA
const MASTER_PASSWORD = "nexus-master-key"; 

export function TechGuard({ children }: Props) {
  // ✅ CORRECCIÓN: Inicialización perezosa (Lazy Initialization)
  // Leemos sessionStorage directamente al crear el estado. Es más rápido y elimina el error.
  const [authorized, setAuthorized] = useState(() => {
    return sessionStorage.getItem('nexus_tech_auth') === 'true';
  });

  const [input, setInput] = useState('');
  const [error, setError] = useState(false);

  const handleVerify = (e: React.FormEvent) => {
    e.preventDefault();
    if (input === MASTER_PASSWORD) {
      setAuthorized(true);
      sessionStorage.setItem('nexus_tech_auth', 'true'); 
      setError(false);
    } else {
      setError(true);
      setInput('');
    }
  };

  if (authorized) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl w-full max-w-md text-center shadow-2xl">
        <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6 ring-1 ring-red-500/50">
          <ShieldAlert className="text-red-500 w-10 h-10" />
        </div>
        
        <h1 className="text-2xl font-bold text-white mb-2">Zona Restringida</h1>
        <p className="text-slate-400 text-sm mb-8">
          Acceso exclusivo para soporte técnico y administración global.
        </p>

        <form onSubmit={handleVerify} className="space-y-4">
          <div className="relative">
            <Lock className="absolute left-3 top-3 text-slate-500 w-5 h-5" />
            <input 
              type="password" 
              autoFocus
              className="w-full bg-slate-950 border border-slate-700 text-white pl-10 pr-4 py-3 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none transition-all placeholder:text-slate-600"
              placeholder="Clave de Técnico..."
              value={input}
              onChange={e => setInput(e.target.value)}
            />
          </div>

          {error && (
            <div className="text-red-400 text-xs font-bold bg-red-500/10 py-2 rounded animate-pulse">
              Acceso Denegado
            </div>
          )}

          <button className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2">
            <span>Entrar al Sistema</span>
            <ArrowRight size={18} />
          </button>
        </form>
        
        <div className="mt-8 pt-6 border-t border-slate-800">
             <a href="/" className="text-slate-500 hover:text-white text-sm transition-colors">← Volver al POS</a>
        </div>
      </div>
    </div>
  );
}