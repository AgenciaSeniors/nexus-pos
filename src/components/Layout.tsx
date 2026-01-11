import { Link, Outlet, useLocation } from 'react-router-dom';
import { Store, Package, PieChart, Settings, Lock, Shield } from 'lucide-react';
import type { Staff } from '../lib/db';
import logo from '../logo.png';

interface LayoutProps {
  currentStaff: Staff | null;
  onLock: () => void;
}

export function Layout({ currentStaff, onLock }: LayoutProps) {
  const location = useLocation();
  
  // VERIFICAMOS SI ES ADMIN
  const isAdmin = currentStaff?.role === 'admin';

  // DEFINIMOS EL MENÚ SEGÚN EL ROL
  const allMenuItems = [
    // Visible para TODOS (Admin y Vendedor)
    { path: '/', icon: <Store size={22} />, label: 'Vender', show: true },
    
    // Visible SOLO para ADMIN
    { path: '/inventario', icon: <Package size={22} />, label: 'Stock', show: isAdmin },
    { path: '/finanzas', icon: <PieChart size={22} />, label: 'Finanzas', show: isAdmin },
    { path: '/equipo', icon: <Shield size={22} />, label: 'Equipo', show: isAdmin },
    { path: '/configuracion', icon: <Settings size={22} />, label: 'Ajustes', show: isAdmin }
  ];

  return (
    <div className="flex h-screen w-full bg-slate-50 overflow-hidden">
      
      {/* 🖥️ SIDEBAR (PC) */}
      <aside className="hidden md:flex w-24 bg-white border-r border-slate-200 flex-col items-center py-6 z-20 shadow-sm">
        {/* Opción con imagen */}
<div className="mb-4 p-1 bg-white rounded-xl shadow-lg">
  <img src={logo} alt="Logo" className="w-10 h-10 object-contain" />
</div>
        
        {/* FOTO/INICIALES DEL EMPLEADO */}
        <div className="mb-6 text-center px-1">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center mx-auto mb-1 text-white font-bold text-xs shadow-sm ${isAdmin ? 'bg-purple-600' : 'bg-blue-500'}`}>
            {currentStaff?.name.substring(0, 2).toUpperCase()}
          </div>
          <p className="text-[10px] font-medium text-slate-500 truncate w-full">
            {currentStaff?.name}
          </p>
        </div>

        {/* MENÚ FILTRADO */}
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

        {/* BOTÓN BLOQUEAR */}
        <button 
          onClick={onLock} 
          className="mt-4 p-3 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors flex flex-col items-center group"
          title="Bloquear Pantalla"
        >
          <Lock size={22} className="group-hover:scale-110 transition-transform"/>
          <span className="text-[9px] font-bold mt-1">Bloquear</span>
        </button>
      </aside>

      {/* 📱 MOBILE NAV (Solo muestra lo esencial) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-4 py-2 flex justify-between items-center z-50 pb-safe">
        {allMenuItems.filter(i => i.show).slice(0, 4).map((item) => (
          <Link key={item.path} to={item.path} className={`flex flex-col items-center p-2 ${location.pathname === item.path ? 'text-indigo-600' : 'text-slate-400'}`}>
            {item.icon}
          </Link>
        ))}
        <button onClick={onLock} className="text-slate-400 p-2"><Lock size={22}/></button>
      </nav>

      {/* ÁREA PRINCIPAL */}
      <main className="flex-1 overflow-auto relative w-full pb-20 md:pb-0">
        <Outlet context={{ currentStaff }} /> 
      </main>
    </div>
  );
}