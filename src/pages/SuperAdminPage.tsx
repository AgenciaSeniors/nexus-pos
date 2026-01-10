import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { ShieldCheck, User, CheckCircle, XCircle, RefreshCw, Calendar, Search, CalendarPlus, X } from 'lucide-react';

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

  // Estado para el Modal de Extensión
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [customMonths, setCustomMonths] = useState<number>(1);

  // 1. Cargar Usuarios
  const fetchUsers = async () => {
    setLoading(true);
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

  // 2. Revocar Licencia (Borrarla)
  const revokeLicense = async (userId: string) => {
    if (!confirm("¿Estás seguro de quitarle el acceso a este cliente?")) return;
    setProcessing(userId);
    try {
      const updates = { business_id: null, license_expiry: null };
      const { error } = await supabase.from('profiles').update(updates).eq('id', userId);
      if (error) throw error;
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...updates } : u));
    } catch (err) {
      console.error(err);
      alert("Error al revocar.");
    } finally {
      setProcessing(null);
    }
  };

  // 3. Extender Licencia (Lógica Inteligente)
  const extendLicense = async (monthsToAdd: number) => {
    if (!selectedUser) return;
    const userId = selectedUser.id;
    setProcessing(userId);

    try {
      // Calcular fecha de inicio: ¿Hoy o cuando venza la actual?
      const now = new Date();
      let startDate = now;

      if (selectedUser.business_id && selectedUser.license_expiry) {
        const currentExpiry = new Date(selectedUser.license_expiry);
        // Si la licencia actual vence en el futuro, sumamos tiempo a partir de ESA fecha
        if (currentExpiry > now) {
          startDate = currentExpiry;
        }
      }

      // Calcular nueva fecha de vencimiento
      const newExpiry = new Date(startDate);
      newExpiry.setMonth(newExpiry.getMonth() + monthsToAdd);

      // Si no tenía Business ID, generamos uno nuevo
      const businessId = selectedUser.business_id || `NEX-${Math.floor(10000 + Math.random() * 90000)}`;

      const updates = { 
        business_id: businessId,
        license_expiry: newExpiry.toISOString() 
      };

      const { error } = await supabase.from('profiles').update(updates).eq('id', userId);
      if (error) throw error;

      // Actualizar UI
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...updates } : u));
      setSelectedUser(null); // Cerrar modal

    } catch (err) {
      console.error(err);
      alert("Error al extender licencia.");
    } finally {
      setProcessing(null);
    }
  };

  const filteredUsers = users.filter(u => 
    (u.email?.toLowerCase().includes(searchTerm.toLowerCase()) || '') ||
    (u.id.includes(searchTerm))
  );

  return (
    <div className="p-8 max-w-7xl mx-auto pb-24 bg-slate-50 min-h-screen relative">
      
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
                <th className="p-5 text-xs font-bold text-slate-500 uppercase tracking-wider">Vencimiento</th>
                <th className="p-5 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Acciones</th>
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
                        <div className={`text-[10px] font-bold flex items-center gap-1 mt-1 ${new Date(user.license_expiry) < new Date() ? 'text-red-500' : 'text-slate-400'}`}>
                          <Calendar size={10} /> 
                          {new Date(user.license_expiry).toLocaleDateString()}
                        </div>
                      )}
                    </td>

                    <td className="p-5 text-right">
                      <div className="flex justify-end gap-2">
                        {/* Botón EXTENDER */}
                        <button 
                          onClick={() => { setSelectedUser(user); setCustomMonths(1); }}
                          disabled={isProcessing}
                          className="px-3 py-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors"
                          title="Agregar tiempo"
                        >
                          <CalendarPlus size={16} /> Extender
                        </button>

                        {/* Botón REVOCAR */}
                        {isActive && (
                          <button 
                            onClick={() => revokeLicense(user.id)}
                            disabled={isProcessing}
                            className="px-3 py-2 bg-white border border-red-200 text-red-500 hover:bg-red-50 rounded-lg text-xs font-bold transition-colors"
                            title="Quitar licencia"
                          >
                            Revocar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL DE EXTENSIÓN */}
      {selectedUser && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 relative">
            <button onClick={() => setSelectedUser(null)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
              <X size={20} />
            </button>

            <h2 className="text-xl font-bold text-slate-800 mb-1">Extender Licencia</h2>
            <p className="text-sm text-slate-500 mb-6">Cliente: <span className="font-bold text-indigo-600">{selectedUser.email || selectedUser.id}</span></p>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => extendLicense(1)} className="p-3 border border-slate-200 rounded-xl hover:border-indigo-500 hover:bg-indigo-50 hover:text-indigo-700 font-bold text-slate-600 transition-all">
                  +1 Mes
                </button>
                <button onClick={() => extendLicense(6)} className="p-3 border border-slate-200 rounded-xl hover:border-indigo-500 hover:bg-indigo-50 hover:text-indigo-700 font-bold text-slate-600 transition-all">
                  +6 Meses
                </button>
                <button onClick={() => extendLicense(12)} className="p-3 border border-slate-200 rounded-xl hover:border-indigo-500 hover:bg-indigo-50 hover:text-indigo-700 font-bold text-slate-600 transition-all">
                  +1 Año
                </button>
                <button onClick={() => extendLicense(0.25)} className="p-3 border border-slate-200 rounded-xl hover:border-indigo-500 hover:bg-indigo-50 hover:text-indigo-700 font-bold text-slate-600 transition-all">
                  +1 Semana
                </button>
              </div>

              <div className="relative border-t border-slate-100 pt-4 mt-4">
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Personalizado (Meses)</label>
                <div className="flex gap-2">
                  <input 
                    type="number" 
                    min="1" 
                    value={customMonths} 
                    onChange={e => setCustomMonths(parseFloat(e.target.value) || 0)}
                    className="flex-1 border border-slate-300 rounded-lg p-2 outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button 
                    onClick={() => extendLicense(customMonths)}
                    className="bg-slate-900 text-white px-4 py-2 rounded-lg font-bold hover:bg-black"
                  >
                    Aplicar
                  </button>
                </div>
                <p className="text-xs text-slate-400 mt-2">
                  Tip: Pon "10" para tu amigo, o "0.5" para 15 días.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}