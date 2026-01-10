import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Store, Package, PieChart, LogOut, Settings } from 'lucide-react';
import { supabase } from '../lib/supabase';

export function Layout() {
  const location = useLocation();
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        supabase.from('profiles').select('role').eq('id', session.user.id).single()
          .then(({ data }) => setRole(data?.role || 'seller'));
      }
    });
  }, []);

  const allMenuItems = [
    { path: '/', icon: <Store size={22} />, label: 'Vender', roles: ['admin', 'seller'] },
    { path: '/inventario', icon: <Package size={22} />, label: 'Stock', roles: ['admin'] },
    { path: '/finanzas', icon: <PieChart size={22} />, label: 'Finanzas', roles: ['admin'] },
    { path: '/configuracion', icon: <Settings size={22} />, label: 'Ajustes', roles: ['admin'] }
  ];

  const visibleItems = allMenuItems.filter(item => role ? item.roles.includes(item.roles[0]) : false);

  return (
    <div className="flex h-screen w-full bg-slate-50 overflow-hidden">
      
      {/* 🖥️ SIDEBAR (Solo visible en Desktop 'md') */}
      <aside className="hidden md:flex w-24 bg-white border-r border-slate-200 flex-col items-center py-6 z-20 shadow-sm">
        <div className="mb-8 p-3 bg-indigo-600 rounded-xl text-white font-bold shadow-indigo-200 shadow-lg">NP</div>
        
        <nav className="flex-1 flex flex-col gap-6 w-full px-4">
          
          {visibleItems.map((item) => (
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

        <button onClick={() => supabase.auth.signOut()} className="p-3 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors">
          <LogOut size={22} />
        </button>
      </aside>

      {/* 📱 MOBILE BOTTOM BAR (Solo visible en Móvil) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-6 py-3 flex justify-between items-center z-50 pb-safe shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        {visibleItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={`flex flex-col items-center transition-all ${
               location.pathname === item.path ? 'text-indigo-600 -translate-y-1' : 'text-slate-400'
            }`}
          >
            {item.icon}
            <span className="text-[10px] font-medium mt-1">{item.label}</span>
          </Link>
        ))}
        <button onClick={() => supabase.auth.signOut()} className="text-slate-300">
           <LogOut size={20} />
        </button>
      </nav>

      {/* ÁREA PRINCIPAL */}
      <main className="flex-1 overflow-auto relative w-full pb-20 md:pb-0">
        <Outlet /> 
      </main>
    </div>
  );
}