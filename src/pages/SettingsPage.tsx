import { useState, useEffect, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Staff, type BusinessConfig } from '../lib/db';
import { syncPush, syncPull, isOnline, addToQueue } from '../lib/sync';
import { logAuditAction } from '../lib/audit';
import { toast } from 'sonner';
import { 
  Save, RefreshCw, Printer, Store, Shield, 
  Trash2, Loader2, Smartphone, 
  Wifi, WifiOff, AlertTriangle, Key,
  Download, Upload, Database // ✅ NUEVOS ICONOS IMPORTADOS
} from 'lucide-react';

export function SettingsPage() {
  const { currentStaff } = useOutletContext<{ currentStaff: Staff }>();
  const businessId = localStorage.getItem('nexus_business_id');
  
  const [activeTab, setActiveTab] = useState<'general' | 'devices' | 'data'>('general');
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const onlineStatus = isOnline();

  // ✅ REF PARA EL SELECTOR DE ARCHIVOS DE RESPALDO
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [businessForm, setBusinessForm] = useState({
    name: '',
    address: '',
    phone: '',
    receipt_message: '¡Gracias por su compra!',
    master_pin: '1234'
  });

  const [showResetDbConfirm, setShowResetDbConfirm] = useState(false);

  const [printerConfig, setPrinterConfig] = useState(() => {
    try {
      const saved = localStorage.getItem('nexus_printer_config');
      if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    return { name: 'Impresora Térmica', ip: '192.168.1.200', width: '80mm', autoPrint: true };
  });

  const settings = useLiveQuery(async () => {
    if (!businessId) return null;
    return await db.settings.where('id').equals(businessId).first(); 
  }, [businessId]);

  useEffect(() => {
    if (settings) {
      setBusinessForm({
        name: settings.name || '',
        address: settings.address || '',
        phone: settings.phone || '',
        receipt_message: settings.receipt_message || '¡Gracias por su compra!',
        master_pin: settings.master_pin || '1234'
      });
    }
  }, [settings]);

  const handleSaveBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) return;
    if (businessForm.master_pin.length !== 4) return toast.error('El PIN debe ser de 4 números');
    setIsLoading(true);

    try {
        const updatedSettings: BusinessConfig = {
            id: businessId, 
            name: businessForm.name,
            address: businessForm.address,
            phone: businessForm.phone,
            receipt_message: businessForm.receipt_message,
            master_pin: businessForm.master_pin, 
            status: 'active',
            sync_status: 'pending_update'
        };

        await db.transaction('rw', [db.settings, db.action_queue, db.audit_logs], async () => {
            await db.settings.put(updatedSettings);
            await addToQueue('SETTINGS_SYNC', updatedSettings);
            await logAuditAction('UPDATE_SETTINGS', { name: businessForm.name }, currentStaff);
        });
        
        toast.success('Perfil y PIN guardados correctamente');
        syncPush().catch(() => {});
    } catch (error) {
        console.error(error);
        toast.error('Error al guardar configuración');
    } finally {
        setIsLoading(false);
    }
  };

  const handleManualSync = async () => {
      setIsSyncing(true);
      try {
          await syncPush();
          await syncPull(); 
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

  // ✅ NUEVA FUNCIÓN: EXPORTAR RESPALDO DE TODA LA BASE DE DATOS
  const handleExportBackup = async () => {
      try {
          setIsLoading(true);
          toast.info("Empaquetando datos del negocio...");
          
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const backupData: Record<string, any[]> = {};
          
          // Recorremos todas las tablas y extraemos su información
          for (const table of db.tables) {
              backupData[table.name] = await table.toArray();
          }

          // Lo convertimos en un archivo JSON descargable
          const dataStr = JSON.stringify(backupData);
          const blob = new Blob([dataStr], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          
          const a = document.createElement('a');
          a.href = url;
          const date = new Date().toISOString().split('T')[0];
          a.download = `Respaldo_Bisne_${date}.json`;
          
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          
          toast.success("Copia de seguridad descargada con éxito");
      } catch (error) {
          console.error(error);
          toast.error("Error al generar la copia de seguridad");
      } finally {
          setIsLoading(false);
      }
  };

  // ✅ NUEVA FUNCIÓN: IMPORTAR RESPALDO
  const handleImportBackup = async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (e) => {
          try {
              setIsLoading(true);
              toast.info("Restaurando datos, por favor espera...");
              
              const content = e.target?.result as string;
              const parsedData = JSON.parse(content);

              // Usamos una transacción masiva para borrar lo actual y poner lo nuevo
              await db.transaction('rw', db.tables, async () => {
                  for (const table of db.tables) {
                      if (parsedData[table.name]) {
                          await table.clear(); // Borramos la info vieja
                          await table.bulkPut(parsedData[table.name]); // Inyectamos la info del archivo
                      }
                  }
              });

              toast.success("Copia de seguridad restaurada correctamente");
              // Recargamos la página para que todos los estados de React lean la nueva DB
              setTimeout(() => window.location.reload(), 1500);

          } catch (error) {
              console.error(error);
              toast.error("El archivo no es válido o está corrupto");
          } finally {
              setIsLoading(false);
              if (fileInputRef.current) fileInputRef.current.value = ''; // Limpiamos el input
          }
      };
      reader.readAsText(file);
  };

  return (
    <div className="p-4 md:p-6 pb-24 max-w-6xl mx-auto min-h-screen bg-[#F3F4F6]">
      
      <div className="mb-8">
        <h1 className="text-3xl font-black text-[#0B3B68] mb-2">Configuración</h1>
        <p className="text-[#6B7280]">Administra tu negocio, dispositivos y copias de seguridad.</p>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        
        <div className="w-full md:w-64 flex flex-col gap-2 shrink-0">
            <button onClick={() => setActiveTab('general')} className={`flex items-center gap-3 p-4 rounded-2xl text-left transition-all font-bold ${activeTab === 'general' ? 'bg-[#0B3B68] text-white shadow-lg shadow-[#0B3B68]/20' : 'bg-white text-[#6B7280] hover:bg-white/80 hover:text-[#0B3B68]'}`}><Store size={20}/> Mi Negocio</button>
            <button onClick={() => setActiveTab('devices')} className={`flex items-center gap-3 p-4 rounded-2xl text-left transition-all font-bold ${activeTab === 'devices' ? 'bg-[#0B3B68] text-white shadow-lg shadow-[#0B3B68]/20' : 'bg-white text-[#6B7280] hover:bg-white/80 hover:text-[#0B3B68]'}`}><Printer size={20}/> Hardware</button>
            <button onClick={() => setActiveTab('data')} className={`flex items-center gap-3 p-4 rounded-2xl text-left transition-all font-bold ${activeTab === 'data' ? 'bg-[#0B3B68] text-white shadow-lg shadow-[#0B3B68]/20' : 'bg-white text-[#6B7280] hover:bg-white/80 hover:text-[#0B3B68]'}`}><Shield size={20}/> Datos y Respaldo</button>
        </div>

        <div className="flex-1">
            
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

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-4">
                            <div>
                                <label className="block text-xs font-bold text-[#6B7280] uppercase mb-1">Mensaje en Ticket</label>
                                <textarea rows={2} value={businessForm.receipt_message} onChange={e => setBusinessForm({...businessForm, receipt_message: e.target.value})}
                                    className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] outline-none transition-all resize-none" placeholder="¡Gracias por su compra!" />
                            </div>
                            <div className="bg-red-50 p-4 rounded-xl border border-red-100">
                                <label className="block text-xs font-bold text-red-600 uppercase mb-1 flex items-center gap-1">
                                    <Key size={14}/> PIN Maestro de Seguridad
                                </label>
                                <p className="text-[10px] text-red-500 mb-2">Se pedirá para retirar dinero o anular ventas.</p>
                                <input type="password" inputMode="numeric" maxLength={4} required value={businessForm.master_pin} onChange={e => setBusinessForm({...businessForm, master_pin: e.target.value})}
                                    className="w-full p-3 border border-red-200 rounded-xl focus:ring-2 focus:ring-red-500 outline-none font-mono text-xl tracking-widest text-center" />
                            </div>
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
                            <button
                                onClick={() => {
                                    localStorage.setItem('nexus_printer_config', JSON.stringify(printerConfig));
                                    toast.success('Configuración de impresora guardada');
                                }}
                                className="bg-[#0B3B68] text-white font-bold py-3 px-8 rounded-xl shadow-lg hover:bg-[#0B3B68]/90 transition-all"
                            >
                                Guardar Configuración
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'data' && (
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 animate-in fade-in slide-in-from-right-4 duration-300">
                    <h2 className="text-xl font-bold text-[#1F2937] mb-6 flex items-center gap-2">
                        <Shield className="text-[#0B3B68]"/> Estado y Respaldos
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
                                <h4 className="font-bold text-[#1F2937]">Nube de Supabase</h4>
                                <p className="text-xs text-blue-600">Sincronización Activa</p>
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

                        {/* ✅ NUEVA ZONA DE COPIAS DE SEGURIDAD LOCALES */}
                        <div className="border-t border-gray-100 my-6 pt-6">
                            <h4 className="font-bold text-[#1F2937] mb-2 flex items-center gap-2">
                                <Database className="text-[#0B3B68]" size={20}/>
                                Copias de Seguridad Locales (Offline)
                            </h4>
                            <p className="text-xs text-[#6B7280] mb-4 leading-relaxed">
                                Si vas a cambiar de teléfono , reinstalar o actualizar la aplicación, descarga un respaldo de tus datos y guárdalo en un lugar seguro. Luego podrás restaurarlo aquí mismo.
                            </p>
                            
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <button 
                                    onClick={handleExportBackup} 
                                    disabled={isLoading} 
                                    className="p-3.5 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors flex items-center justify-center gap-2 font-bold text-[#0B3B68] shadow-sm active:scale-95"
                                >
                                    {isLoading ? <Loader2 className="animate-spin"/> : <><Download size={18}/> Descargar Respaldo</>}
                                </button>
                                
                                {/* Input oculto para subir archivo */}
                                <input 
                                    type="file" 
                                    accept=".json" 
                                    className="hidden" 
                                    ref={fileInputRef} 
                                    onChange={handleImportBackup} 
                                />
                                <button 
                                    onClick={() => fileInputRef.current?.click()} 
                                    disabled={isLoading} 
                                    className="p-3.5 bg-[#0B3B68] text-white rounded-xl hover:bg-[#0B3B68]/90 transition-colors flex items-center justify-center gap-2 font-bold shadow-lg shadow-[#0B3B68]/20 active:scale-95"
                                >
                                    <Upload size={18}/> Restaurar Respaldo
                                </button>
                            </div>
                        </div>

                        <div className="border-t border-gray-100 my-4 pt-6">
                            <h4 className="text-[#EF4444] font-bold text-sm mb-2 uppercase flex items-center gap-2"><AlertTriangle size={16}/> Zona de Peligro</h4>
                            <button onClick={() => setShowResetDbConfirm(true)}
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

      {showResetDbConfirm && (
          <div className="fixed inset-0 bg-[#0B3B68]/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center animate-in zoom-in-95 duration-200">
                  <div className="w-14 h-14 bg-[#EF4444]/10 rounded-full flex items-center justify-center mx-auto mb-4">
                      <AlertTriangle size={28} className="text-[#EF4444]" />
                  </div>
                  <h3 className="font-bold text-lg text-[#1F2937] mb-1">¿Restablecer base de datos?</h3>
                  <p className="text-sm text-[#6B7280] mb-6">
                      Esto borrará todos los datos locales. Los datos ya sincronizados con la nube se recuperarán al volver a iniciar sesión.
                  </p>
                  <div className="flex gap-3">
                      <button
                          onClick={() => setShowResetDbConfirm(false)}
                          className="flex-1 py-2.5 border border-gray-200 text-[#6B7280] font-bold rounded-xl hover:bg-gray-50 transition-colors"
                      >
                          Cancelar
                      </button>
                      <button
                          onClick={() => db.delete().then(() => window.location.reload())}
                          className="flex-1 py-2.5 bg-[#EF4444] text-white font-bold rounded-xl hover:bg-[#EF4444]/90 transition-colors"
                      >
                          Restablecer
                      </button>
                  </div>
              </div>
          </div>
      )}

    </div>
  );
}