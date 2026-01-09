import { useEffect, useState } from 'react';
import { db } from '../lib/db';
import { supabase } from '../lib/supabase';
import { syncPull } from '../lib/sync';

export function SettingsPage() {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    address: '',
    phone: '',
    receipt_message: ''
  });

  // Cargar datos al entrar (desde Dexie para ser rápido)
  useEffect(() => {
    db.settings.get('my-business').then(config => {
      if (config) {
        setFormData({
          name: config.name || '',
          address: config.address || '',
          phone: config.phone || '',
          receipt_message: config.receipt_message || ''
        });
      } else {
        // Si no hay local, intentamos sincronizar
        syncPull(); 
      }
    });
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // 1. Obtener ID del negocio
      const { data: { session } } = await supabase.auth.getSession();
      const { data: perfil } = await supabase.from('profiles').select('business_id').eq('id', session?.user.id).single();
      
      if (!perfil) throw new Error("No business found");

      // 2. Actualizar en Nube (Supabase)
      const { error } = await supabase
        .from('businesses')
        .update({
          name: formData.name,
          address: formData.address,
          phone: formData.phone,
          receipt_message: formData.receipt_message
        })
        .eq('id', perfil.business_id);

      if (error) throw error;

      // 3. Actualizar en Local (Dexie)
      await db.settings.put({
        id: 'my-business',
        ...formData
      });

      alert("✅ Configuración guardada correctamente");

    } catch (error) {
      console.error(error);
      alert("Error al guardar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">⚙️ Configuración del Negocio</h1>
      
      <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-100">
        <form onSubmit={handleSave} className="space-y-4">
          
          <div>
            <label className="block text-sm font-medium text-slate-700">Nombre del Negocio</label>
            <input 
              required
              type="text" 
              className="w-full mt-1 p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              value={formData.name}
              onChange={e => setFormData({...formData, name: e.target.value})}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Dirección</label>
            <input 
              type="text" 
              placeholder="Ej: Calle Independencia #123, Centro"
              className="w-full mt-1 p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              value={formData.address}
              onChange={e => setFormData({...formData, address: e.target.value})}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Teléfono / WhatsApp</label>
            <input 
              type="text" 
              placeholder="+53 5555 5555"
              className="w-full mt-1 p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              value={formData.phone}
              onChange={e => setFormData({...formData, phone: e.target.value})}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Mensaje pie de ticket</label>
            <input 
              type="text" 
              placeholder="¡Gracias por su compra!"
              className="w-full mt-1 p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              value={formData.receipt_message}
              onChange={e => setFormData({...formData, receipt_message: e.target.value})}
            />
            <p className="text-xs text-slate-400 mt-1">Este mensaje aparecerá al final de todos los recibos.</p>
          </div>

          <div className="pt-4">
            <button 
              disabled={loading}
              className="w-full bg-slate-900 text-white font-bold py-3 rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              {loading ? 'Guardando...' : 'Guardar Cambios'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}