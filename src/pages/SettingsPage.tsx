import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom'; // ✅ Para redirigir al Login
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type BusinessConfig } from '../lib/db';
import { supabase } from '../lib/supabase'; // ✅ Para desvincular en la nube
import { 
  Save, Building2, MapPin, Phone, Receipt, Loader2, 
  MonitorX, LogOut // ✅ Iconos nuevos
} from 'lucide-react';
import { toast } from 'sonner';
import { addToQueue } from '../lib/sync';

export function SettingsPage() {
  const navigate = useNavigate();

  // 1. Obtener ID del Negocio (Contexto de Seguridad)
  const businessId = localStorage.getItem('nexus_business_id');

  // 2. Cargar Configuración
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
      setFormData(prev => ({ ...prev, name: 'Mi Negocio' }));
    }
  }, [settings, businessId]);

  // --- FUNCIÓN GUARDAR CONFIGURACIÓN ---
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) return toast.error("Error de sesión: No hay ID de negocio");

    setIsLoading(true);
    try {
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

      // 2. Encolar sincronización
      await addToQueue('SETTINGS_SYNC', configToSave); 

      toast.success('Configuración guardada correctamente');
      
      // Forzar actualización visual global
      window.dispatchEvent(new Event('storage')); 

    } catch (error) {
      console.error(error);
      toast.error('Error al guardar configuración');
    } finally {
      setIsLoading(false);
    }
  };

  // --- FUNCIÓN DESVINCULAR DISPOSITIVO ---
  const handleUnlinkDevice = async () => {
    if (!confirm("¿Estás a punto de cambiar de computadora?\n\nAl desvincular, se cerrará tu sesión aquí y tu licencia quedará libre para usarse en otro equipo.")) return;

    setIsLoading(true);
    try {
      // 1. Obtener usuario actual para seguridad
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No hay sesión activa en la nube.");

      // 2. Borrar la huella de hardware en la base de datos (Nube)
      const { error } = await supabase
        .from('profiles')
        .update({ hardware_id: null })
        .eq('id', user.id);

      if (error) throw error;

      // 3. Limpiar rastro local
      localStorage.removeItem('nexus_hardware_id');

      // 4. Cerrar sesión y mandar al Login
      await supabase.auth.signOut();
      toast.success("Dispositivo desvinculado. Ya puedes entrar en otra PC.");
      navigate('/login');

    } catch (error) {
      console.error(error);
      toast.error("Error al desvincular. Verifica tu conexión a internet.");
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
        <p className="text-slate-500 text-sm">Personaliza la información de tu empresa y gestiona tu licencia.</p>
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

          <hr className="border-slate-100 my-6" />

          {/* ZONA DE DISPOSITIVO (NUEVA SECCIÓN) */}
          <div className="bg-orange-50/50 rounded-xl p-5 border border-orange-100">
            <h3 className="font-bold text-slate-700 flex items-center gap-2 mb-2">
              <MonitorX size={18} className="text-orange-500"/> Gestión de Dispositivo
            </h3>
            <p className="text-xs text-slate-500 mb-4 leading-relaxed">
              Este equipo está vinculado a tu licencia. Si deseas usar el sistema en otra computadora (por ejemplo, en casa o en otra sucursal), debes liberar la licencia primero.
            </p>
            
            <button 
              type="button" // Importante: type="button" para no enviar el form
              onClick={handleUnlinkDevice}
              disabled={isLoading}
              className="w-full py-3 bg-white border border-slate-300 text-slate-700 font-bold rounded-xl hover:bg-white hover:text-orange-600 hover:border-orange-300 transition-all flex items-center justify-center gap-2 shadow-sm"
            >
              <LogOut size={18} /> Liberar Licencia y Cerrar Sesión
            </button>
          </div>

          {/* Botón Guardar Principal */}
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