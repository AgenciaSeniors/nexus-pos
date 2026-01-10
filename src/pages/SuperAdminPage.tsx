import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Building2, Key, RefreshCw, Trash2, ShieldCheck, AlertTriangle } from 'lucide-react';

interface BusinessProfile {
  id: string;
  business_id: string;
  email?: string;
  updated_at: string;
}

export function SuperAdminPage() {
  const [profiles, setProfiles] = useState<BusinessProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [newBizId, setNewBizId] = useState('');

  // 1. Función pura para obtener datos (NO modifica el estado directamente)
  const getProfilesData = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('updated_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching profiles:', error);
      return [];
    }
    return (data as BusinessProfile[]) || [];
  };

  // 2. Efecto de Carga Inicial (Seguro y aislado)
  useEffect(() => {
    let mounted = true; // Evita actualizar si el componente se desmontó

    const init = async () => {
      const data = await getProfilesData();
      if (mounted) {
        setProfiles(data);
        setLoading(false);
      }
    };

    init();

    return () => { mounted = false; };
  }, []); // Sin dependencias, solo se ejecuta al montar

  // 3. Función para el botón de refrescar
  const handleManualRefresh = async () => {
    setLoading(true);
    const data = await getProfilesData();
    setProfiles(data);
    setLoading(false);
  };

  const generateId = () => {
    const random = Math.floor(1000 + Math.random() * 9000);
    setNewBizId(`NEX-${random}`);
  };

  return (
    <div className="p-8 max-w-6xl mx-auto pb-24">
      <div className="flex items-center gap-4 mb-8">
        <div className="bg-red-600 p-3 rounded-xl shadow-lg shadow-red-200">
          <ShieldCheck className="text-white w-8 h-8" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Panel Super Admin</h1>
          <p className="text-slate-500">Gestión Global de Licencias y Negocios</p>
        </div>
      </div>

      {/* GENERADOR DE ID */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 mb-8">
        <h2 className="font-bold text-lg mb-4 flex items-center gap-2">
          <Key className="text-indigo-600" /> Generador de IDs
        </h2>
        <div className="flex gap-4 items-end bg-slate-50 p-4 rounded-xl">
          <div className="flex-1">
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nuevo Business ID</label>
            <div className="text-3xl font-mono font-bold text-slate-800 tracking-wider">
              {newBizId || '----'}
            </div>
          </div>
          <button onClick={generateId} className="bg-white border border-slate-300 text-slate-700 hover:text-indigo-600 px-4 py-2 rounded-lg font-medium flex items-center gap-2 shadow-sm transition-all">
            <RefreshCw size={18} /> Generar Nuevo
          </button>
          <button 
            onClick={() => {navigator.clipboard.writeText(newBizId); alert("Copiado!");}}
            disabled={!newBizId}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg font-bold shadow-lg shadow-indigo-200 transition-all disabled:opacity-50"
          >
            Copiar
          </button>
        </div>
        <p className="text-sm text-slate-400 mt-2">
          <AlertTriangle size={14} className="inline mr-1" />
          Dale este ID al cliente. Él deberá ponerlo en su pantalla de "Configuración" para activar su licencia.
        </p>
      </div>

      {/* LISTA DE NEGOCIOS */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
          <h2 className="font-bold text-lg flex items-center gap-2">
            <Building2 className="text-slate-400" /> Negocios Activos ({profiles.length})
          </h2>
          <button onClick={handleManualRefresh} className="text-indigo-600 hover:bg-indigo-50 p-2 rounded-full transition-colors">
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        
        <table className="w-full text-left border-collapse">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-bold">
            <tr>
              <th className="p-4">Business ID</th>
              <th className="p-4">ID de Usuario (Owner)</th>
              <th className="p-4">Última Actividad</th>
              <th className="p-4 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && profiles.length === 0 ? (
              <tr><td colSpan={4} className="p-8 text-center text-slate-400">Cargando datos...</td></tr>
            ) : profiles.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                <td className="p-4 font-mono font-bold text-indigo-600">{p.business_id || 'Sin Asignar'}</td>
                <td className="p-4 text-xs font-mono text-slate-500">{p.id}</td>
                <td className="p-4 text-sm text-slate-600">{new Date(p.updated_at).toLocaleDateString()}</td>
                <td className="p-4 text-right">
                  <button className="text-red-400 hover:text-red-600 hover:bg-red-50 p-2 rounded transition-colors" title="Desvincular (Cuidado)">
                    <Trash2 size={18} />
                  </button>
                </td>
              </tr>
            ))}
            {profiles.length === 0 && !loading && (
              <tr><td colSpan={4} className="p-8 text-center text-slate-400">No hay negocios registrados aún.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}