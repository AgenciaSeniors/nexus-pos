import { useState, useEffect, useRef } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Staff, type BusinessConfig } from '../lib/db';
import { syncManualFull, syncPush, isOnline, addToQueue, retryFailedItems } from '../lib/sync';
import { ADMIN_WHATSAPP_PHONE } from '../lib/config';
import { hashPin, verifyPin, isPinHashed } from '../lib/pin';
import { logAuditAction } from '../lib/audit';
import { toast } from 'sonner';
import {
  Save, RefreshCw, Printer, Store, Shield,
  Trash2, Loader2, Smartphone,
  Wifi, WifiOff, AlertTriangle, Key,
  Download, Upload, Database,
  Users, Plus, Edit2, UserCheck, UserX, X, Lock, DollarSign, CheckCircle2, Clock,
  HelpCircle, ShoppingCart, Package, BarChart2, Settings, UserCircle, ChevronRight, Repeat,
  ScrollText, Phone, Mail, MapPin, Info
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { checkForUpdate, type AppVersionInfo } from '../lib/version';
import { RestaurantAdmin } from '../components/RestaurantAdmin';
import { MenuModifiersAdmin } from '../components/MenuModifiersAdmin';
import { RecipeAdmin } from '../components/RecipeAdmin';

export function SettingsPage() {
  const { currentStaff } = useOutletContext<{ currentStaff: Staff }>();
  const businessId = localStorage.getItem('nexus_business_id');
  
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<'general' | 'devices' | 'data' | 'team' | 'help' | 'legal' | 'restaurant' | 'menu' | 'recipes'>(
    searchParams.get('tab') === 'help' ? 'help'
      : searchParams.get('tab') === 'legal' ? 'legal'
      : searchParams.get('tab') === 'restaurant' ? 'restaurant'
      : searchParams.get('tab') === 'menu' ? 'menu'
      : searchParams.get('tab') === 'recipes' ? 'recipes'
      : 'general'
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const onlineStatus = isOnline();

  const failedCount = useLiveQuery(
    () => db.action_queue.where('status').equals('failed').count(),
    []
  ) || 0;

  // Métricas detalladas de sync para el panel
  const syncMetrics = useLiveQuery(async () => {
    const [pendingItems, failed] = await Promise.all([
      db.action_queue.where('status').anyOf(['pending', 'processing']).toArray(),
      db.action_queue.where('status').equals('failed').count(),
    ]);

    const labels: Record<string, string> = {
      SALE: 'ventas', PRODUCT_SYNC: 'productos', CUSTOMER_SYNC: 'clientes',
      MOVEMENT: 'movimientos', AUDIT: 'auditorías', SETTINGS_SYNC: 'config.',
      SHIFT: 'turnos', CASH_MOVEMENT: 'mov. caja', STAFF_SYNC: 'empleados',
      VOID_SALE: 'anulaciones', PARTIAL_REFUND: 'devoluciones', LOYALTY_CHANGE: 'puntos',
      AREA_SYNC: 'áreas', TABLE_SYNC: 'mesas', COMANDA_SYNC: 'comandas',
      COMANDA_ITEM_SYNC: 'ítems', COMANDA_CLOSE: 'cierres', KITCHEN_STATUS: 'cocina',
      MODIFIER_GROUP_SYNC: 'grupos', MODIFIER_SYNC: 'modificadores', PRODUCT_MODIFIER_SYNC: 'modificadores',
      RECIPE_SYNC: 'recetas'
    };
    const breakdown: Record<string, number> = {};
    pendingItems.forEach(i => {
      const lbl = labels[i.type] || i.type.toLowerCase();
      breakdown[lbl] = (breakdown[lbl] || 0) + 1;
    });

    // Última sync timestamp
    const { getLastSyncTimestamp } = await import('../lib/sync');
    const ts = getLastSyncTimestamp();
    const ageMs = ts > 0 ? Date.now() - ts : 0;
    let lastSyncLabel = 'Nunca';
    let lastSyncAbsolute = '—';
    if (ts > 0) {
      if (ageMs < 60000) lastSyncLabel = 'Hace <1 min';
      else if (ageMs < 3600000) lastSyncLabel = `Hace ${Math.floor(ageMs / 60000)} min`;
      else if (ageMs < 86400000) lastSyncLabel = `Hace ${Math.floor(ageMs / 3600000)}h`;
      else lastSyncLabel = `Hace ${Math.floor(ageMs / 86400000)}d`;
      lastSyncAbsolute = new Date(ts).toLocaleTimeString('es-CU', { hour: '2-digit', minute: '2-digit' });
    }

    return {
      pending: pendingItems.length,
      failed,
      lastSyncLabel,
      lastSyncAbsolute,
      breakdown: Object.keys(breakdown).length > 0 ? breakdown : null,
    };
  }, []) || { pending: 0, failed: 0, lastSyncLabel: '—', lastSyncAbsolute: '—', breakdown: null };

  // ✅ REF PARA EL SELECTOR DE ARCHIVOS DE RESPALDO
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [businessForm, setBusinessForm] = useState({
    name: '',
    address: '',
    phone: '',
    receipt_message: '¡Gracias por su compra!',
    master_pin: '',
    business_type: 'retail' as 'retail' | 'restaurant'
  });

  const [showResetDbConfirm, setShowResetDbConfirm] = useState(false);

  // ── VERSIÓN / ACTUALIZACIÓN ──────────────────────────────────
  const [updateInfo, setUpdateInfo] = useState<AppVersionInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    try {
      const info = await checkForUpdate(__APP_VERSION__);
      setUpdateInfo(info);
      if (!info) toast.success('Estás en la última versión');
    } catch {
      toast.error('No se pudo verificar. Revisa tu conexión.');
    } finally {
      setCheckingUpdate(false);
    }
  };

  // Check automático al montar
  useEffect(() => {
    checkForUpdate(__APP_VERSION__).then(setUpdateInfo).catch(() => {});
  }, []);

  // ── EQUIPO ────────────────────────────────────────────────────
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [staffForm, setStaffForm] = useState({ name: '', role: 'vendedor' as 'admin' | 'vendedor', pin: '' });

  const staffList = useLiveQuery(async () => {
    if (!businessId) return [];
    return await db.staff.where('business_id').equals(businessId).toArray();
  }, [businessId]) || [];

  const openAddStaff = () => {
    setEditingStaff(null);
    setStaffForm({ name: '', role: 'vendedor', pin: '' });
    setShowStaffModal(true);
  };

  const openEditStaff = (staff: Staff) => {
    setEditingStaff(staff);
    // No cargar el PIN almacenado (puede ser hash); el campo queda vacío
    // y solo se actualiza si el admin ingresa un nuevo PIN de 4 dígitos.
    setStaffForm({ name: staff.name, role: staff.role, pin: '' });
    setShowStaffModal(true);
  };

  const handleSaveStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) return;
    const cleanName = staffForm.name.trim();
    if (!cleanName) return toast.error('El nombre es obligatorio');
    if (cleanName.length < 2) return toast.error('El nombre debe tener al menos 2 caracteres');
    if (cleanName.length > 50) return toast.error('El nombre no puede tener más de 50 caracteres');

    const isNewPin = staffForm.pin.length > 0;
    if (isNewPin && !/^\d{4}$/.test(staffForm.pin)) return toast.error('El PIN debe ser exactamente 4 dígitos');
    if (!editingStaff && !isNewPin) return toast.error('El PIN es obligatorio para un nuevo empleado');

    try {
      const staffId = editingStaff?.id || crypto.randomUUID();

      // Determinar el PIN final: hashear si es nuevo; mantener existente si está vacío al editar
      let pinFinal: string;
      if (isNewPin) {
        // Verificar duplicados usando verifyPin (soporta hashes y texto plano)
        const others = (staffList || []).filter(s => s.id !== editingStaff?.id && s.active !== false);
        for (const s of others) {
          if (await verifyPin(staffForm.pin, s.id, s.pin)) {
            return toast.error('Ese PIN ya lo usa otro empleado activo. Elige uno diferente.');
          }
        }
        pinFinal = await hashPin(staffForm.pin, staffId);
      } else {
        // Sin nuevo PIN al editar: conservar el PIN/hash actual
        pinFinal = editingStaff!.pin;
      }

      const staffRecord: Staff = {
        id: staffId,
        name: staffForm.name.trim(),
        role: staffForm.role,
        pin: pinFinal,
        active: editingStaff?.active ?? true,
        business_id: businessId,
        sync_status: editingStaff ? 'pending_update' : 'pending_create'
      };
      await db.transaction('rw', [db.staff, db.action_queue], async () => {
        await db.staff.put(staffRecord);
        await addToQueue('STAFF_SYNC', staffRecord);
      });
      toast.success(editingStaff ? 'Empleado actualizado' : 'Empleado agregado');
      setShowStaffModal(false);
      syncPush().catch(() => {});
    } catch (err) {
      console.error(err);
      toast.error('Error al guardar empleado');
    }
  };

  const handleToggleStaff = async (staff: Staff) => {
    if (staff.id === currentStaff?.id) return toast.error('No puedes desactivar tu propio perfil');

    // Evitar quedar sin ningún admin activo
    if (staff.active && staff.role === 'admin') {
      const activeAdmins = (staffList || []).filter(s => s.active && s.role === 'admin');
      if (activeAdmins.length <= 1) {
        return toast.error('No puedes desactivar al único administrador activo');
      }
    }

    try {
      const updated = { ...staff, active: !staff.active, sync_status: 'pending_update' as const };
      await db.transaction('rw', [db.staff, db.action_queue], async () => {
        await db.staff.put(updated);
        await addToQueue('STAFF_SYNC', updated);
      });
      toast.success(updated.active ? 'Empleado activado' : 'Empleado desactivado');
      syncPush().catch(() => {});
    } catch (err) {
      toast.error('Error al actualizar empleado');
    }
  };

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
        // Si el PIN almacenado ya es un hash, no lo cargamos en el campo:
        // el admin ingresa un nuevo PIN solo si quiere cambiarlo.
        master_pin: isPinHashed(settings.master_pin || '') ? '' : (settings.master_pin || ''),
        business_type: settings.business_type === 'restaurant' ? 'restaurant' : 'retail'
      });
    }
  }, [settings]);

  const handleSaveBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) return;

    const isNewPin = businessForm.master_pin.length > 0;
    if (isNewPin && !/^\d{4}$/.test(businessForm.master_pin)) return toast.error('El PIN debe ser exactamente 4 dígitos numéricos');
    if (!isNewPin && !isPinHashed(settings?.master_pin || '')) return toast.error('El PIN maestro es obligatorio');

    setIsLoading(true);

    try {
        // Usar el PIN hasheado nuevo, o conservar el existente si no se cambió
        const pinFinal = isNewPin
          ? await hashPin(businessForm.master_pin, businessId)
          : settings!.master_pin!;

        const updatedSettings: BusinessConfig = {
            id: businessId,
            name: businessForm.name,
            address: businessForm.address,
            phone: businessForm.phone,
            receipt_message: businessForm.receipt_message,
            master_pin: pinFinal,
            business_type: businessForm.business_type,
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
      if (!isOnline()) {
          toast.error('Sin conexión a internet');
          return;
      }
      setIsSyncing(true);
      const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 45000)
      );
      try {
          await Promise.race([syncManualFull(), timeout]);
          toast.success('Sincronización completada');
      } catch (error) {
          const isTimeout = error instanceof Error && error.message === 'timeout';
          console.error(error);
          toast.error(isTimeout ? 'La sincronización tardó demasiado. Reintenta más tarde.' : 'Error de sincronización');
      } finally {
          setIsSyncing(false);
      }
  };

  const handleRetryFailed = async () => {
      if (!onlineStatus) { toast.error('Sin conexión a internet'); return; }
      setIsRetrying(true);
      try {
          await retryFailedItems();
          toast.success('Elementos fallidos reenviados al servidor');
      } catch (error: any) {
          toast.error(error.message || 'Error al reintentar');
      } finally {
          setIsRetrying(false);
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

  // ── SUSCRIPCIÓN ────────────────────────────────────────────────────────────
  const subscriptionDaysLeft = (() => {
    if (!settings?.subscription_expires_at) return null;
    const ms = new Date(settings.subscription_expires_at).getTime() - Date.now();
    return Math.ceil(ms / (1000 * 60 * 60 * 24));
  })();
  // ──────────────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 pb-24 max-w-6xl mx-auto min-h-screen bg-[#F3F4F6]">
      
      <div className="mb-8">
        <h1 className="text-3xl font-black text-[#0B3B68] mb-2">Configuración</h1>
        <p className="text-[#6B7280]">Administra tu negocio, dispositivos y copias de seguridad.</p>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        
        <div className="w-full md:w-64 flex flex-col gap-2 shrink-0">
            <button onClick={() => setActiveTab('general')} className={`flex items-center gap-3 p-4 rounded-2xl text-left transition-all font-bold ${activeTab === 'general' ? 'bg-[#0B3B68] text-white shadow-lg shadow-[#0B3B68]/20' : 'bg-white text-[#6B7280] hover:bg-white/80 hover:text-[#0B3B68]'}`}><Store size={20}/> Mi Negocio</button>
            {currentStaff?.role === 'admin' && (
              <button onClick={() => setActiveTab('team')} className={`flex items-center gap-3 p-4 rounded-2xl text-left transition-all font-bold ${activeTab === 'team' ? 'bg-[#0B3B68] text-white shadow-lg shadow-[#0B3B68]/20' : 'bg-white text-[#6B7280] hover:bg-white/80 hover:text-[#0B3B68]'}`}>
                <Users size={20}/> Equipo
                {staffList.length > 0 && (
                  <span className={`ml-auto text-xs font-black px-2 py-0.5 rounded-full ${activeTab === 'team' ? 'bg-white/20 text-white' : 'bg-[#0B3B68]/10 text-[#0B3B68]'}`}>
                    {staffList.filter(s => s.active !== false).length}
                  </span>
                )}
              </button>
            )}
            {currentStaff?.role === 'admin' && settings?.business_type === 'restaurant' && (
              <button onClick={() => setActiveTab('restaurant')} className={`flex items-center gap-3 p-4 rounded-2xl text-left transition-all font-bold ${activeTab === 'restaurant' ? 'bg-[#0B3B68] text-white shadow-lg shadow-[#0B3B68]/20' : 'bg-white text-[#6B7280] hover:bg-white/80 hover:text-[#0B3B68]'}`}><Store size={20}/> Mesas y Áreas</button>
            )}
            {currentStaff?.role === 'admin' && settings?.business_type === 'restaurant' && (
              <button onClick={() => setActiveTab('menu')} className={`flex items-center gap-3 p-4 rounded-2xl text-left transition-all font-bold ${activeTab === 'menu' ? 'bg-[#0B3B68] text-white shadow-lg shadow-[#0B3B68]/20' : 'bg-white text-[#6B7280] hover:bg-white/80 hover:text-[#0B3B68]'}`}><ShoppingCart size={20}/> Menú</button>
            )}
            {currentStaff?.role === 'admin' && settings?.business_type === 'restaurant' && (
              <button onClick={() => setActiveTab('recipes')} className={`flex items-center gap-3 p-4 rounded-2xl text-left transition-all font-bold ${activeTab === 'recipes' ? 'bg-[#0B3B68] text-white shadow-lg shadow-[#0B3B68]/20' : 'bg-white text-[#6B7280] hover:bg-white/80 hover:text-[#0B3B68]'}`}><Package size={20}/> Recetas</button>
            )}
            <button onClick={() => setActiveTab('devices')} className={`flex items-center gap-3 p-4 rounded-2xl text-left transition-all font-bold ${activeTab === 'devices' ? 'bg-[#0B3B68] text-white shadow-lg shadow-[#0B3B68]/20' : 'bg-white text-[#6B7280] hover:bg-white/80 hover:text-[#0B3B68]'}`}><Printer size={20}/> Hardware</button>
            <button onClick={() => setActiveTab('data')} className={`flex items-center gap-3 p-4 rounded-2xl text-left transition-all font-bold ${activeTab === 'data' ? 'bg-[#0B3B68] text-white shadow-lg shadow-[#0B3B68]/20' : 'bg-white text-[#6B7280] hover:bg-white/80 hover:text-[#0B3B68]'}`}><Shield size={20}/> Datos y Respaldo</button>
            <button onClick={() => setActiveTab('help')} className={`flex items-center gap-3 p-4 rounded-2xl text-left transition-all font-bold ${activeTab === 'help' ? 'bg-[#0B3B68] text-white shadow-lg shadow-[#0B3B68]/20' : 'bg-white text-[#6B7280] hover:bg-white/80 hover:text-[#0B3B68]'}`}><HelpCircle size={20}/> Guía Rápida</button>
            <button onClick={() => setActiveTab('legal')} className={`flex items-center gap-3 p-4 rounded-2xl text-left transition-all font-bold ${activeTab === 'legal' ? 'bg-[#0B3B68] text-white shadow-lg shadow-[#0B3B68]/20' : 'bg-white text-[#6B7280] hover:bg-white/80 hover:text-[#0B3B68]'}`}><ScrollText size={20}/> Términos y Política</button>
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

                        {/* ── MODO DEL NEGOCIO (retail / restaurante) ───────── */}
                        <div className="pt-4">
                            <label className="block text-xs font-bold text-[#6B7280] uppercase mb-2">Tipo de Negocio</label>
                            <div className="grid grid-cols-2 gap-3">
                                {([
                                    { key: 'retail' as const, title: 'Tienda', desc: 'Punto de venta de productos' },
                                    { key: 'restaurant' as const, title: 'Restaurante', desc: 'Mesas, comandas y cocina' },
                                ]).map(opt => {
                                    const active = businessForm.business_type === opt.key;
                                    return (
                                        <button type="button" key={opt.key}
                                            onClick={() => setBusinessForm({ ...businessForm, business_type: opt.key })}
                                            className={`text-left p-4 rounded-xl border-2 transition-all ${active ? 'border-[#7AC142] bg-[#7AC142]/5' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                                            <p className={`font-bold ${active ? 'text-[#0B3B68]' : 'text-[#6B7280]'}`}>{opt.title}</p>
                                            <p className="text-[11px] text-[#6B7280] mt-0.5">{opt.desc}</p>
                                        </button>
                                    );
                                })}
                            </div>
                            <p className="text-[10px] text-[#6B7280] mt-2">
                                El modo restaurante cambia la pantalla principal por el plano de mesas. Cambiarlo no afecta tus datos de productos ni ventas.
                            </p>
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
                                <input type="password" inputMode="numeric" maxLength={4} value={businessForm.master_pin} onChange={e => setBusinessForm({...businessForm, master_pin: e.target.value.replace(/\D/g, '').slice(0, 4)})}
                                    className="w-full p-3 border border-red-200 rounded-xl focus:ring-2 focus:ring-red-500 outline-none font-mono text-xl tracking-widest text-center"
                                    placeholder={isPinHashed(settings?.master_pin || '') ? 'Vacío = sin cambios' : 'Ej. 1234'} />
                            </div>
                        </div>
                        
                        <div className="pt-4 border-t border-gray-100 flex justify-end">
                            <button type="submit" disabled={isLoading}
                                className="bg-[#7AC142] hover:bg-[#7AC142]/90 text-white font-bold py-3 px-8 rounded-xl shadow-lg shadow-[#7AC142]/20 flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50">
                                {isLoading ? <Loader2 className="animate-spin"/> : <><Save size={20}/> Guardar Cambios</>}
                            </button>
                        </div>
                    </form>

                    {/* ── CARD SUSCRIPCIÓN ─────────────────────────────── */}
                    {settings?.status === 'active' && (() => {
                      const days = subscriptionDaysLeft;
                      const expiry = settings.subscription_expires_at
                        ? new Date(settings.subscription_expires_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })
                        : null;
                      const isOk = days === null || days > 7;
                      const isWarning = days !== null && days >= 0 && days <= 7;
                      const waMsg = encodeURIComponent('Hola, quiero renovar mi suscripción de Bisne con Talla.');
                      return (
                        <div className={`mt-6 rounded-2xl border p-5 flex items-center gap-4 ${isOk ? 'bg-[#7AC142]/5 border-[#7AC142]/20' : isWarning ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'}`}>
                          <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${isOk ? 'bg-[#7AC142]/10 text-[#7AC142]' : isWarning ? 'bg-amber-100 text-amber-600' : 'bg-red-100 text-red-500'}`}>
                            <CheckCircle2 size={22}/>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-[#6B7280] uppercase tracking-wide mb-1">Suscripción Activa</p>
                            <p className="text-sm text-[#1F2937] font-medium">
                              {days === null ? 'Sin fecha de vencimiento asignada' :
                               days < 0 ? `Venció el ${expiry}` :
                               days === 0 ? 'Vence hoy' :
                               `Vence el ${expiry} · ${days} día${days !== 1 ? 's' : ''} restantes`}
                            </p>
                          </div>
                          {isWarning && (
                            <a href={`https://wa.me/${ADMIN_WHATSAPP_PHONE}?text=${waMsg}`} target="_blank" rel="noopener noreferrer"
                              className="shrink-0 flex items-center gap-1.5 px-3 py-2 bg-[#25D366]/10 text-[#128C7E] border border-[#25D366]/30 rounded-xl text-xs font-bold hover:bg-[#25D366]/20 transition-colors">
                              Renovar
                            </a>
                          )}
                          {isOk && (
                            <span className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-[#7AC142]/10 text-[#7AC142] rounded-full text-xs font-black uppercase">
                              <CheckCircle2 size={13}/> Al día
                            </span>
                          )}
                        </div>
                      );
                    })()}

                    {/* ── TARJETA PERÍODO DE PRUEBA ────────────────────── */}
                    {settings?.status === 'trial' && (() => {
                      const msLeft = settings.subscription_expires_at
                        ? new Date(settings.subscription_expires_at).getTime() - Date.now()
                        : -1;
                      const daysLeft = msLeft > 0 ? Math.ceil(msLeft / (1000 * 60 * 60 * 24)) : 0;
                      const expired = msLeft <= 0;
                      return (
                        <div className={`mt-4 rounded-2xl border p-5 flex items-center gap-4 ${expired ? 'bg-red-50 border-red-200' : daysLeft <= 2 ? 'bg-red-50 border-red-200' : daysLeft <= 5 ? 'bg-orange-50 border-orange-200' : 'bg-amber-50 border-amber-200'}`}>
                          <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${expired ? 'bg-red-100 text-red-500' : daysLeft <= 2 ? 'bg-red-100 text-red-500' : daysLeft <= 5 ? 'bg-orange-100 text-orange-500' : 'bg-amber-100 text-amber-600'}`}>
                            <Clock size={22}/>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs font-bold uppercase tracking-wide mb-0.5 ${expired ? 'text-red-600' : daysLeft <= 2 ? 'text-red-600' : daysLeft <= 5 ? 'text-orange-600' : 'text-amber-700'}`}>
                              Período de Prueba Gratuita
                            </p>
                            <p className={`text-sm font-medium ${expired ? 'text-red-700' : 'text-slate-700'}`}>
                              {expired
                                ? 'Tu período de prueba ha vencido. Contacta al administrador para activar tu cuenta.'
                                : daysLeft === 0
                                  ? 'Tu período de prueba vence hoy.'
                                  : `Te quedan ${daysLeft} día${daysLeft !== 1 ? 's' : ''} de prueba gratuita.`}
                            </p>
                          </div>
                          {!expired && (
                            <span className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-black uppercase border ${daysLeft <= 2 ? 'bg-red-100 text-red-700 border-red-200' : daysLeft <= 5 ? 'bg-orange-100 text-orange-700 border-orange-200' : 'bg-amber-100 text-amber-700 border-amber-200'}`}>
                              {daysLeft === 0 ? 'Vence hoy' : `${daysLeft}d restantes`}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                </div>
            )}

            {activeTab === 'restaurant' && (
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 animate-in fade-in slide-in-from-right-4 duration-300">
                    <h2 className="text-xl font-bold text-[#1F2937] flex items-center gap-2 mb-6">
                        <Store className="text-[#7AC142]"/> Mesas y Áreas
                    </h2>
                    <RestaurantAdmin />
                </div>
            )}

            {activeTab === 'menu' && (
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 animate-in fade-in slide-in-from-right-4 duration-300">
                    <h2 className="text-xl font-bold text-[#1F2937] flex items-center gap-2 mb-6">
                        <ShoppingCart className="text-[#7AC142]"/> Menú y Modificadores
                    </h2>
                    <MenuModifiersAdmin />
                </div>
            )}

            {activeTab === 'recipes' && (
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 animate-in fade-in slide-in-from-right-4 duration-300">
                    <h2 className="text-xl font-bold text-[#1F2937] flex items-center gap-2 mb-6">
                        <Package className="text-[#7AC142]"/> Recetas e Insumos
                    </h2>
                    <RecipeAdmin />
                </div>
            )}

            {activeTab === 'team' && (
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 animate-in fade-in slide-in-from-right-4 duration-300">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-bold text-[#1F2937] flex items-center gap-2">
                            <Users className="text-[#7AC142]"/> Mi Equipo
                        </h2>
                        <button
                            onClick={openAddStaff}
                            className="flex items-center gap-2 bg-[#0B3B68] text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-[#0B3B68]/90 transition-all active:scale-95 shadow-lg shadow-[#0B3B68]/20"
                        >
                            <Plus size={16}/> Agregar
                        </button>
                    </div>

                    <p className="text-sm text-[#6B7280] mb-5 bg-blue-50 border border-blue-100 rounded-xl p-3 leading-relaxed">
                        Cada vendedor se identifica con su PIN al abrir la app en su dispositivo. Puedes tener varios vendiendo al mismo tiempo sin conflictos.
                    </p>

                    {staffList.length === 0 ? (
                        <div className="text-center py-12 text-[#6B7280]">
                            <Users size={48} className="mx-auto mb-3 stroke-1 opacity-30"/>
                            <p className="font-bold">No hay empleados agregados aún</p>
                            <p className="text-sm">Toca "Agregar" para crear el primer perfil</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {staffList.map(staff => {
                                const isOwner = staff.id === currentStaff?.id;
                                return (
                                    <div key={staff.id} className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${staff.active !== false ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'}`}>
                                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-black text-lg flex-shrink-0 border-2 ${
                                            staff.role === 'admin' ? 'bg-[#7AC142] text-[#0B3B68] border-[#7AC142]' : 'bg-[#0B3B68]/10 text-[#0B3B68] border-[#0B3B68]/20'
                                        }`}>
                                            {staff.name.substring(0, 2).toUpperCase()}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="font-bold text-[#1F2937] truncate">{staff.name}</p>
                                                {isOwner && (
                                                    <span className="text-[10px] font-black bg-[#7AC142] text-[#0B3B68] px-2 py-0.5 rounded-full uppercase">Tú</span>
                                                )}
                                                {staff.active === false && (
                                                    <span className="text-[10px] font-black bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full uppercase">Inactivo</span>
                                                )}
                                            </div>
                                            <p className="text-xs text-[#6B7280] capitalize">
                                                {staff.role === 'admin' ? 'Administrador' : 'Vendedor'} · PIN: ****
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            <button
                                                onClick={() => openEditStaff(staff)}
                                                className="p-2 text-[#6B7280] hover:text-[#0B3B68] hover:bg-[#0B3B68]/5 rounded-lg transition-colors"
                                                title="Editar"
                                            >
                                                <Edit2 size={16}/>
                                            </button>
                                            {!isOwner && (
                                                <button
                                                    onClick={() => handleToggleStaff(staff)}
                                                    className={`p-2 rounded-lg transition-colors ${staff.active !== false ? 'text-[#EF4444] hover:bg-red-50' : 'text-[#7AC142] hover:bg-green-50'}`}
                                                    title={staff.active !== false ? 'Desactivar' : 'Activar'}
                                                >
                                                    {staff.active !== false ? <UserX size={16}/> : <UserCheck size={16}/>}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
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

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
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

                    {/* PANEL DE MÉTRICAS DE SYNC */}
                    <div className="mb-6 p-4 rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50/80 to-white">
                        <h4 className="font-bold text-[#1F2937] text-sm mb-3 flex items-center gap-2">
                            <BarChart2 size={16} className="text-[#0B3B68]"/> Estado de Sincronización
                        </h4>
                        <div className="grid grid-cols-3 gap-3">
                            <div className={`p-3 rounded-lg border text-center ${syncMetrics.pending === 0 ? 'bg-[#7AC142]/5 border-[#7AC142]/20' : 'bg-amber-50 border-amber-200'}`}>
                                <p className="text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">Pendientes</p>
                                <p className={`text-2xl font-black ${syncMetrics.pending === 0 ? 'text-[#7AC142]' : 'text-amber-600'}`}>{syncMetrics.pending}</p>
                                <p className="text-[9px] text-[#6B7280] mt-0.5">Por subir</p>
                            </div>
                            <div className={`p-3 rounded-lg border text-center ${syncMetrics.failed === 0 ? 'bg-[#7AC142]/5 border-[#7AC142]/20' : 'bg-red-50 border-red-200'}`}>
                                <p className="text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">Fallidos</p>
                                <p className={`text-2xl font-black ${syncMetrics.failed === 0 ? 'text-[#7AC142]' : 'text-red-600'}`}>{syncMetrics.failed}</p>
                                <p className="text-[9px] text-[#6B7280] mt-0.5">Abandonados</p>
                            </div>
                            <div className="p-3 rounded-lg border bg-blue-50 border-blue-100 text-center">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">Última sync</p>
                                <p className="text-sm font-black text-blue-700 leading-tight pt-1">{syncMetrics.lastSyncLabel}</p>
                                <p className="text-[9px] text-[#6B7280] mt-0.5">{syncMetrics.lastSyncAbsolute}</p>
                            </div>
                        </div>
                        {syncMetrics.breakdown && (
                            <div className="mt-3 pt-3 border-t border-gray-100">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-[#6B7280] mb-2">Desglose de pendientes</p>
                                <div className="flex flex-wrap gap-1.5">
                                    {Object.entries(syncMetrics.breakdown).map(([label, count]) => (
                                        <span key={label} className="text-[11px] font-bold px-2 py-1 rounded-lg bg-amber-100 text-amber-800 border border-amber-200">
                                            {count} {label}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="space-y-3">
                        <button onClick={handleManualSync} disabled={!onlineStatus || isSyncing}
                            className="w-full p-4 flex items-center justify-between bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors group">
                            <span className="flex items-center gap-3 font-bold text-[#1F2937]">
                                <RefreshCw className={`text-[#0B3B68] ${isSyncing ? 'animate-spin' : ''}`}/> Forzar Sincronización Manual
                            </span>
                            <span className="text-xs font-bold bg-[#0B3B68] text-white px-3 py-1 rounded-full group-hover:shadow-md transition-all">Sincronizar</span>
                        </button>
                        {failedCount > 0 && (
                            <button onClick={handleRetryFailed} disabled={!onlineStatus || isRetrying}
                                className="w-full p-4 flex items-center justify-between bg-orange-50 border border-orange-200 rounded-xl hover:bg-orange-100 transition-colors group">
                                <span className="flex items-center gap-3 font-bold text-orange-700">
                                    <Repeat className={`text-orange-500 ${isRetrying ? 'animate-spin' : ''}`}/> Reintentar Fallidos
                                    <span className="bg-orange-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full">{failedCount}</span>
                                </span>
                                <span className="text-xs font-bold bg-orange-500 text-white px-3 py-1 rounded-full group-hover:shadow-md transition-all">Reintentar</span>
                            </button>
                        )}

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

                        {/* Banner de actualización disponible */}
                        {updateInfo && (
                          <div className="border-t border-gray-100 my-4 pt-4">
                            <div className="bg-[#7AC142]/10 border border-[#7AC142]/30 rounded-xl p-4">
                              <div className="flex items-start gap-3">
                                <div className="bg-[#7AC142] text-white p-2 rounded-lg flex-shrink-0"><Download size={18} /></div>
                                <div className="flex-1">
                                  <p className="font-bold text-[#0B3B68]">Nueva versión disponible: v{updateInfo.version}</p>
                                  {updateInfo.release_notes && <p className="text-sm text-[#6B7280] mt-1">{updateInfo.release_notes}</p>}
                                  <p className="text-xs text-[#6B7280] mt-2">Contacta a soporte para recibir la actualización.</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Guía de actualización */}
                        <div className="border-t border-gray-100 my-4 pt-4">
                          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                            <p className="font-bold text-[#0B3B68] text-sm flex items-center gap-2 mb-2"><Info size={14} /> Sobre las actualizaciones</p>
                            <ul className="text-xs text-[#6B7280] space-y-1.5">
                              <li>Al instalar una actualización, <strong className="text-[#0B3B68]">tus datos se mantienen intactos</strong>.</li>
                              <li><strong className="text-[#EF4444]">No desinstales la app</strong> antes de actualizar. Instala encima.</li>
                              <li>El sistema crea backups automáticos cada 15 minutos como protección extra.</li>
                            </ul>
                          </div>
                        </div>

                        <div className="border-t border-gray-100 my-4 pt-6 flex items-center justify-between">
                            <div>
                                <h4 className="text-[#EF4444] font-bold text-sm mb-2 uppercase flex items-center gap-2"><AlertTriangle size={16}/> Zona de Peligro</h4>
                                <button onClick={() => setShowResetDbConfirm(true)}
                                    className="w-full p-4 flex items-center justify-between bg-[#EF4444]/5 border border-[#EF4444]/20 rounded-xl hover:bg-[#EF4444]/10 transition-colors text-[#EF4444]">
                                    <span className="font-bold">Restablecer Base de Datos Local</span>
                                    <Trash2 size={20}/>
                                </button>
                            </div>
                            <div className="text-right pl-6 flex-shrink-0">
                                <p className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">Versión</p>
                                <p className="text-lg font-black text-[#0B3B68]">v{__APP_VERSION__}</p>
                                <p className="text-[10px] text-[#6B7280] mb-2">Bisne con Talla</p>
                                <button
                                  onClick={handleCheckUpdate}
                                  disabled={checkingUpdate}
                                  className="text-xs font-bold text-[#0B3B68] bg-[#0B3B68]/10 hover:bg-[#0B3B68]/20 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5 ml-auto"
                                >
                                  {checkingUpdate ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                                  Verificar
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
      </div>

      {showStaffModal && (
          <div className="fixed inset-0 bg-[#0B3B68]/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-[92vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                  <div className="flex justify-between items-center p-5 pb-0 flex-shrink-0">
                      <h3 className="font-bold text-lg text-[#1F2937] flex items-center gap-2">
                          <Users size={20} className="text-[#7AC142]"/>
                          {editingStaff ? 'Editar Empleado' : 'Nuevo Empleado'}
                      </h3>
                      <button onClick={() => setShowStaffModal(false)} className="p-1.5 text-[#6B7280] hover:text-[#1F2937] hover:bg-gray-100 rounded-lg transition-colors">
                          <X size={20}/>
                      </button>
                  </div>
                  <form onSubmit={handleSaveStaff} className="flex-1 overflow-y-auto p-5 space-y-4">
                      <div>
                          <label className="block text-xs font-bold text-[#6B7280] uppercase mb-1">Nombre</label>
                          <input
                              type="text" required autoFocus
                              value={staffForm.name}
                              onChange={e => setStaffForm({...staffForm, name: e.target.value})}
                              className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] outline-none transition-all font-bold text-[#1F2937]"
                              placeholder="Ej. María González"
                          />
                      </div>
                      <div>
                          <label className="block text-xs font-bold text-[#6B7280] uppercase mb-1">Rol</label>
                          <select
                              value={staffForm.role}
                              onChange={e => setStaffForm({...staffForm, role: e.target.value as 'admin' | 'vendedor'})}
                              className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] outline-none bg-white font-bold text-[#1F2937]"
                          >
                              <option value="vendedor">Vendedor</option>
                              <option value="admin">Administrador</option>
                          </select>
                      </div>
                      <div>
                          <label className="block text-xs font-bold text-[#6B7280] uppercase mb-1 flex items-center gap-1">
                              <Lock size={12}/> PIN (4 dígitos){editingStaff && <span className="font-normal normal-case ml-1 text-gray-400">— vacío = sin cambios</span>}
                          </label>
                          <input
                              type="password" inputMode="numeric" maxLength={4}
                              value={staffForm.pin}
                              onChange={e => setStaffForm({...staffForm, pin: e.target.value.replace(/\D/g, '').slice(0, 4)})}
                              className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] outline-none font-mono text-2xl tracking-widest text-center"
                              placeholder={editingStaff ? 'Dejar vacío = sin cambios' : '••••'}
                          />
                          <p className="text-[10px] text-[#6B7280] mt-1">El empleado usará este PIN para identificarse en cada dispositivo</p>
                      </div>
                      <div className="flex gap-3 pt-2">
                          <button type="button" onClick={() => setShowStaffModal(false)}
                              className="flex-1 py-3 border border-gray-200 text-[#6B7280] font-bold rounded-xl hover:bg-gray-50 transition-colors">
                              Cancelar
                          </button>
                          <button type="submit"
                              className="flex-1 py-3 bg-[#0B3B68] text-white font-bold rounded-xl hover:bg-[#0B3B68]/90 transition-all active:scale-95 shadow-lg shadow-[#0B3B68]/20">
                              {editingStaff ? 'Guardar Cambios' : 'Agregar Empleado'}
                          </button>
                      </div>
                  </form>
              </div>
          </div>
      )}

      {activeTab === 'legal' && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 animate-in fade-in slide-in-from-right-4 duration-300 space-y-6">
          {/* Encabezado */}
          <div>
            <h2 className="text-xl font-bold text-[#1F2937] mb-1 flex items-center gap-2">
              <ScrollText size={22} className="text-[#0B3B68]" /> Términos de Uso y Política de Privacidad
            </h2>
            <p className="text-xs text-[#6B7280]">Bisne con Talla · Agencia Señores · Versión 1.0 · Sancti Spíritus, Cuba · 2025</p>
          </div>

          {/* Sección 1 — Aceptación */}
          <div className="border border-gray-100 rounded-2xl p-4 space-y-1">
            <h3 className="font-black text-[#0B3B68] text-sm flex items-center gap-2"><Info size={15}/> 1. Aceptación de los Términos</h3>
            <p className="text-sm text-[#4B5563] leading-relaxed">
              Al registrarte y utilizar <strong>Bisne con Talla</strong>, aceptas de forma plena y sin reservas los presentes Términos de Uso y la Política de Privacidad. Si no estás de acuerdo con alguno de estos términos, debes abstenerte de usar la aplicación.
            </p>
          </div>

          {/* Sección 2 — Descripción */}
          <div className="border border-gray-100 rounded-2xl p-4 space-y-1">
            <h3 className="font-black text-[#0B3B68] text-sm flex items-center gap-2"><Info size={15}/> 2. Descripción del Servicio</h3>
            <p className="text-sm text-[#4B5563] leading-relaxed">
              <strong>Bisne con Talla</strong> es un sistema de punto de venta (POS) <em>offline-first</em> desarrollado por <strong>Agencia Señores</strong> para negocios ubicados en Cuba. La aplicación opera de forma local en el dispositivo del usuario y sincroniza datos con la nube cuando existe conexión a internet disponible.
            </p>
            <p className="text-sm text-[#4B5563] leading-relaxed mt-2">
              El servicio incluye: gestión de ventas, inventario, clientes, turnos de caja, reportes financieros y sincronización multi-dispositivo.
            </p>
          </div>

          {/* Sección 3 — Período de prueba */}
          <div className="border border-gray-100 rounded-2xl p-4 space-y-1">
            <h3 className="font-black text-[#0B3B68] text-sm flex items-center gap-2"><Info size={15}/> 3. Período de Prueba</h3>
            <p className="text-sm text-[#4B5563] leading-relaxed">
              Los nuevos usuarios tienen acceso <strong>gratuito durante 7 días</strong> desde la fecha de registro. Al finalizar este período, se requiere una suscripción activa para continuar utilizando el sistema. Agencia Señores se reserva el derecho de suspender el acceso transcurrido dicho plazo sin pago confirmado.
            </p>
          </div>

          {/* Sección 4 — Tarifas (la más importante) */}
          <div className="border-2 border-[#0B3B68]/20 bg-[#0B3B68]/03 rounded-2xl p-4 space-y-3">
            <h3 className="font-black text-[#0B3B68] text-sm flex items-center gap-2"><DollarSign size={15}/> 4. Tarifas y Modelo de Cobro</h3>
            <p className="text-sm text-[#4B5563] leading-relaxed">
              El servicio se contrata mediante una <strong>suscripción mensual de tarifa plana</strong>. El monto es acordado con el proveedor al momento del registro y puede variar según el plan negociado con <strong>Agencia Señores</strong>.
            </p>
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Clock size={16} className="text-indigo-600"/>
                <span className="font-black text-indigo-800 text-sm">Período de Prueba</span>
              </div>
              <p className="text-xs text-indigo-700 leading-relaxed">
                Todo negocio registrado accede a un período de prueba gratuito de <strong>7 días</strong> para evaluar el sistema sin ningún costo. Al vencer el período, se requiere activar una suscripción para continuar.
              </p>
            </div>
            <ul className="space-y-1.5 text-xs text-[#6B7280]">
              {[
                'La suscripción se renueva mensualmente y debe pagarse antes de la fecha de vencimiento para evitar interrupciones.',
                'Los datos del negocio se conservan íntegros durante la suspensión por falta de pago.',
                'Para renovar o consultar tarifas vigentes, contacta a Agencia Señores por WhatsApp.',
              ].map((item, i) => (
                <li key={i} className="flex gap-2 leading-relaxed">
                  <CheckCircle2 size={13} className="text-[#7AC142] flex-shrink-0 mt-0.5"/>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Sección 5 — Privacidad y datos */}
          <div className="border border-gray-100 rounded-2xl p-4 space-y-2">
            <h3 className="font-black text-[#0B3B68] text-sm flex items-center gap-2"><Shield size={15}/> 5. Privacidad y Tratamiento de Datos</h3>
            <ul className="space-y-2 text-sm text-[#4B5563]">
              {[
                'Los datos del negocio (ventas, inventario, clientes) se almacenan localmente en el dispositivo y se sincronizan cifrados con nuestros servidores en la nube (Supabase/PostgreSQL con RLS).',
                'No vendemos, cedemos ni compartimos datos con terceros bajo ninguna circunstancia.',
                'Los datos personales de clientes finales solo son accesibles por el negocio que los registró. Agencia Señores no accede a esta información.',
                'El usuario es responsable de mantener sus credenciales de acceso (correo y contraseña) en estricta confidencialidad.',
                'Ante la solicitud del usuario, los datos pueden ser exportados o eliminados permanentemente de nuestros servidores.',
              ].map((item, i) => (
                <li key={i} className="flex gap-2 leading-relaxed">
                  <CheckCircle2 size={15} className="text-[#7AC142] flex-shrink-0 mt-0.5"/>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Sección 6 — Copias de seguridad */}
          <div className="border border-gray-100 rounded-2xl p-4 space-y-1">
            <h3 className="font-black text-[#0B3B68] text-sm flex items-center gap-2"><Info size={15}/> 6. Copias de Seguridad</h3>
            <p className="text-sm text-[#4B5563] leading-relaxed">
              Se recomienda encarecidamente realizar respaldos periódicos desde <em>Configuración › Datos y Respaldo</em>. Aunque el sistema sincroniza datos con la nube, <strong>Agencia Señores no se hace responsable</strong> de la pérdida de datos causada por fallos del dispositivo, eliminación accidental o datos que nunca fueron sincronizados por falta de conexión.
            </p>
          </div>

          {/* Sección 7 — Uso aceptable */}
          <div className="border border-gray-100 rounded-2xl p-4 space-y-1">
            <h3 className="font-black text-[#0B3B68] text-sm flex items-center gap-2"><Info size={15}/> 7. Uso Aceptable</h3>
            <p className="text-sm text-[#4B5563] leading-relaxed">
              El sistema está diseñado exclusivamente para la gestión comercial legal de negocios. Queda terminantemente prohibido su uso para registrar actividades ilícitas, evadir impuestos o cualquier otra acción contraria a la legislación vigente. El usuario es el único responsable de la exactitud y legalidad de la información registrada.
            </p>
          </div>

          {/* Sección 8 — Modificaciones */}
          <div className="border border-gray-100 rounded-2xl p-4 space-y-1">
            <h3 className="font-black text-[#0B3B68] text-sm flex items-center gap-2"><Info size={15}/> 8. Modificaciones a los Términos</h3>
            <p className="text-sm text-[#4B5563] leading-relaxed">
              Agencia Señores se reserva el derecho de modificar estos términos en cualquier momento. Los cambios significativos serán notificados a los usuarios con al menos <strong>15 días de antelación</strong> a través de la propia aplicación. El uso continuado del servicio tras la notificación implica la aceptación de los nuevos términos.
            </p>
          </div>

          {/* Sección 9 — Limitación de responsabilidad */}
          <div className="border border-gray-100 rounded-2xl p-4 space-y-1">
            <h3 className="font-black text-[#0B3B68] text-sm flex items-center gap-2"><Info size={15}/> 9. Limitación de Responsabilidad</h3>
            <p className="text-sm text-[#4B5563] leading-relaxed">
              Agencia Señores no será responsable por pérdidas de ingresos, datos o cualquier daño indirecto derivado del uso o la imposibilidad de uso de la aplicación. La responsabilidad máxima en cualquier caso no superará el monto pagado por el servicio en el último mes facturado.
            </p>
          </div>

          {/* Contacto */}
          <div className="bg-[#0B3B68] rounded-2xl p-5 text-white">
            <h3 className="font-black text-sm mb-3">Contacto y Soporte</h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-white/80"><Phone size={14}/> <span>+53 5988-7863 (WhatsApp)</span></div>
              <div className="flex items-center gap-2 text-white/80"><MapPin size={14}/> <span>Sancti Spíritus, Cuba</span></div>
            </div>
            <a
              href={`https://wa.me/${ADMIN_WHATSAPP_PHONE}?text=Hola%2C%20tengo%20una%20consulta%20sobre%20los%20T%C3%A9rminos%20de%20Bisne%20con%20Talla`}
              target="_blank" rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-2 bg-[#7AC142] text-[#0B3B68] font-black text-xs px-4 py-2 rounded-xl hover:bg-[#7AC142]/90 transition-colors"
            >
              <Phone size={13}/> Contactar por WhatsApp
            </a>
          </div>
        </div>
      )}

      {activeTab === 'help' && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 animate-in fade-in slide-in-from-right-4 duration-300">
          <h2 className="text-xl font-bold text-[#1F2937] mb-1 flex items-center gap-2">
            <HelpCircle size={22} className="text-[#0B3B68]" /> Guía Rápida
          </h2>
          <p className="text-sm text-[#6B7280] mb-6">Aprende a sacarle el máximo provecho a Bisne con Talla</p>

          {/* Flujo diario */}
          <div className="mb-8">
            <h3 className="text-sm font-black text-[#0B3B68] uppercase tracking-wider mb-3">Flujo diario recomendado</h3>
            <div className="flex flex-col sm:flex-row items-stretch gap-2">
              {[
                { icon: <DollarSign size={18}/>, label: 'Abre turno', sub: 'Finanzas → Abrir turno', color: 'bg-green-100 text-green-700' },
                { icon: <ShoppingCart size={18}/>, label: 'Vende', sub: 'POS → cobra a clientes', color: 'bg-blue-100 text-blue-700' },
                { icon: <BarChart2 size={18}/>, label: 'Revisa', sub: 'Finanzas → ver resumen', color: 'bg-purple-100 text-purple-700' },
                { icon: <Lock size={18}/>, label: 'Cierra turno', sub: 'Finanzas → cerrar turno', color: 'bg-slate-100 text-slate-700' },
              ].map((step, i, arr) => (
                <div key={i} className="flex sm:flex-col items-center gap-2 flex-1">
                  <div className="flex-1 sm:w-full bg-gray-50 border border-gray-200 rounded-2xl p-3 flex sm:flex-col items-center gap-3 sm:gap-1 sm:text-center">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${step.color}`}>
                      {step.icon}
                    </div>
                    <div>
                      <p className="font-bold text-[#1F2937] text-sm">{step.label}</p>
                      <p className="text-[11px] text-[#6B7280]">{step.sub}</p>
                    </div>
                  </div>
                  {i < arr.length - 1 && (
                    <ChevronRight size={16} className="text-gray-300 flex-shrink-0 sm:rotate-90" />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Secciones */}
          <div className="space-y-4">
            {[
              {
                icon: <ShoppingCart size={20} className="text-[#0B3B68]"/>,
                title: 'Punto de Venta (POS)',
                steps: [
                  'Busca productos por nombre o código, o filtra por categoría',
                  'Toca un producto para agregarlo al carrito; toca de nuevo para sumar más unidades',
                  'Ajusta cantidades con + / − o toca el número para escribirlo directamente',
                  'Descuentos: toca el ícono de etiqueta (🏷) en el carrito — puedes aplicar % o monto fijo',
                  'Pago mixto: al cobrar elige "Mixto" para dividir entre efectivo y transferencia en una sola venta',
                  'Selecciona un cliente antes de cobrar para que acumule puntos de lealtad automáticamente',
                  'Cambio de vendedor: si hay varios en el equipo, toca el badge con el nombre en la parte superior del carrito',
                  'Notas por ítem: toca el lápiz ✏️ en cualquier producto del carrito para agregar una nota (ej: "variada con extra queso") y/o cambiar el precio de ese ítem específico',
                  'Toca "Cobrar" → elige método → confirma → el ticket se genera automáticamente con las notas incluidas',
                ],
              },
              {
                icon: <Package size={20} className="text-[#0B3B68]"/>,
                title: 'Inventario',
                steps: [
                  'Crea el producto con nombre, precio y categoría',
                  'Al crearlo, pon la cantidad disponible (existencia) — si la dejas en 0 el producto NO aparecerá en el POS',
                  'Para agregar existencia después: toca el producto → "Ajustar Stock" → ingresa la cantidad a sumar',
                  'El stock se descuenta automáticamente con cada venta realizada',
                  'Edita precio, nombre o categoría tocando el lápiz en cualquier momento',
                  'Transferencia almacén ↔ vitrina: toca el producto → "Transferir" → elige la dirección (al mostrador o de vuelta al almacén) y la cantidad — el movimiento queda registrado en el historial',
                ],
              },
              {
                icon: <BarChart2 size={20} className="text-[#0B3B68]"/>,
                title: 'Finanzas y Reportes',
                steps: [
                  'Abre un turno al inicio del día indicando el efectivo inicial en caja',
                  'Durante el turno puedes registrar entradas y salidas de efectivo (ej: gastos, depósitos) — no puedes retirar más de lo disponible en caja',
                  'El resumen separa ventas en efectivo, transferencia y mixto — el efectivo de ventas mixtas se suma al efectivo total',
                  'Cierra el turno al final del día para cuadrar la caja — si hay ventas con conflicto de stock sin resolver, el cierre se bloqueará hasta que las atiendas',
                  'Las ventas anuladas no se suman a los totales del resumen',
                  'Reportes por rango: en la pestaña "Resumen diario" activa el modo Rango, elige fechas de inicio y fin, y obtén estadísticas, gráfico y desglose por vendedor para cualquier período',
                  'Presets rápidos de rango: botones de 7d, 15d y 30d para análisis rápido',
                  'Devoluciones parciales: en el historial de ventas toca "Devolución" — puedes devolver uno o varios artículos de la venta, el stock regresa automáticamente',
                  'Solo los administradores pueden ver Finanzas; los vendedores solo acceden al POS y Clientes',
                ],
              },
              {
                icon: <UserCircle size={20} className="text-[#0B3B68]"/>,
                title: 'Clientes y Puntos de Lealtad',
                steps: [
                  'Agrega clientes con nombre, teléfono y correo desde la sección Clientes',
                  'Cada cliente acumula 1 punto por cada $1.00 de compra',
                  'Selecciona el cliente en el POS antes de cobrar para que los puntos se sumen',
                  'Para canjear puntos: selecciona el cliente → en la pantalla de cobro activa "Canjear puntos"',
                  '10 puntos = $1.00 de descuento (el máximo canjeable no puede exceder el total de la venta)',
                  'El historial completo de compras y puntos de cada cliente está en la sección Clientes',
                  'Multi-dispositivo: si dos vendedores atienden al mismo cliente desde dispositivos distintos, los puntos se suman correctamente — ningún cambio se pierde al sincronizar',
                ],
              },
              {
                icon: <Repeat size={20} className="text-[#0B3B68]"/>,
                title: 'Sincronización y conexión',
                steps: [
                  'Todo se guarda en el dispositivo primero — la app funciona completamente sin internet',
                  'Cuando hay conexión, cada acción se sube a la nube automáticamente en segundos',
                  'El ícono en la barra lateral muestra el tiempo desde la última sync y el estado: 🟢 al día · 🟡 subiendo · 🟠 error',
                  'Sin internet: la app funciona igual, los cambios quedan en cola y suben solos al reconectarse',
                  'Si el ícono queda en 🟠 (error), al reconectarte se reintenta automáticamente — también puedes forzarlo manualmente',
                  'Aviso amarillo en el POS: si el stock tiene más de 2 horas sin actualizarse desde la nube, aparece una alerta — útil cuando hay varios dispositivos',
                  'Aviso naranja: si llevas 3 o más días sin sincronizar, la app te recuerda que tus datos solo existen en ese dispositivo',
                  'Varios dispositivos: la app funciona en múltiples teléfonos — los puntos de lealtad y el stock se sincronizan correctamente aunque cada uno haya trabajado offline',
                  'Si cambias de dispositivo: instala la app, inicia sesión y en segundos descargarás todos los productos, clientes y configuración',
                ],
              },
              {
                icon: <Database size={20} className="text-[#0B3B68]"/>,
                title: 'Backups automáticos',
                steps: [
                  'La app crea un backup local automáticamente cada 15 minutos mientras está abierta',
                  'Se conservan los últimos 8 backups (2 horas de historial de protección)',
                  'Al instalar una actualización, se crea un backup de seguridad adicional automáticamente antes de migrar los datos',
                  'Los backups son independientes de la base de datos principal — si algo falla, los datos están protegidos',
                  'Si necesitas restaurar un backup, contacta a soporte técnico',
                ],
              },
              {
                icon: <Shield size={20} className="text-[#0B3B68]"/>,
                title: 'Seguridad y acceso',
                steps: [
                  'Cada empleado tiene un PIN de 4 dígitos para acceder — si es la primera vez, la app te pedirá crear uno',
                  'Después de 5 intentos incorrectos de PIN, el acceso se bloquea por 5 minutos automáticamente',
                  'El PIN maestro protege operaciones sensibles: anular ventas, salidas de caja y cierre de turno',
                  'Los vendedores solo ven POS y Clientes — Finanzas, Inventario y Configuración son exclusivos del administrador',
                  'Para cambiar el PIN de un empleado ve a Configuración → Equipo → edita el perfil',
                ],
              },
              {
                icon: <Download size={20} className="text-[#0B3B68]"/>,
                title: 'Actualizaciones',
                steps: [
                  'Cuando hay una nueva versión, aparece un aviso en esta sección automáticamente',
                  'Para actualizar: instala el nuevo APK (Android) o instalador (Windows) encima de la versión actual — no desinstales la app',
                  'Tus datos se mantienen intactos al actualizar — el sistema crea un backup de seguridad antes de cualquier cambio',
                  'Si necesitas la última versión, contáctanos por WhatsApp y te la enviamos',
                  'Puedes verificar manualmente si hay actualizaciones con el botón "Verificar" que aparece junto a la versión actual',
                ],
              },
            ].map((section) => (
              <details key={section.title} className="group border border-gray-200 rounded-2xl overflow-hidden">
                <summary className="flex items-center gap-3 p-4 cursor-pointer select-none hover:bg-gray-50 transition-colors list-none">
                  <div className="w-9 h-9 rounded-xl bg-[#0B3B68]/8 flex items-center justify-center flex-shrink-0">
                    {section.icon}
                  </div>
                  <span className="font-bold text-[#1F2937] flex-1">{section.title}</span>
                  <ChevronRight size={16} className="text-[#6B7280] transition-transform group-open:rotate-90" />
                </summary>
                <div className="px-4 pb-4 pt-1">
                  <ul className="space-y-2">
                    {section.steps.map((step, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm text-[#374151]">
                        <CheckCircle2 size={15} className="text-[#7AC142] mt-0.5 flex-shrink-0" />
                        {step}
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            ))}
          </div>

          {/* Footer contacto */}
          <div className="mt-6 bg-[#0B3B68]/5 rounded-2xl p-4 flex items-center gap-3">
            <HelpCircle size={20} className="text-[#0B3B68] flex-shrink-0" />
            <div>
              <p className="text-sm font-bold text-[#0B3B68]">¿Necesitas ayuda adicional?</p>
              <p className="text-xs text-[#6B7280]">Contáctanos por WhatsApp y te asistimos en minutos</p>
            </div>
            <a
              href={`https://wa.me/${ADMIN_WHATSAPP_PHONE}?text=Hola,%20necesito%20ayuda%20con%20Bisne%20con%20Talla`}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto flex-shrink-0 bg-[#25D366] text-white text-xs font-bold px-3 py-2 rounded-xl hover:bg-[#25D366]/90 transition-colors"
            >
              WhatsApp
            </a>
          </div>
        </div>
      )}

      {showResetDbConfirm && (
          <div className="fixed inset-0 bg-[#0B3B68]/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-[92vh] overflow-y-auto p-6 text-center animate-in zoom-in-95 duration-200">
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