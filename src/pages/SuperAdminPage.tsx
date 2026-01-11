import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
// ✅ CORRECCIÓN: Eliminado 'Calendar' que no se usaba
import { Shield, Check, X, Search, RefreshCw, UserCheck, Inbox, CalendarPlus, Key, User } from 'lucide-react';

interface Profile {
  id: string;
  full_name: string;
  phone: string;
  months_requested: number;
  status: string; // 'pending' | 'active' | 'rejected'
  created_at: string;
  initial_pin: string;
  license_expiry?: string;
  business_id?: string;
  email?: string;
}

export function SuperAdminPage() {
  const [activeTab, setActiveTab] = useState<'requests' | 'active'>('requests');
  const [dataList, setDataList] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  // MODALES
  const [approvingItem, setApprovingItem] = useState<Profile | null>(null);
  const [extendingItem, setExtendingItem] = useState<Profile | null>(null);
  
  // FORMULARIOS AUXILIARES
  const [monthsToGrant, setMonthsToGrant] = useState(1);
  const [extendMonths, setExtendMonths] = useState(1);

  // --- 1. CARGAR DATOS ---
  const fetchData = async () => {
    setLoading(true);
    const statusFilter = activeTab === 'requests' ? 'pending' : 'active';
    
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('status', statusFilter)
      .order('created_at', { ascending: false });

    if (!error && data) {
      // ✅ CORRECCIÓN: Casteo seguro a Profile[]
      setDataList(data as Profile[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  // --- 2. FUNCIÓN: APROBAR SOLICITUD ---
  const handleApprove = async () => {
    if (!approvingItem) return;

    const expiryDate = new Date();
    expiryDate.setMonth(expiryDate.getMonth() + monthsToGrant);

    const { error } = await supabase
      .from('profiles')
      .update({
        status: 'active',
        business_id: crypto.randomUUID(),
        license_expiry: expiryDate.toISOString()
      })
      .eq('id', approvingItem.id);

    if (error) alert("Error: " + error.message);
    else {
      alert(`✅ Usuario Aprobado. Podrá entrar con su PIN: ${approvingItem.initial_pin}`);
      setApprovingItem(null);
      fetchData();
    }
  };

  // --- 3. FUNCIÓN: EXTENDER LICENCIA ---
  const handleExtend = async () => {
    if (!extendingItem) return;

    try {
      const now = new Date();
      const currentExpiry = extendingItem.license_expiry ? new Date(extendingItem.license_expiry) : new Date();
      const startDate = currentExpiry > now ? currentExpiry : now;
      
      const newExpiry = new Date(startDate);
      newExpiry.setMonth(newExpiry.getMonth() + extendMonths);

      const { error } = await supabase
        .from('profiles')
        .update({ license_expiry: newExpiry.toISOString() })
        .eq('id', extendingItem.id);

      if (error) throw error;

      alert("✅ Licencia extendida exitosamente.");
      setExtendingItem(null);
      fetchData();
    } catch (err: unknown) { // ✅ CORRECCIÓN: Tipo seguro
      const msg = err instanceof Error ? err.message : "Error desconocido";
      alert("Error al extender: " + msg);
    }
  };

  // --- 4. FUNCIÓN: REVOCAR ---
  const handleRevoke = async (id: string) => {
    if (!confirm("¿Estás seguro de quitar el acceso a este usuario?")) return;
    
    const { error } = await supabase
      .from('profiles')
      .update({ status: 'rejected', business_id: null })
      .eq('id', id);

    if (error) alert("Error al revocar");
    else fetchData();
  };

  const handleRejectRequest = async (id: string) => {
    if (!confirm("¿Rechazar solicitud permanentemente?")) return;
    await supabase.from('profiles').update({ status: 'rejected' }).eq('id', id);
    fetchData();
  };

  // Filtrado local
  const filteredData = dataList.filter(item => 
    item.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    item.id.includes(searchTerm)
  );

  return (
    <div className="p-6 bg-slate-50 min-h-screen">
      
      <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Shield className="text-purple-600" /> Super Admin
          </h1>
          <p className="text-slate-500 text-sm">Control Maestro de Licencias</p>
        </div>
        
        <div className="flex gap-2">
            <div className="relative">
                <Search className="absolute left-3 top-2.5 text-slate-400 w-4 h-4"/>
                <input 
                    type="text" 
                    placeholder="Buscar cliente..." 
                    className="pl-9 pr-4 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-purple-200"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>
            <button onClick={fetchData} className="p-2 bg-white border rounded-lg hover:bg-slate-100">
                <RefreshCw size={20} className={loading ? 'animate-spin' : ''}/>
            </button>
        </div>
      </div>

      <div className="flex gap-4 mb-6 border-b border-slate-200">
        <button 
          onClick={() => { setActiveTab('requests'); setSearchTerm(''); }}
          className={`pb-2 px-4 font-bold text-sm flex items-center gap-2 border-b-2 transition-colors ${activeTab === 'requests' ? 'text-indigo-600 border-indigo-600' : 'text-slate-400 border-transparent hover:text-slate-600'}`}
        >
          <Inbox size={18} /> Solicitudes Pendientes
        </button>
        <button 
          onClick={() => { setActiveTab('active'); setSearchTerm(''); }}
          className={`pb-2 px-4 font-bold text-sm flex items-center gap-2 border-b-2 transition-colors ${activeTab === 'active' ? 'text-indigo-600 border-indigo-600' : 'text-slate-400 border-transparent hover:text-slate-600'}`}
        >
          <UserCheck size={18} /> Usuarios Activos
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {filteredData.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            {loading ? 'Cargando...' : 'No se encontraron registros.'}
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500 uppercase text-xs">
              <tr>
                <th className="p-4">Cliente</th>
                <th className="p-4">Contacto</th>
                <th className="p-4">Info Licencia</th>
                <th className="p-4 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredData.map(item => (
                <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                  
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                            <User size={16} />
                        </div>
                        <div>
                            <p className="font-bold text-slate-800">{item.full_name || 'Sin nombre'}</p>
                            <p className="text-xs text-slate-400 font-mono">ID: {item.id.slice(0,8)}</p>
                        </div>
                    </div>
                  </td>

                  <td className="p-4 text-slate-600">
                    <p>{item.phone || 'No telf'}</p>
                    {item.initial_pin && (
                        <div className="flex items-center gap-1 mt-1 text-xs text-slate-500">
                            <Key size={12}/> PIN: <span className="font-mono font-bold bg-slate-100 px-1 rounded">{item.initial_pin}</span>
                        </div>
                    )}
                  </td>
                  
                  <td className="p-4">
                    {activeTab === 'requests' ? (
                      <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded-full text-xs font-bold">
                        Solicita: {item.months_requested} Meses
                      </span>
                    ) : (
                      <div className="flex flex-col">
                        <span className="text-xs text-slate-400">Vence el:</span>
                        <span className={`font-bold ${new Date(item.license_expiry!) < new Date() ? 'text-red-600' : 'text-green-600'}`}>
                          {item.license_expiry ? new Date(item.license_expiry).toLocaleDateString() : 'Indefinido'}
                        </span>
                      </div>
                    )}
                  </td>

                  <td className="p-4 flex justify-center gap-2">
                    {activeTab === 'requests' ? (
                      <>
                        <button 
                            onClick={() => { setApprovingItem(item); setMonthsToGrant(item.months_requested); }} 
                            className="p-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors" 
                            title="Aprobar"
                        >
                            <Check size={18}/>
                        </button>
                        <button 
                            onClick={() => handleRejectRequest(item.id)} 
                            className="p-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors" 
                            title="Rechazar"
                        >
                            <X size={18}/>
                        </button>
                      </>
                    ) : (
                      <>
                        <button 
                            onClick={() => setExtendingItem(item)} 
                            className="p-2 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 flex items-center gap-1 font-bold text-xs transition-colors"
                        >
                            <CalendarPlus size={16}/> Extender
                        </button>
                        <button 
                            onClick={() => handleRevoke(item.id)} 
                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Revocar Acceso"
                        >
                            <X size={18} />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {approvingItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-bold text-slate-800 mb-4">Aprobar Solicitud</h3>
            <p className="text-sm text-slate-500 mb-4">Cliente: <span className="font-bold text-indigo-600">{approvingItem.full_name}</span></p>
            <div className="mb-4">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tiempo a Otorgar (Meses)</label>
                <input type="number" value={monthsToGrant} onChange={(e) => setMonthsToGrant(Number(e.target.value))} className="w-full p-2 border border-slate-300 rounded-lg font-bold outline-none focus:border-indigo-500"/>
            </div>
            <div className="flex gap-2">
                <button onClick={() => setApprovingItem(null)} className="flex-1 py-2 text-slate-600 font-bold bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors">Cancelar</button>
                <button onClick={handleApprove} className="flex-1 py-2 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 transition-colors">Confirmar y Activar</button>
            </div>
          </div>
        </div>
      )}

      {extendingItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-bold text-slate-800 mb-4">Extender Licencia</h3>
            <p className="text-sm text-slate-500 mb-4">Cliente: <span className="font-bold text-indigo-600">{extendingItem.full_name}</span></p>
            <div className="mb-4">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Meses a Añadir</label>
                <div className="flex gap-2 mb-2">
                    {[1, 3, 6, 12].map(m => (
                        <button key={m} onClick={() => setExtendMonths(m)} className={`flex-1 py-1 text-xs font-bold rounded border transition-colors ${extendMonths === m ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{m}M</button>
                    ))}
                </div>
                <input type="number" value={extendMonths} onChange={(e) => setExtendMonths(Number(e.target.value))} className="w-full p-2 border border-slate-300 rounded-lg font-bold mt-2 text-center outline-none focus:border-indigo-500"/>
            </div>
            <div className="flex gap-2">
                <button onClick={() => setExtendingItem(null)} className="flex-1 py-2 text-slate-600 font-bold bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors">Cancelar</button>
                <button onClick={handleExtend} className="flex-1 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 transition-colors">Aplicar Extensión</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}