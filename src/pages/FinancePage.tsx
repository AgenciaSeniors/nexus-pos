import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { syncPull } from '../lib/sync';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, Legend 
} from 'recharts';
import { 
  Calendar, 
  DollarSign, 
  TrendingUp, 
  Wallet, 
  ArrowLeft, 
  ArrowRight, 
  CalendarOff,
  RefreshCw
} from 'lucide-react';

export function FinancePage() {
  // --- GESTIÓN DE FECHA ---
  const today = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState(today);

  // --- DATOS DE LA BASE DE DATOS ---
  const rawSales = useLiveQuery(() => db.sales.toArray());
  const allSales = useMemo(() => rawSales ?? [], [rawSales]);

  const rawProducts = useLiveQuery(() => db.products.toArray());
  const products = useMemo(() => rawProducts ?? [], [rawProducts]);

  // 1. MAPAS DE COSTOS Y CATEGORÍAS (Para cálculos rápidos)
  const productMeta = useMemo(() => {
    const costMap = new Map();
    const catMap = new Map();
    products.forEach(p => {
      costMap.set(p.id, p.cost || 0);
      catMap.set(p.id, p.category || 'General');
    });
    return { costs: costMap, cats: catMap };
  }, [products]);

  // 2. CÁLCULOS DEL DÍA SELECCIONADO
  const dailyStats = useMemo(() => {
    // A. Filtrar ventas solo de la fecha seleccionada
    const salesForDay = allSales.filter(sale => sale.date.startsWith(selectedDate));

    let revenue = 0;
    let cost = 0;
    const categoryCounts: Record<string, number> = {};
    const hourlyCounts: Record<string, number> = {}; // "09:00", "10:00"...

    // Inicializar horas para el gráfico (de 8am a 10pm por ejemplo, o todas)
    for (let i = 0; i < 24; i++) {
        const hour = i.toString().padStart(2, '0') + ":00";
        hourlyCounts[hour] = 0;
    }

    salesForDay.forEach(sale => {
      revenue += sale.total;

      // Calcular hora para el gráfico
      const dateObj = new Date(sale.date);
      const hourKey = dateObj.getHours().toString().padStart(2, '0') + ":00";
      hourlyCounts[hourKey] = (hourlyCounts[hourKey] || 0) + sale.total;

      // Calcular costos y categorías item por item
      sale.items.forEach(item => {
        // Costo
        const itemCost = productMeta.costs.get(item.product_id) || 0;
        cost += itemCost * item.quantity;

        // Categoría
        const cat = productMeta.cats.get(item.product_id) || 'General';
        categoryCounts[cat] = (categoryCounts[cat] || 0) + (item.price * item.quantity);
      });
    });

    const profit = revenue - cost;
    const margin = revenue > 0 ? ((profit / revenue) * 100) : 0;

    // Formatear datos para Recharts
    const chartData = Object.entries(hourlyCounts)
        .map(([time, total]) => ({ time, total }))
        // Filtramos horas sin ventas para limpiar el gráfico si se desea, o lo dejamos fijo
        .filter(d => parseInt(d.time) >= 6); // Mostrar desde las 6 AM en adelante

    const pieData = Object.entries(categoryCounts)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);

    return { 
      sales: salesForDay.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
      revenue, 
      cost, 
      profit, 
      margin, 
      chartData, 
      pieData 
    };
  }, [allSales, selectedDate, productMeta]);

  // --- NAVEGACIÓN DE FECHA ---
  const changeDate = (days: number) => {
    const date = new Date(selectedDate);
    date.setDate(date.getDate() + days);
    const newDateStr = date.toISOString().split('T')[0];
    if (newDateStr > today) return; // Bloqueo futuro
    setSelectedDate(newDateStr);
  };

  // Colores para el gráfico de pastel
  const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

  return (
    <div className="p-6 pb-24 md:pb-6 min-h-screen bg-slate-50">
      
      {/* HEADER: Título y Selector de Fecha */}
      <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <TrendingUp className="text-indigo-600" /> Finanzas Diarias
          </h1>
          <p className="text-slate-500 text-sm">Análisis detallado por día</p>
        </div>

        <div className="flex items-center gap-2">
            {/* Controles de Fecha */}
            <div className="bg-white p-1.5 rounded-xl shadow-sm border border-slate-200 flex items-center gap-2">
              <button onClick={() => changeDate(-1)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600">
                <ArrowLeft size={20} />
              </button>

              <div className="relative group">
                <div className="flex items-center gap-2 px-3 py-1 cursor-pointer min-w-[140px] justify-center">
                  <Calendar size={18} className="text-indigo-600" />
                  <span className="font-bold text-slate-700 capitalize">
                    {selectedDate === today ? 'Hoy' : new Date(selectedDate).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                  </span>
                </div>
                <input 
                  type="date" 
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  value={selectedDate}
                  max={today}
                  onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
                />
              </div>

              <button 
                onClick={() => changeDate(1)} 
                disabled={selectedDate >= today}
                className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ArrowRight size={20} />
              </button>
            </div>

            {/* Botón Sync Manual */}
            <button onClick={() => syncPull()} className="p-3 bg-white text-indigo-600 rounded-xl shadow-sm border border-slate-200 hover:bg-indigo-50 transition-colors" title="Sincronizar">
              <RefreshCw size={20} />
            </button>
        </div>
      </div>

      {/* TARJETAS DE KPI (Ventas, Costos, Ganancia) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 relative overflow-hidden group">
          <div className="absolute right-0 top-0 w-24 h-24 bg-indigo-50 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110"></div>
          <div className="relative">
            <p className="text-slate-500 font-medium text-sm mb-1">Ventas del Día</p>
            <h3 className="text-3xl font-bold text-slate-800">${dailyStats.revenue.toFixed(2)}</h3>
            <div className="flex items-center mt-2 text-indigo-600 text-xs font-bold bg-indigo-50 w-fit px-2 py-1 rounded-full">
               <DollarSign size={12} className="mr-1" /> Ingreso Bruto
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 relative overflow-hidden group">
          <div className="absolute right-0 top-0 w-24 h-24 bg-emerald-50 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110"></div>
          <div className="relative">
            <p className="text-slate-500 font-medium text-sm mb-1">Ganancia Neta</p>
            <h3 className="text-3xl font-bold text-slate-800">${dailyStats.profit.toFixed(2)}</h3>
            <div className="flex items-center mt-2 text-emerald-600 text-xs font-bold bg-emerald-50 w-fit px-2 py-1 rounded-full">
               <TrendingUp size={12} className="mr-1" /> Margen: {dailyStats.margin.toFixed(1)}%
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 relative overflow-hidden group">
          <div className="absolute right-0 top-0 w-24 h-24 bg-orange-50 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110"></div>
          <div className="relative">
            <p className="text-slate-500 font-medium text-sm mb-1">Costos Estimados</p>
            <h3 className="text-3xl font-bold text-slate-800">${dailyStats.cost.toFixed(2)}</h3>
            <div className="flex items-center mt-2 text-orange-600 text-xs font-bold bg-orange-50 w-fit px-2 py-1 rounded-full">
               <Wallet size={12} className="mr-1" /> Costo Mercancía
            </div>
          </div>
        </div>
      </div>

      {dailyStats.sales.length > 0 ? (
        <>
          {/* GRÁFICOS */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Gráfico 1: Ventas por Hora */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
              <h3 className="font-bold text-slate-700 mb-6">Actividad por Hora</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyStats.chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="time" axisLine={false} tickLine={false} fontSize={12} stroke="#94a3b8" />
                    <YAxis axisLine={false} tickLine={false} fontSize={12} stroke="#94a3b8" tickFormatter={(value) => `$${value}`} />
                    <Tooltip 
                      cursor={{ fill: '#f8fafc' }}
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} 
                    />
                    <Bar dataKey="total" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={30} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Gráfico 2: Categorías */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
              <h3 className="font-bold text-slate-700 mb-6">Categorías Vendidas</h3>
              <div className="h-64 flex items-center justify-center">
                 {dailyStats.pieData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                        data={dailyStats.pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                        >
                        {dailyStats.pieData.map((_entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                        </Pie>
                        <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                        <Legend verticalAlign="middle" align="right" layout="vertical" iconType="circle" />
                    </PieChart>
                    </ResponsiveContainer>
                 ) : (
                     <p className="text-slate-400 text-sm">Sin datos suficientes</p>
                 )}
              </div>
            </div>
          </div>

          {/* LISTA DE TRANSACCIONES */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-6 border-b border-slate-100 bg-slate-50/50">
              <h3 className="font-bold text-slate-800">Transacciones del {new Date(selectedDate).toLocaleDateString()}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="p-4">Hora</th>
                    <th className="p-4">Método</th>
                    <th className="p-4">Vendedor</th>
                    <th className="p-4 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {dailyStats.sales.map(sale => (
                    <tr key={sale.id} className="hover:bg-slate-50 transition-colors">
                        <td className="p-4 text-slate-600 font-mono font-bold">
                            {new Date(sale.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="p-4">
                            <span className={`uppercase text-[10px] font-bold px-2 py-1 rounded ${
                                sale.payment_method === 'efectivo' 
                                ? 'bg-green-100 text-green-700' 
                                : 'bg-purple-100 text-purple-700'
                            }`}>
                                {sale.payment_method}
                            </span>
                        </td>
                        <td className="p-4 text-slate-600 capitalize">{sale.staff_name}</td>
                        <td className="p-4 text-right font-bold text-slate-800">${sale.total.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        // ESTADO VACÍO (SIN VENTAS)
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center flex flex-col items-center justify-center">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4 text-slate-400">
                <CalendarOff size={32} />
            </div>
            <h3 className="text-lg font-bold text-slate-700">Sin Movimientos</h3>
            <p className="text-slate-400 max-w-xs mx-auto mt-2">
                No se registraron ventas en la fecha <span className="font-mono text-slate-600 font-bold">{selectedDate}</span>.
            </p>
            <button onClick={() => setSelectedDate(today)} className="mt-6 text-indigo-600 font-bold hover:underline">
                Volver a Hoy
            </button>
        </div>
      )}
    </div>
  );
}