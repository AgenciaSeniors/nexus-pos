import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { 
  Store, Package, PieChart, Settings, 
  Cloud, AlertCircle, RefreshCw, LogOut, Menu, X, Users as UsersIcon, CheckCircle2 
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Staff } from '../lib/db';
import { syncManualFull } from '../lib/sync'; 
import { supabase } from '../lib/supabase';
import logo from '../logo.png'; 
import { toast } from 'sonner';

interface LayoutProps {
  currentStaff: Staff | null;
}

export function Layout({ currentStaff }: LayoutProps) {
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
    const products = await db.products.filter(p => p.sync_status !== 'synced').count();
    const customers = await db.customers.filter(c => c.sync_status !== 'synced').count();
    const settings = await db.settings.filter(s => s.sync_status !== 'synced').count();
    const shifts = await db.cash_shifts.filter(s => s.sync_status !== 'synced').count();
    const cashMovements = await db.cash_movements.filter(m => m.sync_status !== 'synced').count();

    return sales + movements + audits + products + customers + settings + shifts + cashMovements;
  }, []) || 0;

  const handleManualSync = async () => {
    if (!isOnline) {
        toast.error("No hay conexión para sincronizar");
        return;
    }
    setIsSyncing(true);
    
    try {
        await syncManualFull();
        toast.success('¡Sistema sincronizado con éxito!');
    } catch (error) {
        console.error(error);
        toast.error('Error al sincronizar');
    } finally {
        setTimeout(() => setIsSyncing(false), 500);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem('nexus_business_id');
    localStorage.removeItem('nexus_current_staff'); 
    navigate('/login');
  };

  const isAdmin = currentStaff?.role === 'admin';
  const isCashier = currentStaff?.role === 'vendedor';

  const menuItems = [
    { path: '/', icon: <Store size={22} />, label: 'Punto de Venta', show: true }, 
    { path: '/clientes', icon: <UsersIcon size={22} />, label: 'Clientes', show: true }, 
    { path: '/inventario', icon: <Package size={22} />, label: 'Inventario', show: isAdmin },
    { path: '/finanzas', icon: <PieChart size={22} />, label: 'Finanzas', show: isAdmin },
    { path: '/configuracion', icon: <Settings size={22} />, label: 'Configuración', show: isAdmin }
  ];

  // --- LÓGICA DE ESTADO DEL BOTÓN (Simplificada y corregida) ---
  const getButtonState = () => {
    if (isSyncing) {
      return {
        className: "bg-amber-50 text-amber-600 ring-1 ring-amber-200",
        icon: <RefreshCw size={20} className="animate-spin"/>,
        title: "Sincronizando..."
      };
    } 
    if (!isOnline && pendingCount > 0) {
      return {
        className: "bg-red-50 text-[#EF4444] ring-1 ring-red-200 animate-pulse",
        icon: <AlertCircle size={20} />,
        title: "¡ADVERTENCIA! Cambios sin guardar en la nube"
      };
    } 
    if (pendingCount > 0) {
      return {
        className: "bg-amber-50 text-[#F59E0B] ring-1 ring-amber-200",
        icon: <RefreshCw size={20} />,
        title: "Hay cambios pendientes de subir"
      };
    } 
    return {
      className: "bg-[#7AC142]/10 text-[#7AC142] ring-1 ring-[#7AC142]/30 hover:bg-[#7AC142]/20",
      icon: <CheckCircle2 size={20} />,
      title: "Sistema actualizado y seguro"
    };
  };

  const buttonState = getButtonState();

  return (
    <div className="flex h-screen w-full bg-[#F3F4F6] overflow-hidden font-sans text-[#1F2937]">
      
      {/* SIDEBAR DESKTOP */}
      <aside className={`hidden md:flex flex-col items-center py-6 z-20 shadow-xl transition-all bg-[#0B3B68] text-white duration-300 ${isCashier ? 'w-20' : 'w-24'}`}>
        
        <div className="mb-6 p-2 bg-white/10 rounded-2xl border border-white/10 shadow-inner">
          <img src={logo} alt="Bisne" className="w-10 h-10 object-contain drop-shadow-md" />
        </div>
        
        <div className="mb-8 text-center px-1 w-full group relative">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2 font-bold text-sm shadow-lg transition-colors border-2 border-[#7AC142] ${isAdmin ? 'bg-[#7AC142] text-[#0B3B68]' : 'bg-white/10 text-white'}`}>
            {currentStaff?.name.substring(0, 2).toUpperCase() || 'BT'}
          </div>
          {!isCashier && (
             <p className="text-[10px] font-bold text-[#7AC142] truncate w-full px-1 uppercase tracking-wider opacity-90">
               {currentStaff?.name?.split(' ')[0]}
             </p>
          )}
        </div>

        <nav className="flex-1 flex flex-col gap-4 w-full px-3">
          {menuItems.filter(i => i.show).map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex flex-col items-center justify-center p-3 rounded-xl transition-all duration-200 group relative ${
                  isActive
                    ? 'bg-[#7AC142] text-[#0B3B68] shadow-lg shadow-[#7AC142]/20 font-bold translate-x-1'
                    : 'text-gray-300 hover:text-white hover:bg-white/10'
                }`}
              >
                {item.icon}
                <span className="absolute left-full ml-4 px-3 py-2 bg-[#1F2937] text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50 shadow-xl font-bold uppercase tracking-wide border border-gray-700">
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="flex flex-col gap-3 w-full px-3 mt-4 border-t border-white/10 pt-6">
            <button 
                onClick={handleManualSync}
                disabled={!isOnline || isSyncing}
                className={`p-3 rounded-xl flex flex-col items-center justify-center transition-all duration-300 relative group bg-white/5 hover:bg-white/10 border border-white/5 ${pendingCount > 0 ? 'text-[#F59E0B] border-[#F59E0B]/50' : 'text-[#7AC142]'}`}
                title={buttonState.title}
            >
                {buttonState.icon}
                {pendingCount > 0 && (
                    <span className="absolute top-2 right-2 flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#F59E0B] opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#F59E0B]"></span>
                    </span>
                )}
            </button>

            <button onClick={handleLogout} className="p-3 text-gray-400 hover:text-[#EF4444] hover:bg-[#EF4444]/10 rounded-xl transition-colors flex flex-col items-center justify-center" title="Cerrar Sesión">
                <LogOut size={20}/>
            </button>
        </div>
      </aside>

      {/* HEADER MÓVIL */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        <header className="bg-[#0B3B68] text-white border-b border-[#0B3B68] px-4 py-3 flex justify-between items-center md:hidden z-10 shadow-lg sticky top-0">
            <button onClick={() => setIsMobileMenuOpen(true)} className="text-white hover:text-[#7AC142] transition-colors">
                <Menu size={26} />
            </button>
            <div className="font-bold text-lg flex items-center gap-2 tracking-tight">
                <img src={logo} alt="" className="w-8 h-8 object-contain"/> 
                <span>Bisne con Talla</span>
            </div>
            <div className="flex items-center gap-3">
                <button 
                    onClick={handleManualSync}
                    className={`flex items-center justify-center w-9 h-9 rounded-full transition-all ${isSyncing || pendingCount > 0 ? 'bg-[#F59E0B] text-[#0B3B68] animate-pulse' : 'bg-[#7AC142] text-[#0B3B68]'}`}
                >
                    {isSyncing ? <RefreshCw size={18} className="animate-spin"/> : pendingCount > 0 ? <Cloud size={18}/> : <CheckCircle2 size={18}/>}
                </button>
            </div>
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden relative bg-[#F3F4F6] pb-safe scroll-smooth">
            <Outlet context={{ currentStaff }} /> 
        </main>

        <nav className="md:hidden bg-white border-t border-gray-200 flex justify-around items-center p-2 pb-safe z-30 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] sticky bottom-0">
            {menuItems.filter(i => i.show).slice(0, 4).map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <Link key={item.path} to={item.path} className={`flex-1 p-2 rounded-xl flex flex-col items-center transition-all duration-200 ${isActive ? 'text-[#0B3B68] bg-[#0B3B68]/5 transform -translate-y-1' : 'text-gray-400 hover:text-[#0B3B68]'}`}>
                    <div className={isActive ? 'drop-shadow-sm' : ''}>{item.icon}</div>
                    <span className={`text-[9px] font-bold mt-1 uppercase tracking-wider ${isActive ? 'opacity-100' : 'opacity-0'}`}>{item.label}</span>
                </Link>
              )
            })}
        </nav>

        {isMobileMenuOpen && (
            <div className="fixed inset-0 z-50 md:hidden flex justify-end">
                <div className="absolute inset-0 bg-[#0B3B68]/90 backdrop-blur-sm animate-in fade-in" onClick={() => setIsMobileMenuOpen(false)} />
                
                <div className="relative bg-[#F3F4F6] w-4/5 max-w-xs h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300 border-l border-gray-200">
                    <div className="p-6 bg-[#0B3B68] text-white">
                        <div className="flex justify-between items-center mb-6">
                           <img src={logo} alt="Logo" className="w-10 h-10 object-contain"/>
                           <button onClick={() => setIsMobileMenuOpen(false)} className="bg-white/10 p-2 rounded-full hover:bg-white/20 text-white"><X size={20}/></button>
                        </div>
                        <h2 className="text-xl font-bold text-white mb-1">Menú Principal</h2>
                        <p className="text-[#7AC142] text-sm font-medium">Hola, {currentStaff?.name.split(' ')[0]}</p>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-4 space-y-2">
                        {menuItems.filter(i => i.show).map(item => {
                             const isActive = location.pathname === item.path;
                             return (
                                <Link key={item.path} to={item.path} onClick={() => setIsMobileMenuOpen(false)} 
                                    className={`flex items-center gap-4 p-4 rounded-xl transition-all ${isActive ? 'bg-[#0B3B68] text-white shadow-md font-bold' : 'text-[#1F2937] hover:bg-gray-100'}`}>
                                    <span className={isActive ? 'text-[#7AC142]' : 'text-[#0B3B68]'}>{item.icon}</span>
                                    <span>{item.label}</span>
                                </Link>
                             )
                        })}
                    </div>
                    
                    <div className="p-6 border-t border-gray-200 bg-white">
                        <button onClick={handleLogout} className="flex items-center justify-center gap-3 text-[#EF4444] w-full p-4 hover:bg-[#EF4444]/5 rounded-xl font-bold transition-colors border border-[#EF4444]/20 hover:border-[#EF4444]">
                            <LogOut size={20} /> Cerrar Sesión
                        </button>
                    </div>
                </div>
            </div>
        )}
      </div>
    </div>
  );
}