import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { 
  Store, Package, PieChart, Settings, Lock, Shield, 
  Cloud, AlertCircle, RefreshCw, LogOut, Menu, X, Users as UsersIcon, CheckCircle2 
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Staff } from '../lib/db';
import { syncPush, syncPull } from '../lib/sync'; // Importamos syncPull también
import { supabase } from '../lib/supabase';
import logo from '../logo.png'; 
import { toast } from 'sonner';

interface LayoutProps {
  currentStaff: Staff | null;
  onLock: () => void;
}

export function Layout({ currentStaff, onLock }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    const handleOnline = () => { setIsOnline(true); toast.success("Conexión restaurada"); };
    const handleOffline = () => { setIsOnline(false); toast.error("Sin conexión a internet"); };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const pendingCount = useLiveQuery(async () => {
    const sales = await db.sales.where('sync_status').equals('pending_create').count();
    const movements = await db.movements.where('sync_status').equals('pending_create').count();
    const audits = await db.audit_logs.where('sync_status').equals('pending_create').count();
    return sales + movements + audits; 
  }, []) || 0;

  const handleManualSync = async () => {
    if (!isOnline) {
        toast.error("No hay conexión para sincronizar");
        return;
    }
    setIsSyncing(true);
    
    // Ejecutamos Push (subir) y Pull (bajar) para estar 100% al día
    toast.promise(Promise.all([syncPush(), syncPull()]), {
        loading: 'Sincronizando todo...',
        success: '¡Sistema actualizado y al día!',
        error: 'Error al sincronizar'
    });

    // Pequeño delay para que se vea la animación
    setTimeout(() => setIsSyncing(false), 2000);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem('nexus_business_id');
    localStorage.removeItem('nexus_current_staff'); 
    navigate('/login');
  };

  // --- LÓGICA DE ESTADO VISUAL DEL BOTÓN ---
  let buttonColorClass = "";
  let buttonIcon = <Cloud size={20} />;
  let buttonTitle = "";

  if (isSyncing) {
      buttonColorClass = "bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200";
      buttonIcon = <RefreshCw size={20} className="animate-spin"/>;
      buttonTitle = "Sincronizando...";
  } else if (!isOnline && pendingCount > 0) {
      // ⚠️ CASO CRÍTICO: Cambios sin subir y sin internet (ROJO)
      buttonColorClass = "bg-red-50 text-red-600 ring-1 ring-red-200 animate-pulse";
      buttonIcon = <AlertCircle size={20} />;
      buttonTitle = "¡ADVERTENCIA! Cambios sin guardar en la nube";
  } else if (pendingCount > 0) {
      // ⚠️ Cambios pendientes por subir (AMARILLO)
      buttonColorClass = "bg-amber-50 text-amber-600 ring-1 ring-amber-200";
      buttonIcon = <RefreshCw size={20} />;
      buttonTitle = "Hay cambios pendientes de subir";
  } else {
      // ✅ Todo al día (VERDE - Feedback positivo)
      buttonColorClass = "bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200 hover:bg-emerald-100";
      buttonIcon = <CheckCircle2 size={20} />;
      buttonTitle = "Sistema actualizado y seguro";
  }

  const isAdmin = currentStaff?.role === 'admin';
  const isCashier = currentStaff?.role === 'vendedor';

  const menuItems = [
    { path: '/', icon: <Store size={22} />, label: 'Punto de Venta', show: true }, 
    { path: '/clientes', icon: <UsersIcon size={22} />, label: 'Clientes', show: true }, 
    { path: '/inventario', icon: <Package size={22} />, label: 'Inventario', show: isAdmin },
    { path: '/finanzas', icon: <PieChart size={22} />, label: 'Finanzas', show: isAdmin },
    { path: '/equipo', icon: <Shield size={22} />, label: 'Equipo', show: isAdmin },
    { path: '/configuracion', icon: <Settings size={22} />, label: 'Configuración', show: isAdmin }
  ];

  return (
    <div className="flex h-screen w-full bg-slate-50 overflow-hidden font-sans">
      
      {/* SIDEBAR DESKTOP */}
      <aside className={`hidden md:flex flex-col items-center py-6 z-20 shadow-sm transition-all bg-white border-r border-slate-200 duration-300 ${isCashier ? 'w-20' : 'w-24'}`}>
        <div className="mb-4 p-1 bg-white rounded-xl shadow-sm border border-slate-100">
          <img src={logo} alt="Logo" className="w-10 h-10 object-contain" />
        </div>
        
        <div className="mb-6 text-center px-1 w-full group relative">
          <div className={`w-9 h-9 rounded-full flex items-center justify-center mx-auto mb-1 text-white font-bold text-sm shadow-md transition-colors ${isAdmin ? 'bg-purple-600' : 'bg-indigo-500'}`}>
            {currentStaff?.name.substring(0, 2).toUpperCase() || 'ST'}
          </div>
          {!isCashier && (
             <p className="text-[10px] font-bold text-slate-600 truncate w-full px-1">
               {currentStaff?.name?.split(' ')[0]}
             </p>
          )}
        </div>

        <nav className="flex-1 flex flex-col gap-3 w-full px-2">
          {menuItems.filter(i => i.show).map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex flex-col items-center justify-center p-3 rounded-xl transition-all duration-200 group relative ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-600 shadow-sm ring-1 ring-indigo-100'
                    : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                }`}
              >
                {item.icon}
                <span className="absolute left-full ml-2 px-2 py-1 bg-slate-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50 shadow-lg">
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="flex flex-col gap-2 w-full px-2 mt-4 border-t border-slate-100 pt-4">
            {/* BOTÓN DE SINCRONIZACIÓN MEJORADO */}
            <button 
                onClick={handleManualSync}
                disabled={!isOnline || isSyncing}
                className={`p-3 rounded-xl flex flex-col items-center justify-center transition-all duration-300 relative group ${buttonColorClass}`}
                title={buttonTitle}
            >
                {buttonIcon}
                {pendingCount > 0 && (
                    <span className="absolute top-1 right-1 flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500 text-[8px] text-white justify-center items-center font-bold"></span>
                    </span>
                )}
            </button>

            <button onClick={onLock} className="p-3 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-xl transition-colors flex flex-col items-center justify-center" title="Bloquear Pantalla">
                <Lock size={20}/>
            </button>

            <button onClick={handleLogout} className="p-3 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors flex flex-col items-center justify-center" title="Cerrar Sesión">
                <LogOut size={20}/>
            </button>
        </div>
      </aside>

      {/* HEADER MÓVIL */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        <header className="bg-white border-b border-slate-200 px-4 py-3 flex justify-between items-center md:hidden z-10 shadow-sm">
            <button onClick={() => setIsMobileMenuOpen(true)} className="text-slate-600">
                <Menu size={24} />
            </button>
            <div className="font-bold text-slate-800 flex items-center gap-2">
                <img src={logo} alt="" className="w-6 h-6 object-contain"/> 
                <span className="text-sm">Nexus POS</span>
            </div>
            <div className="flex items-center gap-3">
                {/* BOTÓN MÓVIL TAMBIÉN ACTUALIZADO */}
                <button 
                    onClick={handleManualSync}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${buttonColorClass}`}
                >
                    {isSyncing ? <RefreshCw size={14} className="animate-spin"/> : pendingCount > 0 ? <AlertCircle size={14}/> : <CheckCircle2 size={14}/>}
                    {pendingCount > 0 && <span className="ml-1">{pendingCount}</span>}
                </button>
            </div>
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden relative bg-slate-50 pb-safe">
            <Outlet context={{ currentStaff }} /> 
        </main>

        <nav className="md:hidden bg-white border-t border-slate-200 flex justify-around items-center p-2 pb-safe z-30 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
            {menuItems.filter(i => i.show).slice(0, 4).map((item) => (
            <Link key={item.path} to={item.path} className={`p-2 rounded-xl flex flex-col items-center transition-colors ${location.pathname === item.path ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400'}`}>
                {item.icon}
            </Link>
            ))}
            <button onClick={onLock} className="p-2 text-slate-400 active:text-blue-500 rounded-xl"><Lock size={22}/></button>
        </nav>

        {/* Menú Móvil Overlay */}
        {isMobileMenuOpen && (
            <div className="fixed inset-0 z-50 md:hidden flex">
                <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setIsMobileMenuOpen(false)} />
                <div className="relative bg-white w-64 h-full shadow-2xl flex flex-col animate-in slide-in-from-left duration-200">
                    <div className="p-4 border-b flex justify-between items-center bg-slate-50">
                        <span className="font-bold text-lg">Menú</span>
                        <button onClick={() => setIsMobileMenuOpen(false)}><X size={24} className="text-slate-500"/></button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-1">
                        {menuItems.filter(i => i.show).map(item => (
                            <Link key={item.path} to={item.path} onClick={() => setIsMobileMenuOpen(false)} className={`flex items-center gap-3 p-3 rounded-lg ${location.pathname === item.path ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-600 hover:bg-slate-100'}`}>
                                {item.icon}
                                <span>{item.label}</span>
                            </Link>
                        ))}
                    </div>
                    <div className="p-4 border-t bg-slate-50">
                        <button onClick={handleLogout} className="flex items-center gap-2 text-red-600 w-full p-2 hover:bg-red-50 rounded-lg font-bold">
                            <LogOut size={20} /> Salir
                        </button>
                    </div>
                </div>
            </div>
        )}
      </div>
    </div>
  );
}