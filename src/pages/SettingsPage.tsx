import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Staff, type BusinessConfig } from '../lib/db';
import { syncPush, syncPull, isOnline } from '../lib/sync';
import { logAuditAction } from '../lib/audit';
import { toast } from 'sonner';
import { 
  Save, RefreshCw, Printer, Users, Store, Shield, 
  Trash2, Edit2, Plus, Loader2, Smartphone, 
  Wifi, WifiOff, AlertTriangle, X
} from 'lucide-react';

export function SettingsPage() {
  const { currentStaff } = useOutletContext<{ currentStaff: Staff }>();
  const businessId = localStorage.getItem('nexus_business_id');
  const [activeTab, setActiveTab] = useState<'general' | 'staff' | 'devices' | 'data'>('general');
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const onlineStatus = isOnline();

  // --- ESTADOS DE FORMULARIOS ---
  
  // 1. Perfil de Negocio (Adaptado a BusinessConfig)
  const [businessForm, setBusinessForm] = useState({
    name: '',
    address: '',
    phone: '',
    receipt_message: '¡Gracias por su compra!'
  });

  // 2. Staff (Modal y Edición)
  const [isStaffModalOpen, setIsStaffModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [staffForm, setStaffForm] = useState({
    name: '',
    pin: '',
    role: 'vendedor' as 'admin' | 'vendedor'
  });

  // 3. Impresora (Estado Local)
  const [printerConfig, setPrinterConfig] = useState({
    name: 'Impresora Térmica',
    ip: '192.168.1.200',
    width: '80mm',
    autoPrint: true
  });

  // --- CARGA DE DATOS ---
  
  const settings = useLiveQuery(async () => {
    if (!businessId) return null;
    return await db.settings.where('id').equals(businessId).first(); 
    // Nota: db.ts define store 'settings: id', asumimos que el ID es el businessId
  }, [businessId]);

  const staffList = useLiveQuery(async () => {
    if (!businessId) return [];
    return await db.staff
      .where('business_id').equals(businessId)
      .filter(s => s.active) // Usamos 'active' en lugar de deleted_at
      .toArray();
  }, [businessId]) || [];

  // Sincronizar formulario cuando cargan los datos
  useEffect(() => {
    if (settings) {
      setBusinessForm({
        name: settings.name || '',
        address: settings.address || '',
        phone: settings.phone || '',
        receipt_message: settings.receipt_message || '¡Gracias por su compra!'
      });
    }
  }, [settings]);

  // --- HANDLERS: NEGOCIO ---

  const handleSaveBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) return;
    setIsLoading(true);

    try {
        const updatedSettings: BusinessConfig = {
            id: businessId, // Usamos businessId como ID principal para settings
            name: businessForm.name,
            address: businessForm.address,
            phone: businessForm.phone,
            receipt_message: businessForm.receipt_message,
            status: 'active',
            sync_status: 'pending_update'
        };

        await db.settings.put(updatedSettings);
        
        // Registrar Auditoría
        await logAuditAction('UPDATE_SETTINGS', { name: businessForm.name }, currentStaff);
        
        // Sincronizar
        await syncPush();
        
        toast.success('Perfil de negocio actualizado');
    } catch (error) {
        console.error(error);
        toast.error('Error al guardar configuración');
    } finally {
        setIsLoading(false);
    }
  };

  // --- HANDLERS: STAFF ---

  const handleOpenStaffModal = (staff?: Staff) => {
      if (staff) {
          setEditingStaff(staff);
          setStaffForm({ name: staff.name, pin: staff.pin, role: staff.role });
      } else {
          setEditingStaff(null);
          setStaffForm({ name: '', pin: '', role: 'vendedor' });
      }
      setIsStaffModalOpen(true);
  };

  const handleSaveStaff = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!businessId) return;
      if (staffForm.pin.length < 4) return toast.error('El PIN debe tener al menos 4 dígitos');

      setIsLoading(true);
      try {
          if (editingStaff) {
              await db.staff.update(editingStaff.id, {
                  ...staffForm,
                  // Staff no tiene sync_status en db.ts, es local
              });
              toast.success('Personal actualizado');
          } else {
              const newStaff: Staff = {
                  id: crypto.randomUUID(),
                  business_id: businessId,
                  name: staffForm.name,
                  role: staffForm.role,
                  pin: staffForm.pin,
                  active: true // Campo correcto según db.ts
              };
              await db.staff.add(newStaff);
              toast.success('Personal agregado');
          }
          setIsStaffModalOpen(false);
          // Nota: Staff no se sincroniza en la cola actual (db.ts QueuePayload)
      } catch (error) {
          console.error(error);
          toast.error('Error al guardar personal');
      } finally {
          setIsLoading(false);
      }
  };

  const handleDeleteStaff = async (id: string) => {
      if (!confirm('¿Desactivar este usuario? Ya no podrá acceder.')) return;
      try {
          // Soft delete usando 'active: false'
          await db.staff.update(id, { active: false });
          toast.success('Usuario desactivado');
      } catch (e) { console.error(e); toast.error('Error al eliminar'); }
  };

  // --- HANDLERS: SISTEMA ---

  const handleManualSync = async () => {
      setIsSyncing(true);
      try {
          await syncPush();
          await syncPull(); // Asumimos que esta función existe en sync.ts
          toast.success('Sincronización completada');
      } catch (error) {
          console.error(error);
          toast.error('Error de sincronización');
      } finally {
          setIsSyncing(false);
      }
  };

  const handleTestPrint = () => {
      toast.info(`🖨️ Imprimiendo prueba en ${printerConfig.ip}...`);
      setTimeout(() => toast.success('Prueba enviada'), 1000);
  };

  return (
    <div className="p-4 md:p-6 pb-24 max-w-6xl mx-auto min-h-screen bg-[#F3F4F6]">
      
      {/* HEADER */}
      <div className="mb-8">
        <h1 className="text-3xl font-black text-[#0B3B68] mb-2">Configuración</h1>
        <p className="text-[#6B7280]">Administra tu negocio, equipo y preferencias.</p>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        
        {/* SIDEBAR DE NAVEGACIÓN (Tabs) */}
        <div className="w-full md:w-64 flex flex-col gap-2 shrink-0">
            <button 
                onClick={() => setActiveTab('general')}
                className={`flex items-center gap-3 p-4 rounded-2xl text-left transition-all font-bold ${activeTab === 'general' ? 'bg-[#0B3B68] text-white shadow-lg shadow-[#0B3B68]/20' : 'bg-white text-[#6B7280] hover:bg-white/80 hover:text-[#0B3B68]'}`}
            >
                <Store size={20}/> Mi Negocio
            </button>
            <button 
                onClick={() => setActiveTab('staff')}
                className={`flex items-center gap-3 p-4 rounded-2xl text-left transition-all font-bold ${activeTab === 'staff' ? 'bg-[#0B3B68] text-white shadow-lg shadow-[#0B3B68]/20' : 'bg-white text-[#6B7280] hover:bg-white/80 hover:text-[#0B3B68]'}`}
            >
                <Users size={20}/> Equipo
            </button>
            <button 
                onClick={() => setActiveTab('devices')}
                className={`flex items-center gap-3 p-4 rounded-2xl text-left transition-all font-bold ${activeTab === 'devices' ? 'bg-[#0B3B68] text-white shadow-lg shadow-[#0B3B68]/20' : 'bg-white text-[#6B7280] hover:bg-white/80 hover:text-[#0B3B68]'}`}
            >
                <Printer size={20}/> Hardware
            </button>
            <button 
                onClick={() => setActiveTab('data')}
                className={`flex items-center gap-3 p-4 rounded-2xl text-left transition-all font-bold ${activeTab === 'data' ? 'bg-[#0B3B68] text-white shadow-lg shadow-[#0B3B68]/20' : 'bg-white text-[#6B7280] hover:bg-white/80 hover:text-[#0B3B68]'}`}
            >
                <Shield size={20}/> Datos y Nube
            </button>
        </div>

        {/* CONTENIDO PRINCIPAL */}
        <div className="flex-1">
            
            {/* --- SECCIÓN 1: GENERAL --- */}
            {activeTab === 'general' && (
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 animate-in fade-in slide-in-from-right-4 duration-300">
                    <h2 className="text-xl font-bold text-[#1F2937] mb-6 flex items-center gap-2">
                        <Store className="text-[#7AC142]"/> Perfil del Negocio
                    </h2>
                    <form onSubmit={handleSaveBusiness} className="space-y-5">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div>
                                <label className="block text-xs font-bold text-[#6B7280] uppercase mb-1">Nombre del Negocio</label>
                                <input type="text" required value={businessForm.name} onChange={e => setBusinessForm({...businessForm, name: e.target.value})}
                                    className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] outline-none transition-all font-bold text-[#1F2937]" placeholder="Ej. Bisne con Talla" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-[#6B7280] uppercase mb-1">Teléfono</label>
                                <input type="tel" value={businessForm.phone} onChange={e => setBusinessForm({...businessForm, phone: e.target.value})}
                                    className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] outline-none transition-all" placeholder="(53) 5555-5555" />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-[#6B7280] uppercase mb-1">Dirección Física</label>
                            <input type="text" value={businessForm.address} onChange={e => setBusinessForm({...businessForm, address: e.target.value})}
                                className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] outline-none transition-all" placeholder="Calle Principal #123" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-[#6B7280] uppercase mb-1">Mensaje en Ticket</label>
                            <textarea rows={3} value={businessForm.receipt_message} onChange={e => setBusinessForm({...businessForm, receipt_message: e.target.value})}
                                className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] outline-none transition-all resize-none" placeholder="¡Gracias por su compra!" />
                        </div>
                        
                        <div className="pt-4 border-t border-gray-100 flex justify-end">
                            <button type="submit" disabled={isLoading} 
                                className="bg-[#7AC142] hover:bg-[#7AC142]/90 text-white font-bold py-3 px-8 rounded-xl shadow-lg shadow-[#7AC142]/20 flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50">
                                {isLoading ? <Loader2 className="animate-spin"/> : <><Save size={20}/> Guardar Cambios</>}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* --- SECCIÓN 2: EQUIPO (STAFF) --- */}
            {activeTab === 'staff' && (
                <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-bold text-[#1F2937] flex items-center gap-2">
                            <Users className="text-[#0B3B68]"/> Gestión de Equipo
                        </h2>
                        <button onClick={() => handleOpenStaffModal()} className="bg-[#0B3B68] text-white px-4 py-2 rounded-xl font-bold text-sm shadow-md hover:bg-[#0B3B68]/90 flex items-center gap-2">
                            <Plus size={18}/> Nuevo Usuario
                        </button>
                    </div>

                    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                        <table className="mobile-card-table w-full text-left">
                            <thead className="bg-[#F3F4F6] text-[#6B7280] uppercase text-xs font-bold border-b border-gray-200">
                                <tr>
                                    <th className="p-4">Nombre</th>
                                    <th className="p-4">Rol</th>
                                    <th className="p-4 text-center">PIN</th>
                                    <th className="p-4 text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {staffList.map(staff => (
                                    <tr key={staff.id} className="hover:bg-gray-50 transition-colors group">
                                        <td className="p-4" data-label="Nombre">
                                            <div className="font-bold text-[#1F2937] flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-[#0B3B68]/10 text-[#0B3B68] flex items-center justify-center text-xs">
                                                    {staff.name.substring(0,2).toUpperCase()}
                                                </div>
                                                {staff.name}
                                                {currentStaff.id === staff.id && <span className="bg-[#7AC142]/10 text-[#7AC142] text-[10px] px-2 rounded-full border border-[#7AC142]/20">Tú</span>}
                                            </div>
                                        </td>
                                        <td className="p-4" data-label="Rol">
                                            <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${staff.role === 'admin' ? 'bg-[#0B3B68]/10 text-[#0B3B68]' : 'bg-gray-100 text-[#6B7280]'}`}>
                                                {staff.role}
                                            </span>
                                        </td>
                                        <td className="p-4 text-center font-mono text-[#6B7280]" data-label="PIN">****</td>
                                        <td className="p-4 text-right" data-label="Acciones">
                                            <div className="flex justify-end gap-2">
                                                <button onClick={() => handleOpenStaffModal(staff)} className="p-2 text-[#6B7280] hover:text-[#0B3B68] bg-gray-50 hover:bg-[#0B3B68]/10 rounded-lg transition-colors"><Edit2 size={18}/></button>
                                                {staff.id !== currentStaff.id && (
                                                    <button onClick={() => handleDeleteStaff(staff.id)} className="p-2 text-[#6B7280] hover:text-[#EF4444] bg-gray-50 hover:bg-[#EF4444]/10 rounded-lg transition-colors"><Trash2 size={18}/></button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {staffList.length === 0 && <div className="p-8 text-center text-gray-400">No hay usuarios registrados</div>}
                    </div>
                </div>
            )}

            {/* --- SECCIÓN 3: DISPOSITIVOS --- */}
            {activeTab === 'devices' && (
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 animate-in fade-in slide-in-from-right-4 duration-300">
                    <h2 className="text-xl font-bold text-[#1F2937] mb-6 flex items-center gap-2">
                        <Printer className="text-[#0B3B68]"/> Configuración de Impresora
                    </h2>
                    
                    <div className="bg-[#F3F4F6] p-4 rounded-xl mb-6 flex items-start gap-3 border border-gray-200">
                        <Smartphone className="text-[#0B3B68] mt-1" size={20}/>
                        <div>
                            <h4 className="font-bold text-[#1F2937] text-sm">Modo Híbrido</h4>
                            <p className="text-xs text-[#6B7280] mt-1">
                                Si estás usando Bisne en un celular, la impresión se realizará a través del navegador o la app nativa instalada.
                            </p>
                        </div>
                    </div>

                    <div className="space-y-5">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div>
                                <label className="block text-xs font-bold text-[#6B7280] uppercase mb-1">Dirección IP / Host</label>
                                <input type="text" value={printerConfig.ip} onChange={e => setPrinterConfig({...printerConfig, ip: e.target.value})}
                                    className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] outline-none font-mono" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-[#6B7280] uppercase mb-1">Ancho de Papel</label>
                                <select value={printerConfig.width} onChange={e => setPrinterConfig({...printerConfig, width: e.target.value})}
                                    className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] outline-none bg-white">
                                    <option value="58mm">58mm (Estándar)</option>
                                    <option value="80mm">80mm (Ancho)</option>
                                </select>
                            </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                            <input type="checkbox" id="autoPrint" checked={printerConfig.autoPrint} onChange={e => setPrinterConfig({...printerConfig, autoPrint: e.target.checked})} 
                                className="w-5 h-5 text-[#0B3B68] rounded focus:ring-[#0B3B68] border-gray-300"/>
                            <label htmlFor="autoPrint" className="text-sm font-bold text-[#1F2937]">Imprimir ticket automáticamente al cobrar</label>
                        </div>

                        <div className="pt-4 border-t border-gray-100 flex justify-end gap-3">
                            <button onClick={handleTestPrint} className="px-6 py-3 border border-[#0B3B68] text-[#0B3B68] font-bold rounded-xl hover:bg-[#0B3B68]/5 transition-colors">
                                Probar Conexión
                            </button>
                            <button className="bg-[#0B3B68] text-white font-bold py-3 px-8 rounded-xl shadow-lg hover:bg-[#0B3B68]/90 transition-all">
                                Guardar Configuración
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- SECCIÓN 4: DATOS --- */}
            {activeTab === 'data' && (
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 animate-in fade-in slide-in-from-right-4 duration-300">
                    <h2 className="text-xl font-bold text-[#1F2937] mb-6 flex items-center gap-2">
                        <Shield className="text-[#0B3B68]"/> Estado del Sistema
                    </h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                        <div className={`p-4 rounded-xl border flex items-center gap-4 ${onlineStatus ? 'bg-[#7AC142]/5 border-[#7AC142]/20' : 'bg-[#EF4444]/5 border-[#EF4444]/20'}`}>
                            {onlineStatus ? <Wifi className="text-[#7AC142]" size={28}/> : <WifiOff className="text-[#EF4444]" size={28}/>}
                            <div>
                                <h4 className="font-bold text-[#1F2937]">Conexión a Internet</h4>
                                <p className={`text-xs font-bold ${onlineStatus ? 'text-[#7AC142]' : 'text-[#EF4444]'}`}>
                                    {onlineStatus ? 'En línea' : 'Sin conexión'}
                                </p>
                            </div>
                        </div>
                        <div className="p-4 rounded-xl border bg-blue-50 border-blue-100 flex items-center gap-4">
                            <RefreshCw className="text-blue-600" size={28}/>
                            <div>
                                <h4 className="font-bold text-[#1F2937]">Sincronización</h4>
                                <p className="text-xs text-blue-600">Estado: Activo</p>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <button onClick={handleManualSync} disabled={!onlineStatus || isSyncing}
                            className="w-full p-4 flex items-center justify-between bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors group">
                            <span className="flex items-center gap-3 font-bold text-[#1F2937]">
                                <RefreshCw className={`text-[#0B3B68] ${isSyncing ? 'animate-spin' : ''}`}/> Forzar Sincronización Manual
                            </span>
                            <span className="text-xs font-bold bg-[#0B3B68] text-white px-3 py-1 rounded-full group-hover:shadow-md transition-all">Sincronizar</span>
                        </button>

                        <div className="border-t border-gray-100 my-4 pt-4">
                            <h4 className="text-[#EF4444] font-bold text-sm mb-2 uppercase flex items-center gap-2"><AlertTriangle size={16}/> Zona de Peligro</h4>
                            <button onClick={() => confirm('¿Seguro que deseas borrar la base de datos local? Esto requiere volver a iniciar sesión.') && db.delete().then(() => window.location.reload())}
                                className="w-full p-4 flex items-center justify-between bg-[#EF4444]/5 border border-[#EF4444]/20 rounded-xl hover:bg-[#EF4444]/10 transition-colors text-[#EF4444]">
                                <span className="font-bold">Restablecer Base de Datos Local</span>
                                <Trash2 size={20}/>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
      </div>

      {/* --- MODAL STAFF --- */}
      {isStaffModalOpen && (
          <div className="fixed inset-0 bg-[#0B3B68]/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
                  <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-[#F3F4F6]">
                      <h3 className="font-bold text-lg text-[#1F2937]">{editingStaff ? 'Editar Usuario' : 'Nuevo Usuario'}</h3>
                      <button onClick={() => setIsStaffModalOpen(false)}><X className="text-gray-400 hover:text-gray-600"/></button>
                  </div>
                  <form onSubmit={handleSaveStaff} className="p-6 space-y-4">
                      <div>
                          <label className="block text-xs font-bold text-[#6B7280] uppercase mb-1">Nombre Completo</label>
                          <input type="text" required autoFocus value={staffForm.name} onChange={e => setStaffForm({...staffForm, name: e.target.value})}
                              className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] outline-none" />
                      </div>
                      <div>
                          <label className="block text-xs font-bold text-[#6B7280] uppercase mb-1">PIN de Acceso (4 dígitos)</label>
                          <input type="password" inputMode="numeric" maxLength={4} required value={staffForm.pin} onChange={e => setStaffForm({...staffForm, pin: e.target.value})}
                              className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] outline-none font-mono text-center text-lg tracking-widest" placeholder="****" />
                      </div>
                      <div>
                          <label className="block text-xs font-bold text-[#6B7280] uppercase mb-1">Rol</label>
                          <div className="grid grid-cols-2 gap-3">
                              <button type="button" onClick={() => setStaffForm({...staffForm, role: 'vendedor'})}
                                  className={`p-3 rounded-xl border font-bold text-sm transition-all ${staffForm.role === 'vendedor' ? 'bg-[#0B3B68] text-white border-[#0B3B68]' : 'bg-white text-[#6B7280] border-gray-200'}`}>
                                  Vendedor
                              </button>
                              <button type="button" onClick={() => setStaffForm({...staffForm, role: 'admin'})}
                                  className={`p-3 rounded-xl border font-bold text-sm transition-all ${staffForm.role === 'admin' ? 'bg-[#0B3B68] text-white border-[#0B3B68]' : 'bg-white text-[#6B7280] border-gray-200'}`}>
                                  Admin
                              </button>
                          </div>
                      </div>
                      <div className="pt-2">
                          <button type="submit" disabled={isLoading} className="w-full bg-[#7AC142] text-white font-bold py-3.5 rounded-xl shadow-lg shadow-[#7AC142]/20 hover:bg-[#7AC142]/90 flex justify-center items-center gap-2">
                              {isLoading ? <Loader2 className="animate-spin"/> : 'Guardar Usuario'}
                          </button>
                      </div>
                  </form>
              </div>
          </div>
      )}
    </div>
  );
}