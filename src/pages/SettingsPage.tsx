import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type BusinessConfig } from '../lib/db';
import { Save, Building2, MapPin, Phone, Receipt, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { addToQueue } from '../lib/sync';

export function SettingsPage() {
  // 1. Obtener ID del Negocio (Contexto de Seguridad)
  const businessId = localStorage.getItem('nexus_business_id');

  // 2. Cargar Configuración (Usamos businessId como Key directa)
  // Esto asegura que cargamos LA configuración de ESTE negocio, y no otra.
  const settings = useLiveQuery(async () => {
    if (!businessId) return null;
    return await db.settings.get(businessId);
  }, [businessId]);

  const [formData, setFormData] = useState<Partial<BusinessConfig>>({
    name: '',
    address: '',
    phone: '',
    receipt_message: '¡Gracias por su compra!'
  });

  const [isLoading, setIsLoading] = useState(false);

  // Cargar datos al formulario cuando lleguen de la DB
  useEffect(() => {
    if (settings) {
      setFormData({
        name: settings.name,
        address: settings.address || '',
        phone: settings.phone || '',
        receipt_message: settings.receipt_message || ''
      });
    } else if (businessId) {
      // Si no existe configuración, sugerimos valores por defecto
      setFormData(prev => ({ ...prev, name: 'Mi Negocio' }));
    }
  }, [settings, businessId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) return toast.error("Error de sesión: No hay ID de negocio");

    setIsLoading(true);
    try {
      // ✅ ESTRATEGIA: ID Determinista
      // El ID de la configuración ES el ID del negocio. 
      // Esto impide tener configuraciones duplicadas o "huerfanas".
      const configToSave: BusinessConfig = {
        id: businessId, 
        name: formData.name || 'Sin Nombre',
        address: formData.address,
        phone: formData.phone,
        receipt_message: formData.receipt_message,
        sync_status: settings ? 'pending_update' : 'pending_create'
      };

      // 1. Guardar en local
      await db.settings.put(configToSave);
      await addToQueue('SETTINGS_SYNC', configToSave);
      toast.success('Configuración guardada correctamente');

      // 2. Encolar sincronización (necesita soporte en backend para tabla 'businesses')
      // Nota: Asegúrate de que tu sync.ts maneje el tipo 'BUSINESS_SYNC' o similar si deseas esto.
      // Por ahora, lo guardamos localmente que es lo crítico para el POS.
      
      // Opcional: Si tienes lógica de sync para settings
      // await addToQueue('SETTINGS_SYNC', configToSave); 

      toast.success('Configuración guardada correctamente');
      
      // Forzar actualización visual si el nombre cambió en el header
      window.dispatchEvent(new Event('storage')); 

    } catch (error) {
      console.error(error);
      toast.error('Error al guardar configuración');
    } finally {
      setIsLoading(false);
    }
  };

  if (!businessId) return <div className="p-8 text-center">Inicia sesión para configurar tu negocio.</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto pb-24">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <Building2 className="text-indigo-600"/> Configuración del Negocio
        </h1>
        <p className="text-slate-500 text-sm">Personaliza la información que aparece en tus recibos.</p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <form onSubmit={handleSubmit} className="p-6 md:p-8 space-y-6">
          
          {/* Nombre del Negocio */}
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2">
                <Building2 size={14}/> Nombre Comercial
              </label>
              <input 
                type="text" 
                required
                className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none font-bold text-slate-700"
                value={formData.name}
                onChange={e => setFormData({...formData, name: e.target.value})}
                placeholder="Ej. Restaurante El Buen Sabor"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2">
                <Phone size={14}/> Teléfono / WhatsApp
              </label>
              <input 
                type="text" 
                className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                value={formData.phone}
                onChange={e => setFormData({...formData, phone: e.target.value})}
                placeholder="+53 5555 5555"
              />
            </div>
          </div>

          {/* Dirección */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2">
              <MapPin size={14}/> Dirección Física
            </label>
            <textarea 
              rows={2}
              className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
              value={formData.address}
              onChange={e => setFormData({...formData, address: e.target.value})}
              placeholder="Calle Principal #123, Ciudad..."
            />
          </div>

          <hr className="border-slate-100" />

          {/* Configuración de Recibos */}
          <div className="space-y-4">
            <h3 className="font-bold text-slate-700 flex items-center gap-2">
              <Receipt size={18} className="text-indigo-500"/> Personalización del Ticket
            </h3>
            
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase">Mensaje de Pie de Página</label>
              <input 
                type="text" 
                className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-center font-mono text-sm"
                value={formData.receipt_message}
                onChange={e => setFormData({...formData, receipt_message: e.target.value})}
                placeholder="¡Gracias por su visita!"
              />
              <p className="text-xs text-slate-400 text-center">Este mensaje aparecerá al final de todos los tickets impresos.</p>
            </div>
          </div>

          {/* Botón Guardar */}
          <div className="pt-4">
            <button 
              type="submit" 
              disabled={isLoading}
              className="w-full md:w-auto px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg shadow-indigo-200 transition-all flex items-center justify-center gap-2"
            >
              {isLoading ? <Loader2 className="animate-spin" /> : <><Save size={20} /> Guardar Cambios</>}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}