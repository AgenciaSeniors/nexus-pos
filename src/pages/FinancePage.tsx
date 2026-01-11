import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Sale } from '../lib/db';
import { syncPull } from '../lib/sync';
import { TicketModal } from '../components/TicketModal';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, Legend 
} from 'recharts';
import { 
  Calendar, 
  TrendingUp, 
  ArrowLeft, 
  ArrowRight, 
  CalendarOff,
  RefreshCw,
  Eye,
  BarChart3,
  DollarSign,
  Wallet,
  PieChart as PieChartIcon
} from 'lucide-react';

export function FinancePage() {
  // --- ESTADOS DE LA VISTA ---
  const [viewMode, setViewMode] = useState<'daily' | 'trends'>('daily');
  
  // Estado para MODO DIARIO
  const today = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedTicket, setSelectedTicket] = useState<Sale | null>(null);

  // Estado para MODO TENDENCIAS
  const [trendFilter, setTrendFilter] = useState<'week' | 'month'>('week');

  // --- DATOS ---
  const rawSales = useLiveQuery(() => db.sales.toArray());
  const allSales = useMemo(() => rawSales ?? [], [rawSales]);

  const rawProducts = useLiveQuery(() => db.products.toArray());
  const products = useMemo(() => rawProducts ?? [], [rawProducts]);

  // Mapa de Costos y Categorías
  const productMeta = useMemo(() => {
    const costs = new Map();
    const cats = new Map();
    products.forEach(p => {
      costs.set(p.id, p.cost || 0);
      cats.set(p.id, p.category || 'General');
    });
    return { costs, cats };
  }, [products]);

  // ==========================================
  // 1. LÓGICA DIARIA
  // ==========================================
  const dailyStats = useMemo(() => {
    const salesForDay = allSales.filter(sale => sale.date.startsWith(selectedDate));
    
    let revenue = 0, cost = 0;
    const hourlyCounts: Record<string, number> = {};
    const categoryCounts: Record<string, number> = {};

    // Inicializar horas (07:00 a 23:00)
    for (let i = 7; i <= 23; i++) hourlyCounts[i.toString().padStart(2, '0') + ":00"] = 0;

    salesForDay.forEach(sale => {
      revenue += sale.total;
      
      // Hora
      const h = new Date(sale.date).getHours().toString().padStart(2, '0') + ":00";
      if (hourlyCounts[h] !== undefined) hourlyCounts[h] += sale.total;

      // Costos y Categorías
      sale.items.forEach(item => {
        const itemCost = productMeta.costs.get(item.product_id) || 0;
        cost += itemCost * item.quantity;
        
        const cat = productMeta.cats.get(item.product_id) || 'General';
        categoryCounts[cat] = (categoryCounts[cat] || 0) + (item.price * item.quantity);
      });
    });

    const profit = revenue - cost;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
    
    const chartData = Object.entries(hourlyCounts).map(([time, total]) => ({ time, total }));
    const pieData = Object.entries(categoryCounts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    return { 
      sales: salesForDay.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
      revenue, profit, cost, margin, chartData, pieData 
    };
  }, [allSales, selectedDate, productMeta]);


  // ==========================================
  // 2. LÓGICA TENDENCIAS
  // ==========================================
  const trendStats = useMemo(() => {
    const now = new Date();
    const daysToShow = trendFilter === 'week' ? 7 : 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(now.getDate() - daysToShow);

    const filteredSales = allSales.filter(s => new Date(s.date) >= cutoffDate);

    let totalRevenue = 0, totalCost = 0;
    const salesByDate: Record<string, number> = {};

    filteredSales.forEach(sale => {
      totalRevenue += sale.total;
      
      let saleCost = 0;
      sale.items.forEach(i => saleCost += (productMeta.costs.get(i.product_id) || 0) * i.quantity);
      totalCost += saleCost;

      const dateKey = new Date(sale.date).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' });
      salesByDate[dateKey] = (salesByDate[dateKey] || 0) + sale.total;
    });

    const totalProfit = totalRevenue - totalCost;
    const totalMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
    const chartData = Object.entries(salesByDate).map(([date, total]) => ({ date, total }));

    return { totalRevenue, totalCost, totalProfit, totalMargin, chartData, count: filteredSales.length };
  }, [allSales, trendFilter, productMeta]);


  // Funciones Auxiliares
  const changeDate = (days: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + days);
    const newStr = d.toISOString().split('T')[0];
    if (newStr <= today) setSelectedDate(newStr);
  };

  const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

  return (
    <div className="p-6 pb-24 md:pb-6 min-h-screen bg-slate-50">
      
      {/* HEADER PRINCIPAL */}
      <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <TrendingUp className="text-indigo-600" /> Finanzas
          </h1>
          <p className="text-slate-500 text-sm">Control de caja y rendimiento</p>
        </div>

        <div className="flex bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
          <button 
            onClick={() => setViewMode('daily')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'daily' ? 'bg-indigo-50 text-indigo-600 shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            <Calendar size={16} /> Día a Día
          </button>
          <button 
            onClick={() => setViewMode('trends')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'trends' ? 'bg-indigo-50 text-indigo-600 shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            <BarChart3 size={16} /> Tendencias
          </button>
        </div>
      </div>

      {/* --- VISTA 1: DETALLE DIARIO --- */}
      {viewMode === 'daily' && (
        <div className="animate-fade-in">
          
          {/* Controles de Fecha */}
          <div className="flex justify-between items-center mb-6">
             <div className="flex items-center gap-2 bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
                <button onClick={() => changeDate(-1)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600"><ArrowLeft size={20} /></button>
                <div className="relative mx-2">
                  <input 
                    type="date" 
                    value={selectedDate} max={today}
                    onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
                    className="bg-transparent text-slate-700 font-bold outline-none cursor-pointer"
                  />
                </div>
                <button onClick={() => changeDate(1)} disabled={selectedDate >= today} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 disabled:opacity-30"><ArrowRight size={20} /></button>
             </div>
             <button onClick={() => syncPull()} className="p-2 bg-white text-indigo-600 border border-slate-200 rounded-lg shadow-sm hover:bg-indigo-50"><RefreshCw size={20}/></button>
          </div>

          {/* KPI CARDS (Restaurados: Ventas, Costos, Ganancias) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {/* VENTAS */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 relative overflow-hidden group">
               <div className="absolute right-0 top-0 w-20 h-20 bg-indigo-50 rounded-bl-full -mr-4 -mt-4"></div>
               <div className="relative">
                  <p className="text-slate-500 text-xs font-bold uppercase mb-1 flex items-center gap-1">
                     <DollarSign size={14} /> Ventas Totales
                  </p>
                  <h3 className="text-2xl font-bold text-slate-800">${dailyStats.revenue.toFixed(2)}</h3>
               </div>
            </div>

            {/* COSTOS */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 relative overflow-hidden group">
               <div className="absolute right-0 top-0 w-20 h-20 bg-orange-50 rounded-bl-full -mr-4 -mt-4"></div>
               <div className="relative">
                  <p className="text-slate-500 text-xs font-bold uppercase mb-1 flex items-center gap-1">
                     <Wallet size={14} /> Costo Mercancía
                  </p>
                  <h3 className="text-2xl font-bold text-slate-800">${dailyStats.cost.toFixed(2)}</h3>
               </div>
            </div>

            {/* GANANCIAS */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 relative overflow-hidden group">
               <div className="absolute right-0 top-0 w-20 h-20 bg-emerald-50 rounded-bl-full -mr-4 -mt-4"></div>
               <div className="relative">
                  <p className="text-slate-500 text-xs font-bold uppercase mb-1 flex items-center gap-1">
                     <TrendingUp size={14} /> Ganancia Neta
                  </p>
                  <h3 className="text-2xl font-bold text-slate-800">${dailyStats.profit.toFixed(2)}</h3>
                  <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold mt-2 inline-block">
                     Margen: {dailyStats.margin.toFixed(0)}%
                  </span>
               </div>
            </div>
          </div>

          {dailyStats.sales.length > 0 ? (
            <>
              {/* Gráficos */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 h-72">
                   <h4 className="font-bold text-slate-700 text-sm mb-4 flex items-center gap-2"><BarChart3 size={16}/> Ventas por Hora</h4>
                   <ResponsiveContainer width="100%" height="90%">
                     <BarChart data={dailyStats.chartData}>
                       <CartesianGrid strokeDasharray="3 3" vertical={false} />
                       <XAxis dataKey="time" fontSize={10} axisLine={false} tickLine={false} />
                       <YAxis fontSize={10} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                       <Tooltip cursor={{fill: '#f8fafc'}} contentStyle={{borderRadius:'8px'}} />
                       <Bar dataKey="total" fill="#6366f1" radius={[4,4,0,0]} />
                     </BarChart>
                   </ResponsiveContainer>
                </div>
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 h-72">
                   <h4 className="font-bold text-slate-700 text-sm mb-4 flex items-center gap-2"><PieChartIcon size={16}/> Categorías</h4>
                   <ResponsiveContainer width="100%" height="90%">
                     <PieChart>
                       <Pie data={dailyStats.pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={60} paddingAngle={5} dataKey="value">
                         {dailyStats.pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                       </Pie>
                       <Tooltip />
                       <Legend iconType="circle" wrapperStyle={{fontSize:'10px'}} />
                     </PieChart>
                   </ResponsiveContainer>
                </div>
              </div>

              {/* Lista de Tickets */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                    <tr>
                      <th className="p-4">Hora</th>
                      <th className="p-4">Método</th>
                      <th className="p-4 text-right">Total</th>
                      <th className="p-4 text-center">Ver</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dailyStats.sales.map(sale => (
                      <tr key={sale.id} className="hover:bg-slate-50">
                         <td className="p-4 font-mono text-slate-600 font-bold">{new Date(sale.date).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</td>
                         <td className="p-4"><span className="uppercase text-[10px] font-bold bg-slate-100 px-2 py-1 rounded text-slate-500">{sale.payment_method}</span></td>
                         <td className="p-4 text-right font-bold text-slate-800">${sale.total.toFixed(2)}</td>
                         <td className="p-4 text-center">
                           <button onClick={() => setSelectedTicket(sale)} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg"><Eye size={18}/></button>
                         </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="bg-white p-12 rounded-2xl border border-dashed border-slate-300 text-center">
              <CalendarOff className="mx-auto text-slate-300 mb-4" size={40} />
              <p className="text-slate-500 font-medium">No hubo ventas el {selectedDate}</p>
            </div>
          )}
        </div>
      )}

      {/* --- VISTA 2: TENDENCIAS --- */}
      {viewMode === 'trends' && (
        <div className="animate-fade-in">
          <div className="flex gap-2 mb-6">
             <button onClick={() => setTrendFilter('week')} className={`px-4 py-2 rounded-full text-xs font-bold ${trendFilter === 'week' ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>Últimos 7 días</button>
             <button onClick={() => setTrendFilter('month')} className={`px-4 py-2 rounded-full text-xs font-bold ${trendFilter === 'month' ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>Últimos 30 días</button>
          </div>

          {/* KPI CARDS TENDENCIAS (También agregadas aquí) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
             <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
                <p className="text-slate-500 text-xs font-bold uppercase mb-1">Ingresos Totales</p>
                <h3 className="text-2xl font-bold text-slate-800">${trendStats.totalRevenue.toFixed(2)}</h3>
             </div>
             <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
                <p className="text-slate-500 text-xs font-bold uppercase mb-1">Costo Total</p>
                <h3 className="text-2xl font-bold text-slate-800">${trendStats.totalCost.toFixed(2)}</h3>
             </div>
             <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
                <p className="text-slate-500 text-xs font-bold uppercase mb-1">Ganancia Neta</p>
                <h3 className="text-2xl font-bold text-slate-800">${trendStats.totalProfit.toFixed(2)}</h3>
                <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold">Margen: {trendStats.totalMargin.toFixed(0)}%</span>
             </div>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 h-80">
             <h4 className="font-bold text-slate-700 mb-4">Evolución de Ventas</h4>
             <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendStats.chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" fontSize={12} axisLine={false} tickLine={false} />
                  <YAxis fontSize={12} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                  <Tooltip cursor={{fill: '#f8fafc'}} contentStyle={{borderRadius:'8px'}} />
                  <Bar dataKey="total" fill="#10b981" radius={[4,4,0,0]} barSize={40} />
                </BarChart>
             </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* MODAL DE TICKET */}
      {selectedTicket && <TicketModal sale={selectedTicket} onClose={() => setSelectedTicket(null)} />}
    </div>
  );
}