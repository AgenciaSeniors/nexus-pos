import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Package, PieChart, Settings,
  Cloud, AlertCircle, RefreshCw, LogOut, Menu, X, Users as UsersIcon, CheckCircle2, Loader2,
  ArrowLeftRight, WifiOff, Wifi, Clock, HelpCircle
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Staff } from '../lib/db';
import { syncManualFull, getLastSyncTimestamp } from '../lib/sync';
import { supabase } from '../lib/supabase';
import { toast } from 'sonner';

// ✅ MÉTODO INFALIBLE: Importar desde la carpeta assets
import logo from '../assets/logo.png'; 

interface LayoutProps {
  currentStaff: Staff | null;
  onChangeStaff?: () => void;
}

export function Layout({ currentStaff, onChangeStaff }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [showGuidePrompt, setShowGuidePrompt] = useState(false);
  const guideCheckedRef = useRef(false); // evita re-disparar si staff cambia mid-sesión

  const [justReconnected, setJustReconnected] = useState(false);

  // Mostrar guía rápida: una vez por cuenta (clave por business_id) o cuando es registro nuevo.
  // guideCheckedRef garantiza que no se repita si el empleado activo cambia durante la sesión.
  useEffect(() => {
    if (!currentStaff || guideCheckedRef.current) return;
    guideCheckedRef.current = true;
    const bId = localStorage.getItem('nexus_business_id');
    const guideKey = bId ? `nexus_guide_seen_${bId}` : null;
    const isNewRegistration = sessionStorage.getItem('nexus_new_registration') === '1';
    const alreadySeen = guideKey ? !!localStorage.getItem(guideKey) : false;
    if (isNewRegistration || !alreadySeen) {
      setShowGuidePrompt(true);
    }
  }, [currentStaff]);

  // Atajos de teclado F1/F2/F4/F5 desde Electron (main process → preload → renderer)
  useEffect(() => {
    if (!window.electronAPI?.onNavigate) return;
    const cleanup = window.electronAPI.onNavigate((path: string) => navigate(path));
    return cleanup; // preload retorna función que elimina el listener de ipcRenderer
  }, [navigate]);

  // Escuchar alertas de stock negativo (conflicto multi-dispositivo offline)
  useEffect(() => {
    const handleStockAlert = (e: Event) => {
      const { products } = (e as CustomEvent).detail;
      const names = products.map((p: any) => p.name).join(', ');
      toast.error(`Stock negativo detectado: ${names}. Revisa el inventario.`, { duration: 8000 });
    };
    const handleStockConflict = (e: Event) => {
      const { items } = (e as CustomEvent).detail;
      toast.warning(
        items
          ? `Conflicto de stock al sincronizar: ${items}. La venta quedó marcada para revisión.`
          : 'Conflicto de stock al sincronizar. Revisa Finanzas > Historial.',
        { duration: 10000 }
      );
    };
    const handleSyncFailed = (e: Event) => {
      const { type, error } = (e as CustomEvent).detail;
      toast.error(`Sincronización fallida: ${type}. ${error?.includes('Failed to fetch') ? 'Sin conexión al servidor.' : error?.slice(0, 80) || 'Error desconocido.'}`, { duration: 8000 });
    };
    window.addEventListener('nexus-stock-alert', handleStockAlert);
    window.addEventListener('nexus-stock-conflict', handleStockConflict);
    window.addEventListener('nexus-sync-failed', handleSyncFailed);
    return () => {
      window.removeEventListener('nexus-stock-alert', handleStockAlert);
      window.removeEventListener('nexus-stock-conflict', handleStockConflict);
      window.removeEventListener('nexus-sync-failed', handleSyncFailed);
    };
  }, []);

  // Mejora 5: Trial expirado detectado durante uso
  const [trialJustExpired, setTrialJustExpired] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setJustReconnected(true);
      toast.success("Conexión restaurada");
      // Auto-sync al reconectar
      setIsSyncing(true);
      syncManualFull()
        .then(() => toast.success('Datos sincronizados automáticamente'))
        .catch(() => {})
        .finally(() => {
          setIsSyncing(false);
          setTimeout(() => setJustReconnected(false), 3000);
        });
    };
    const handleOffline = () => { setIsOnline(false); setJustReconnected(false); };
    const handleTrialExpired = () => {
      setTrialJustExpired(true);
      toast.error('Tu período de prueba ha vencido. Contacta al administrador.', { duration: 15000 });
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('nexus-trial-expired', handleTrialExpired);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('nexus-trial-expired', handleTrialExpired);
    };
  }, []);

  const trialInfo = useLiveQuery(async () => {
    const settings = await db.settings.toArray();
    const s = settings[0];
    if (!s || s.status !== 'trial' || !s.subscription_expires_at) return null;
    const msLeft = new Date(s.subscription_expires_at).getTime() - Date.now();
    const daysLeft = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
    return { daysLeft };
  }, []) ?? null;

  const multipleStaff = useLiveQuery(async () => {
    const bId = localStorage.getItem('nexus_business_id');
    if (!bId) return false;
    const count = await db.staff.where('business_id').equals(bId).filter(s => s.active !== false).count();
    return count > 1;
  }, []) || false;

  const inventoryAlertCount = useLiveQuery(async () => {
    const bId = localStorage.getItem('nexus_business_id');
    if (!bId) return 0;
    const products = await db.products
      .where('business_id').equals(bId)
      .filter(p => !p.deleted_at)
      .toArray();
    const now = Date.now();
    let count = 0;
    for (const p of products) {
      const threshold = p.low_stock_threshold ?? 5;
      if (p.stock <= threshold) count++;
      if (p.expiration_date) {
        const days = Math.ceil((new Date(p.expiration_date).getTime() - now) / 86400000);
        if (days <= 90) count++;
      }
    }
    return count;
  }, []) || 0;

  const conflictCount = useLiveQuery(async () => {
    const bId = localStorage.getItem('nexus_business_id');
    if (!bId) return 0;
    return await db.sales
      .where('business_id').equals(bId)
      .filter(s => s.status === 'stock_conflict')
      .count();
  }, []) || 0;

  const pendingCount = useLiveQuery(async () => {
    // La action_queue es la fuente de verdad: si está vacía, todo está sincronizado
    const pending = await db.action_queue.where('status').equals('pending').count();
    const processing = await db.action_queue.where('status').equals('processing').count();
    return pending + processing;
  }, []) || 0;

  const failedCount = useLiveQuery(async () => {
    return await db.action_queue.where('status').equals('failed').count();
  }, []) || 0;

  const handleManualSync = async () => {
    if (!isOnline) {
        toast.error("No hay conexión para sincronizar");
        return;
    }
    setIsSyncing(true);
    const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 45000)
    );
    try {
        await Promise.race([syncManualFull(), timeout]);
        toast.success('¡Sistema sincronizado con éxito!');
    } catch (error) {
        const isTimeout = error instanceof Error && error.message === 'timeout';
        console.error(error);
        toast.error(isTimeout ? 'La sincronización tardó demasiado. Reintenta más tarde.' : 'Error al sincronizar');
    } finally {
        setIsSyncing(false);
    }
  };

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      localStorage.removeItem('nexus_business_id');
      localStorage.removeItem('nexus_staff_id');
      await supabase.auth.signOut();
    } catch {
      setIsLoggingOut(false);
    }
  };

  const isAdmin = currentStaff?.role === 'admin';
  const isCashier = currentStaff?.role === 'vendedor';

  const menuItems = [
    // ✅ Usamos la variable {logo} generada por Vite
    { path: '/', icon: <img src={logo} alt="POS" className="w-6 h-6 object-contain opacity-90 group-hover:opacity-100 transition-opacity" />, label: 'Punto de Venta', show: true }, 
    { path: '/clientes', icon: <UsersIcon size={22} />, label: 'Clientes', show: true }, 
    { path: '/inventario', icon: <Package size={22} />, label: 'Inventario', show: isAdmin },
    { path: '/finanzas', icon: <PieChart size={22} />, label: 'Finanzas', show: true },
    { path: '/configuracion', icon: <Settings size={22} />, label: 'Configuración', show: isAdmin }
  ];

  // Mejora 2: Calcular tiempo desde última sincronización
  const lastSyncAt = getLastSyncTimestamp();
  const lastSyncAgeMs = lastSyncAt > 0 ? Date.now() - lastSyncAt : 0;
  const lastSyncLabel = lastSyncAt === 0 ? '' : lastSyncAgeMs < 60000 ? ' (hace <1 min)' :
    lastSyncAgeMs < 3600000 ? ` (hace ${Math.floor(lastSyncAgeMs / 60000)} min)` :
    lastSyncAgeMs < 86400000 ? ` (hace ${Math.floor(lastSyncAgeMs / 3600000)}h)` :
    ` (hace ${Math.floor(lastSyncAgeMs / 86400000)} día(s))`;
  // Mejora 4: Alerta si lleva más de 3 días sin sincronizar
  const daysWithoutSync = lastSyncAt > 0 ? Math.floor(lastSyncAgeMs / 86400000) : 0;

  const getButtonState = () => {
    if (isSyncing) {
      return { className: "bg-amber-50 text-amber-600 ring-1 ring-amber-200", icon: <RefreshCw size={20} className="animate-spin"/>, title: "Sincronizando..." };
    }
    if (!isOnline && (pendingCount > 0 || failedCount > 0)) {
      return { className: "bg-red-50 text-[#EF4444] ring-1 ring-red-200 animate-pulse", icon: <AlertCircle size={20} />, title: "Sin conexión — cambios pendientes de subir" + lastSyncLabel };
    }
    if (pendingCount > 0) {
      return { className: "bg-amber-50 text-[#F59E0B] ring-1 ring-amber-200", icon: <RefreshCw size={20} />, title: "Hay cambios pendientes de subir" + lastSyncLabel };
    }
    if (failedCount > 0) {
      return { className: "bg-orange-50 text-orange-500 ring-1 ring-orange-200", icon: <AlertCircle size={20} />, title: `${failedCount} elemento(s) con error — toca para reintentar` };
    }
    return { className: "bg-[#7AC142]/10 text-[#7AC142] ring-1 ring-[#7AC142]/30 hover:bg-[#7AC142]/20", icon: <CheckCircle2 size={20} />, title: "Sistema actualizado y seguro" + lastSyncLabel };
  };

  const buttonState = getButtonState();

  return (
    <div className="flex h-screen w-full bg-[#F3F4F6] overflow-hidden font-sans text-[#1F2937]">
      
      {/* SIDEBAR DESKTOP */}
      <aside className={`hidden md:flex flex-col items-center py-6 z-20 shadow-xl transition-all bg-[#0B3B68] text-white duration-300 ${isCashier ? 'w-20' : 'w-24'}`}>
        
        {/* ✅ LOGO PRINCIPAL */}
        <div className="mb-6 p-1.5 bg-white rounded-2xl shadow-lg flex items-center justify-center w-14 h-14 overflow-hidden border-2 border-[#7AC142]/30">
          <img 
              src={logo} 
              alt="Logo" 
              className="w-full h-full object-contain"
          />
        </div>
        
        <div className="mb-8 text-center px-1 w-full relative">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-1 font-bold text-sm shadow-lg transition-colors border-2 border-[#7AC142] ${isAdmin ? 'bg-[#7AC142] text-[#0B3B68]' : 'bg-white/10 text-white'}`}>
            {currentStaff?.name.substring(0, 2).toUpperCase() || 'BT'}
          </div>
          {!isCashier && (
             <p className="text-[10px] font-bold text-[#7AC142] truncate w-full px-1 uppercase tracking-wider opacity-90">
               {currentStaff?.name?.split(' ')[0]}
             </p>
          )}
          {multipleStaff && onChangeStaff && (
            <button
              onClick={onChangeStaff}
              className="mt-1 mx-auto flex items-center justify-center gap-1 text-[9px] font-bold text-white/50 hover:text-[#7AC142] transition-colors uppercase tracking-wide"
              title="Cambiar vendedor"
            >
              <ArrowLeftRight size={10}/> cambiar
            </button>
          )}
        </div>

        <nav className="flex-1 flex flex-col gap-4 w-full px-3">
          {menuItems.filter(i => i.show).map((item) => {
            const isActive = location.pathname === item.path;
            const showInventoryBadge = item.path === '/inventario' && inventoryAlertCount > 0;
            const showConflictBadge = item.path === '/finanzas' && conflictCount > 0;
            return (
              <Link key={item.path} to={item.path} className={`flex flex-col items-center justify-center p-3 rounded-xl transition-all duration-200 group relative ${isActive ? 'bg-[#7AC142] text-[#0B3B68] shadow-lg shadow-[#7AC142]/20 font-bold translate-x-1' : 'text-gray-300 hover:text-white hover:bg-white/10'}`}>
                {item.icon}
                {showInventoryBadge && (
                  <span className="absolute top-1.5 right-1.5 flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500 border border-white/50"></span>
                  </span>
                )}
                {showConflictBadge && (
                  <span className="absolute top-1.5 right-1.5 flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-orange-500 border border-white/50"></span>
                  </span>
                )}
                <span className="absolute left-full ml-4 px-3 py-2 bg-[#1F2937] text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50 shadow-xl font-bold uppercase tracking-wide border border-gray-700">
                  {item.label}{showInventoryBadge ? ` (${inventoryAlertCount})` : ''}{showConflictBadge ? ` — ${conflictCount} conflicto(s)` : ''}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="flex flex-col gap-3 w-full px-3 mt-4 border-t border-white/10 pt-6">
            <button onClick={handleManualSync} disabled={!isOnline || isSyncing} className={`p-3 rounded-xl flex flex-col items-center justify-center transition-all duration-300 relative group border ${!isOnline ? 'bg-red-500/20 text-red-400 border-red-500/50' : pendingCount > 0 ? 'bg-white/5 hover:bg-white/10 text-[#F59E0B] border-[#F59E0B]/50' : failedCount > 0 ? 'bg-white/5 hover:bg-white/10 text-orange-400 border-orange-400/50' : 'bg-white/5 hover:bg-white/10 text-[#7AC142] border-white/5'}`} title={!isOnline ? 'Sin conexión' : buttonState.title}>
                {!isOnline ? <WifiOff size={20} /> : buttonState.icon}
                {(pendingCount > 0 || failedCount > 0) && (
                    <span className="absolute top-2 right-2 flex h-2.5 w-2.5">
                      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${failedCount > 0 && pendingCount === 0 ? 'bg-orange-400' : 'bg-[#F59E0B]'}`}></span>
                      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${failedCount > 0 && pendingCount === 0 ? 'bg-orange-400' : 'bg-[#F59E0B]'}`}></span>
                    </span>
                )}
            </button>
            <button onClick={handleLogout} disabled={isLoggingOut} className="p-3 text-gray-400 hover:text-[#EF4444] hover:bg-[#EF4444]/10 rounded-xl transition-colors flex flex-col items-center justify-center disabled:opacity-50" title="Cerrar Sesión">
                {isLoggingOut ? <Loader2 size={20} className="animate-spin"/> : <LogOut size={20}/>}
            </button>
        </div>
      </aside>

      {/* HEADER MÓVIL */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        <header
          className="bg-[#0B3B68] text-white border-b border-[#0B3B68] px-4 pb-3 flex justify-between items-center md:hidden z-10 shadow-lg sticky top-0"
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
        >
            <button onClick={() => setIsMobileMenuOpen(true)} className="text-white hover:text-[#7AC142] transition-colors">
                <Menu size={26} />
            </button>
            
            <div className="font-bold text-lg flex items-center gap-3 tracking-tight">
                {/* ✅ LOGO EN HEADER MÓVIL */}
                <div className="bg-white p-1 rounded-md shadow-sm w-8 h-8 flex items-center justify-center">
                    <img src={logo} alt="Logo" className="w-full h-full object-contain" />
                </div>
                <span>Bisne con Talla</span>
            </div>

            <div className="flex items-center gap-3">
                <button onClick={handleManualSync} disabled={!isOnline || isSyncing} className={`flex items-center justify-center w-9 h-9 rounded-full transition-all ${!isOnline ? 'bg-red-500 text-white' : isSyncing || pendingCount > 0 ? 'bg-[#F59E0B] text-[#0B3B68] animate-pulse' : 'bg-[#7AC142] text-[#0B3B68]'}`}>
                    {!isOnline ? <WifiOff size={18}/> : isSyncing ? <RefreshCw size={18} className="animate-spin"/> : pendingCount > 0 ? <Cloud size={18}/> : <CheckCircle2 size={18}/>}
                </button>
            </div>
        </header>

        {/* BANNER OFFLINE / RECONEXIÓN */}
        {!isOnline && (
          <div className="bg-red-600 text-white px-4 py-2 flex items-center justify-between gap-3 z-20 animate-in slide-in-from-top duration-300">
            <div className="flex items-center gap-2 min-w-0">
              <WifiOff size={16} className="flex-shrink-0" />
              <span className="text-xs sm:text-sm font-bold truncate">
                Sin conexión — modo offline activo
              </span>
            </div>
            {pendingCount > 0 && (
              <span className="bg-white/20 text-white px-2.5 py-0.5 rounded-full text-xs font-black flex-shrink-0">
                {pendingCount} pendiente{pendingCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        )}
        {justReconnected && isOnline && (
          <div className="bg-emerald-600 text-white px-4 py-2 flex items-center gap-2 z-20 animate-in slide-in-from-top duration-300">
            <Wifi size={16} className="flex-shrink-0" />
            <span className="text-xs sm:text-sm font-bold">
              {isSyncing ? 'Reconectado — sincronizando datos...' : 'Reconectado — todo sincronizado'}
            </span>
            {isSyncing && <RefreshCw size={14} className="animate-spin flex-shrink-0" />}
          </div>
        )}

        {/* BANNER PERÍODO DE PRUEBA */}
        {trialInfo !== null && (
          <div className={`px-4 py-2 flex items-center justify-between gap-3 z-20 ${trialInfo.daysLeft <= 2 ? 'bg-red-500' : trialInfo.daysLeft <= 5 ? 'bg-orange-500' : 'bg-amber-500'} text-white`}>
            <div className="flex items-center gap-2 min-w-0">
              <Clock size={15} className="flex-shrink-0" />
              <span className="text-xs sm:text-sm font-bold truncate">
                Período de prueba
              </span>
            </div>
            <span className={`flex-shrink-0 px-3 py-0.5 rounded-full text-xs font-black border border-white/30 ${trialInfo.daysLeft <= 2 ? 'bg-red-600' : trialInfo.daysLeft <= 5 ? 'bg-orange-600' : 'bg-amber-600'}`}>
              {trialInfo.daysLeft === 0 ? 'Vence hoy' : `${trialInfo.daysLeft} día${trialInfo.daysLeft !== 1 ? 's' : ''} restante${trialInfo.daysLeft !== 1 ? 's' : ''}`}
            </span>
          </div>
        )}

        {/* Mejora 5: Trial expirado detectado durante uso */}
        {trialJustExpired && (
          <div className="bg-red-600 text-white px-4 py-2 flex items-center gap-2 z-20 animate-in slide-in-from-top duration-300">
            <AlertCircle size={16} className="flex-shrink-0" />
            <span className="text-xs sm:text-sm font-bold">
              Tu período de prueba ha vencido. Contacta al administrador para activar tu cuenta.
            </span>
          </div>
        )}

        {/* Mejora 4: Alerta de días sin sincronizar */}
        {daysWithoutSync >= 3 && !trialJustExpired && (
          <div className="bg-orange-500 text-white px-4 py-2 flex items-center justify-between gap-3 z-20">
            <div className="flex items-center gap-2 min-w-0">
              <Cloud size={15} className="flex-shrink-0" />
              <span className="text-xs sm:text-sm font-bold truncate">
                Llevas {daysWithoutSync} día(s) sin sincronizar — tus datos solo existen en este dispositivo
              </span>
            </div>
            {isOnline && (
              <button onClick={handleManualSync} disabled={isSyncing} className="flex-shrink-0 bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg text-xs font-black transition-colors">
                Sincronizar
              </button>
            )}
          </div>
        )}

        <main className="flex-1 overflow-y-auto overflow-x-hidden relative bg-[#F3F4F6] scroll-smooth pb-safe">
            <Outlet context={{ currentStaff, onChangeStaff }} />
        </main>

        <nav
          className="md:hidden bg-white border-t border-gray-200 flex justify-around items-center px-2 pt-2 z-30 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] sticky bottom-0"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.5rem)' }}
        >
            {menuItems.filter(i => i.show).slice(0, 4).map((item) => {
              const isActive = location.pathname === item.path;
              const showInventoryBadge = item.path === '/inventario' && inventoryAlertCount > 0;
              return (
                <Link key={item.path} to={item.path} className={`flex-1 p-2 rounded-xl flex flex-col items-center transition-all duration-200 relative ${isActive ? 'text-[#0B3B68] bg-[#0B3B68]/5 transform -translate-y-1' : 'text-gray-400 hover:text-[#0B3B68]'}`}>
                    <div className={isActive ? 'drop-shadow-sm' : ''}>{item.icon}</div>
                    {showInventoryBadge && (
                      <span className="absolute top-1 right-[calc(50%-12px)] flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                      </span>
                    )}
                    <span className={`text-[9px] font-bold mt-1 uppercase tracking-wider ${isActive ? 'opacity-100' : 'opacity-0'}`}>{item.label}</span>
                </Link>
              )
            })}
        </nav>

        {isMobileMenuOpen && (
            <div className="fixed inset-0 z-50 md:hidden flex justify-end">
                <div className="absolute inset-0 bg-[#0B3B68]/90 backdrop-blur-sm animate-in fade-in" onClick={() => setIsMobileMenuOpen(false)} />
                
                <div className="relative bg-[#F3F4F6] w-4/5 max-w-xs h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300 border-l border-gray-200">
                    <div
                      className="px-6 pb-6 bg-[#0B3B68] text-white"
                      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1.5rem)' }}
                    >
                        <div className="flex justify-between items-center mb-6">
                           {/* ✅ LOGO EN EL MENÚ MÓVIL DESPLEGABLE */}
                           <div className="bg-white p-1.5 rounded-xl shadow-lg w-12 h-12 flex items-center justify-center">
                             <img src={logo} alt="Logo" className="w-full h-full object-contain" />
                           </div>
                           <button onClick={() => setIsMobileMenuOpen(false)} className="bg-white/10 p-2 rounded-full hover:bg-white/20 text-white"><X size={20}/></button>
                        </div>
                        <h2 className="text-xl font-bold text-white mb-1">Menú Principal</h2>
                        <p className="text-[#7AC142] text-sm font-medium">Hola, {currentStaff?.name.split(' ')[0]}</p>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-4 space-y-2">
                        {menuItems.filter(i => i.show).map(item => {
                             const isActive = location.pathname === item.path;
                             return (
                                <Link key={item.path} to={item.path} onClick={() => setIsMobileMenuOpen(false)} className={`flex items-center gap-4 p-4 rounded-xl transition-all ${isActive ? 'bg-[#0B3B68] text-white shadow-md font-bold' : 'text-[#1F2937] hover:bg-gray-100'}`}>
                                    <span className={isActive ? 'text-[#7AC142]' : 'text-[#0B3B68]'}>{item.icon}</span>
                                    <span>{item.label}</span>
                                </Link>
                             )
                        })}
                    </div>
                    
                    <div className="p-6 border-t border-gray-200 bg-white space-y-3">
                        {multipleStaff && onChangeStaff && (
                          <button
                            onClick={() => { setIsMobileMenuOpen(false); onChangeStaff(); }}
                            className="flex items-center justify-center gap-3 text-[#0B3B68] w-full p-4 hover:bg-[#0B3B68]/5 rounded-xl font-bold transition-colors border border-[#0B3B68]/20"
                          >
                            <ArrowLeftRight size={20} /> Cambiar Vendedor
                          </button>
                        )}
                        <button onClick={handleLogout} disabled={isLoggingOut} className="flex items-center justify-center gap-3 text-[#EF4444] w-full p-4 hover:bg-[#EF4444]/5 rounded-xl font-bold transition-colors border border-[#EF4444]/20 hover:border-[#EF4444] disabled:opacity-50">
                            {isLoggingOut ? <Loader2 size={20} className="animate-spin"/> : <LogOut size={20}/>}
                            {isLoggingOut ? 'Cerrando...' : 'Cerrar Sesión'}
                        </button>
                    </div>
                </div>
            </div>
        )}

      {/* Modal de bienvenida → guía rápida (solo primera vez) */}
      {showGuidePrompt && (
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-sm z-50 animate-in slide-in-from-bottom-4 fade-in duration-300">
          <div className="bg-[#0B3B68] text-white rounded-2xl shadow-2xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center flex-shrink-0">
              <HelpCircle size={22} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm leading-tight">¿Primera vez aquí?</p>
              <p className="text-xs text-white/70 mt-0.5">Tenemos una guía rápida para empezar</p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={() => {
                  const bId = localStorage.getItem('nexus_business_id');
                  if (bId) localStorage.setItem(`nexus_guide_seen_${bId}`, '1');
                  sessionStorage.removeItem('nexus_new_registration');
                  setShowGuidePrompt(false);
                  navigate('/configuracion?tab=help');
                }}
                className="bg-[#7AC142] text-[#0B3B68] text-xs font-black px-3 py-2 rounded-xl hover:bg-[#7AC142]/90 transition-colors whitespace-nowrap"
              >
                Ver guía
              </button>
              <button
                onClick={() => {
                  const bId = localStorage.getItem('nexus_business_id');
                  if (bId) localStorage.setItem(`nexus_guide_seen_${bId}`, '1');
                  sessionStorage.removeItem('nexus_new_registration');
                  setShowGuidePrompt(false);
                }}
                className="w-8 h-8 flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}