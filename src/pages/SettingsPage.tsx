import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Save, Store, Phone, MapPin, FileText, Loader2, LogOut, AlertTriangle } from 'lucide-react';

export function SettingsPage() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    address: '',
    receipt_message: ''
  });

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const businessId = localStorage.getItem('nexus_business_id');
      if (!businessId) return;

      const { data, error } = await supabase
        .from('businesses')
        .select('name, phone, address, receipt_message')
        .eq('id', businessId)
        .single();

      if (error) throw error;

      if (data) {
        setFormData({
            name: data.name || '',
            phone: data.phone || '',
            address: data.address || '',
            receipt_message: data.receipt_message || ''
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const businessId = localStorage.getItem('nexus_business_id');
      if (!businessId) return;

      const { error } = await supabase
        .from('businesses')
        .update({
            name: formData.name,
            phone: formData.phone,
            address: formData.address,
            receipt_message: formData.receipt_message
        })
        .eq('id', businessId);

      if (error) throw error;
      alert("✅ Configuración actualizada correctamente");
    } catch (err) {
      console.error(err);
      alert("Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  // --- NUEVA FUNCIÓN PARA CERRAR SESIÓN DEL NEGOCIO ---
  const handleUnlinkDevice = async () => {
    if (!confirm("⚠️ ¿Cerrar sesión del negocio?\n\nEsto desconectará el dispositivo. Tendrás que ingresar tu correo y contraseña nuevamente para entrar.")) return;
    
    // 1. Limpiamos las llaves de acceso local
    localStorage.removeItem('nexus_device_authorized');
    localStorage.removeItem('nexus_business_id');
    localStorage.removeItem('nexus_last_verification');
    
    // 2. Cerramos la sesión de Supabase por seguridad
    await supabase.auth.signOut();

    // 3. Recargamos la página para que App.tsx nos mande al LoginScreen
    window.location.reload();
  };

  if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin"/></div>;

  return (
    <div className="p-6 max-w-4xl mx-auto pb-20">
      <h1 className="text-2xl font-bold text-slate-800 mb-6 flex items-center gap-2">
        <Store className="text-indigo-600"/> Configuración del Negocio
      </h1>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 mb-8">
        <form onSubmit={handleSave} className="space-y-6">
            
            {/* NOMBRE DEL NEGOCIO */}
            <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">Nombre del Establecimiento</label>
                <div className="relative">
                    <Store className="absolute left-3 top-3 text-slate-400 w-5 h-5" />
                    <input 
                        type="text" 
                        value={formData.name}
                        onChange={e => setFormData({...formData, name: e.target.value})}
                        className="w-full pl-10 pr-4 py-3 border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                        placeholder="Ej. Tienda Nexus"
                    />
                </div>
                <p className="text-xs text-slate-400 mt-1">Este nombre aparecerá en los tickets.</p>
            </div>

            {/* TELÉFONO */}
            <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">Teléfono de Contacto</label>
                <div className="relative">
                    <Phone className="absolute left-3 top-3 text-slate-400 w-5 h-5" />
                    <input 
                        type="tel" 
                        value={formData.phone}
                        onChange={e => setFormData({...formData, phone: e.target.value})}
                        className="w-full pl-10 pr-4 py-3 border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                        placeholder="Ej. +53 5555 5555"
                    />
                </div>
            </div>

            {/* DIRECCIÓN */}
            <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">Dirección del Local</label>
                <div className="relative">
                    <MapPin className="absolute left-3 top-3 text-slate-400 w-5 h-5" />
                    <input 
                        type="text" 
                        value={formData.address}
                        onChange={e => setFormData({...formData, address: e.target.value})}
                        className="w-full pl-10 pr-4 py-3 border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                        placeholder="Calle Principal #123"
                    />
                </div>
            </div>

            {/* MENSAJE DEL TICKET */}
            <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">Mensaje al Pie del Recibo</label>
                <div className="relative">
                    <FileText className="absolute left-3 top-3 text-slate-400 w-5 h-5" />
                    <textarea 
                        value={formData.receipt_message}
                        onChange={e => setFormData({...formData, receipt_message: e.target.value})}
                        className="w-full pl-10 pr-4 py-3 border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none h-24 resize-none"
                        placeholder="Gracias por su visita..."
                    />
                </div>
            </div>

            <hr className="border-slate-100"/>

            <button 
                type="submit" 
                disabled={saving}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-xl shadow-lg shadow-indigo-200 transition-all active:scale-95 flex items-center justify-center gap-2"
            >
                {saving ? <Loader2 className="animate-spin"/> : <><Save size={20}/> Guardar Cambios</>}
            </button>

        </form>
      </div>

      {/* --- ZONA DE PELIGRO (LOGOUT) --- */}
      <div className="bg-red-50 border border-red-100 rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
            <h3 className="text-red-800 font-bold flex items-center gap-2 mb-1">
                <AlertTriangle size={20}/> Zona de Peligro
            </h3>
            <p className="text-red-600 text-sm">
                ¿Deseas cerrar la sesión en este dispositivo? Tendrás que loguearte de nuevo.
            </p>
        </div>
        <button 
            onClick={handleUnlinkDevice}
            className="whitespace-nowrap px-6 py-3 bg-white border border-red-200 text-red-600 font-bold rounded-xl hover:bg-red-100 transition-colors flex items-center gap-2 shadow-sm"
        >
            <LogOut size={18}/> Desvincular Dispositivo
        </button>
      </div>
    </div>
  );
}