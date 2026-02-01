import { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Sale, type Product, type CashShift, type CashMovement, type Staff } from '../lib/db';
import { syncPush, addToQueue, syncPull } from '../lib/sync';
import { logAuditAction } from '../lib/audit';
import { currency } from '../lib/currency';
import { TicketModal } from '../components/TicketModal';
import { toast } from 'sonner';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, Legend 
} from 'recharts';
import { 
  Calendar, TrendingUp, ArrowLeft, ArrowRight, RefreshCw,
  BarChart3, DollarSign, Wallet, PieChart as PieChartIcon, ClipboardCheck,
  Printer, Trophy, Lock, Unlock, PlusCircle, MinusCircle, ShoppingBag, Loader2, X,
  ArrowRightLeft
} from 'lucide-react';

const EMPTY_ARRAY: never[] = [];

export function FinancePage() {
  const { currentStaff } = useOutletContext<{ currentStaff: Staff }>();
  const businessId = localStorage.getItem('nexus_business_id');

  // --- ESTADOS ---
  const [viewMode, setViewMode] = useState<'control' | 'daily' | 'trends' | 'closing'>('control');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [movementType, setMovementType] = useState<'in' | 'out' | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [isLoading, setIsLoading] = useState(false); // Estado de carga para botones

  const today = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedTicket, setSelectedTicket] = useState<Sale | null>(null);
  const [trendFilter, setTrendFilter] = useState<'week' | 'month'>('week');

  // --- DATOS ---
  const activeShift = useLiveQuery(async () => {
    if (!businessId) return null;
    return await db.cash_shifts.where({ business_id: businessId, status: 'open' }).first();
  }, [businessId]);

  const shiftData = useLiveQuery(async () => {
    if (!activeShift || !businessId) return null;
    const [sales, movements] = await Promise.all([
      db.sales
        .where('shift_id')
        .equals(activeShift.id)
        .filter(s => s.business_id === businessId)
        .toArray(),
      db.cash_movements
        .where('shift_id')
        .equals(activeShift.id)
        .filter(m => m.business_id === businessId)
        .toArray()
    ]);

    return { sales, movements };
  }, [activeShift]);

  const products = useLiveQuery<Product[]>(async () => {
    if (!businessId) return [];
    return await db.products.where('business_id').equals(businessId).toArray();
  }, [businessId]) || EMPTY_ARRAY;

  const allSales = useLiveQuery<Sale[]>(async () => {
    if (!businessId) return [];
    return await db.sales.where('business_id').equals(businessId).toArray();
  }, [businessId]) || EMPTY_ARRAY;

  // --- CÁLCULOS ---
  const shiftStats = useMemo(() => {
    if (!activeShift || !shiftData) return null;
    const startAmount = activeShift.start_amount;
    
    // 1. Total Global (Lo que vendiste en total, no importa el método)
    const totalSales = shiftData.sales.reduce((sum, s) => sum + s.total, 0);

    // 2. Solo Efectivo (Para el arqueo)
    const cashSales = shiftData.sales
      .filter(s => s.payment_method === 'efectivo' || s.payment_method === 'mixto') // Asumimos mixto como efectivo parcial, idealmente se desglosa
      .reduce((sum, s) => sum + (s.amount_tendered && s.payment_method === 'efectivo' ? s.total : s.total), 0); 
      // Nota: Si 'mixto' separa montos, habría que ajustar lógica. Por ahora asumimos total.
    
    const cashIn = shiftData.movements.filter(m => m.type === 'in').reduce((sum, m) => sum + m.amount, 0);
    const cashOut = shiftData.movements.filter(m => m.type === 'out').reduce((sum, m) => sum + m.amount, 0);

    const expectedCash = startAmount + cashSales + cashIn - cashOut;

    return { startAmount, cashSales, totalSales, cashIn, cashOut, expectedCash };
  }, [activeShift, shiftData]);

  const productMeta = useMemo(() => {
    const costs = new Map<string, number>();
    const cats = new Map<string, string>();
    products.forEach((p) => {
      costs.set(p.id, p.cost || 0);
      cats.set(p.id, p.category || 'General');
    });
    return { costs, cats };
  }, [products]);

  const dailyStats = useMemo(() => {
    const salesForDay = allSales.filter((sale) => sale.date.startsWith(selectedDate));
    let revenue = 0, cost = 0;
    const hourlyCounts: Record<string, number> = {};
    const categoryCounts: Record<string, number> = {};
    const productCounts: Record<string, number> = {}; 

    for (let i = 7; i <= 23; i++) hourlyCounts[i.toString().padStart(2, '0') + ":00"] = 0;

    salesForDay.forEach((sale) => {
      revenue += sale.total;
      const h = new Date(sale.date).getHours().toString().padStart(2, '0') + ":00";
      if (hourlyCounts[h] !== undefined) hourlyCounts[h] += sale.total;

      sale.items.forEach((item) => {
        const historicalCost = item.cost !== undefined ? item.cost : (productMeta.costs.get(item.product_id) || 0);
        cost += historicalCost * item.quantity;
        const cat = productMeta.cats.get(item.product_id) || 'General';
        categoryCounts[cat] = (categoryCounts[cat] || 0) + (item.price * item.quantity);
        productCounts[item.name] = (productCounts[item.name] || 0) + item.quantity;
      });
    });

    let bestSeller = { name: 'N/A', count: 0 };
    Object.entries(productCounts).forEach(([name, count]) => { if (count > bestSeller.count) bestSeller = { name, count }; });

    const profit = revenue - cost;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
    const chartData = Object.entries(hourlyCounts).map(([time, total]) => ({ time, total }));
    const pieData = Object.entries(categoryCounts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

    return { sales: salesForDay.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()), revenue, profit, cost, margin, chartData, pieData, bestSeller };
  }, [allSales, selectedDate, productMeta]);

  const closingStats = useMemo(() => {
    const sales = dailyStats.sales;
    let cashTotal = 0, transferTotal = 0, cardTotal = 0;
    const productSummary: Record<string, { quantity: number, total: number }> = {};

    sales.forEach((sale) => {
      if (sale.payment_method === 'efectivo') cashTotal += sale.total;
      else if (sale.payment_method === 'tarjeta') cardTotal += sale.total;
      else transferTotal += sale.total;

      sale.items.forEach((item) => {
        if (!productSummary[item.name]) productSummary[item.name] = { quantity: 0, total: 0 };
        productSummary[item.name].quantity += item.quantity;
        productSummary[item.name].total += (item.price * item.quantity);
      });
    });

    const productsList = Object.entries(productSummary).map(([name, data]) => ({ name, ...data })).sort((a, b) => b.quantity - a.quantity);
    return { cashTotal, transferTotal, cardTotal, productsList, ticketCount: sales.length };
  }, [dailyStats.sales]);

  const trendStats = useMemo(() => {
    const now = new Date();
    const daysToShow = trendFilter === 'week' ? 7 : 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(now.getDate() - daysToShow);
    const filteredSales = allSales.filter((s) => new Date(s.date) >= cutoffDate);

    let totalRevenue = 0, totalCost = 0;
    const salesByDate: Record<string, number> = {};

    filteredSales.forEach((sale) => {
      totalRevenue += sale.total;
      let saleCost = 0;
      sale.items.forEach((i) => {
          const historicalCost = i.cost !== undefined ? i.cost : (productMeta.costs.get(i.product_id) || 0);
          saleCost += historicalCost * i.quantity;
      });
      totalCost += saleCost;
      const dateKey = new Date(sale.date).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' });
      salesByDate[dateKey] = (salesByDate[dateKey] || 0) + sale.total;
    });

    const totalProfit = totalRevenue - totalCost;
    const totalMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
    const chartData = Object.entries(salesByDate).map(([date, total]) => ({ date, total }));

    return { totalRevenue, totalCost, totalProfit, totalMargin, chartData, count: filteredSales.length };
  }, [allSales, trendFilter, productMeta]);

  // --- HANDLERS TRANSACCIONALES ---

  // 1. ABRIR CAJA
  const handleOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) return;
    const startAmount = parseFloat(amount);
    if (isNaN(startAmount) || startAmount < 0) return toast.error('Monto inicial inválido');

    setIsLoading(true);
    try {
        const shiftId = crypto.randomUUID();
        const newShift: CashShift = {
            id: shiftId, 
            business_id: businessId, 
            staff_id: currentStaff.id, 
            start_amount: startAmount,
            opened_at: new Date().toISOString(), 
            status: 'open', 
            sync_status: 'pending_create'
        };

        // Transacción atómica
        await db.transaction('rw', [db.cash_shifts, db.action_queue, db.audit_logs], async () => {
            await db.cash_shifts.add(newShift);
            await addToQueue('SHIFT', newShift);
            await logAuditAction('OPEN_SHIFT', { amount: startAmount }, currentStaff);
        });

        toast.success('¡Caja Abierta!');
        setAmount('');
        syncPush().catch(console.error);
    } catch (error) {
        console.error(error);
        toast.error("Error al abrir caja");
    } finally {
        setIsLoading(false);
    }
  };

  // 2. MOVIMIENTO DE CAJA (Entrada/Salida)
  const handleMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShift || !movementType || !businessId) return;
    const val = parseFloat(amount);
    
    if (isNaN(val) || val <= 0) return toast.error('Monto inválido');
    if (!reason.trim()) return toast.error('Debes indicar un motivo');

    setIsLoading(true);
    try {
        const movement: CashMovement = {
            id: crypto.randomUUID(), 
            shift_id: activeShift.id, 
            business_id: businessId, 
            type: movementType,
            amount: val, 
            reason: reason, 
            staff_id: currentStaff.id, 
            created_at: new Date().toISOString(), 
            sync_status: 'pending_create'
        };

        await db.transaction('rw', [db.cash_movements, db.action_queue, db.audit_logs], async () => {
            await db.cash_movements.add(movement);
            await addToQueue('CASH_MOVEMENT', movement);
            await logAuditAction(movementType === 'in' ? 'CASH_IN' : 'CASH_OUT', { amount: val, reason }, currentStaff);
        });

        toast.success('Movimiento registrado');
        setAmount(''); setReason(''); setMovementType(null);
        syncPush().catch(console.error);
    } catch (error) {
        console.error(error);
        toast.error("Error al registrar movimiento");
    } finally {
        setIsLoading(false);
    }
  };

  // 3. CERRAR CAJA (Arqueo)
  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShift || !shiftStats) return;
    const finalCount = parseFloat(amount);
    if (isNaN(finalCount) || finalCount < 0) return toast.error('Ingresa el monto final válido');
    
    setIsLoading(true);
    try {
        const difference = finalCount - shiftStats.expectedCash;
        const closedAt = new Date().toISOString();

        await db.transaction('rw', [db.cash_shifts, db.action_queue, db.audit_logs], async () => {
            // Actualizar turno local
            await db.cash_shifts.update(activeShift.id, {
                end_amount: finalCount, 
                difference: difference, 
                expected_amount: shiftStats.expectedCash,
                closed_at: closedAt, 
                status: 'closed', 
                sync_status: 'pending_update'
            });

            // Recuperar objeto completo para la cola
            const closedShift = await db.cash_shifts.get(activeShift.id);
            if(closedShift) await addToQueue('SHIFT', closedShift);
            
            // Auditoría
            await logAuditAction('CLOSE_SHIFT', { 
                expected: shiftStats.expectedCash, 
                real: finalCount, 
                diff: difference 
            }, currentStaff);
        });

        toast.success(`Caja cerrada. Diferencia: ${currency.format(difference)}`);
        setIsClosing(false); setAmount('');
        syncPush().catch(console.error);
    } catch (error) {
        console.error(error);
        toast.error("Error al cerrar caja");
    } finally {
        setIsLoading(false);
    }
  };

  const changeDate = (days: number) => {
    const d = new Date(selectedDate); d.setDate(d.getDate() + days);
    const newStr = d.toISOString().split('T')[0]; if (newStr <= today) setSelectedDate(newStr);
  };
  const handlePrint = () => window.print();
  const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

  // --- UI: APERTURA DE CAJA ---
  if (!activeShift) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full border border-slate-100 text-center animate-in fade-in zoom-in duration-300">
          <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
            <Lock className="text-indigo-600 w-8 h-8" />
          </div>
          <h1 className="text-2xl font-black text-slate-800 mb-2">Apertura de Caja</h1>
          <p className="text-slate-500 mb-6 text-sm">Inicia el turno para habilitar el punto de venta.</p>
          <form onSubmit={handleOpenShift}>
            <div className="mb-6 text-left">
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2 ml-1">Monto Inicial (Efectivo)</label>
              <div className="relative group">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5 group-focus-within:text-indigo-500 transition-colors"/>
                <input 
                    type="number" step="0.01" autoFocus required 
                    className="w-full pl-10 pr-4 py-3 text-lg font-bold text-slate-800 border border-slate-300 rounded-xl focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all" 
                    placeholder="0.00" 
                    value={amount} 
                    onChange={e => setAmount(e.target.value)} 
                />
              </div>
            </div>
            <button 
                type="submit" 
                disabled={isLoading}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-indigo-200 flex justify-center items-center gap-2 active:scale-[0.98]"
            >
                {isLoading ? <Loader2 className="animate-spin"/> : 'ABRIR TURNO'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- UI: DASHBOARD FINANCIERO ---
  return (
    <div className="p-6 pb-24 md:pb-6 min-h-screen bg-slate-50 print:bg-white print:p-0">
      
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Unlock className="text-emerald-500" /> Caja Abierta
          </h1>
          <p className="text-slate-500 text-xs font-mono mt-1 bg-slate-100 px-2 py-1 rounded inline-block border border-slate-200">
            ID: {activeShift.id.slice(0,8).toUpperCase()} | Inicio: {new Date(activeShift.opened_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
          </p>
        </div>

        <div className="flex bg-white p-1.5 rounded-xl border border-slate-200 shadow-sm overflow-x-auto max-w-full scrollbar-hide">
          <button onClick={() => setViewMode('control')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${viewMode === 'control' ? 'bg-indigo-50 text-indigo-700 shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}>
            <Wallet size={16} /> Control
          </button>
          <div className="w-px h-6 bg-slate-200 mx-1 self-center"></div>
          <button onClick={() => setViewMode('daily')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${viewMode === 'daily' ? 'bg-indigo-50 text-indigo-700 shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}>
            <Calendar size={16} /> Reportes
          </button>
          <button onClick={() => setViewMode('trends')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${viewMode === 'trends' ? 'bg-indigo-50 text-indigo-700 shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}>
            <BarChart3 size={16} /> Tendencias
          </button>
          <div className="w-px h-6 bg-slate-200 mx-1 self-center"></div>
          <button onClick={() => setViewMode('closing')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${viewMode === 'closing' ? 'bg-slate-800 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>
            <ClipboardCheck size={16} /> Corte Z
          </button>
        </div>
      </div>

      {/* VISTA 1: CONTROL DE CAJA (Operativa) */}
      {viewMode === 'control' && shiftStats && (
        <div className="animate-in slide-in-from-bottom-4 duration-300 space-y-6">
          
          {/* Tarjetas de Resumen */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
               <p className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1"><ShoppingBag size={12}/> Total Ventas</p>
               <h3 className="text-2xl font-black text-slate-800">{currency.format(shiftStats.totalSales)}</h3>
               <p className="text-[10px] text-slate-400 mt-1">Todos los métodos</p>
            </div>

            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
               <p className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">Base Inicial</p>
               <h3 className="text-2xl font-black text-slate-600">{currency.format(shiftStats.startAmount)}</h3>
            </div>
            
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
               <p className="text-emerald-600 text-[10px] font-bold uppercase tracking-wider mb-1">Ventas Efectivo</p>
               <h3 className="text-2xl font-black text-emerald-600">+{currency.format(shiftStats.cashSales)}</h3>
            </div>
            
            <div className="bg-slate-900 p-5 rounded-2xl shadow-lg shadow-slate-300 text-white relative overflow-hidden">
               <div className="absolute top-0 right-0 w-20 h-20 bg-white/5 rounded-full -mr-10 -mt-10 blur-xl"></div>
               <p className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">Efectivo en Caja</p>
               <h3 className="text-3xl font-black">{currency.format(shiftStats.expectedCash)}</h3>
               <p className="text-[10px] text-slate-500 mt-1">Calculado automáticamente</p>
            </div>
          </div>

          {/* Botones de Acción */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
             <button onClick={() => { setMovementType('in'); setAmount(''); }} className="group flex items-center justify-center gap-3 p-4 bg-emerald-50 text-emerald-700 rounded-2xl border border-emerald-100 hover:bg-emerald-100 font-bold transition-all active:scale-[0.98]">
                <div className="bg-emerald-200 text-emerald-700 p-2 rounded-lg group-hover:bg-emerald-300 transition-colors"><PlusCircle size={20}/></div>
                <span>Ingreso Dinero</span>
             </button>
             <button onClick={() => { setMovementType('out'); setAmount(''); }} className="group flex items-center justify-center gap-3 p-4 bg-red-50 text-red-700 rounded-2xl border border-red-100 hover:bg-red-100 font-bold transition-all active:scale-[0.98]">
                <div className="bg-red-200 text-red-700 p-2 rounded-lg group-hover:bg-red-300 transition-colors"><MinusCircle size={20}/></div>
                <span>Retiro Dinero</span>
             </button>
             <button onClick={() => { setIsClosing(true); setAmount(''); }} className="group flex items-center justify-center gap-3 p-4 bg-white text-slate-700 rounded-2xl border border-slate-200 hover:bg-slate-50 hover:border-slate-300 font-bold transition-all active:scale-[0.98]">
                <div className="bg-slate-100 text-slate-600 p-2 rounded-lg group-hover:bg-slate-200 transition-colors"><Lock size={20} /></div>
                <span>Cerrar Turno</span>
             </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* TABLA MOVIMIENTOS */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                    <h3 className="font-bold text-slate-700 text-sm flex items-center gap-2"><ArrowRightLeft className="text-slate-400" size={16}/> Movimientos de Caja</h3>
                </div>
                <div className="overflow-x-auto max-h-60">
                    <table className="w-full text-sm text-left">
                        <thead className="text-slate-400 font-bold uppercase text-[10px] bg-slate-50 sticky top-0">
                        <tr><th className="p-3">Hora</th><th className="p-3">Tipo</th><th className="p-3">Motivo</th><th className="p-3 text-right">Monto</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                        {shiftData?.movements.map(m => (
                            <tr key={m.id} className="hover:bg-slate-50/50 transition-colors">
                                <td className="p-3 text-slate-500 text-xs font-mono">{new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</td>
                                <td className="p-3"><span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${m.type==='in'?'bg-emerald-50 text-emerald-700 border-emerald-100':'bg-red-50 text-red-700 border-red-100'}`}>{m.type === 'in' ? 'Entrada' : 'Salida'}</span></td>
                                <td className="p-3 font-medium text-slate-700 text-xs">{m.reason}</td>
                                <td className={`p-3 text-right font-bold text-xs ${m.type==='in'?'text-emerald-600':'text-red-600'}`}>{m.type==='out'?'-':'+'}{currency.format(m.amount)}</td>
                            </tr>
                        ))}
                        {shiftData?.movements.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-slate-400 italic text-xs">Sin movimientos registrados</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* TABLA VENTAS RECIENTES */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                    <h3 className="font-bold text-slate-700 text-sm flex items-center gap-2"><ShoppingBag className="text-slate-400" size={16}/> Ventas Recientes</h3>
                    <span className="text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-bold">{shiftData?.sales.length || 0}</span>
                </div>
                <div className="overflow-x-auto max-h-60">
                    <table className="w-full text-sm text-left">
                        <thead className="text-slate-400 font-bold uppercase text-[10px] bg-slate-50 sticky top-0">
                        <tr><th className="p-3">Hora</th><th className="p-3">Método</th><th className="p-3 text-right">Total</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                        {shiftData?.sales.slice().reverse().map(s => (
                            <tr key={s.id} onClick={() => setSelectedTicket(s)} className="cursor-pointer hover:bg-indigo-50 transition-colors group">
                                <td className="p-3 text-slate-500 text-xs font-mono group-hover:text-indigo-600">{new Date(s.date).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</td>
                                <td className="p-3"><span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-bold uppercase border border-slate-200">{s.payment_method}</span></td>
                                <td className="p-3 text-right font-bold text-slate-700 text-xs">{currency.format(s.total)}</td>
                            </tr>
                        ))}
                        {shiftData?.sales.length === 0 && <tr><td colSpan={3} className="p-8 text-center text-slate-400 italic text-xs">Sin ventas en este turno</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>
          </div>
        </div>
      )}

      {/* VISTA 2: REPORTES DIARIOS */}
      {viewMode === 'daily' && (
        <div className="animate-in fade-in zoom-in-95 duration-300">
          <div className="flex justify-between items-center mb-6">
             <div className="flex items-center gap-2 bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
                <button onClick={() => changeDate(-1)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600"><ArrowLeft size={20} /></button>
                <div className="relative mx-2">
                  <input type="date" value={selectedDate} max={today} onChange={(e) => e.target.value && setSelectedDate(e.target.value)} className="bg-transparent text-slate-700 font-bold outline-none cursor-pointer text-sm uppercase" />
                </div>
                <button onClick={() => changeDate(1)} disabled={selectedDate >= today} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 disabled:opacity-30"><ArrowRight size={20} /></button>
             </div>
             <button onClick={() => syncPull()} className="p-2 bg-white text-indigo-600 border border-slate-200 rounded-lg shadow-sm hover:bg-indigo-50 transition-colors" title="Sincronizar Nube"><RefreshCw size={20}/></button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 relative overflow-hidden group">
               <div className="relative">
                  <p className="text-slate-500 text-xs font-bold uppercase mb-1 flex items-center gap-1"><DollarSign size={14} /> Ventas</p>
                  <h3 className="text-2xl font-bold text-slate-800">${dailyStats.revenue.toFixed(2)}</h3>
               </div>
            </div>
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 relative overflow-hidden group">
               <div className="relative">
                  <p className="text-slate-500 text-xs font-bold uppercase mb-1 flex items-center gap-1"><Wallet size={14} /> Costos</p>
                  <h3 className="text-2xl font-bold text-slate-800">${dailyStats.cost.toFixed(2)}</h3>
               </div>
            </div>
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 relative overflow-hidden group">
               <div className="relative">
                  <p className="text-slate-500 text-xs font-bold uppercase mb-1 flex items-center gap-1"><TrendingUp size={14} /> Ganancia</p>
                  <h3 className="text-2xl font-bold text-slate-800">${dailyStats.profit.toFixed(2)}</h3>
                  <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold inline-block border border-emerald-200">Margen: {dailyStats.margin.toFixed(0)}%</span>
               </div>
            </div>
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 relative overflow-hidden group">
               <div className="relative">
                  <p className="text-slate-500 text-xs font-bold uppercase mb-1 flex items-center gap-1"><Trophy size={14} className="text-yellow-500"/> Más Vendido</p>
                  <h3 className="text-lg font-bold text-slate-800 truncate">{dailyStats.bestSeller.name}</h3>
                  <p className="text-xs text-slate-400">{dailyStats.bestSeller.count} unidades</p>
               </div>
            </div>
          </div>

          {dailyStats.sales.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 h-72">
                   <h4 className="font-bold text-slate-700 text-sm mb-4 flex items-center gap-2"><BarChart3 size={16}/> Ventas por Hora</h4>
                   <ResponsiveContainer width="100%" height="90%">
                     <BarChart data={dailyStats.chartData}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" /><XAxis dataKey="time" fontSize={10} axisLine={false} tickLine={false} tick={{fill: '#94a3b8'}} /><YAxis fontSize={10} axisLine={false} tickLine={false} tick={{fill: '#94a3b8'}} tickFormatter={v => `$${v}`} /><Tooltip cursor={{fill: '#f8fafc'}} contentStyle={{borderRadius:'8px', border:'none', boxShadow:'0 4px 6px -1px rgb(0 0 0 / 0.1)'}} /><Bar dataKey="total" fill="#6366f1" radius={[4,4,0,0]} /></BarChart>
                   </ResponsiveContainer>
                </div>
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 h-72">
                   <h4 className="font-bold text-slate-700 text-sm mb-4 flex items-center gap-2"><PieChartIcon size={16}/> Categorías</h4>
                   <ResponsiveContainer width="100%" height="90%">
                     <PieChart><Pie data={dailyStats.pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={60} paddingAngle={5} dataKey="value" stroke="none">{dailyStats.pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip contentStyle={{borderRadius:'8px', border:'none', boxShadow:'0 4px 6px -1px rgb(0 0 0 / 0.1)'}} /><Legend iconType="circle" wrapperStyle={{fontSize:'10px', fontFamily: 'sans-serif'}} /></PieChart>
                   </ResponsiveContainer>
                </div>
            </div>
          )}
        </div>
      )}

      {/* VISTA 3: TENDENCIAS */}
      {viewMode === 'trends' && (
        <div className="animate-in fade-in zoom-in-95 duration-300">
          <div className="flex gap-2 mb-6">
             <button onClick={() => setTrendFilter('week')} className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${trendFilter === 'week' ? 'bg-slate-800 text-white shadow-md' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>Últimos 7 días</button>
             <button onClick={() => setTrendFilter('month')} className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${trendFilter === 'month' ? 'bg-slate-800 text-white shadow-md' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>Últimos 30 días</button>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 h-80">
             <h4 className="font-bold text-slate-700 mb-4 text-sm">Evolución de Ingresos</h4>
             <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendStats.chartData}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" /><XAxis dataKey="date" fontSize={10} axisLine={false} tickLine={false} tick={{fill: '#94a3b8'}} /><YAxis fontSize={10} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} tick={{fill: '#94a3b8'}} /><Tooltip cursor={{fill: '#f8fafc'}} contentStyle={{borderRadius:'8px', border:'none', boxShadow:'0 4px 6px -1px rgb(0 0 0 / 0.1)'}} /><Bar dataKey="total" fill="#10b981" radius={[4,4,0,0]} barSize={40} /></BarChart>
             </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* VISTA 4: REPORTE Z (CIERRE HISTÓRICO) */}
      {viewMode === 'closing' && (
        <div className="animate-in slide-in-from-bottom-4 duration-300 max-w-3xl mx-auto">
          <div className="flex justify-between items-center mb-6 print:hidden">
            <h2 className="text-xl font-bold text-slate-800">Cierre del Día</h2>
            <div className="flex items-center gap-3">
               <input type="date" value={selectedDate} max={today} onChange={(e) => e.target.value && setSelectedDate(e.target.value)} className="bg-white border border-slate-200 text-slate-700 font-bold rounded-lg p-2 outline-none text-sm" />
               <button onClick={handlePrint} className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-lg hover:bg-black transition-colors shadow-lg shadow-slate-300/50"><Printer size={16} /> Imprimir</button>
            </div>
          </div>
          <div className="bg-white p-8 rounded-none md:rounded-3xl shadow-lg border border-slate-200 print:shadow-none print:border-none print:p-0">
             <div className="text-center mb-8 border-b border-dashed border-slate-300 pb-6">
                <h1 className="text-2xl font-black text-slate-900 uppercase tracking-widest mb-2">REPORTE Z</h1>
                <p className="text-slate-500 font-mono text-xs">Nexus POS System</p>
                <p className="text-sm text-slate-400 mt-1">Fecha: {new Date(selectedDate).toLocaleDateString()}</p>
             </div>
             <div className="mb-8">
               <div className="space-y-3 font-mono text-sm">
                 <div className="flex justify-between p-2 bg-slate-50 rounded print:bg-white border border-transparent print:border-slate-100"><span>Efectivo</span><span className="font-bold">${closingStats.cashTotal.toFixed(2)}</span></div>
                 <div className="flex justify-between p-2 bg-slate-50 rounded print:bg-white border border-transparent print:border-slate-100"><span>Tarjeta</span><span className="font-bold">${closingStats.cardTotal.toFixed(2)}</span></div>
                 <div className="flex justify-between p-2 bg-slate-50 rounded print:bg-white border border-transparent print:border-slate-100"><span>Transferencia</span><span className="font-bold">${closingStats.transferTotal.toFixed(2)}</span></div>
                 <div className="border-t-2 border-slate-800 pt-3 flex justify-between text-lg font-black mt-2"><span>TOTAL</span><span>${(closingStats.cashTotal + closingStats.transferTotal + closingStats.cardTotal).toFixed(2)}</span></div>
               </div>
             </div>
             <div>
               <h3 className="text-xs font-bold text-slate-400 uppercase mb-4 tracking-wider">Desglose de Productos</h3>
               {closingStats.productsList.length > 0 ? (
                 <table className="w-full text-sm font-mono">
                    <thead className="text-slate-400 border-b border-slate-200 text-[10px] uppercase">
                        <tr><th className="text-left py-2">Cant</th><th className="text-left py-2">Descripción</th><th className="text-right py-2">Total</th></tr>
                    </thead>
                    <tbody className="divide-y divide-dashed divide-slate-200">
                        {closingStats.productsList.map((p, i) => (
                            <tr key={i}><td className="py-2 w-12 font-bold">{p.quantity}</td><td className="py-2 text-xs">{p.name}</td><td className="py-2 text-right">${p.total.toFixed(2)}</td></tr>
                        ))}
                    </tbody>
                 </table>
               ) : <p className="text-center text-slate-400 italic text-xs">Sin movimientos.</p>}
             </div>
             <div className="mt-12 text-center text-[10px] text-slate-300 font-mono print:block hidden">
                *** FIN DEL REPORTE ***
             </div>
          </div>
        </div>
      )}

      {/* --- MODAL MOVIMIENTOS --- */}
      {movementType && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
           <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl scale-100 animate-in zoom-in-95 duration-200">
              <div className="flex justify-between items-center mb-4">
                  <h2 className={`text-xl font-black flex items-center gap-2 ${movementType === 'in' ? 'text-emerald-600' : 'text-red-600'}`}>
                    {movementType === 'in' ? <PlusCircle className="fill-current"/> : <MinusCircle className="fill-current"/>} 
                    {movementType === 'in' ? 'INGRESO' : 'RETIRO'}
                  </h2>
                  <button onClick={() => { setMovementType(null); setAmount(''); setReason(''); }}><X className="text-slate-400 hover:text-slate-600"/></button>
              </div>
              
              <form onSubmit={handleMovement} className="space-y-4">
                 <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Monto</label>
                    <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4"/>
                        <input 
                            type="number" step="0.01" required autoFocus 
                            value={amount} onChange={e => setAmount(e.target.value)} 
                            className="w-full pl-9 pr-4 py-3 border border-slate-200 rounded-xl font-bold text-lg outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all" 
                            placeholder="0.00"
                        />
                    </div>
                 </div>
                 <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Motivo</label>
                    <input 
                        type="text" required 
                        value={reason} onChange={e => setReason(e.target.value)} 
                        className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm transition-all" 
                        placeholder="Ej: Cambio, Pago proveedor..."
                    />
                 </div>
                 <button 
                    type="submit" 
                    disabled={isLoading}
                    className={`w-full py-3.5 font-bold text-white rounded-xl shadow-lg transition-all active:scale-[0.98] flex justify-center items-center gap-2 ${movementType === 'in' ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200' : 'bg-red-600 hover:bg-red-700 shadow-red-200'}`}
                 >
                    {isLoading ? <Loader2 className="animate-spin"/> : 'CONFIRMAR'}
                 </button>
              </form>
           </div>
        </div>
      )}

      {/* --- MODAL CIERRE DE CAJA --- */}
      {isClosing && shiftStats && (
        <div className="fixed inset-0 bg-slate-900/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
           <div className="bg-white rounded-2xl p-0 max-w-md w-full shadow-2xl overflow-hidden animate-in slide-in-from-bottom-8 duration-300">
              <div className="bg-slate-900 p-6 text-white flex justify-between items-center">
                  <h2 className="text-xl font-black flex items-center gap-2"><Lock className="text-indigo-400"/> CORTE DE CAJA</h2>
                  <button onClick={() => setIsClosing(false)}><X className="text-slate-400 hover:text-white"/></button>
              </div>
              
              <div className="p-6">
                <div className="bg-slate-50 p-4 rounded-xl mb-6 border border-slate-100">
                    <div className="flex justify-between items-center mb-1">
                        <span className="text-xs font-bold text-slate-500 uppercase">Efectivo Esperado</span>
                        <span className="text-lg font-black text-slate-800">{currency.format(shiftStats.expectedCash)}</span>
                    </div>
                    <div className="h-px bg-slate-200 my-2"></div>
                    <p className="text-[10px] text-slate-400 leading-tight">
                        Calculado: Base Inicial + Ventas Efectivo + Ingresos - Retiros
                    </p>
                </div>

                <form onSubmit={handleCloseShift}>
                    <div className="mb-6">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Dinero en Caja (Conteo Real)</label>
                        <div className="relative">
                            <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-6 h-6"/>
                            <input 
                                type="number" step="0.01" required autoFocus 
                                value={amount} onChange={e => setAmount(e.target.value)} 
                                className="w-full pl-12 pr-4 py-4 text-3xl font-black text-slate-800 border-2 border-slate-200 rounded-xl focus:border-indigo-500 outline-none transition-all bg-slate-50 focus:bg-white" 
                                placeholder="0.00"
                            />
                        </div>
                        {/* Calculadora de Diferencia en tiempo real */}
                        {amount && (
                            <div className={`mt-2 text-center text-xs font-bold px-2 py-1 rounded ${
                                (parseFloat(amount) - shiftStats.expectedCash) === 0 ? 'text-emerald-600 bg-emerald-50' : 
                                (parseFloat(amount) - shiftStats.expectedCash) > 0 ? 'text-blue-600 bg-blue-50' : 'text-red-600 bg-red-50'
                            }`}>
                                Diferencia: {((parseFloat(amount) || 0) - shiftStats.expectedCash) > 0 ? '+' : ''}
                                {currency.format((parseFloat(amount) || 0) - shiftStats.expectedCash)}
                            </div>
                        )}
                    </div>

                    <button 
                        type="submit" 
                        disabled={isLoading}
                        className="w-full py-4 bg-slate-900 text-white font-bold rounded-xl hover:bg-black shadow-xl shadow-slate-300 transition-all flex justify-center items-center gap-2 active:scale-[0.98]"
                    >
                        {isLoading ? <Loader2 className="animate-spin"/> : 'FINALIZAR TURNO'}
                    </button>
                </form>
              </div>
           </div>
        </div>
      )}

      {selectedTicket && <TicketModal sale={selectedTicket} onClose={() => setSelectedTicket(null)} />}
    </div>
  );
}