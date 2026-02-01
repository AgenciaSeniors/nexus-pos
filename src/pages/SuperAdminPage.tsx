import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { 
  Shield, Check, X, Search, RefreshCw, UserCheck, Inbox, 
  CalendarPlus, Key, User, LogOut, Store, Trash2, AlertTriangle, Calendar, AlertOctagon
} from 'lucide-react';
import { toast } from 'sonner';

// Interfaz completa
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

type ConfirmAction = {
    type: 'suspend' | 'delete';
    item: Profile;
};

export function SuperAdminPage() {
  const navigate = useNavigate();
  
  // --- ESTADOS DE LA INTERFAZ ---
  const [activeTab, setActiveTab] = useState<'requests' | 'active'>('requests');
  const [dataList, setDataList] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // --- MODALES ---
  const [approvingItem, setApprovingItem] = useState<Profile | null>(null);
  const [extendingItem, setExtendingItem] = useState<Profile | null>(null);
  const [confirmModal, setConfirmModal] = useState<ConfirmAction | null>(null);

  // --- VALORES DE FORMULARIO ---
  const [monthsToGrant, setMonthsToGrant] = useState(1);
  const [extendMonths, setExtendMonths] = useState(1);
  const [adminPin, setAdminPin] = useState('1234'); // Estado para el PIN (Ya no prompt)

  // 1. CARGA DE DATOS
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
      toast.error("No se pudo cargar la lista de usuarios");
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 2. APROBACIÓN DE USUARIO (Con Modal Integrado)
  const executeApproval = async () => {
    if (!approvingItem) return;

    // Validación de PIN en el modal
    if (!adminPin || !/^\d{4}$/.test(adminPin)) {
        toast.warning("El PIN debe ser de 4 dígitos numéricos");
        return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.rpc('approve_client_transaction', {
        target_user_id: approvingItem.id,
        months_to_grant: monthsToGrant,
        initial_pin: adminPin, // Usamos el estado
        admin_user_id: (await supabase.auth.getUser()).data.user?.id 
      });

      if (error) throw error;

      toast.success(`Cliente aprobado. PIN Maestro: ${adminPin}`);
      
      setApprovingItem(null);
      setAdminPin('1234'); // Reset
      fetchData();

    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Error desconocido";
        console.error(err);
        toast.error("Error crítico: " + msg);
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
      toast.success("Licencia extendida correctamente.");

    } catch (err) {
      console.error(err);
      toast.error("Error al extender licencia");
    }
  };

  // 4. EJECUTAR ACCIÓN DESTRUCTIVA (Suspender/Borrar)
  const executeConfirmAction = async () => {
      if (!confirmModal) return;
      const { type, item } = confirmModal;
      setLoading(true);

      try {
          if (type === 'suspend') {
              const newStatus = item.status === 'active' ? 'suspended' : 'active';
              await supabase.from('profiles').update({ status: newStatus }).eq('id', item.id);
              if (item.business_id) {
                  await supabase.from('businesses').update({ status: newStatus }).eq('id', item.business_id);
              }
              toast.success(`Usuario ${newStatus === 'active' ? 'reactivado' : 'suspendido'}`);
          } 
          else if (type === 'delete') {
              const { error } = await supabase.rpc('delete_user_completely', { 
                  target_user_id: item.id 
              });
              if (error) throw error;
              toast.success("Usuario eliminado completamente de la base de datos.");
          }
          
          setConfirmModal(null);
          fetchData();

      } catch (err: unknown) {
          console.error(err);
          const msg = err instanceof Error ? err.message : "Error desconocido";
          toast.error("Falló la operación: " + msg);
      } finally {
          setLoading(false);
      }
  };

  // Logout
  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/admin-login');
  };

  const filteredList = dataList.filter(item => 
    item.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      {/* --- HEADER --- */}
      <header className="bg-slate-900 text-white shadow-lg sticky top-0 z-10 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 h-16 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-red-600 to-red-700 p-2 rounded-lg shadow-lg shadow-red-900/50">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight leading-none">NEXUS ADMIN</h1>
              <p className="text-[10px] text-slate-400 font-medium tracking-wide uppercase">Panel Maestro</p>
            </div>
          </div>
          <button onClick={handleLogout} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-lg text-xs font-bold transition-all border border-slate-700 hover:border-slate-600">
            <LogOut size={16} /> <span className="hidden sm:inline">Salir</span>
          </button>
        </div>
      </header>

      {/* --- CONTENIDO PRINCIPAL --- */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-4 sm:p-8 space-y-6">
        
        {/* BARRA DE HERRAMIENTAS */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="bg-white p-1 rounded-xl shadow-sm border border-slate-200 flex w-full sm:w-auto">
                <button 
                    onClick={() => setActiveTab('requests')}
                    className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${activeTab === 'requests' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
                >
                    <Inbox size={18} /> Solicitudes
                </button>
                <button 
                    onClick={() => setActiveTab('active')}
                    className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${activeTab === 'active' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
                >
                    <UserCheck size={18} /> Clientes
                </button>
            </div>

            <div className="relative w-full sm:w-96 group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5 group-focus-within:text-indigo-500 transition-colors"/>
                <input 
                    type="text" 
                    placeholder="Buscar por nombre, email o teléfono..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none shadow-sm transition-all text-sm font-medium"
                />
            </div>
        </div>

        {/* TABLA DE DATOS */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden min-h-[400px]">
            {loading ? (
                <div className="h-96 flex flex-col items-center justify-center text-slate-400">
                    <RefreshCw className="animate-spin w-10 h-10 mb-4 text-indigo-500 opacity-50" />
                    <p className="text-sm font-medium">Sincronizando datos...</p>
                </div>
            ) : filteredList.length === 0 ? (
                <div className="h-96 flex flex-col items-center justify-center text-slate-400">
                    <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-4 border border-slate-100">
                        <Inbox className="w-10 h-10 opacity-30"/>
                    </div>
                    <p className="text-sm font-medium">No hay registros para mostrar</p>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase font-bold text-slate-500 tracking-wider">
                                <th className="p-5 w-72">Negocio / Cliente</th>
                                <th className="p-5">Contacto</th>
                                <th className="p-5 text-center">Estado</th>
                                <th className="p-5">Detalles</th>
                                <th className="p-5 text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filteredList.map((item) => (
                                <tr key={item.id} className="hover:bg-slate-50/50 transition-colors group">
                                    <td className="p-5">
                                        <div className="flex items-center gap-3">
                                            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-sm ${item.business_id ? 'bg-indigo-600' : 'bg-slate-400'}`}>
                                                {item.full_name.substring(0,2).toUpperCase()}
                                            </div>
                                            <div>
                                                <div className="font-bold text-slate-800 text-sm">{item.full_name}</div>
                                                <div className="text-[11px] text-slate-400 font-medium uppercase tracking-wide flex items-center gap-1 mt-0.5">
                                                    {item.business_id ? (
                                                        <><Store size={10} className="text-emerald-500"/> Negocio Activo</>
                                                    ) : (
                                                        <><AlertTriangle size={10} className="text-amber-500"/> Sin Asignar</>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-5">
                                        <div className="flex flex-col gap-1">
                                            <div className="text-xs font-bold text-slate-600 flex items-center gap-2">
                                                <User size={12} className="text-slate-400"/> {item.email || 'N/A'}
                                            </div>
                                            <div className="text-xs text-slate-500 pl-5">
                                                {item.phone || 'Sin teléfono'}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-5 text-center">
                                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border ${
                                            item.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                            item.status === 'pending' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
                                            'bg-red-50 text-red-700 border-red-200'
                                        }`}>
                                            {item.status === 'active' ? 'ACTIVO' : 
                                             item.status === 'pending' ? 'PENDIENTE' : item.status}
                                        </span>
                                    </td>
                                    <td className="p-5">
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
                                                <Key size={12} className="text-slate-400"/> PIN Solicitud: <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 text-slate-700">{item.initial_pin}</span>
                                            </div>
                                            <div className="text-xs text-slate-500 flex items-center gap-2">
                                                <Calendar size={12}/> 
                                                {item.license_expiry 
                                                    ? `Vence: ${new Date(item.license_expiry).toLocaleDateString()}` 
                                                    : `Solicita: ${item.months_requested} Mes(es)`}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-5 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            {activeTab === 'requests' ? (
                                                <>
                                                    <button 
                                                        onClick={() => { setApprovingItem(item); setMonthsToGrant(item.months_requested || 1); setAdminPin('1234'); }}
                                                        className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg shadow-sm transition-colors text-xs font-bold"
                                                    >
                                                        <Check size={14} /> Aprobar
                                                    </button>
                                                    <button 
                                                        onClick={() => setConfirmModal({ type: 'delete', item })}
                                                        className="flex items-center gap-1 bg-white border border-slate-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200 text-slate-500 px-3 py-1.5 rounded-lg transition-colors text-xs font-bold"
                                                    >
                                                        <X size={14} /> Rechazar
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <button 
                                                        onClick={() => { setExtendingItem(item); setExtendMonths(1); }}
                                                        className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                                        title="Extender Licencia"
                                                    >
                                                        <CalendarPlus size={18} />
                                                    </button>
                                                    <button 
                                                        onClick={() => setConfirmModal({ type: 'suspend', item })}
                                                        className={`p-2 rounded-lg transition-colors ${item.status === 'active' ? 'text-slate-400 hover:text-amber-600 hover:bg-amber-50' : 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100'}`}
                                                        title={item.status === 'active' ? "Suspender Cuenta" : "Reactivar Cuenta"}
                                                    >
                                                        {item.status === 'active' ? <UserCheck size={18} /> : <Check size={18} />}
                                                    </button>
                                                    <button 
                                                        onClick={() => setConfirmModal({ type: 'delete', item })}
                                                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                        title="Eliminar Definitivamente"
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

      {/* ================= MODALES ================= */}

      {/* 1. MODAL DE APROBACIÓN */}
      {approvingItem && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
                <div className="p-6 bg-indigo-50 border-b border-indigo-100">
                    <h3 className="text-lg font-black text-indigo-900 flex items-center gap-2">
                        <Check className="w-5 h-5 text-indigo-600"/> APROBAR CLIENTE
                    </h3>
                    <p className="text-xs text-indigo-600 mt-1 font-medium">{approvingItem.full_name}</p>
                </div>
                
                <div className="p-6 space-y-5">
                    {/* Duración */}
                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Duración Licencia</label>
                        <div className="grid grid-cols-4 gap-2 mb-2">
                            {[1, 3, 6, 12].map(m => (
                                <button key={m} onClick={() => setMonthsToGrant(m)} className={`py-2 text-xs font-bold rounded-lg border transition-all ${monthsToGrant === m ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white text-slate-500 hover:bg-slate-50 border-slate-200'}`}>
                                    {m}M
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* PIN Maestro */}
                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Asignar PIN Maestro</label>
                        <div className="relative">
                            <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                            <input 
                                type="text" maxLength={4}
                                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-mono text-lg font-bold text-slate-800 tracking-widest outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-center"
                                value={adminPin}
                                onChange={(e) => setAdminPin(e.target.value.replace(/\D/g,''))}
                                placeholder="0000"
                            />
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1.5 text-center">Este PIN se usará para acceder a la caja.</p>
                    </div>

                    {/* Acciones */}
                    <div className="flex gap-3 pt-2">
                        <button onClick={() => setApprovingItem(null)} className="flex-1 py-3 text-slate-500 font-bold bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors text-xs">CANCELAR</button>
                        <button onClick={executeApproval} className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg shadow-indigo-200 transition-all text-xs">CONFIRMAR</button>
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* 2. MODAL DE EXTENSIÓN */}
      {extendingItem && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
                <div className="p-6 bg-emerald-50 border-b border-emerald-100">
                    <h3 className="text-lg font-black text-emerald-900 flex items-center gap-2">
                        <CalendarPlus className="w-5 h-5 text-emerald-600"/> EXTENDER LICENCIA
                    </h3>
                    <p className="text-xs text-emerald-600 mt-1 font-medium">{extendingItem.full_name}</p>
                </div>
                
                <div className="p-6 space-y-6">
                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Meses a Añadir</label>
                        <div className="flex items-center justify-center gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                            <button onClick={() => setExtendMonths(Math.max(1, extendMonths - 1))} className="w-8 h-8 flex items-center justify-center bg-white rounded-full shadow-sm border border-slate-200 text-slate-600 hover:text-emerald-600 font-bold">-</button>
                            <span className="text-2xl font-bold text-slate-800 w-16 text-center">{extendMonths}</span>
                            <button onClick={() => setExtendMonths(extendMonths + 1)} className="w-8 h-8 flex items-center justify-center bg-white rounded-full shadow-sm border border-slate-200 text-slate-600 hover:text-emerald-600 font-bold">+</button>
                        </div>
                    </div>

                    <div className="flex gap-3">
                        <button onClick={() => setExtendingItem(null)} className="flex-1 py-3 text-slate-500 font-bold bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors text-xs">CANCELAR</button>
                        <button onClick={executeExtension} className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-lg shadow-emerald-200 transition-all text-xs">APLICAR</button>
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* 3. MODAL DE CONFIRMACIÓN (Suspensión / Eliminación) */}
      {confirmModal && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border-t-4 border-red-500">
                <div className="p-8 text-center">
                    <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <AlertOctagon className="w-8 h-8 text-red-500" />
                    </div>
                    <h3 className="text-xl font-black text-slate-800 mb-2">
                        {confirmModal.type === 'delete' ? '¿ELIMINAR USUARIO?' : '¿CAMBIAR ESTADO?'}
                    </h3>
                    <p className="text-sm text-slate-500 mb-6">
                        {confirmModal.type === 'delete' 
                            ? <>Estás a punto de borrar permanentemente a <strong>{confirmModal.item.full_name}</strong>. Esta acción no se puede deshacer.</>
                            : <>Estás a punto de {confirmModal.item.status === 'active' ? 'suspender' : 'reactivar'} el acceso de <strong>{confirmModal.item.full_name}</strong>.</>
                        }
                    </p>

                    <div className="flex gap-3">
                        <button onClick={() => setConfirmModal(null)} className="flex-1 py-3 text-slate-600 font-bold bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors text-xs">
                            CANCELAR
                        </button>
                        <button onClick={executeConfirmAction} className={`flex-1 py-3 text-white font-bold rounded-xl shadow-lg transition-all text-xs ${confirmModal.type === 'delete' ? 'bg-red-600 hover:bg-red-700 shadow-red-200' : 'bg-slate-800 hover:bg-black'}`}>
                            {confirmModal.type === 'delete' ? 'SÍ, ELIMINAR' : 'CONFIRMAR'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
      )}

    </div>
  );
}