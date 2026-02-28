import { useState, useMemo, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Sale, type Product, type CashShift, type CashMovement, type Staff, type InventoryMovement } from '../lib/db';
import { addToQueue, syncPull, syncPush } from '../lib/sync';
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
  ArrowRightLeft, History, Ban
} from 'lucide-react';

const EMPTY_ARRAY: never[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const safeFloat = (val: any): number => {
  const num = parseFloat(val);
  return isNaN(num) ? 0 : num;
};

export function FinancePage() {
  const { currentStaff } = useOutletContext<{ currentStaff: Staff }>();

  const [viewMode, setViewMode] = useState<'control' | 'history' | 'daily' | 'trends' | 'closing'>('control');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [movementType, setMovementType] = useState<'in' | 'out' | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // ESTADOS DEL PIN PAD (Incluye 'void_sale' para anular ventas)
  const [pinModal, setPinModal] = useState<{isOpen: boolean, action: 'out' | 'close' | 'void_sale' | null, data?: any}>({isOpen: false, action: null});
  const [pinInput, setPinInput] = useState('');

  const today = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedTicket, setSelectedTicket] = useState<Sale | null>(null);
  const [trendFilter, setTrendFilter] = useState<'week' | 'month'>('week');

  const businessSettings = useLiveQuery(() => db.settings.toArray());
  const masterPin = businessSettings && businessSettings.length > 0 ? (businessSettings[0].master_pin || '1234') : '1234';

  const activeShift = useLiveQuery(async () => {
    let bId = localStorage.getItem('nexus_business_id');
    if (!bId) {
        const settings = await db.settings.toArray();
        if (settings.length > 0) bId = settings[0].id;
    }
    if (!bId) return null;
    
    const shift = await db.cash_shifts.where({ business_id: bId, status: 'open' }).first();
    return shift || null; 
  }, []);

  const shiftData = useLiveQuery(async () => {
    if (activeShift === undefined) return undefined;
    if (activeShift === null) return null;

    const bId = activeShift.business_id;
    const [sales, movements] = await Promise.all([
      db.sales.where('shift_id').equals(activeShift.id).filter(s => s.business_id === bId).toArray(),
      db.cash_movements.where('shift_id').equals(activeShift.id).filter(m => m.business_id === bId).toArray()
    ]);
    return { sales, movements };
  }, [activeShift]);

  const products = useLiveQuery<Product[]>(async () => {
    let bId = localStorage.getItem('nexus_business_id');
    if (!bId) return [];
    return await db.products.where('business_id').equals(bId).toArray();
  }, []) || EMPTY_ARRAY;

  const allSales = useLiveQuery<Sale[]>(async () => {
    let bId = localStorage.getItem('nexus_business_id');
    if (!bId) return [];
    if (viewMode !== 'history' && viewMode !== 'daily' && viewMode !== 'trends' && viewMode !== 'closing') return [];
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    return await db.sales.where('business_id').equals(bId).filter(s => s.date >= thirtyDaysAgo.toISOString()).reverse().sortBy('date');
  }, [viewMode]) || EMPTY_ARRAY;

  useEffect(() => {
    if (activeShift !== undefined) {
      setIsInitialLoad(false);
    }
  }, [activeShift]);

  const shiftStats = useMemo(() => {
    if (!activeShift || !shiftData || !shiftData.sales || !shiftData.movements) return null;
    
    const startAmount = safeFloat(activeShift.start_amount);
    // Ignoramos ventas anuladas para no contarlas como ganancia en caja
    const validSales = shiftData.sales.filter(s => s.status !== 'voided');
    
    const totalSales = validSales.reduce((sum, s) => sum + safeFloat(s.total), 0);
    const cashSales = validSales.filter(s => ['efectivo', 'mixto'].includes(s.payment_method?.toLowerCase() || 'efectivo')).reduce((sum, s) => sum + safeFloat(s.total), 0); 
    
    const cashIn = shiftData.movements.filter(m => m.type === 'in').reduce((sum, m) => sum + safeFloat(m.amount), 0);
    const cashOut = shiftData.movements.filter(m => m.type === 'out').reduce((sum, m) => sum + safeFloat(m.amount), 0);
    const expectedCash = (startAmount + cashSales + cashIn) - cashOut;

    return { startAmount, cashSales, totalSales, cashIn, cashOut, expectedCash };
  }, [activeShift, shiftData]);

  const productMeta = useMemo(() => {
    const costs = new Map<string, number>();
    const cats = new Map<string, string>();
    products.forEach((p) => {
      costs.set(p.id, safeFloat(p.cost));
      cats.set(p.id, p.category || 'General');
    });
    return { costs, cats };
  }, [products]);

  const dailyStats = useMemo(() => {
    const salesForDay = allSales.filter((sale) => sale.date.startsWith(selectedDate) && sale.status !== 'voided');
    let revenue = 0, cost = 0;
    const hourlyCounts: Record<string, number> = {};
    const categoryCounts: Record<string, number> = {};
    const productCounts: Record<string, number> = {}; 

    for (let i = 7; i <= 23; i++) hourlyCounts[i.toString().padStart(2, '0') + ":00"] = 0;

    salesForDay.forEach((sale) => {
      const saleTotal = safeFloat(sale.total);
      revenue += saleTotal;
      const saleDate = new Date(sale.date);
      if (!isNaN(saleDate.getTime())) {
          const h = saleDate.getHours().toString().padStart(2, '0') + ":00";
          if (hourlyCounts[h] !== undefined) hourlyCounts[h] += saleTotal;
      }
      sale.items.forEach((item) => {
        const itemQty = safeFloat(item.quantity);
        const itemPrice = safeFloat(item.price);
        const historicalCost = item.cost !== undefined ? safeFloat(item.cost) : (productMeta.costs.get(item.product_id) || 0);
        cost += historicalCost * itemQty;
        const cat = productMeta.cats.get(item.product_id) || 'General';
        categoryCounts[cat] = (categoryCounts[cat] || 0) + (itemPrice * itemQty);
        productCounts[item.name] = (productCounts[item.name] || 0) + itemQty;
      });
    });

    let bestSeller = { name: 'N/A', count: 0 };
    Object.entries(productCounts).forEach(([name, count]) => { if (count > bestSeller.count) bestSeller = { name, count }; });

    const profit = revenue - cost;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
    const chartData = Object.entries(hourlyCounts).map(([time, total]) => ({ time, total }));
    const pieData = Object.entries(categoryCounts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

    return { sales: salesForDay, revenue, profit, cost, margin, chartData, pieData, bestSeller };
  }, [allSales, selectedDate, productMeta]);

  const closingStats = useMemo(() => {
    let cashTotal = 0, transferTotal = 0, cardTotal = 0;
    const productSummary: Record<string, { quantity: number, total: number }> = {};

    dailyStats.sales.forEach((sale) => {
      const saleTotal = safeFloat(sale.total);
      const method = sale.payment_method?.toLowerCase() || 'efectivo';
      if (method === 'efectivo') cashTotal += saleTotal;
      else if (method === 'tarjeta') cardTotal += saleTotal;
      else transferTotal += saleTotal;

      sale.items.forEach((item) => {
        if (!productSummary[item.name]) productSummary[item.name] = { quantity: 0, total: 0 };
        productSummary[item.name].quantity += safeFloat(item.quantity);
        productSummary[item.name].total += (safeFloat(item.price) * safeFloat(item.quantity));
      });
    });

    const productsList = Object.entries(productSummary).map(([name, data]) => ({ name, ...data })).sort((a, b) => b.quantity - a.quantity);
    return { cashTotal, transferTotal, cardTotal, productsList, ticketCount: dailyStats.sales.length };
  }, [dailyStats.sales]);

  const trendStats = useMemo(() => {
    const daysToShow = trendFilter === 'week' ? 7 : 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(new Date().getDate() - daysToShow);
    const filteredSales = allSales.filter((s) => new Date(s.date) >= cutoffDate && s.status !== 'voided');

    let totalRevenue = 0, totalCost = 0;
    const salesByDate: Record<string, number> = {};

    filteredSales.forEach((sale) => {
      const saleTotal = safeFloat(sale.total);
      totalRevenue += saleTotal;
      let saleCost = 0;
      sale.items.forEach((i) => {
          const historicalCost = i.cost !== undefined ? safeFloat(i.cost) : (productMeta.costs.get(i.product_id) || 0);
          saleCost += historicalCost * safeFloat(i.quantity);
      });
      totalCost += saleCost;
      const dateKey = new Date(sale.date).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' });
      salesByDate[dateKey] = (salesByDate[dateKey] || 0) + saleTotal;
    });

    const totalProfit = totalRevenue - totalCost;
    const totalMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
    const chartData = Object.entries(salesByDate).map(([date, total]) => ({ date, total }));

    return { totalRevenue, totalCost, totalProfit, totalMargin, chartData, count: filteredSales.length };
  }, [allSales, trendFilter, productMeta]);

  const formatMoney = (val: number) => {
    if (val === undefined || val === null || isNaN(val)) return '$0.00';
    try {
      return currency.format(val);
    } catch (err) {
      console.warn("Error formateando moneda:", err);
      return `$${val.toFixed(2)}`;
    }
  };

  const getActiveCredentials = async () => {
      let bId = localStorage.getItem('nexus_business_id');
      if (!bId) {
          const settings = await db.settings.toArray();
          if (settings.length > 0) {
              bId = settings[0].id;
              localStorage.setItem('nexus_business_id', bId);
          }
      }
      
      let sId = currentStaff?.id || localStorage.getItem('nexus_staff_id');
      if (!sId) {
          const staffs = await db.staff.toArray();
          if (staffs.length > 0) {
              sId = staffs[0].id;
              localStorage.setItem('nexus_staff_id', sId);
          } else {
              sId = 'admin';
          }
      }
      return { bId, sId };
  };

  const handleOpenShift = async () => {
    const startAmount = safeFloat(amount);
    if (isNaN(startAmount) || startAmount < 0) {
        toast.error('Monto inicial inválido');
        return;
    }
    
    setIsLoading(true);
    try {
        const { bId, sId } = await getActiveCredentials();
        if (!bId) {
            toast.error("Error crítico: Negocio no configurado.");
            setIsLoading(false);
            return;
        }

        const shiftId = crypto.randomUUID();
        const newShift: CashShift = {
            id: shiftId, 
            business_id: bId, 
            staff_id: sId, 
            start_amount: startAmount,
            opened_at: new Date().toISOString(), 
            status: 'open', 
            sync_status: 'pending_create'
        };

        const staffPayload = { id: sId, name: currentStaff?.name || 'Cajero', business_id: bId };

        await db.transaction('rw', [db.cash_shifts, db.action_queue, db.audit_logs], async () => {
            await db.cash_shifts.add(newShift);
            await addToQueue('SHIFT', newShift);
            await logAuditAction('OPEN_SHIFT', { amount: startAmount }, staffPayload as any);
        });

        toast.success('¡Caja Abierta!');
        setAmount('');
        syncPush().catch(err => console.warn("Sync warning:", err));
        
    } catch (error) {
        console.error('❌ Error CRÍTICO al abrir caja:', error);
        toast.error("Error al guardar en base de datos local");
    } finally {
        setIsLoading(false);
    }
  };

  const handleMovement = async () => {
    const currentShift = activeShift;
    if (!currentShift || !movementType) return;
    const val = safeFloat(amount);
    
    if (val <= 0) return toast.error('Monto inválido');
    if (!reason.trim()) return toast.error('Debes indicar un motivo');

    setIsLoading(true);
    try {
        const { bId, sId } = await getActiveCredentials();
        const safeBid = bId || currentShift.business_id;

        const movement: CashMovement = {
            id: crypto.randomUUID(), 
            shift_id: currentShift.id, 
            business_id: safeBid, 
            type: movementType,
            amount: val, 
            reason: reason, 
            staff_id: sId, 
            created_at: new Date().toISOString(), 
            sync_status: 'pending_create'
        };

        const staffPayload = { id: sId, name: currentStaff?.name || 'Cajero', business_id: safeBid };

        await db.transaction('rw', [db.cash_movements, db.action_queue, db.audit_logs], async () => {
            await db.cash_movements.add(movement);
            await addToQueue('CASH_MOVEMENT', movement);
            await logAuditAction(movementType === 'in' ? 'CASH_IN' : 'CASH_OUT', { amount: val, reason }, staffPayload as any);
        });

        toast.success('Movimiento registrado');
        setAmount(''); setReason(''); setMovementType(null);
        syncPush().catch(() => {});
    } catch (error) {
        console.error(error);
        toast.error("Error al registrar movimiento");
    } finally {
        setIsLoading(false);
    }
  };

  const handleCloseShift = async () => {
    const currentShift = activeShift;
    if (!currentShift || !shiftStats) return;
    const finalCount = safeFloat(amount);
    
    setIsLoading(true);
    try {
        const { bId, sId } = await getActiveCredentials();
        const safeBid = bId || currentShift.business_id;
        const difference = finalCount - shiftStats.expectedCash;
        const closedAt = new Date().toISOString();

        const staffPayload = { id: sId, name: currentStaff?.name || 'Cajero', business_id: safeBid };

        await db.transaction('rw', [db.cash_shifts, db.action_queue, db.audit_logs], async () => {
            await db.cash_shifts.update(currentShift.id, {
                end_amount: finalCount, 
                difference: difference, 
                expected_amount: shiftStats.expectedCash,
                closed_at: closedAt, 
                status: 'closed', 
                sync_status: 'pending_update'
            });

            const closedShift = await db.cash_shifts.get(currentShift.id);
            if(closedShift) await addToQueue('SHIFT', closedShift);
            
            await logAuditAction('CLOSE_SHIFT', { expected: shiftStats.expectedCash, real: finalCount, diff: difference }, staffPayload as any);
        });

        toast.success(`Caja cerrada. Diferencia: ${formatMoney(difference)}`);
        setIsClosing(false); setAmount('');
        syncPush().catch(() => {});
    } catch (error) {
        console.error(error);
        toast.error("Error al cerrar caja");
    } finally {
        setIsLoading(false);
    }
  };

  // ✅ NUEVA FUNCIÓN: ANULAR VENTA Y DEVOLVER INVENTARIO
  const handleVoidSale = async (sale: Sale) => {
      setIsLoading(true);
      try {
          const { bId, sId } = await getActiveCredentials();
          const safeBid = bId || sale.business_id;

          await db.transaction('rw', [db.sales, db.products, db.movements, db.cash_movements, db.action_queue, db.audit_logs], async () => {
              // 1. Marcar venta como anulada
              await db.sales.update(sale.id, { status: 'voided', sync_status: 'pending_update' });
              await addToQueue('VOID_SALE', { saleId: sale.id });

              // 2. Devolver stock de cada producto
              for (const item of sale.items) {
                  const product = await db.products.get(item.product_id);
                  if (product) {
                      const newStock = product.stock + item.quantity;
                      await db.products.update(product.id, { stock: newStock, sync_status: 'pending_update' });
                      await addToQueue('PRODUCT_SYNC', { ...product, stock: newStock, sync_status: 'pending_update' });
                      
                      const mov: InventoryMovement = {
                          id: crypto.randomUUID(), business_id: safeBid, product_id: product.id,
                          qty_change: item.quantity, reason: `Devolución - Venta #${sale.id.slice(0,6)}`,
                          created_at: new Date().toISOString(), staff_id: sId, sync_status: 'pending_create'
                      };
                      await db.movements.add(mov);
                      await addToQueue('MOVEMENT', mov);
                  }
              }

              // 3. Si la venta es de un turno ANTERIOR, registrar retiro de caja en el turno actual
              if (activeShift && sale.shift_id !== activeShift.id && ['efectivo', 'mixto'].includes(sale.payment_method)) {
                  const cashMov: CashMovement = {
                      id: crypto.randomUUID(), shift_id: activeShift.id, business_id: safeBid, type: 'out',
                      amount: sale.total, reason: `Reembolso Venta Anterior #${sale.id.slice(0,6)}`,
                      staff_id: sId, created_at: new Date().toISOString(), sync_status: 'pending_create'
                  };
                  await db.cash_movements.add(cashMov);
                  await addToQueue('CASH_MOVEMENT', cashMov);
              }

              // 4. Log
              await logAuditAction('VOID_SALE', { sale_id: sale.id, amount: sale.total }, { id: sId, name: currentStaff?.name || 'Admin', business_id: safeBid } as any);
          });
          toast.success("Venta anulada y stock restaurado");
          syncPush().catch(()=>{});
      } catch (error) {
          console.error(error);
          toast.error("Error al anular la venta");
      } finally {
          setIsLoading(false);
      }
  };

  const changeDate = (days: number) => {
    const d = new Date(selectedDate); d.setDate(d.getDate() + days);
    const newStr = d.toISOString().split('T')[0]; if (newStr <= today) setSelectedDate(newStr);
  };
  
  const handlePrint = () => window.print();
  const COLORS = ['#0B3B68', '#7AC142', '#F59E0B', '#EF4444', '#6B7280'];

  if (activeShift === undefined || isInitialLoad) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[#F3F4F6]">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-[#0B3B68] mx-auto mb-4" />
          <p className="text-[#6B7280] font-semibold">Cargando datos del turno...</p>
        </div>
      </div>
    );
  }

  if (activeShift === null) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[#F3F4F6]">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full border border-gray-100 text-center animate-in fade-in zoom-in duration-300">
          <div className="w-16 h-16 bg-[#0B3B68]/10 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
            <Lock className="text-[#0B3B68] w-8 h-8" />
          </div>
          <h1 className="text-2xl font-black text-[#0B3B68] mb-2">Apertura de Caja</h1>
          <p className="text-[#6B7280] mb-6 text-sm">Inicia el turno para habilitar el punto de venta.</p>
          
          <div className="w-full text-left">
            <div className="mb-6 text-left">
              <label className="block text-xs font-bold text-[#6B7280] uppercase mb-2 ml-1">Monto Inicial (Efectivo)</label>
              <div className="relative group">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280] w-5 h-5 group-focus-within:text-[#0B3B68] transition-colors"/>
                <input 
                    type="number" step="0.01" autoFocus
                    className="w-full pl-10 pr-4 py-3 text-lg font-bold text-[#1F2937] border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#0B3B68] outline-none transition-all" 
                    placeholder="0.00" 
                    value={amount} 
                    onChange={e => setAmount(e.target.value)} 
                    onKeyDown={(e) => { 
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            if(!isLoading && amount !== '') handleOpenShift(); 
                        }
                    }}
                />
              </div>
            </div>
            <button 
                type="button" 
                onClick={(e) => { e.preventDefault(); handleOpenShift(); }}
                disabled={isLoading || amount === ''}
                className="w-full bg-[#7AC142] hover:bg-[#7AC142]/90 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-[#7AC142]/20 flex justify-center items-center gap-2 active:scale-[0.98]"
            >
                {isLoading ? <Loader2 className="animate-spin"/> : 'ABRIR TURNO'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 pb-24 md:pb-6 min-h-screen bg-[#F3F4F6] print:bg-white print:p-0">
      
      <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-[#0B3B68] flex items-center gap-2">
            <Unlock className="text-[#7AC142]" /> Caja Abierta
          </h1>
          <p className="text-[#6B7280] text-xs font-mono mt-1 bg-white px-2 py-1 rounded inline-block border border-gray-200 shadow-sm">
            ID: {activeShift.id.slice(0,8).toUpperCase()} | Inicio: {new Date(activeShift.opened_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
          </p>
        </div>

        <div className="flex bg-white p-1.5 rounded-xl border border-gray-200 shadow-sm overflow-x-auto max-w-full scrollbar-hide">
          <button onClick={() => setViewMode('control')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${viewMode === 'control' ? 'bg-[#0B3B68] text-white shadow-md' : 'text-[#6B7280] hover:bg-gray-50'}`}>
            <Wallet size={16} /> Control
          </button>
          <div className="w-px h-6 bg-gray-200 mx-1 self-center"></div>
          <button onClick={() => setViewMode('history')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${viewMode === 'history' ? 'bg-[#0B3B68] text-white shadow-md' : 'text-[#6B7280] hover:bg-gray-50'}`}>
            <History size={16} /> Historial
          </button>
          <div className="w-px h-6 bg-gray-200 mx-1 self-center"></div>
          <button onClick={() => setViewMode('daily')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${viewMode === 'daily' ? 'bg-[#0B3B68] text-white shadow-md' : 'text-[#6B7280] hover:bg-gray-50'}`}>
            <Calendar size={16} /> Reportes
          </button>
          <button onClick={() => setViewMode('trends')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${viewMode === 'trends' ? 'bg-[#0B3B68] text-white shadow-md' : 'text-[#6B7280] hover:bg-gray-50'}`}>
            <BarChart3 size={16} /> Tendencias
          </button>
          <div className="w-px h-6 bg-gray-200 mx-1 self-center"></div>
          <button onClick={() => setViewMode('closing')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${viewMode === 'closing' ? 'bg-[#1F2937] text-white shadow-md' : 'text-[#6B7280] hover:bg-gray-50'}`}>
            <ClipboardCheck size={16} /> Corte Z
          </button>
        </div>
      </div>

      {viewMode === 'control' && shiftStats && (
        <div className="animate-in slide-in-from-bottom-4 duration-300 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
               <p className="text-[#6B7280] text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1"><ShoppingBag size={12}/> Total Ventas</p>
               <h3 className="text-2xl font-black text-[#1F2937]">{formatMoney(shiftStats.totalSales)}</h3>
               <p className="text-[10px] text-[#6B7280] mt-1">Todas las confirmadas</p>
            </div>
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
               <p className="text-[#6B7280] text-[10px] font-bold uppercase tracking-wider mb-1">Base Inicial</p>
               <h3 className="text-2xl font-black text-[#0B3B68]">{formatMoney(shiftStats.startAmount)}</h3>
            </div>
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
               <p className="text-[#7AC142] text-[10px] font-bold uppercase tracking-wider mb-1">Ventas Efectivo</p>
               <h3 className="text-2xl font-black text-[#7AC142]">+{formatMoney(shiftStats.cashSales)}</h3>
            </div>
            
            <div className="bg-[#0B3B68] p-5 rounded-2xl shadow-lg shadow-[#0B3B68]/30 text-white relative overflow-hidden">
               <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -mr-10 -mt-10 blur-xl"></div>
               <p className="text-gray-300 text-[10px] font-bold uppercase tracking-wider mb-1">Efectivo en Caja</p>
               <h3 className="text-3xl font-black text-white">
                {shiftStats && typeof shiftStats.expectedCash === 'number'
                  ? formatMoney(shiftStats.expectedCash)
                  : <span className="text-yellow-400 text-lg">Cargando...</span>
                }
              </h3>
               <p className="text-[10px] text-gray-400 mt-1">Calculado automáticamente</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
             <button onClick={() => { setMovementType('in'); setAmount(''); }} className="group flex items-center justify-center gap-3 p-4 bg-[#7AC142]/10 text-[#7AC142] rounded-2xl border border-[#7AC142]/20 hover:bg-[#7AC142]/20 font-bold transition-all active:scale-[0.98]">
                <div className="bg-[#7AC142]/20 text-[#7AC142] p-2 rounded-lg group-hover:bg-[#7AC142]/30 transition-colors"><PlusCircle size={20}/></div>
                <span>Ingreso Dinero</span>
             </button>
             <button onClick={() => setPinModal({isOpen: true, action: 'out'})} className="group flex items-center justify-center gap-3 p-4 bg-[#EF4444]/10 text-[#EF4444] rounded-2xl border border-[#EF4444]/20 hover:bg-[#EF4444]/20 font-bold transition-all active:scale-[0.98]">
                <div className="bg-[#EF4444]/20 text-[#EF4444] p-2 rounded-lg group-hover:bg-[#EF4444]/30 transition-colors"><MinusCircle size={20}/></div>
                <span>Retiro Dinero</span>
             </button>
             <button onClick={() => setPinModal({isOpen: true, action: 'close'})} className="group flex items-center justify-center gap-3 p-4 bg-white text-[#1F2937] rounded-2xl border border-gray-200 hover:bg-gray-50 hover:border-gray-300 font-bold transition-all active:scale-[0.98]">
                <div className="bg-gray-100 text-[#6B7280] p-2 rounded-lg group-hover:bg-gray-200 transition-colors"><Lock size={20} /></div>
                <span>Cerrar Turno</span>
             </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                    <h3 className="font-bold text-[#1F2937] text-sm flex items-center gap-2"><ArrowRightLeft className="text-[#6B7280]" size={16}/> Movimientos de Caja</h3>
                </div>
                <div className="overflow-x-auto max-h-60">
                    <table className="mobile-card-table w-full text-sm text-left">
                        <thead className="text-[#6B7280] font-bold uppercase text-[10px] bg-[#F3F4F6] sticky top-0">
                        <tr><th className="p-3">Hora</th><th className="p-3">Tipo</th><th className="p-3">Motivo</th><th className="p-3 text-right">Monto</th></tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                        {shiftData?.movements.map(m => (
                            <tr key={m.id} className="hover:bg-gray-50 transition-colors">
                                <td className="p-3 text-[#6B7280] text-xs font-mono" data-label="Hora">{new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</td>
                                <td className="p-3" data-label="Tipo"><span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${m.type==='in'?'bg-[#7AC142]/10 text-[#7AC142] border-[#7AC142]/20':'bg-[#EF4444]/10 text-[#EF4444] border-[#EF4444]/20'}`}>{m.type === 'in' ? 'Entrada' : 'Salida'}</span></td>
                                <td className="p-3 font-medium text-[#1F2937] text-xs" data-label="Motivo">{m.reason}</td>
                                <td className={`p-3 text-right font-bold text-xs ${m.type==='in'?'text-[#7AC142]':'text-[#EF4444]'}`} data-label="Monto">{m.type==='out'?'-':'+'}{formatMoney(m.amount)}</td>
                            </tr>
                        ))}
                        {shiftData?.movements.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-[#6B7280] italic text-xs">Sin movimientos registrados</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                    <h3 className="font-bold text-[#1F2937] text-sm flex items-center gap-2"><ShoppingBag className="text-[#6B7280]" size={16}/> Ventas Recientes</h3>
                    <span className="text-[10px] bg-[#0B3B68]/10 text-[#0B3B68] px-2 py-0.5 rounded-full font-bold">
                        {shiftData?.sales.filter(s => s.status !== 'voided').length || 0}
                    </span>
                </div>
                <div className="overflow-x-auto max-h-60">
                    <table className="mobile-card-table w-full text-sm text-left">
                        <thead className="text-[#6B7280] font-bold uppercase text-[10px] bg-[#F3F4F6] sticky top-0">
                        <tr><th className="p-3">Hora</th><th className="p-3">Método</th><th className="p-3 text-right">Total</th></tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                        {shiftData?.sales.filter(s => s.status !== 'voided').slice().reverse().map(s => (
                            <tr key={s.id} onClick={() => setSelectedTicket(s)} className="cursor-pointer hover:bg-[#0B3B68]/5 transition-colors group">
                                <td className="p-3 text-[#6B7280] text-xs font-mono group-hover:text-[#0B3B68]" data-label="Hora">{new Date(s.date).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</td>
                                <td className="p-3" data-label="Método"><span className="px-2 py-0.5 bg-gray-100 text-[#6B7280] rounded text-[10px] font-bold uppercase border border-gray-200">{s.payment_method}</span></td>
                                <td className="p-3 text-right font-bold text-[#1F2937] text-xs" data-label="Total">{formatMoney(s.total)}</td>
                            </tr>
                        ))}
                        {shiftData?.sales.filter(s => s.status !== 'voided').length === 0 && <tr><td colSpan={3} className="p-8 text-center text-[#6B7280] italic text-xs">Sin ventas en este turno</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>
          </div>
        </div>
      )}

      {/* ✅ VISTA: HISTORIAL Y DEVOLUCIONES */}
      {viewMode === 'history' && (
        <div className="animate-in fade-in zoom-in-95 duration-300">
           <div className="bg-white rounded-3xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="p-5 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                  <h2 className="text-lg font-bold text-[#1F2937] flex items-center gap-2">
                      <History className="text-[#0B3B68]"/> Historial (Últimos 30 días)
                  </h2>
              </div>
              <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                      <thead className="text-[#6B7280] font-bold uppercase text-xs bg-white border-b border-gray-200">
                          <tr>
                              <th className="p-4">Fecha y Hora</th>
                              <th className="p-4">Método</th>
                              <th className="p-4 text-center">Estado</th>
                              <th className="p-4 text-right">Total</th>
                              <th className="p-4 text-center">Acciones</th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                          {allSales.map(sale => (
                              <tr key={sale.id} className={`transition-colors ${sale.status === 'voided' ? 'bg-red-50/50 opacity-60' : 'hover:bg-gray-50'}`}>
                                  <td className="p-4 font-mono text-[#6B7280]">
                                      {new Date(sale.date).toLocaleDateString()} <span className="ml-2">{new Date(sale.date).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                                  </td>
                                  <td className="p-4 uppercase text-xs font-bold text-[#1F2937]">{sale.payment_method}</td>
                                  <td className="p-4 text-center">
                                      {sale.status === 'voided' 
                                          ? <span className="bg-red-100 text-red-600 px-3 py-1 rounded-full text-[10px] font-black uppercase">Anulada</span>
                                          : <span className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-[10px] font-black uppercase">Completada</span>
                                      }
                                  </td>
                                  <td className="p-4 text-right font-black text-[#1F2937]">{formatMoney(sale.total)}</td>
                                  <td className="p-4">
                                      <div className="flex justify-center gap-2">
                                          <button onClick={() => setSelectedTicket(sale)} className="px-3 py-1.5 bg-gray-100 text-[#1F2937] rounded-lg font-bold text-xs hover:bg-gray-200 transition-colors">Ver</button>
                                          {sale.status !== 'voided' && (
                                              <button onClick={() => setPinModal({isOpen: true, action: 'void_sale', data: sale})} className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg font-bold text-xs hover:bg-red-100 transition-colors flex items-center gap-1">
                                                  <Ban size={12}/> Anular
                                              </button>
                                          )}
                                      </div>
                                  </td>
                              </tr>
                          ))}
                          {allSales.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-[#6B7280]">No hay ventas registradas.</td></tr>}
                      </tbody>
                  </table>
              </div>
           </div>
        </div>
      )}

      {viewMode === 'daily' && (
        <div className="animate-in fade-in zoom-in-95 duration-300">
          <div className="flex justify-between items-center mb-6">
             <div className="flex items-center gap-2 bg-white p-1 rounded-xl border border-gray-200 shadow-sm">
                <button onClick={() => changeDate(-1)} className="p-2 hover:bg-gray-100 rounded-lg text-[#6B7280]"><ArrowLeft size={20} /></button>
                <div className="relative mx-2">
                  <input type="date" value={selectedDate} max={today} onChange={(e) => e.target.value && setSelectedDate(e.target.value)} className="bg-transparent text-[#1F2937] font-bold outline-none cursor-pointer text-sm uppercase" />
                </div>
                <button onClick={() => changeDate(1)} disabled={selectedDate >= today} className="p-2 hover:bg-gray-100 rounded-lg text-[#6B7280] disabled:opacity-30"><ArrowRight size={20} /></button>
             </div>
             <button onClick={() => syncPull()} className="p-2 bg-white text-[#0B3B68] border border-gray-200 rounded-lg shadow-sm hover:bg-[#0B3B68]/10 transition-colors" title="Sincronizar Nube"><RefreshCw size={20}/></button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 relative overflow-hidden group">
               <div className="relative">
                  <p className="text-[#6B7280] text-xs font-bold uppercase mb-1 flex items-center gap-1"><DollarSign size={14} /> Ventas (Neto)</p>
                  <h3 className="text-2xl font-bold text-[#1F2937]">{formatMoney(dailyStats.revenue)}</h3>
               </div>
            </div>
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 relative overflow-hidden group">
               <div className="relative">
                  <p className="text-[#6B7280] text-xs font-bold uppercase mb-1 flex items-center gap-1"><Wallet size={14} /> Costos</p>
                  <h3 className="text-2xl font-bold text-[#1F2937]">{formatMoney(dailyStats.cost)}</h3>
               </div>
            </div>
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 relative overflow-hidden group">
               <div className="relative">
                  <p className="text-[#6B7280] text-xs font-bold uppercase mb-1 flex items-center gap-1"><TrendingUp size={14} /> Ganancia</p>
                  <h3 className="text-2xl font-bold text-[#7AC142]">{formatMoney(dailyStats.profit)}</h3>
                  <span className="text-[10px] bg-[#7AC142]/10 text-[#7AC142] px-2 py-0.5 rounded-full font-bold inline-block border border-[#7AC142]/20">Margen: {dailyStats.margin.toFixed(0)}%</span>
               </div>
            </div>
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 relative overflow-hidden group">
               <div className="relative">
                  <p className="text-[#6B7280] text-xs font-bold uppercase mb-1 flex items-center gap-1"><Trophy size={14} className="text-[#F59E0B]"/> Más Vendido</p>
                  <h3 className="text-lg font-bold text-[#1F2937] truncate">{dailyStats.bestSeller.name}</h3>
                  <p className="text-xs text-[#6B7280]">{dailyStats.bestSeller.count} unidades</p>
               </div>
            </div>
          </div>

          {dailyStats.sales.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 h-72">
                   <h4 className="font-bold text-[#1F2937] text-sm mb-4 flex items-center gap-2"><BarChart3 size={16}/> Ventas por Hora</h4>
                   <ResponsiveContainer width="100%" height="90%">
                     <BarChart data={dailyStats.chartData}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" /><XAxis dataKey="time" fontSize={10} axisLine={false} tickLine={false} tick={{fill: '#94a3b8'}} /><YAxis fontSize={10} axisLine={false} tickLine={false} tick={{fill: '#94a3b8'}} tickFormatter={v => `$${v}`} /><Tooltip cursor={{fill: '#f8fafc'}} contentStyle={{borderRadius:'8px', border:'none', boxShadow:'0 4px 6px -1px rgb(0 0 0 / 0.1)'}} /><Bar dataKey="total" fill="#0B3B68" radius={[4,4,0,0]} /></BarChart>
                   </ResponsiveContainer>
                </div>
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 h-72">
                   <h4 className="font-bold text-[#1F2937] text-sm mb-4 flex items-center gap-2"><PieChartIcon size={16}/> Categorías</h4>
                   <ResponsiveContainer width="100%" height="90%">
                     <PieChart><Pie data={dailyStats.pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={60} paddingAngle={5} dataKey="value" stroke="none">{dailyStats.pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip contentStyle={{borderRadius:'8px', border:'none', boxShadow:'0 4px 6px -1px rgb(0 0 0 / 0.1)'}} /><Legend iconType="circle" wrapperStyle={{fontSize:'10px', fontFamily: 'sans-serif'}} /></PieChart>
                   </ResponsiveContainer>
                </div>
            </div>
          )}
        </div>
      )}

      {viewMode === 'trends' && (
        <div className="animate-in fade-in zoom-in-95 duration-300">
          <div className="flex gap-2 mb-6">
             <button onClick={() => setTrendFilter('week')} className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${trendFilter === 'week' ? 'bg-[#0B3B68] text-white shadow-md' : 'bg-white border border-gray-200 text-[#6B7280] hover:bg-gray-50'}`}>Últimos 7 días</button>
             <button onClick={() => setTrendFilter('month')} className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${trendFilter === 'month' ? 'bg-[#0B3B68] text-white shadow-md' : 'bg-white border border-gray-200 text-[#6B7280] hover:bg-gray-50'}`}>Últimos 30 días</button>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 h-80">
             <h4 className="font-bold text-[#1F2937] mb-4 text-sm">Evolución de Ingresos Netos</h4>
             <ResponsiveContainer width="100%" height="100%">
                 <BarChart data={trendStats.chartData}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" /><XAxis dataKey="date" fontSize={10} axisLine={false} tickLine={false} tick={{fill: '#94a3b8'}} /><YAxis fontSize={10} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} tick={{fill: '#94a3b8'}} /><Tooltip cursor={{fill: '#f8fafc'}} contentStyle={{borderRadius:'8px', border:'none', boxShadow:'0 4px 6px -1px rgb(0 0 0 / 0.1)'}} /><Bar dataKey="total" fill="#7AC142" radius={[4,4,0,0]} barSize={40} /></BarChart>
             </ResponsiveContainer>
          </div>
        </div>
      )}

      {viewMode === 'closing' && (
        <div className="animate-in slide-in-from-bottom-4 duration-300 max-w-3xl mx-auto">
          <div className="flex justify-between items-center mb-6 print:hidden">
            <h2 className="text-xl font-bold text-[#1F2937]">Cierre del Día</h2>
            <div className="flex items-center gap-3">
               <input type="date" value={selectedDate} max={today} onChange={(e) => e.target.value && setSelectedDate(e.target.value)} className="bg-white border border-gray-200 text-[#1F2937] font-bold rounded-lg p-2 outline-none text-sm" />
               <button onClick={handlePrint} className="flex items-center gap-2 px-4 py-2 bg-[#0B3B68] text-white text-xs font-bold rounded-lg hover:bg-[#0B3B68]/90 transition-colors shadow-lg shadow-[#0B3B68]/30"><Printer size={16} /> Imprimir</button>
            </div>
          </div>
          <div className="bg-white p-8 rounded-none md:rounded-3xl shadow-lg border border-gray-200 print:shadow-none print:border-none print:p-0">
             <div className="text-center mb-8 border-b border-dashed border-gray-300 pb-6">
                 <h1 className="text-2xl font-black text-[#0B3B68] uppercase tracking-widest mb-2">REPORTE Z</h1>
                 <p className="text-[#6B7280] font-mono text-xs">Bisne con Talla POS</p>
                 <p className="text-sm text-[#6B7280] mt-1">Fecha: {new Date(selectedDate).toLocaleDateString()}</p>
             </div>
             <div className="mb-8">
                 <div className="space-y-3 font-mono text-sm text-[#1F2937]">
                     <div className="flex justify-between p-2 bg-gray-50 rounded print:bg-white border border-transparent print:border-gray-100"><span>Efectivo</span><span className="font-bold">{formatMoney(closingStats.cashTotal)}</span></div>
                     <div className="flex justify-between p-2 bg-gray-50 rounded print:bg-white border border-transparent print:border-gray-100"><span>Tarjeta</span><span className="font-bold">{formatMoney(closingStats.cardTotal)}</span></div>
                     <div className="flex justify-between p-2 bg-gray-50 rounded print:bg-white border border-transparent print:border-gray-100"><span>Transferencia</span><span className="font-bold">{formatMoney(closingStats.transferTotal)}</span></div>
                     <div className="border-t-2 border-[#0B3B68] pt-3 flex justify-between text-lg font-black mt-2"><span>TOTAL NETO</span><span>{formatMoney(closingStats.cashTotal + closingStats.transferTotal + closingStats.cardTotal)}</span></div>
                 </div>
             </div>
             <div>
                 <h3 className="text-xs font-bold text-[#6B7280] uppercase mb-4 tracking-wider">Desglose de Productos Vendidos</h3>
                 {closingStats.productsList.length > 0 ? (
                     <table className="w-full text-sm font-mono text-[#1F2937]">
                         <thead className="text-[#6B7280] border-b border-gray-200 text-[10px] uppercase">
                             <tr><th className="text-left py-2">Cant</th><th className="text-left py-2">Descripción</th><th className="text-right py-2">Total</th></tr>
                         </thead>
                         <tbody className="divide-y divide-dashed divide-gray-200">
                             {closingStats.productsList.map((p, i) => (
                                 <tr key={i}><td className="py-2 w-12 font-bold">{p.quantity}</td><td className="py-2 text-xs">{p.name}</td><td className="py-2 text-right">{formatMoney(p.total)}</td></tr>
                             ))}
                         </tbody>
                     </table>
                 ) : <p className="text-center text-[#6B7280] italic text-xs">Sin movimientos.</p>}
             </div>
          </div>
        </div>
      )}

      {/* ✅ PIN PAD MODAL PARA RETIROS, CIERRES Y ANULACIONES */}
      {pinModal.isOpen && (
        <div className="fixed inset-0 bg-[#0B3B68]/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
           <div className="bg-white rounded-3xl p-6 max-w-xs w-full shadow-2xl scale-100 animate-in zoom-in-95 duration-200">
              <div className="text-center mb-6">
                  <div className="w-16 h-16 bg-[#EF4444]/10 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Lock className="text-[#EF4444] w-8 h-8" />
                  </div>
                  <h2 className="text-xl font-black text-[#1F2937]">Acceso Restringido</h2>
                  <p className="text-xs text-[#6B7280] mt-1">Ingresa el PIN Maestro para continuar</p>
              </div>
              
              <div className="mb-6">
                  <div className="flex justify-center gap-3 mb-2">
                      {[0,1,2,3].map(i => (
                          <div key={i} className={`w-4 h-4 rounded-full transition-all ${pinInput.length > i ? 'bg-[#0B3B68] scale-110' : 'bg-gray-200'}`}></div>
                      ))}
                  </div>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-6">
                  {[1,2,3,4,5,6,7,8,9].map(num => (
                      <button key={num} onClick={() => { if(pinInput.length < 4) setPinInput(pinInput + num) }} className="py-4 bg-gray-50 hover:bg-gray-100 rounded-xl text-xl font-black text-[#1F2937] transition-colors active:scale-95">
                          {num}
                      </button>
                  ))}
                  <button onClick={() => { setPinModal({isOpen: false, action: null}); setPinInput(''); }} className="py-4 bg-red-50 hover:bg-red-100 rounded-xl text-red-500 font-bold transition-colors flex items-center justify-center">
                      <X size={24}/>
                  </button>
                  <button onClick={() => { if(pinInput.length < 4) setPinInput(pinInput + '0') }} className="py-4 bg-gray-50 hover:bg-gray-100 rounded-xl text-xl font-black text-[#1F2937] transition-colors active:scale-95">
                      0
                  </button>
                  <button onClick={() => setPinInput(pinInput.slice(0, -1))} className="py-4 bg-gray-50 hover:bg-gray-100 rounded-xl text-[#6B7280] font-bold transition-colors flex items-center justify-center">
                      <ArrowLeft size={24}/>
                  </button>
              </div>

              <button 
                  onClick={() => {
                      if (pinInput === masterPin) {
                          if (pinModal.action === 'out') { setMovementType('out'); setAmount(''); }
                          if (pinModal.action === 'close') { setIsClosing(true); setAmount(''); }
                          if (pinModal.action === 'void_sale' && pinModal.data) { handleVoidSale(pinModal.data); }
                          setPinModal({isOpen: false, action: null, data: null}); 
                          setPinInput('');
                      } else {
                          toast.error('PIN Incorrecto');
                          setPinInput('');
                      }
                  }}
                  disabled={pinInput.length < 4}
                  className="w-full py-4 bg-[#0B3B68] text-white font-bold rounded-xl shadow-lg transition-all active:scale-[0.98] disabled:opacity-50"
              >
                  VERIFICAR
              </button>
           </div>
        </div>
      )}

      {/* MODAL MOVIMIENTOS */}
      {movementType && (
        <div className="fixed inset-0 bg-[#0B3B68]/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
                <div className="flex justify-between items-center mb-4">
                    <h2 className={`text-xl font-black flex items-center gap-2 ${movementType === 'in' ? 'text-[#7AC142]' : 'text-[#EF4444]'}`}>
                        {movementType === 'in' ? 'INGRESO' : 'RETIRO'}
                    </h2>
                    <button onClick={() => { setMovementType(null); setAmount(''); setReason(''); }}><X /></button>
                </div>
                <div className="space-y-4">
                    <div>
                        <label className="block text-[10px] font-bold text-[#6B7280] uppercase mb-1">Monto</label>
                        <input type="number" step="0.01" autoFocus value={amount} onChange={e => setAmount(e.target.value)} onKeyDown={(e) => { if(e.key === 'Enter') { e.preventDefault(); handleMovement(); } }} className="w-full p-3 border rounded-xl font-bold text-lg" />
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold text-[#6B7280] uppercase mb-1">Motivo</label>
                        <input type="text" value={reason} onChange={e => setReason(e.target.value)} onKeyDown={(e) => { if(e.key === 'Enter') handleMovement(); }} className="w-full p-3 border rounded-xl" />
                    </div>
                    <button type="button" onClick={handleMovement} disabled={isLoading || amount === '' || reason === ''} className="w-full py-3.5 font-bold text-white rounded-xl bg-[#0B3B68]">
                        CONFIRMAR
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* MODAL CIERRE */}
      {isClosing && shiftStats && (
        <div className="fixed inset-0 bg-[#0B3B68]/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-2xl p-0 max-w-md w-full shadow-2xl overflow-hidden">
                <div className="bg-[#0B3B68] p-6 text-white flex justify-between items-center">
                    <h2 className="text-xl font-black flex items-center gap-2"><Lock className="text-[#7AC142]"/> CORTE DE CAJA</h2>
                    <button onClick={() => setIsClosing(false)}><X className="text-gray-400 hover:text-white"/></button>
                </div>
                <div className="p-6">
                    <div className="bg-gray-50 p-4 rounded-xl mb-6 border">
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-xs font-bold text-[#6B7280] uppercase">Efectivo Esperado</span>
                            <span className="text-lg font-black text-[#1F2937]">{formatMoney(shiftStats.expectedCash)}</span>
                        </div>
                    </div>
                    <div className="mb-6">
                        <label className="block text-xs font-bold text-[#6B7280] uppercase mb-2">Dinero en Caja (Conteo Real)</label>
                        <input type="number" step="0.01" autoFocus value={amount} onChange={e => setAmount(e.target.value)} onKeyDown={(e) => { if(e.key === 'Enter') handleCloseShift(); }} className="w-full pl-12 pr-4 py-4 text-3xl font-black border-2 rounded-xl" />
                    </div>
                    <button type="button" onClick={handleCloseShift} disabled={isLoading || amount === ''} className="w-full py-4 bg-[#0B3B68] text-white font-bold rounded-xl">
                        FINALIZAR TURNO
                    </button>
                </div>
            </div>
        </div>
      )}

      {selectedTicket && <TicketModal sale={selectedTicket} onClose={() => setSelectedTicket(null)} />}
    </div>
  );
}