import { useState, useEffect } from 'react';

import { useLiveQuery } from 'dexie-react-hooks';
import { db, type BusinessConfig } from '../lib/db';
import { supabase } from '../lib/supabase';
import { 
  Save, Building2, Receipt, Loader2, 
  MonitorX, LogOut 
} from 'lucide-react';
import { toast } from 'sonner';
import { addToQueue, syncPush } from '../lib/sync';

export function SettingsPage() {
  const businessId = localStorage.getItem('nexus_business_id');

  // Consulta reactiva de la configuración local
  const settings = useLiveQuery(async () => {
    if (!businessId) return null;
    return await db.settings.get(businessId);
  }, [businessId]);

  const [formData, setFormData] = useState<Partial<BusinessConfig>>({
    name: '',
    address: '',
    phone: '',
    receipt_message: '¡Gracias por su preferencia!'
  });

  const [isLoading, setIsLoading] = useState(false);

  // Efecto para cargar los datos en el formulario cuando la DB esté lista
  useEffect(() => {
    if (settings) {
      setFormData({
        name: settings.name,
        address: settings.address || '',
        phone: settings.phone || '',
        receipt_message: settings.receipt_message || ''
      });
    }
  }, [settings]);

  // Manejador del formulario
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) {
        toast.error("Error: Sesión de negocio no encontrada.");
        return;
    }

    setIsLoading(true);
    try {
      const configToSave: BusinessConfig = {
        id: businessId, 
        name: formData.name?.trim() || 'Nexus Business',
        address: formData.address?.trim(),
        phone: formData.phone?.trim(),
        receipt_message: formData.receipt_message?.trim(),
        status: settings?.status || 'active',
        subscription_expires_at: settings?.subscription_expires_at,
        sync_status: 'pending_update'
      };

      // 1. Guardar localmente
      await db.settings.put(configToSave);

      // 2. Encolar para sincronización con Supabase
      await addToQueue('SETTINGS_SYNC', configToSave); 
      
      toast.success('Configuración actualizada correctamente');
      
      // Intentar subir los cambios de inmediato
      syncPush().catch(console.error);

    } catch (error) {
      console.error("Error saving settings:", error);
      toast.error('No se pudo guardar la configuración');
    } finally {
      setIsLoading(false);
    }
  };

  // Función para desvincular equipo y cerrar sesión
  const handleUnlinkDevice = async () => {
    const isConfirmed = confirm(
        "¿Cerrar sesión en este equipo?\n\nEsto permitirá que otro dispositivo use esta cuenta si tienes límites de licencia."
    );
    if (!isConfirmed) return;

    setIsLoading(true);
    
    try {
      // Intentar limpiar el hardware_id en la nube para liberar el cupo
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('profiles').update({ hardware_id: null }).eq('id', user.id);
      }
    } catch (error) {
      console.warn("No se pudo desvincular en la nube, continuando cierre local...", error);
    }

    try {
      // Limpiar datos locales y cerrar sesión
      await supabase.auth.signOut();
      localStorage.clear(); 
      toast.success("Sesión finalizada");
      
      // Redirigir al inicio para forzar recarga de estado
      setTimeout(() => window.location.href = '/', 500);

    } catch (error) {
      console.error("Logout error:", error);
      localStorage.clear();
      window.location.href = '/';
    }
  };

  if (!businessId) {
    return (
        <div className="flex items-center justify-center h-screen text-slate-500">
            Cargando identificador de negocio...
        </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto pb-24 animate-in fade-in duration-500">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <Building2 className="text-indigo-600"/> Perfil del Negocio
        </h1>
        <p className="text-slate-500 text-sm">Configura los datos que tus clientes verán en sus comprobantes.</p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <form onSubmit={handleSubmit} className="p-6 md:p-8 space-y-6">
          
          <div className="grid md:grid-cols-2 gap-6">
            {/* Nombre Comercial */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                Nombre de la Empresa
              </label>
              <input 
                type="text" 
                required
                className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none font-bold text-slate-700 bg-slate-50/30"
                value={formData.name}
                onChange={e => setFormData({...formData, name: e.target.value})}
                placeholder="Nombre del negocio"
              />
            </div>

            {/* Teléfono de Contacto */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                Teléfono / Contacto
              </label>
              <input 
                type="text" 
                className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none bg-slate-50/30"
                value={formData.phone}
                onChange={e => setFormData({...formData, phone: e.target.value})}
                placeholder="Ej. +53 5200 0000"
              />
            </div>
          </div>

          {/* Dirección Física */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
              Dirección del Local
            </label>
            <textarea 
              rows={2}
              className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none resize-none bg-slate-50/30"
              value={formData.address}
              onChange={e => setFormData({...formData, address: e.target.value})}
              placeholder="Calle, Número, Ciudad..."
            />
          </div>

          <div className="h-px bg-slate-100 my-2"></div>

          {/* Personalización de Recibos */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-slate-700 font-bold">
              <Receipt size={18} className="text-indigo-500"/>
              <span>Personalización de Recibos</span>
            </div>
            
            <div className="bg-indigo-50/30 p-4 rounded-2xl border border-indigo-50 space-y-3">
              <label className="text-[10px] font-bold text-indigo-400 uppercase">Mensaje al pie del ticket</label>
              <input 
                type="text" 
                className="w-full p-3 border border-indigo-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm bg-white text-center"
                value={formData.receipt_message}
                onChange={e => setFormData({...formData, receipt_message: e.target.value})}
              />
              <p className="text-[10px] text-slate-400 text-center uppercase tracking-tight font-medium">Este texto aparecerá al final de todas las impresiones.</p>
            </div>
          </div>

          {/* Botón de Acción Principal */}
          <div className="pt-4">
            <button 
              type="submit" 
              disabled={isLoading}
              className="w-full md:w-auto px-12 py-4 bg-slate-900 hover:bg-black text-white font-bold rounded-2xl shadow-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95"
            >
              {isLoading ? (
                <Loader2 className="animate-spin" />
              ) : (
                <>
                  <Save size={20} /> 
                  <span>Guardar Configuración</span>
                </>
              )}
            </button>
          </div>

        </form>
      </div>

      {/* SECCIÓN DE CIERRE DE SESIÓN SEGURO */}
      <div className="mt-12 p-8 bg-white rounded-3xl border border-red-100 flex flex-col md:flex-row justify-between items-center gap-6 shadow-sm">
        <div className="text-center md:text-left">
          <h3 className="font-bold text-slate-800 flex items-center justify-center md:justify-start gap-2 mb-1">
            <MonitorX size={20} className="text-red-500"/> 
            Cerrar Sesión en este dispositivo
          </h3>
          <p className="text-xs text-slate-400 max-w-sm">Si vas a cambiar de equipo, usa esta opción para liberar tu licencia y proteger tus datos.</p>
        </div>
        
        <button 
          type="button" 
          onClick={handleUnlinkDevice}
          className="w-full md:w-auto px-8 py-3 bg-red-50 border border-red-100 text-red-600 font-bold rounded-xl hover:bg-red-600 hover:text-white transition-all flex items-center justify-center gap-2 text-sm"
        >
          <LogOut size={18} /> 
          <span>Desvincular Dispositivo</span>
        </button>
      </div>
    </div>
  );
}