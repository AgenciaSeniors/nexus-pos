import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { 
  Shield, Check, X, Search, RefreshCw, UserCheck, Inbox, 
  CalendarPlus, Key, User, LogOut, Store, Trash2, AlertTriangle, Calendar
} from 'lucide-react';

// Interfaz completa para manejar todos los datos del usuario y negocio
interface Profile {
  id: string;
  email?: string;
  full_name: string;
  phone: string;
  months_requested: number;
  status: 'pending' | 'active' | 'rejected' | 'suspended';
  created_at: string;
  initial_pin: string;
  license_expiry?: string;
  business_id?: string;
  role?: string;
}

export function SuperAdminPage() {
  const navigate = useNavigate();
  
  // --- ESTADOS DE LA INTERFAZ ---
  const [activeTab, setActiveTab] = useState<'requests' | 'active'>('requests');
  const [dataList, setDataList] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // --- ESTADOS DE LOS MODALES ---
  const [approvingItem, setApprovingItem] = useState<Profile | null>(null);
  const [extendingItem, setExtendingItem] = useState<Profile | null>(null);

  // --- VALORES SELECCIONADOS EN MODALES ---
  const [monthsToGrant, setMonthsToGrant] = useState(1); // Para aprobación
  const [extendMonths, setExtendMonths] = useState(1);   // Para extensión

  // 1. CARGA DE DATOS (Filtrado por pestaña)
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (activeTab === 'requests') {
        query = query.eq('status', 'pending');
      } else {
        query = query.in('status', ['active', 'suspended', 'rejected']);
      }

      const { data, error } = await query;
      if (error) throw error;
      setDataList(data || []);

    } catch (error) {
      console.error('Error cargando usuarios:', error);
      alert("Error al cargar la lista de usuarios");
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 2. APROBACIÓN DE USUARIO (CORREGIDA: Usa variables correctas + PIN)
  const executeApproval = async () => {
    // Usamos 'approvingItem' que es la variable de estado correcta
    if (!approvingItem) return;

    // ✅ PASO 1: Pedir el PIN Maestro
    const adminPin = prompt(`Asigna el PIN maestro (4 dígitos) para el usuario "${approvingItem.full_name}":`, "1234");
    
    // Validación simple
    if (!adminPin || !/^\d{4}$/.test(adminPin)) {
        alert("❌ Error: Debes asignar un PIN numérico de 4 dígitos para crear el negocio.");
        return;
    }

    setLoading(true); // Bloqueo de UI opcional si quieres mostrar spinner global

    try {
      // ✅ PASO 2: Llamada a la Transacción Atómica
      const { error } = await supabase.rpc('approve_client_transaction', {
        target_user_id: approvingItem.id,     // Variable correcta
        months_to_grant: monthsToGrant,       // Variable correcta
        initial_pin: adminPin,                // PIN capturado
        admin_user_id: (await supabase.auth.getUser()).data.user?.id 
      });

      if (error) throw error;

      alert(`✅ ${approvingItem.full_name} aprobado y negocio creado con PIN: ${adminPin}`);
      
      setApprovingItem(null); // Variable correcta para cerrar modal
      fetchData();

    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Error desconocido";
        console.error(err);
        alert("❌ Error crítico en aprobación: " + msg);
    } finally {
        setLoading(false);
    }
  };

  // 3. EXTENSIÓN DE LICENCIA
  const executeExtension = async () => {
    if (!extendingItem) return;

    try {
      const currentExpiry = extendingItem.license_expiry ? new Date(extendingItem.license_expiry) : new Date();
      const baseDate = currentExpiry > new Date() ? currentExpiry : new Date();
      baseDate.setMonth(baseDate.getMonth() + extendMonths);

      const { error: profileError } = await supabase
        .from('profiles')
        .update({ license_expiry: baseDate.toISOString(), status: 'active' })
        .eq('id', extendingItem.id);

      if (profileError) throw profileError;

      if (extendingItem.business_id) {
        await supabase
          .from('businesses')
          .update({ subscription_expires_at: baseDate.toISOString(), status: 'active' })
          .eq('id', extendingItem.business_id);
      }

      setExtendingItem(null);
      fetchData();
      alert("✅ Licencia extendida correctamente.");

    } catch (err) {
      console.error(err);
      alert("Error al extender licencia");
    }
  };

  // 4. SUSPENDER / REACTIVAR
  const toggleStatus = async (user: Profile) => {
    const newStatus = user.status === 'active' ? 'suspended' : 'active';
    const action = user.status === 'active' ? 'SUSPENDER' : 'REACTIVAR';
    
    if (!confirm(`¿Estás seguro de ${action} a este usuario?`)) return;

    try {
      await supabase.from('profiles').update({ status: newStatus }).eq('id', user.id);
      if (user.business_id) {
        await supabase.from('businesses').update({ status: newStatus }).eq('id', user.business_id);
      }
      fetchData();
    } catch (error) {
      console.error(error);
      alert("Error al cambiar estado");
    }
  };

  // 5. ELIMINAR (HARD DELETE)
  const handleDelete = async (userId: string) => {
    if (!confirm("⚠️ ¿ELIMINAR DEFINITIVAMENTE?\n\nEsto borrará al usuario de Auth y liberará el correo electrónico.")) return;
    
    setLoading(true);
    try {
        const { error } = await supabase.rpc('delete_user_completely', { 
            target_user_id: userId 
        });

        if (error) throw error;

        alert("🗑️ Usuario eliminado y correo liberado correctamente.");
        fetchData();

    } catch (err: unknown) {
        console.error(err);
        const msg = err instanceof Error ? err.message : "Error desconocido";
        if (msg.includes("foreign key constraint")) {
            alert("❌ No se puede eliminar: El usuario tiene historial vinculado. Suspéndelo en su lugar.");
        } else {
            alert("Error al eliminar usuario: " + msg);
        }
    } finally {
        setLoading(false);
    }
  };

  // 6. LOGOUT
  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/admin-login');
  };

  const filteredList = dataList.filter(item => 
    item.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* --- HEADER --- */}
      <header className="bg-slate-900 text-white shadow-lg sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-16 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-red-600 p-2 rounded-lg shadow-red-900/50 shadow-lg">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Panel Super Admin</h1>
              <p className="text-xs text-slate-400">Sistema de Control de Licencias</p>
            </div>
          </div>
          <button onClick={handleLogout} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-lg text-sm transition-all border border-slate-700">
            <LogOut size={16} /> <span className="hidden sm:inline">Cerrar Sesión</span>
          </button>
        </div>
      </header>

      {/* --- CONTENIDO PRINCIPAL --- */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-4 sm:p-6">
        
        {/* BUSCADOR Y PESTAÑAS */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
            <div className="bg-white p-1 rounded-xl shadow-sm border border-slate-200 flex w-full sm:w-auto">
                <button 
                    onClick={() => setActiveTab('requests')}
                    className={`flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'requests' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
                >
                    <Inbox size={18} /> Solicitudes
                </button>
                <button 
                    onClick={() => setActiveTab('active')}
                    className={`flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'active' ? 'bg-green-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
                >
                    <UserCheck size={18} /> Clientes
                </button>
            </div>

            <div className="relative w-full sm:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5"/>
                <input 
                    type="text" 
                    placeholder="Buscar cliente, email..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm"
                />
            </div>
        </div>

        {/* LISTA DE DATOS */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            {loading ? (
                <div className="p-12 flex flex-col items-center justify-center text-slate-400">
                    <RefreshCw className="animate-spin w-8 h-8 mb-4 text-indigo-500" />
                    <p>Cargando datos...</p>
                </div>
            ) : filteredList.length === 0 ? (
                <div className="p-12 text-center text-slate-400">
                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Inbox className="w-8 h-8 opacity-50"/>
                    </div>
                    <p>No se encontraron registros en esta sección.</p>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-50 text-slate-500 uppercase text-xs font-bold border-b border-slate-200">
                            <tr>
                                <th className="p-4 w-64">Cliente / Negocio</th>
                                <th className="p-4">Contacto</th>
                                <th className="p-4">Estado</th>
                                <th className="p-4">Detalles Licencia</th>
                                <th className="p-4 text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filteredList.map((item) => (
                                <tr key={item.id} className="hover:bg-slate-50/80 transition-colors group">
                                    <td className="p-4">
                                        <div className="font-bold text-slate-800">{item.full_name}</div>
                                        <div className="text-xs text-slate-400 flex items-center gap-1 mt-1">
                                            {item.business_id ? <Store size={12}/> : <AlertTriangle size={12} className="text-yellow-500"/>}
                                            {item.business_id ? "Negocio Vinculado" : "Sin Negocio Asignado"}
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <div className="text-sm text-slate-600 flex items-center gap-2"><User size={14}/> {item.email || 'Sin email'}</div>
                                        <div className="text-sm text-slate-600 mt-1">{item.phone}</div>
                                    </td>
                                    <td className="p-4">
                                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${
                                            item.status === 'active' ? 'bg-green-50 text-green-700 border-green-200' :
                                            item.status === 'pending' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
                                            item.status === 'suspended' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                                            'bg-red-50 text-red-700 border-red-200'
                                        }`}>
                                            {item.status === 'active' ? 'ACTIVO' : 
                                             item.status === 'pending' ? 'PENDIENTE' : 
                                             item.status === 'suspended' ? 'SUSPENDIDO' : 'RECHAZADO'}
                                        </span>
                                    </td>
                                    <td className="p-4">
                                        <div className="flex flex-col gap-1">
                                            <div className="text-sm font-medium flex items-center gap-2 text-slate-700">
                                                <Key size={14} className="text-slate-400"/> PIN Solicitud: <span className="font-mono bg-slate-100 px-1.5 rounded">{item.initial_pin}</span>
                                            </div>
                                            <div className="text-xs text-slate-500">
                                                Solicitó: <span className="font-bold">{item.months_requested} Meses</span>
                                            </div>
                                            {item.license_expiry && (
                                                <div className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                                                    <Calendar size={12}/> Vence: {new Date(item.license_expiry).toLocaleDateString()}
                                                </div>
                                            )}
                                        </div>
                                    </td>
                                    <td className="p-4 text-right">
                                        <div className="flex items-center justify-end gap-2 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                                            
                                            {activeTab === 'requests' && (
                                                <>
                                                    <button 
                                                        onClick={() => { setApprovingItem(item); setMonthsToGrant(item.months_requested || 1); }}
                                                        className="bg-indigo-600 hover:bg-indigo-700 text-white p-2 rounded-lg shadow-sm transition-colors"
                                                        title="Aprobar Solicitud"
                                                    >
                                                        <Check size={18} />
                                                    </button>
                                                    <button 
                                                        onClick={() => handleDelete(item.id)}
                                                        className="bg-white border border-slate-200 hover:bg-red-50 hover:text-red-600 text-slate-400 p-2 rounded-lg transition-colors"
                                                        title="Rechazar y Borrar"
                                                    >
                                                        <X size={18} />
                                                    </button>
                                                </>
                                            )}

                                            {activeTab === 'active' && (
                                                <>
                                                    <button 
                                                        onClick={() => { setExtendingItem(item); setExtendMonths(1); }}
                                                        className="bg-white border border-slate-200 hover:bg-indigo-50 hover:text-indigo-600 text-slate-600 p-2 rounded-lg transition-colors"
                                                        title="Extender Licencia"
                                                    >
                                                        <CalendarPlus size={18} />
                                                    </button>
                                                    <button 
                                                        onClick={() => toggleStatus(item)}
                                                        className={`p-2 rounded-lg border transition-colors ${
                                                            item.status === 'active' 
                                                            ? 'bg-white border-slate-200 text-yellow-600 hover:bg-yellow-50' 
                                                            : 'bg-green-100 border-green-200 text-green-700 hover:bg-green-200'
                                                        }`}
                                                        title={item.status === 'active' ? "Suspender" : "Reactivar"}
                                                    >
                                                        {item.status === 'active' ? <UserCheck size={18} /> : <Check size={18} />}
                                                    </button>
                                                    <button 
                                                        onClick={() => handleDelete(item.id)}
                                                        className="bg-white border border-slate-200 hover:bg-red-50 hover:text-red-600 text-slate-400 p-2 rounded-lg transition-colors"
                                                        title="Eliminar Cliente"
                                                    >
                                                        <Trash2 size={18} />
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
      </main>

      {/* --- MODAL DE APROBACIÓN --- */}
      {approvingItem && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 animate-in fade-in zoom-in duration-200">
                <h3 className="text-lg font-bold text-slate-800 mb-2 flex items-center gap-2">
                    <Check className="text-green-500"/> Aprobar Licencia
                </h3>
                <p className="text-sm text-slate-500 mb-4">
                    Cliente: <span className="font-bold text-indigo-600">{approvingItem.full_name}</span>
                </p>

                <div className="mb-6">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Confirmar Duración (Meses)</label>
                    <div className="grid grid-cols-4 gap-2 mb-3">
                        {[1, 3, 6, 12].map(m => (
                            <button 
                                key={m} 
                                onClick={() => setMonthsToGrant(m)} 
                                className={`py-2 text-xs font-bold rounded-lg border transition-all ${monthsToGrant === m ? 'bg-indigo-600 text-white border-indigo-600 shadow-md transform scale-105' : 'bg-white text-slate-600 hover:bg-slate-50 border-slate-200'}`}
                            >
                                {m}M
                            </button>
                        ))}
                    </div>
                    <input 
                        type="number" 
                        value={monthsToGrant} 
                        onChange={(e) => setMonthsToGrant(Number(e.target.value))} 
                        className="w-full p-3 border border-slate-200 rounded-xl font-bold text-center outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all text-slate-700"
                    />
                </div>

                <div className="flex gap-3">
                    <button 
                        onClick={() => setApprovingItem(null)} 
                        className="flex-1 py-3 text-slate-600 font-bold bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors"
                    >
                        Cancelar
                    </button>
                    <button 
                        onClick={executeApproval} 
                        className="flex-1 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl shadow-lg shadow-green-900/20 transition-all active:scale-95"
                    >
                        Confirmar
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* --- MODAL DE EXTENSIÓN --- */}
      {extendingItem && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 animate-in fade-in zoom-in duration-200">
                <h3 className="text-lg font-bold text-slate-800 mb-2 flex items-center gap-2">
                    <CalendarPlus className="text-indigo-500"/> Extender Licencia
                </h3>
                <p className="text-sm text-slate-500 mb-4">
                    Cliente: <span className="font-bold text-indigo-600">{extendingItem.full_name}</span>
                </p>

                <div className="mb-6">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Meses a Añadir</label>
                    <div className="grid grid-cols-4 gap-2 mb-3">
                        {[1, 3, 6, 12].map(m => (
                            <button 
                                key={m} 
                                onClick={() => setExtendMonths(m)} 
                                className={`py-2 text-xs font-bold rounded-lg border transition-all ${extendMonths === m ? 'bg-indigo-600 text-white border-indigo-600 shadow-md transform scale-105' : 'bg-white text-slate-600 hover:bg-slate-50 border-slate-200'}`}
                            >
                                {m}M
                            </button>
                        ))}
                    </div>
                    <input 
                        type="number" 
                        value={extendMonths} 
                        onChange={(e) => setExtendMonths(Number(e.target.value))} 
                        className="w-full p-3 border border-slate-200 rounded-xl font-bold text-center outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all text-slate-700"
                    />
                </div>

                <div className="flex gap-3">
                    <button 
                        onClick={() => setExtendingItem(null)} 
                        className="flex-1 py-3 text-slate-600 font-bold bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors"
                    >
                        Cancelar
                    </button>
                    <button 
                        onClick={executeExtension} 
                        className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg shadow-indigo-900/20 transition-all active:scale-95"
                    >
                        Extender
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}