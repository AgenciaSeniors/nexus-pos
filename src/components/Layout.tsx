import { Link, Outlet, useLocation } from 'react-router-dom';
import { Store, Package, PieChart, Settings, Users, Lock, Shield } from 'lucide-react';
import type { Staff } from '../lib/db';

interface LayoutProps {
  currentStaff: Staff | null;
  onLock: () => void;
}

export function Layout({ currentStaff, onLock }: LayoutProps) {
  const location = useLocation();
  const isAdmin = currentStaff?.role === 'admin';

  // Filtramos el menú según el rol del empleado
  const allMenuItems = [
    { path: '/', icon: <Store size={22} />, label: 'Vender', show: true },
    { path: '/clientes', icon: <Users size={22} />, label: 'Clientes', show: true },
    { path: '/inventario', icon: <Package size={22} />, label: 'Stock', show: isAdmin },
    { path: '/finanzas', icon: <PieChart size={22} />, label: 'Finanzas', show: isAdmin },
    { path: '/equipo', icon: <Shield size={22} />, label: 'Equipo', show: isAdmin },
    { path: '/configuracion', icon: <Settings size={22} />, label: 'Ajustes', show: isAdmin }
  ];

  return (
    <div className="flex h-screen w-full bg-slate-50 overflow-hidden">
      
      {/* 🖥️ SIDEBAR (PC) */}
      <aside className="hidden md:flex w-24 bg-white border-r border-slate-200 flex-col items-center py-6 z-20 shadow-sm">
        <div className="mb-4 p-3 bg-indigo-600 rounded-xl text-white font-bold shadow-indigo-200 shadow-lg">NP</div>
        
        {/* INFO DEL EMPLEADO ACTUAL */}
        <div className="mb-6 text-center px-1">
          <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-1 text-slate-600 font-bold text-xs border border-slate-200">
            {currentStaff?.name.substring(0, 2).toUpperCase()}
          </div>
          <p className="text-[10px] font-medium text-slate-500 truncate w-full" title={currentStaff?.name}>
            {currentStaff?.name}
          </p>
        </div>

        <nav className="flex-1 flex flex-col gap-4 w-full px-4 overflow-y-auto scrollbar-hide">
          {allMenuItems.filter(i => i.show).map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`flex flex-col items-center justify-center p-3 rounded-2xl transition-all duration-300 ${
                location.pathname === item.path
                  ? 'bg-indigo-50 text-indigo-600 shadow-sm translate-x-1'
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
              }`}
            >
              {item.icon}
              <span className="text-[10px] mt-1 font-semibold">{item.label}</span>
            </Link>
          ))}
        </nav>

        {/* BOTÓN DE BLOQUEO */}
        <button 
          onClick={onLock} 
          className="mt-4 p-3 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors flex flex-col items-center"
          title="Bloquear Pantalla"
        >
          <Lock size={22} />
          <span className="text-[9px] font-bold mt-1">Bloquear</span>
        </button>
      </aside>

      {/* 📱 MOBILE BOTTOM BAR */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-4 py-2 flex justify-between items-center z-50 pb-safe">
        {allMenuItems.filter(i => i.show).slice(0, 4).map((item) => (
          <Link key={item.path} to={item.path} className={`flex flex-col items-center p-2 ${location.pathname === item.path ? 'text-indigo-600' : 'text-slate-400'}`}>
            {item.icon}
          </Link>
        ))}
        <button onClick={onLock} className="text-slate-400 p-2"><Lock size={22}/></button>
      </nav>

      {/* ÁREA PRINCIPAL: Pasamos el contexto del empleado a las páginas */}
      <main className="flex-1 overflow-auto relative w-full pb-20 md:pb-0">
        <Outlet context={{ currentStaff }} /> 
      </main>
    </div>
  );
}