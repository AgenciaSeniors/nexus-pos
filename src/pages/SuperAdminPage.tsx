import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { ShieldCheck, User, CheckCircle, XCircle, RefreshCw, Calendar, Search } from 'lucide-react';

interface UserProfile {
  id: string;
  email?: string;
  business_id: string | null;
  license_expiry?: string | null; 
  updated_at: string;
  full_name?: string;
}

export function SuperAdminPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [processing, setProcessing] = useState<string | null>(null);

  // 1. Cargar Usuarios
  const fetchUsers = async () => {
    setLoading(true);
    // Nota: Asegúrate de que tu tabla 'profiles' tenga acceso de lectura para el admin
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setUsers(data as UserProfile[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  // 2. Lógica para Activar/Desactivar Licencia remotamente
  const toggleLicense = async (userId: string, currentStatus: boolean) => {
    setProcessing(userId);
    
    try {
      const updates = currentStatus 
        ? { business_id: null, license_expiry: null } // Desactivar
        : { 
            business_id: `NEX-${Math.floor(10000 + Math.random() * 90000)}`, // Generar ID automático
            license_expiry: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString() // 1 año de licencia
          };

      const { error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', userId);

      if (error) throw error;
      
      // Actualizar lista localmente para que se vea rápido
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...updates } : u));
      
    } catch (err) {
      console.error("Error gestionando licencia:", err);
      alert("Error al actualizar la licencia.");
    } finally {
      setProcessing(null);
    }
  };

  const filteredUsers = users.filter(u => 
    (u.email?.toLowerCase().includes(searchTerm.toLowerCase()) || '') ||
    (u.id.includes(searchTerm))
  );

  return (
    <div className="p-8 max-w-7xl mx-auto pb-24 bg-slate-50 min-h-screen">
      
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div className="flex items-center gap-4">
          <div className="bg-slate-900 p-3 rounded-2xl shadow-xl shadow-slate-200">
            <ShieldCheck className="text-white w-8 h-8" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Control Maestro</h1>
            <p className="text-slate-500 font-medium">Administra las licencias de tus clientes</p>
          </div>
        </div>
        <button onClick={fetchUsers} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:text-indigo-600 hover:border-indigo-200 transition-all shadow-sm">
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          <span>Refrescar Lista</span>
        </button>
      </div>

      {/* BUSCADOR */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 mb-6 flex items-center gap-3">
        <Search className="text-slate-400" />
        <input 
          type="text" 
          placeholder="Buscar por ID o Email..." 
          className="flex-1 outline-none text-slate-700 font-medium"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
      </div>

      {/* TABLA DE USUARIOS */}
      <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="p-5 text-xs font-bold text-slate-500 uppercase tracking-wider">Usuario / Cliente</th>
                <th className="p-5 text-xs font-bold text-slate-500 uppercase tracking-wider">Estado Licencia</th>
                <th className="p-5 text-xs font-bold text-slate-500 uppercase tracking-wider">ID Negocio (Interno)</th>
                <th className="p-5 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && users.length === 0 ? (
                <tr><td colSpan={4} className="p-10 text-center text-slate-400">Cargando base de datos...</td></tr>
              ) : filteredUsers.map((user) => {
                const isActive = !!user.business_id;
                const isProcessing = processing === user.id;

                return (
                  <tr key={user.id} className="hover:bg-slate-50 transition-colors group">
                    <td className="p-5">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 font-bold">
                          <User size={20} />
                        </div>
                        <div>
                          <div className="font-bold text-slate-800">{user.email || 'Sin Email (Solo ID)'}</div>
                          <div className="text-xs text-slate-400 font-mono mt-1">{user.id}</div>
                        </div>
                      </div>
                    </td>
                    
                    <td className="p-5">
                      {isActive ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700 border border-green-200">
                          <CheckCircle size={14} /> ACTIVA
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-500 border border-slate-200">
                          <XCircle size={14} /> INACTIVA
                        </span>
                      )}
                    </td>

                    <td className="p-5">
                      <div className="font-mono text-sm font-medium text-slate-600">
                        {user.business_id || '—'}
                      </div>
                      {isActive && user.license_expiry && (
                        <div className="text-[10px] text-slate-400 flex items-center gap-1 mt-1">
                          <Calendar size={10} /> Expira: {new Date(user.license_expiry).toLocaleDateString()}
                        </div>
                      )}
                    </td>

                    <td className="p-5 text-right">
                      <button 
                        onClick={() => toggleLicense(user.id, isActive)}
                        disabled={isProcessing}
                        className={`
                          px-4 py-2 rounded-lg font-bold text-sm shadow-sm transition-all
                          ${isActive 
                            ? 'bg-white border border-red-200 text-red-600 hover:bg-red-50' 
                            : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-200'
                          }
                          ${isProcessing ? 'opacity-50 cursor-wait' : ''}
                        `}
                      >
                        {isProcessing ? 'Procesando...' : (isActive ? 'Revocar Licencia' : 'Activar Ahora')}
                      </button>
                    </td>
                  </tr>
                );
              })}
              
              {!loading && filteredUsers.length === 0 && (
                <tr><td colSpan={4} className="p-10 text-center text-slate-400 italic">No se encontraron usuarios.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      
      <div className="mt-6 text-center text-slate-400 text-sm">
        <p>⚠️ Al activar una licencia, el sistema asigna automáticamente un ID único al usuario.</p>
        <p>El cliente solo necesita recargar su página o iniciar sesión para ver los cambios.</p>
      </div>
    </div>
  );
}