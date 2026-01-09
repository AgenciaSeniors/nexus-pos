import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { syncPull } from '../lib/sync';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, Legend 
} from 'recharts';

export function FinancePage() {
  const [filter, setFilter] = useState<'week' | 'month'>('week');

  // 1. CORRECCIÓN DE DEPENDENCIAS:
  // Traemos los datos crudos y luego los estabilizamos con useMemo.
  // Esto evita que los arrays se regeneren en cada render y rompan los cálculos siguientes.
  const rawSales = useLiveQuery(() => db.sales.toArray());
  const sales = useMemo(() => rawSales ?? [], [rawSales]);

  const rawProducts = useLiveQuery(() => db.products.toArray());
  const products = useMemo(() => rawProducts ?? [], [rawProducts]);

  // Mapa de costos para cálculo de ganancia neta
  const productCosts = useMemo(() => {
    return new Map(products.map(p => [p.id, p.cost || 0]));
  }, [products]);

  // Mapa de categorías para el gráfico de pastel
  const productCategories = useMemo(() => {
    return new Map(products.map(p => [p.id, p.category || 'General']));
  }, [products]);

  // --- PROCESAMIENTO DE DATOS PARA GRÁFICOS ---

  // 2. Gráfico de Ventas vs Ganancias
  const chartData = useMemo(() => {
    const days = filter === 'week' ? 7 : 30;
    const data = [];
    const today = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(today.getDate() - i);
      const dateStr = d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' });
      
      const daySales = sales.filter(s => new Date(s.date).toDateString() === d.toDateString());
      
      const revenue = daySales.reduce((acc, s) => acc + s.total, 0);
      const profit = daySales.reduce((acc, s) => {
        const cost = s.items.reduce((c, item) => c + ((productCosts.get(item.product_id) || 0) * item.quantity), 0);
        return acc + (s.total - cost);
      }, 0);

      data.push({ name: dateStr, ventas: revenue, ganancia: profit });
    }
    return data;
  }, [sales, filter, productCosts]);

  // 3. Gráfico de Categorías (Pie Chart)
  const categoryData = useMemo(() => {
    const stats: Record<string, number> = {};
    
    sales.forEach(sale => {
      sale.items.forEach(item => {
        const cat = productCategories.get(item.product_id) || 'General';
        const amount = item.price * item.quantity;
        stats[cat] = (stats[cat] || 0) + amount;
      });
    });

    return Object.entries(stats)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value); 
  }, [sales, productCategories]);

  const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

  // --- CÁLCULOS DE KPI ---
  const totalRevenue = sales.reduce((acc, s) => acc + s.total, 0);
  const totalProfit = sales.reduce((acc, s) => {
    const cost = s.items.reduce((c, item) => c + ((productCosts.get(item.product_id) || 0) * item.quantity), 0);
    return acc + (s.total - cost);
  }, 0);

  return (
    <div className="p-6 bg-slate-50 min-h-full pb-20">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">📊 Reporte Financiero</h1>
          <p className="text-slate-500 text-sm">Visión general del rendimiento de tu negocio</p>
        </div>
        
        <div className="flex bg-white rounded-lg p-1 shadow-sm border">
          <button 
            onClick={() => setFilter('week')}
            className={`px-4 py-1 rounded-md text-sm font-medium transition-all ${filter === 'week' ? 'bg-indigo-100 text-indigo-700 shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            7 Días
          </button>
          <button 
            onClick={() => setFilter('month')}
            className={`px-4 py-1 rounded-md text-sm font-medium transition-all ${filter === 'month' ? 'bg-indigo-100 text-indigo-700 shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            30 Días
          </button>
          <button 
             onClick={() => syncPull()}
             className="ml-2 px-3 py-1 text-sm text-indigo-600 font-bold border-l pl-3 hover:text-indigo-800"
          >
            🔄 Actualizar
          </button>
        </div>
      </div>

      {/* Tarjetas de Métricas (KPIs) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">Ventas Totales</p>
          <p className="text-3xl font-bold text-slate-800 mt-1">${totalRevenue.toFixed(2)}</p>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">Ganancia Neta</p>
          <p className="text-3xl font-bold text-emerald-600 mt-1">${totalProfit.toFixed(2)}</p>
          <p className="text-xs text-slate-400 mt-2">Margen: {totalRevenue > 0 ? ((totalProfit/totalRevenue)*100).toFixed(1) : 0}%</p>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">Transacciones</p>
          <p className="text-3xl font-bold text-indigo-600 mt-1">{sales.length}</p>
          <p className="text-xs text-slate-400 mt-2">Promedio: ${sales.length > 0 ? (totalRevenue / sales.length).toFixed(2) : 0}</p>
        </div>
      </div>

      {/* GRÁFICOS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        
        {/* 1. Gráfico de Barras */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 h-80">
          <h3 className="font-bold text-slate-700 mb-4">Tendencia de Ventas vs Ganancia</h3>
          <ResponsiveContainer width="100%" height="90%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{fontSize: 12, fill: '#64748b'}} axisLine={false} tickLine={false} />
              <YAxis tick={{fontSize: 12, fill: '#64748b'}} axisLine={false} tickLine={false} tickFormatter={(value) => `$${value}`} />
              <Tooltip 
                contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                cursor={{fill: '#f8fafc'}}
              />
              <Legend wrapperStyle={{paddingTop: '10px'}} />
              <Bar dataKey="ventas" name="Ventas ($)" fill="#4f46e5" radius={[4, 4, 0, 0]} barSize={20} />
              <Bar dataKey="ganancia" name="Ganancia ($)" fill="#10b981" radius={[4, 4, 0, 0]} barSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* 2. Gráfico de Pastel */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 h-80">
          <h3 className="font-bold text-slate-700 mb-4">Ventas por Categoría</h3>
          <ResponsiveContainer width="100%" height="90%">
            <PieChart>
              <Pie
                data={categoryData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                paddingAngle={5}
                dataKey="value"
              >
                {/* CORRECCIÓN: Cambiamos 'entry' por '_' ya que no lo usamos */}
                {categoryData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              {/* CORRECCIÓN: Especificamos un tipo flexible para 'value' compatible con Recharts */}
              <Tooltip formatter={(value: number | string | undefined) => `$${Number(value || 0).toFixed(2)}`} />
              <Legend layout="vertical" verticalAlign="middle" align="right" />
            </PieChart>
          </ResponsiveContainer>
        </div>

      </div>

      {/* Tabla Resumen */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100">
           <h3 className="font-bold text-slate-800">Últimas Transacciones</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
               <tr>
                 <th className="p-4">Fecha</th>
                 <th className="p-4">Método</th>
                 <th className="p-4">Items</th>
                 <th className="p-4 text-right">Total</th>
               </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
               {sales.slice(0, 5).map(sale => (
                 <tr key={sale.id} className="hover:bg-slate-50">
                    <td className="p-4 text-slate-600">{new Date(sale.date).toLocaleString()}</td>
                    <td className="p-4"><span className="uppercase text-xs font-bold bg-slate-100 px-2 py-1 rounded text-slate-500">{sale.payment_method}</span></td>
                    <td className="p-4 text-slate-600">{sale.items.length} productos</td>
                    <td className="p-4 text-right font-bold text-slate-800">${sale.total.toFixed(2)}</td>
                 </tr>
               ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}