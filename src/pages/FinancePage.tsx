import { useState, useMemo, useEffect, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Sale, type Product, type CashShift, type CashMovement, type Staff, type InventoryMovement, type RefundedItem } from '../lib/db';
import { addToQueue, syncPull, syncPush, isOnline } from '../lib/sync';
import { hashPin, verifyPin, isPinHashed } from '../lib/pin';
import { supabase } from '../lib/supabase';
import { logAuditAction } from '../lib/audit';
import { currency } from '../lib/currency';
import { TicketModal } from '../components/TicketModal';
import { toast } from 'sonner';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line, Area, AreaChart
} from 'recharts';
import {
  Calendar, CalendarRange, TrendingUp, ArrowLeft, ArrowRight, RefreshCw,
  BarChart3, DollarSign, Wallet, PieChart as PieChartIcon, ClipboardCheck,
  Printer, Trophy, Lock, Unlock, PlusCircle, MinusCircle, ShoppingBag, Loader2, X,
  ArrowRightLeft, History, Ban, TrendingDown, Users, Hash, Download, RotateCcw, Package
} from 'lucide-react';

const EMPTY_ARRAY: never[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const safeFloat = (val: any): number => {
  const num = parseFloat(val);
  return isNaN(num) ? 0 : num;
};

// Devuelve la fecha LOCAL en formato YYYY-MM-DD (no UTC).
// Crítico para Cuba (UTC-5/-4): una venta a las 11pm local se guarda como
// el día siguiente en UTC, así que nunca comparar sale.date (UTC) con hoy en UTC.
const localDateStr = (d: Date = new Date()): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Compara la fecha LOCAL de una venta (guardada en UTC ISO) con un string YYYY-MM-DD local.
const saleMatchesLocalDate = (saleDate: string, localDay: string): boolean =>
  localDateStr(new Date(saleDate)) === localDay;

export function FinancePage() {
  const { currentStaff } = useOutletContext<{ currentStaff: Staff }>();

  const isAdmin = currentStaff?.role === 'admin';

  const [viewMode, setViewMode] = useState<'control' | 'history' | 'daily' | 'trends' | 'closing'>('control');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [movementType, setMovementType] = useState<'in' | 'out' | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  // Captura los stats del turno al iniciar el cierre para evitar que el modal
  // desaparezca cuando db.cash_shifts.update() dispara el useLiveQuery
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [closingShiftStats, setClosingShiftStats] = useState<any>(null);
  const [transferCount, setTransferCount] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // Confirmación antes de abrir el PIN para anular ventas
  const [voidConfirmSale, setVoidConfirmSale] = useState<Sale | null>(null);

  // Devolución parcial
  const [refundSale, setRefundSale] = useState<Sale | null>(null);
  const [refundSelections, setRefundSelections] = useState<Record<string, number>>({});

  // ESTADOS DEL PIN PAD (Incluye 'void_sale' para anular ventas)
  const [pinModal, setPinModal] = useState<{isOpen: boolean, action: 'out' | 'close' | 'void_sale' | null, data?: any}>({isOpen: false, action: null});
  const [pinInput, setPinInput] = useState('');

  // PROTECCIÓN BRUTE-FORCE: máx 3 intentos, bloqueo 5 min
  const pinAttemptsRef = useRef(0);
  const pinLockedUntilRef = useRef(0);
  const [pinLockSecondsLeft, setPinLockSecondsLeft] = useState(0);

  // Actualizar contador de segundos restantes del bloqueo
  useEffect(() => {
    if (pinLockSecondsLeft <= 0) return;
    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((pinLockedUntilRef.current - Date.now()) / 1000));
      setPinLockSecondsLeft(left);
      if (left === 0) pinAttemptsRef.current = 0;
    }, 1000);
    return () => clearInterval(timer);
  }, [pinLockSecondsLeft]);

  const today = localDateStr(); // fecha local, no UTC
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedTicket, setSelectedTicket] = useState<Sale | null>(null);
  const [trendFilter, setTrendFilter] = useState<'week' | 'month'>('week');

  // Reportes por rango de fechas
  const [reportMode, setReportMode] = useState<'day' | 'range'>('day');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return localDateStr(d);
  });
  const [dateTo, setDateTo] = useState(today);

  const businessSettings = useLiveQuery(() => db.settings.toArray());
  // null si no está configurado → nunca coincide con entrada del usuario
  // (evita que todos los negocios sin PIN usen el mismo '1234' por defecto)
  const masterPin = businessSettings?.[0]?.master_pin || null;

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

    // En modo rango, cargar datos suficientes para cubrir el rango seleccionado
    const cutoffDays = (viewMode === 'daily' && reportMode === 'range') ? 90 : 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - cutoffDays);

    return await db.sales.where('business_id').equals(bId).filter(s => s.date >= cutoff.toISOString()).reverse().sortBy('date');
  }, [viewMode, reportMode]) || EMPTY_ARRAY;

  useEffect(() => {
    if (activeShift !== undefined) {
      setIsInitialLoad(false);
    }
  }, [activeShift]);

  // Vendedores solo pueden ver 'control' y 'closing'
  useEffect(() => {
    if (!isAdmin && (viewMode === 'history' || viewMode === 'daily' || viewMode === 'trends')) {
      setViewMode('control');
    }
  }, [isAdmin, viewMode]);

  const shiftStats = useMemo(() => {
    if (!activeShift || !shiftData || !shiftData.sales || !shiftData.movements) return null;

    const startAmount = safeFloat(activeShift.start_amount);
    // Ignoramos ventas anuladas para no contarlas como ganancia en caja
    const validSales = shiftData.sales.filter(s => s.status !== 'voided');

    const totalSales = validSales.reduce((sum, s) => sum + safeFloat(s.total), 0);
    const cashSales = validSales.reduce((sum, s) => {
      const m = s.payment_method?.toLowerCase() || 'efectivo';
      if (m === 'efectivo') return sum + safeFloat(s.total);
      if (m === 'mixto') return sum + safeFloat(s.cash_amount || 0);
      return sum;
    }, 0);
    const transferSales = validSales.reduce((sum, s) => {
      const m = s.payment_method?.toLowerCase() || 'efectivo';
      if (m === 'transferencia' || m === 'transfer') return sum + safeFloat(s.total);
      if (m === 'mixto') return sum + safeFloat(s.transfer_amount || 0);
      return sum;
    }, 0);

    const cashIn = shiftData.movements.filter(m => m.type === 'in').reduce((sum, m) => sum + safeFloat(m.amount), 0);
    const cashOut = shiftData.movements.filter(m => m.type === 'out').reduce((sum, m) => sum + safeFloat(m.amount), 0);
    const expectedCash = (startAmount + cashSales + cashIn) - cashOut;

    // Desglose por vendedor en el turno activo
    const byStaff: Record<string, { count: number, total: number }> = {};
    validSales.forEach(s => {
      const key = s.staff_name || 'Sin asignar';
      if (!byStaff[key]) byStaff[key] = { count: 0, total: 0 };
      byStaff[key].count++;
      byStaff[key].total += safeFloat(s.total);
    });
    const staffList = Object.entries(byStaff).map(([name, d]) => ({ name, ...d })).sort((a, b) => b.total - a.total);

    // Mini gráfico por hora del turno actual
    const shiftHourly: Record<string, number> = {};
    for (let i = 0; i <= 23; i++) shiftHourly[i.toString().padStart(2, '0')] = 0;
    validSales.forEach(s => {
      const h = new Date(s.date).getHours().toString().padStart(2, '0');
      shiftHourly[h] = (shiftHourly[h] || 0) + safeFloat(s.total);
    });
    // Solo mostrar horas con actividad o rango relevante
    const openHour = new Date(activeShift.opened_at).getHours();
    const nowHour = new Date().getHours();
    const hourlyChart = Array.from({ length: nowHour - openHour + 1 }, (_, i) => {
      const h = (openHour + i).toString().padStart(2, '0');
      return { h: h + ':00', v: shiftHourly[h] || 0 };
    });

    return { startAmount, cashSales, transferSales, totalSales, cashIn, cashOut, expectedCash, staffList, hourlyChart };
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

  // Helper: filtra ventas según modo día o rango
  const saleMatchesRange = (saleDate: string): boolean => {
    const local = localDateStr(new Date(saleDate));
    return local >= dateFrom && local <= dateTo;
  };

  const dailyStats = useMemo(() => {
    const salesForDay = reportMode === 'range'
      ? allSales.filter((sale) => saleMatchesRange(sale.date) && sale.status !== 'voided')
      : allSales.filter((sale) => saleMatchesLocalDate(sale.date, selectedDate) && sale.status !== 'voided');
    let revenue = 0, cost = 0;
    const hourlyCounts: Record<string, number> = {};
    const categoryCounts: Record<string, number> = {};
    const productCounts: Record<string, number> = {};
    // En modo rango: agrupar ventas por día para el gráfico de barras
    const dailyCounts: Record<string, number> = {};

    for (let i = 7; i <= 23; i++) hourlyCounts[i.toString().padStart(2, '0') + ":00"] = 0;

    salesForDay.forEach((sale) => {
      const saleTotal = safeFloat(sale.total);
      revenue += saleTotal;
      const saleDate = new Date(sale.date);
      if (!isNaN(saleDate.getTime())) {
          const h = saleDate.getHours().toString().padStart(2, '0') + ":00";
          if (hourlyCounts[h] !== undefined) hourlyCounts[h] += saleTotal;
          // Agrupar por día para gráfico de rango
          if (reportMode === 'range') {
            const dayKey = saleDate.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' });
            dailyCounts[dayKey] = (dailyCounts[dayKey] || 0) + saleTotal;
          }
      }
      (sale.items || []).forEach((item) => {
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
    const rangeChartData = Object.entries(dailyCounts).map(([date, total]) => ({ date, total }));
    const pieData = Object.entries(categoryCounts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

    // Top 5 productos por cantidad
    const topProducts = Object.entries(productCounts)
      .map(([name, qty]) => ({ name, qty, revenue: categoryCounts[name] || 0 }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);

    // Desglose por método de pago
    const paymentBreakdown = { efectivo: 0, transferencia: 0, tarjeta: 0 };
    salesForDay.forEach(s => {
      const m = s.payment_method?.toLowerCase() || 'efectivo';
      if (m === 'efectivo') paymentBreakdown.efectivo += safeFloat(s.total);
      else if (m === 'transferencia' || m === 'transfer') paymentBreakdown.transferencia += safeFloat(s.total);
      else if (m === 'tarjeta') paymentBreakdown.tarjeta += safeFloat(s.total);
      else if (m === 'mixto') {
        paymentBreakdown.efectivo += safeFloat(s.cash_amount || 0);
        paymentBreakdown.transferencia += safeFloat(s.transfer_amount || 0);
      }
    });

    // Promedio diario (solo para modo rango)
    const daysInRange = reportMode === 'range'
      ? Math.max(1, Math.round((new Date(dateTo + 'T23:59').getTime() - new Date(dateFrom + 'T00:00').getTime()) / 86400000) + 1)
      : 1;
    const dailyAvg = revenue / daysInRange;

    // Desglose por vendedor (para modo rango)
    const staffCounts: Record<string, { count: number; total: number }> = {};
    salesForDay.forEach(s => {
      const name = s.staff_name || 'Sin asignar';
      if (!staffCounts[name]) staffCounts[name] = { count: 0, total: 0 };
      staffCounts[name].count++;
      staffCounts[name].total += safeFloat(s.total);
    });
    const staffList = Object.entries(staffCounts).map(([name, d]) => ({ name, ...d })).sort((a, b) => b.total - a.total);

    return { sales: salesForDay, revenue, profit, cost, margin, chartData, rangeChartData, pieData, bestSeller, topProducts, paymentBreakdown, dailyAvg, daysInRange, staffList };
  }, [allSales, selectedDate, productMeta, reportMode, dateFrom, dateTo]);

  const closingStats = useMemo(() => {
    let cashTotal = 0, transferTotal = 0, cardTotal = 0;
    const productSummary: Record<string, { quantity: number, total: number }> = {};
    const staffSummary: Record<string, { count: number, total: number }> = {};

    dailyStats.sales.forEach((sale) => {
      const saleTotal = safeFloat(sale.total);
      const method = sale.payment_method?.toLowerCase() || 'efectivo';
      if (method === 'efectivo') cashTotal += saleTotal;
      else if (method === 'tarjeta') cardTotal += saleTotal;
      else if (method === 'mixto') {
        cashTotal += safeFloat(sale.cash_amount || 0);
        transferTotal += safeFloat(sale.transfer_amount || 0);
      }
      else transferTotal += saleTotal;

      (sale.items || []).forEach((item) => {
        if (!productSummary[item.name]) productSummary[item.name] = { quantity: 0, total: 0 };
        productSummary[item.name].quantity += safeFloat(item.quantity);
        productSummary[item.name].total += (safeFloat(item.price) * safeFloat(item.quantity));
      });

      // Desglose por vendedor
      const sellerName = sale.staff_name || 'Sin asignar';
      if (!staffSummary[sellerName]) staffSummary[sellerName] = { count: 0, total: 0 };
      staffSummary[sellerName].count++;
      staffSummary[sellerName].total += saleTotal;
    });

    const productsList = Object.entries(productSummary).map(([name, data]) => ({ name, ...data })).sort((a, b) => b.quantity - a.quantity);
    const staffList = Object.entries(staffSummary).map(([name, data]) => ({ name, ...data })).sort((a, b) => b.total - a.total);
    return { cashTotal, transferTotal, cardTotal, productsList, staffList, ticketCount: dailyStats.sales.length };
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
      (sale.items || []).forEach((i) => {
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

    // Top 5 productos del período
    const productAgg: Record<string, { qty: number; revenue: number }> = {};
    filteredSales.forEach(sale => {
      (sale.items || []).forEach(item => {
        if (!productAgg[item.name]) productAgg[item.name] = { qty: 0, revenue: 0 };
        productAgg[item.name].qty += safeFloat(item.quantity);
        productAgg[item.name].revenue += safeFloat(item.custom_price ?? item.price) * safeFloat(item.quantity);
      });
    });
    const topProducts = Object.entries(productAgg)
      .map(([name, d]) => ({ name, ...d }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    return { totalRevenue, totalCost, totalProfit, totalMargin, chartData, count: filteredSales.length, topProducts };
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
            // Fix: Prevenir turnos simultáneos (race condition multi-dispositivo)
            const existingOpen = await db.cash_shifts.where({ business_id: bId, status: 'open' }).first();
            if (existingOpen) throw new Error('Ya existe un turno abierto. Ciérralo primero.');

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
    if (!currentShift) { toast.error('No hay turno activo para cerrar.'); return; }
    const stats = shiftStats || closingShiftStats;
    if (!stats)        { toast.error('Los datos del turno aún están cargando. Intenta de nuevo.'); return; }

    const finalCashCount = safeFloat(amount);
    const finalTransferCount = safeFloat(transferCount);

    setIsLoading(true);
    try {
        const { bId, sId } = await getActiveCredentials();
        const safeBid = bId || currentShift.business_id;
        const cashDiff = currency.subtract(finalCashCount, stats.expectedCash);
        const transferDiff = currency.subtract(finalTransferCount, stats.transferSales);
        const closedAt = new Date().toISOString();
        const staffPayload = { id: sId, name: currentStaff?.name || 'Cajero', business_id: safeBid };

        // Transacción mínima: SOLO actualizar el turno en IndexedDB
        // addToQueue y logAuditAction se hacen FUERA para evitar conflictos
        // con transacciones paralelas del sync periódico en Electron/IndexedDB
        await db.cash_shifts.update(currentShift.id, {
            end_amount: finalCashCount,
            difference: cashDiff,
            expected_amount: stats.expectedCash,
            transfer_expected: stats.transferSales,
            transfer_count: finalTransferCount,
            transfer_difference: transferDiff,
            closed_at: closedAt,
            status: 'closed',
            sync_status: 'pending_update'
        });

        // Encolar y auditar fuera de la transacción
        const closedShift = await db.cash_shifts.get(currentShift.id);
        if (closedShift) await addToQueue('SHIFT', closedShift);

        await logAuditAction('CLOSE_SHIFT', {
          expected_cash: stats.expectedCash, real_cash: finalCashCount, cash_diff: cashDiff,
          expected_transfer: stats.transferSales, real_transfer: finalTransferCount, transfer_diff: transferDiff,
        }, staffPayload as any);

        const totalDiff = cashDiff + transferDiff;
        toast.success(`Caja cerrada. Diferencia total: ${formatMoney(totalDiff)}`);
        setIsClosing(false); setClosingShiftStats(null); setAmount(''); setTransferCount('');
        syncPush().catch(() => {});
    } catch (error) {
        console.error('Error cerrando turno:', error);
        toast.error(`Error al cerrar caja: ${error instanceof Error ? error.message : 'Error desconocido'}`);
    } finally {
        setIsLoading(false);
    }
  };

  // ✅ NUEVA FUNCIÓN: ANULAR VENTA Y DEVOLVER INVENTARIO
  const handleVoidSale = async (sale: Sale) => {
      // Fix: Prevenir doble anulación
      if (sale.status === 'voided') {
          toast.error('Esta venta ya fue anulada.');
          return;
      }
      // Verificar que hay un turno abierto — sin turno activo no se puede registrar el reembolso
      if (!activeShift) {
          toast.error('Debes tener un turno de caja abierto para anular ventas.');
          return;
      }
      setIsLoading(true);
      try {
          const { bId, sId } = await getActiveCredentials();
          const safeBid = bId || sale.business_id;

          await db.transaction('rw', [db.sales, db.products, db.movements, db.cash_movements, db.customers, db.action_queue, db.audit_logs], async () => {
              // Fix: Verificar estado dentro de la transacción (previene race condition multi-dispositivo)
              const freshSale = await db.sales.get(sale.id);
              if (!freshSale || freshSale.status === 'voided') throw new Error('Esta venta ya fue anulada.');

              // 1. Marcar venta como anulada
              await db.sales.update(sale.id, { status: 'voided', sync_status: 'pending_update' });
              await addToQueue('VOID_SALE', { saleId: sale.id });

              // 2. Revertir puntos de lealtad si la venta tenía cliente
              if (sale.customer_id) {
                  const customer = await db.customers.get(sale.customer_id);
                  if (customer) {
                      // Quitar puntos ganados en esta venta y devolver los canjeados
                      const pointsEarned = Math.floor(safeFloat(sale.total) / 10);
                      const pointsRedeemed = sale.redeemed_points || 0;
                      await db.customers.update(sale.customer_id, {
                          loyalty_points: Math.max(0, (customer.loyalty_points || 0) - pointsEarned + pointsRedeemed),
                          sync_status: 'pending_update'
                      });
                  }
              }

              // 3. Devolver stock de cada producto
              for (const item of (sale.items || [])) {
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

  // ── DEVOLUCIÓN PARCIAL ────────────────────────────────────
  const openRefundModal = (sale: Sale) => {
    setRefundSale(sale);
    const selections: Record<string, number> = {};
    (sale.items || []).forEach(item => { selections[item.product_id] = 0; });
    setRefundSelections(selections);
  };

  const refundTotal = refundSale
    ? (refundSale.items || []).reduce((sum, item) => {
        const qty = refundSelections[item.product_id] || 0;
        return sum + (qty * (item.custom_price ?? item.price));
      }, 0)
    : 0;

  const handlePartialRefund = async () => {
    if (!refundSale || !activeShift || refundTotal <= 0) return;
    setIsLoading(true);
    try {
      const { bId, sId } = await getActiveCredentials();
      const safeBid = bId || refundSale.business_id;
      const staffPayload = { id: sId, name: currentStaff?.name || 'Cajero', business_id: safeBid };

      const itemsToRefund = (refundSale.items || []).filter(item => (refundSelections[item.product_id] || 0) > 0);
      if (itemsToRefund.length === 0) { toast.error('Selecciona al menos un producto'); setIsLoading(false); return; }

      const refundedItems: RefundedItem[] = itemsToRefund.map(item => ({
        product_id: item.product_id,
        name: item.name,
        quantity: refundSelections[item.product_id],
        amount: refundSelections[item.product_id] * (item.custom_price ?? item.price),
        date: new Date().toISOString()
      }));

      await db.transaction('rw', [db.sales, db.products, db.movements, db.cash_movements, db.customers, db.action_queue, db.audit_logs], async () => {
        // Fix: Verificar cantidades dentro de la transacción (previene race condition)
        const freshSale = await db.sales.get(refundSale.id);
        if (!freshSale || freshSale.status === 'voided') throw new Error('Esta venta ya fue anulada.');
        const existingRefunds = freshSale.refunded_items || [];
        for (const ri of refundedItems) {
          const originalItem = (freshSale.items || []).find(i => i.product_id === ri.product_id);
          const alreadyRefunded = existingRefunds.filter(r => r.product_id === ri.product_id).reduce((s, r) => s + r.quantity, 0);
          const maxAllowed = (originalItem?.quantity || 0) - alreadyRefunded;
          if (ri.quantity > maxAllowed) throw new Error(`No se pueden devolver ${ri.quantity} unidades de "${ri.name}" (máx: ${maxAllowed})`);
        }

        // 1. Devolver stock por cada item
        for (const ri of refundedItems) {
          const product = await db.products.get(ri.product_id);
          if (product) {
            const newStock = product.stock + ri.quantity;
            await db.products.update(ri.product_id, { stock: newStock, sync_status: 'pending_update' });
            await addToQueue('PRODUCT_SYNC', { ...product, stock: newStock, sync_status: 'pending_update' });

            const mov: InventoryMovement = {
              id: crypto.randomUUID(), business_id: safeBid, product_id: ri.product_id,
              qty_change: ri.quantity, reason: `Devolución parcial - Venta #${refundSale.id.slice(0, 6)}`,
              created_at: new Date().toISOString(), staff_id: sId, sync_status: 'pending_create'
            };
            await db.movements.add(mov);
            await addToQueue('MOVEMENT', mov);
          }
        }

        // 2. Movimiento de caja (reembolso) si fue efectivo/mixto
        if (['efectivo', 'mixto'].includes(refundSale.payment_method)) {
          const cashMov: CashMovement = {
            id: crypto.randomUUID(), shift_id: activeShift.id, business_id: safeBid,
            type: 'out', amount: refundTotal,
            reason: `Devolución parcial - Venta #${refundSale.id.slice(0, 6)}`,
            staff_id: sId, created_at: new Date().toISOString(), sync_status: 'pending_create'
          };
          await db.cash_movements.add(cashMov);
          await addToQueue('CASH_MOVEMENT', cashMov);
        }

        // 3. Revertir puntos de lealtad proporcionalmente
        if (refundSale.customer_id) {
          const customer = await db.customers.get(refundSale.customer_id);
          if (customer) {
            const pointsToRevert = Math.floor(refundTotal / 10);
            if (pointsToRevert > 0) {
              await db.customers.update(refundSale.customer_id, {
                loyalty_points: Math.max(0, (customer.loyalty_points || 0) - pointsToRevert),
                sync_status: 'pending_update'
              });
            }
          }
        }

        // 4. Actualizar venta con items devueltos (usa existingRefunds del freshSale)
        const allRefunds = [...existingRefunds, ...refundedItems];
        await db.sales.update(refundSale.id, {
          status: 'partial_refund',
          refunded_items: allRefunds,
          sync_status: 'pending_update'
        });
        await addToQueue('PARTIAL_REFUND', { saleId: refundSale.id, refunded_items: allRefunds });

        // 5. Audit
        await logAuditAction('PARTIAL_REFUND', {
          sale_id: refundSale.id, refund_amount: refundTotal,
          items: refundedItems.map(i => `${i.name} x${i.quantity}`)
        }, staffPayload as any);
      });

      toast.success(`Devolución de ${currency.format(refundTotal)} procesada`);
      setRefundSale(null);
      syncPush().catch(() => {});
    } catch (error) {
      console.error(error);
      toast.error('Error al procesar la devolución');
    } finally {
      setIsLoading(false);
    }
  };

  const changeDate = (days: number) => {
    // Parsear YYYY-MM-DD como fecha local (agregar T00:00 evita que JS lo interprete como UTC)
    const d = new Date(selectedDate + 'T00:00');
    d.setDate(d.getDate() + days);
    const newStr = localDateStr(d);
    if (newStr <= today) setSelectedDate(newStr);
  };
  
  const handleExportCSV = () => {
    if (!allSales.length) { toast.error('No hay ventas para exportar'); return; }
    const header = ['ID', 'Fecha', 'Hora', 'Método', 'Estado', 'Vendedor', 'Cliente', 'Items', 'Total'];
    const rows = allSales.map(s => [
      s.id.slice(0, 8).toUpperCase(),
      new Date(s.date).toLocaleDateString(),
      new Date(s.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      s.payment_method,
      s.status || 'completed',
      s.staff_name || '',
      s.customer_name || '',
      (s.items || []).map(i => `${i.quantity}x ${i.name}`).join(' | '),
      safeFloat(s.total).toFixed(2)
    ]);
    const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Ventas_${localDateStr()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Reporte CSV descargado');
  };

  // En Electron usar el IPC nativo (evita el "no admite vista previa" de Chromium)
  const handlePrint = () => {
    if (window.electronAPI) {
      window.electronAPI.printTicket();
    } else {
      window.print();
    }
  };
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
          {isAdmin && (
            <>
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
            </>
          )}
          <div className="w-px h-6 bg-gray-200 mx-1 self-center"></div>
          <button onClick={() => setViewMode('closing')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${viewMode === 'closing' ? 'bg-[#1F2937] text-white shadow-md' : 'text-[#6B7280] hover:bg-gray-50'}`}>
            <ClipboardCheck size={16} /> Corte Z
          </button>
        </div>
      </div>

      {viewMode === 'control' && shiftStats && (
        <div className="animate-in slide-in-from-bottom-4 duration-300 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
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
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
               <p className="text-[#F59E0B] text-[10px] font-bold uppercase tracking-wider mb-1">Ventas Transferencia</p>
               <h3 className="text-2xl font-black text-[#F59E0B]">+{formatMoney(shiftStats.transferSales)}</h3>
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

          {/* MINI GRÁFICO ACTIVIDAD DEL TURNO */}
          {shiftStats.hourlyChart.length > 1 && shiftStats.totalSales > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
              <h3 className="font-bold text-[#1F2937] text-sm flex items-center gap-2 mb-4">
                <BarChart3 size={16} className="text-[#0B3B68]"/> Actividad del Turno por Hora
              </h3>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={shiftStats.hourlyChart} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="shiftGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0B3B68" stopOpacity={0.15}/>
                        <stop offset="95%" stopColor="#0B3B68" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/>
                    <XAxis dataKey="h" fontSize={9} axisLine={false} tickLine={false} tick={{ fill: '#94a3b8' }}/>
                    <YAxis fontSize={9} axisLine={false} tickLine={false} tick={{ fill: '#94a3b8' }} tickFormatter={v => v === 0 ? '' : `$${v}`} width={36}/>
                    <Tooltip
                      contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: '11px' }}
                      formatter={(v: number) => [formatMoney(v), 'Ventas']}
                    />
                    <Area type="monotone" dataKey="v" stroke="#0B3B68" strokeWidth={2} fill="url(#shiftGrad)" dot={false} activeDot={{ r: 4, fill: '#0B3B68' }}/>
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {shiftStats.staffList.length > 1 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
              <h3 className="font-bold text-[#1F2937] text-sm flex items-center gap-2 mb-4">
                <Trophy size={16} className="text-[#7AC142]"/> Ventas por Vendedor (Turno Actual)
              </h3>
              <div className="space-y-2">
                {shiftStats.staffList.map((s, i) => {
                  const pct = shiftStats.totalSales > 0 ? (s.total / shiftStats.totalSales) * 100 : 0;
                  return (
                    <div key={i} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
                      <div className="w-7 h-7 rounded-lg bg-[#0B3B68]/10 text-[#0B3B68] flex items-center justify-center text-[10px] font-black flex-shrink-0">
                        {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : s.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center mb-1">
                          <p className="text-xs font-bold text-[#1F2937] truncate">{s.name}</p>
                          <span className="font-black text-xs text-[#7AC142] flex-shrink-0 ml-2">{formatMoney(s.total)}</span>
                        </div>
                        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-[#7AC142] transition-all" style={{ width: `${pct}%` }}/>
                        </div>
                        <p className="text-[9px] text-[#6B7280] mt-0.5">{s.count} venta{s.count !== 1 ? 's' : ''} · {pct.toFixed(0)}%</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
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
                  <button
                    onClick={handleExportCSV}
                    className="flex items-center gap-2 px-3 py-2 bg-[#7AC142]/10 text-[#7AC142] border border-[#7AC142]/20 rounded-xl text-xs font-bold hover:bg-[#7AC142]/20 transition-colors"
                    title="Exportar a CSV"
                  >
                    <Download size={14}/> CSV
                  </button>
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
                              <tr key={sale.id} className={`transition-colors ${sale.status === 'voided' ? 'bg-red-50/50 opacity-60' : sale.status === 'stock_conflict' ? 'bg-orange-50/60' : sale.status === 'partial_refund' ? 'bg-amber-50/40' : 'hover:bg-gray-50'}`}>
                                  <td className="p-4 font-mono text-[#6B7280]">
                                      {new Date(sale.date).toLocaleDateString()} <span className="ml-2">{new Date(sale.date).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                                  </td>
                                  <td className="p-4 uppercase text-xs font-bold text-[#1F2937]">{sale.payment_method}</td>
                                  <td className="p-4 text-center">
                                      {sale.status === 'voided'
                                          ? <span className="bg-red-100 text-red-600 px-3 py-1 rounded-full text-[10px] font-black uppercase">Anulada</span>
                                          : sale.status === 'stock_conflict'
                                          ? <span className="bg-orange-100 text-orange-700 px-3 py-1 rounded-full text-[10px] font-black uppercase">⚠ Stock Insuficiente</span>
                                          : sale.status === 'partial_refund'
                                          ? <span className="bg-amber-100 text-amber-700 px-3 py-1 rounded-full text-[10px] font-black uppercase">Dev. Parcial</span>
                                          : <span className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-[10px] font-black uppercase">Completada</span>
                                      }
                                  </td>
                                  <td className="p-4 text-right font-black text-[#1F2937]">{formatMoney(sale.total)}</td>
                                  <td className="p-4">
                                      <div className="flex justify-center gap-2">
                                          <button onClick={() => setSelectedTicket(sale)} className="px-3 py-1.5 bg-gray-100 text-[#1F2937] rounded-lg font-bold text-xs hover:bg-gray-200 transition-colors">Ver</button>
                                          {sale.status === 'stock_conflict' && (
                                              <>
                                              <button
                                                onClick={async () => {
                                                  try {
                                                    await db.sales.update(sale.id, { status: 'completed' as any, sync_status: 'pending_update' });
                                                    await addToQueue('SALE', { sale: { ...sale, status: 'completed', sync_status: 'pending_update' }, items: sale.items || [] });
                                                    toast.success('Venta aceptada. El stock puede quedar negativo — ajústalo manualmente.', { duration: 5000 });
                                                    syncPush().catch(() => {});
                                                  } catch {
                                                    toast.error('Error al aceptar la venta');
                                                  }
                                                }}
                                                className="px-3 py-1.5 bg-green-50 text-green-700 rounded-lg font-bold text-xs hover:bg-green-100 transition-colors"
                                                title="Aceptar venta con stock negativo"
                                              >
                                                Aceptar
                                              </button>
                                              <button
                                                onClick={() => setVoidConfirmSale(sale)}
                                                className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg font-bold text-xs hover:bg-red-100 transition-colors flex items-center gap-1"
                                                title="Anular venta y devolver stock"
                                              >
                                                <Ban size={12}/> Anular
                                              </button>
                                              </>
                                          )}
                                          {(sale.status === 'completed' || sale.status === 'partial_refund') && (
                                              <>
                                              <button onClick={() => openRefundModal(sale)} className="px-3 py-1.5 bg-amber-50 text-amber-700 rounded-lg font-bold text-xs hover:bg-amber-100 transition-colors flex items-center gap-1">
                                                  <RotateCcw size={12}/> Devolución
                                              </button>
                                              <button onClick={() => setVoidConfirmSale(sale)} className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg font-bold text-xs hover:bg-red-100 transition-colors flex items-center gap-1">
                                                  <Ban size={12}/> Anular
                                              </button>
                                              </>
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
          {/* Selector: Día / Rango */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-3">
            <div className="flex items-center gap-2">
              <div className="flex bg-white p-1 rounded-xl border border-gray-200 shadow-sm">
                <button onClick={() => setReportMode('day')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${reportMode === 'day' ? 'bg-[#0B3B68] text-white shadow-md' : 'text-[#6B7280] hover:bg-gray-50'}`}>
                  <Calendar size={14}/> Día
                </button>
                <button onClick={() => setReportMode('range')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${reportMode === 'range' ? 'bg-[#0B3B68] text-white shadow-md' : 'text-[#6B7280] hover:bg-gray-50'}`}>
                  <CalendarRange size={14}/> Rango
                </button>
              </div>

              {reportMode === 'day' ? (
                <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-gray-200 shadow-sm">
                  <button onClick={() => changeDate(-1)} className="p-2 hover:bg-gray-100 rounded-lg text-[#6B7280]"><ArrowLeft size={18} /></button>
                  <input type="date" value={selectedDate} max={today} onChange={(e) => e.target.value && setSelectedDate(e.target.value)} className="bg-transparent text-[#1F2937] font-bold outline-none cursor-pointer text-sm" />
                  <button onClick={() => changeDate(1)} disabled={selectedDate >= today} className="p-2 hover:bg-gray-100 rounded-lg text-[#6B7280] disabled:opacity-30"><ArrowRight size={18} /></button>
                </div>
              ) : (
                <div className="flex items-center gap-2 bg-white p-2 rounded-xl border border-gray-200 shadow-sm">
                  <input type="date" value={dateFrom} max={dateTo} onChange={(e) => e.target.value && setDateFrom(e.target.value)} className="bg-transparent text-[#1F2937] font-bold outline-none cursor-pointer text-sm" />
                  <span className="text-[#6B7280] text-xs font-bold">→</span>
                  <input type="date" value={dateTo} max={today} onChange={(e) => e.target.value && setDateTo(e.target.value)} className="bg-transparent text-[#1F2937] font-bold outline-none cursor-pointer text-sm" />
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {reportMode === 'range' && (
                <div className="flex gap-1">
                  {[
                    { label: '7d', days: 7 },
                    { label: '15d', days: 15 },
                    { label: '30d', days: 30 },
                  ].map(preset => (
                    <button key={preset.label} onClick={() => {
                      const d = new Date(); d.setDate(d.getDate() - preset.days + 1);
                      setDateFrom(localDateStr(d)); setDateTo(today);
                    }} className="px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-[10px] font-bold text-[#6B7280] hover:bg-[#0B3B68]/10 hover:text-[#0B3B68] transition-colors">
                      {preset.label}
                    </button>
                  ))}
                </div>
              )}
              <button onClick={() => syncPull()} className="p-2 bg-white text-[#0B3B68] border border-gray-200 rounded-lg shadow-sm hover:bg-[#0B3B68]/10 transition-colors" title="Sincronizar Nube"><RefreshCw size={18}/></button>
            </div>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
              <p className="text-[#6B7280] text-[10px] font-bold uppercase mb-1 flex items-center gap-1"><Hash size={11}/> Tickets</p>
              <h3 className="text-2xl font-black text-[#0B3B68]">{dailyStats.sales.length}</h3>
              <p className="text-[10px] text-[#6B7280]">{reportMode === 'range' ? `en ${dailyStats.daysInRange} día${dailyStats.daysInRange !== 1 ? 's' : ''}` : 'ventas del día'}</p>
            </div>
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
              <p className="text-[#6B7280] text-[10px] font-bold uppercase mb-1 flex items-center gap-1"><DollarSign size={11}/> Ingresos</p>
              <h3 className="text-2xl font-black text-[#1F2937]">{formatMoney(dailyStats.revenue)}</h3>
              <p className="text-[10px] text-[#6B7280]">{reportMode === 'range' ? `prom. diario: ${formatMoney(dailyStats.dailyAvg)}` : 'neto del día'}</p>
            </div>
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
              <p className="text-[#6B7280] text-[10px] font-bold uppercase mb-1 flex items-center gap-1"><TrendingDown size={11}/> Costos</p>
              <h3 className="text-2xl font-black text-[#1F2937]">{formatMoney(dailyStats.cost)}</h3>
              <p className="text-[10px] text-[#6B7280]">costo de lo vendido</p>
            </div>
            <div className="col-span-2 lg:col-span-2 bg-gradient-to-br from-[#7AC142] to-[#5a9d2e] p-4 rounded-2xl shadow-lg shadow-[#7AC142]/20 text-white">
              <p className="text-white/70 text-[10px] font-bold uppercase mb-1 flex items-center gap-1"><TrendingUp size={11}/> Ganancia Neta</p>
              <h3 className="text-3xl font-black">{formatMoney(dailyStats.profit)}</h3>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full font-bold">Margen {dailyStats.margin.toFixed(0)}%</span>
                <span className="text-[10px] text-white/70">· Mejor: {dailyStats.bestSeller.name} ({dailyStats.bestSeller.count} un.)</span>
              </div>
            </div>
          </div>

          {/* DESGLOSE PAGOS */}
          {dailyStats.sales.length > 0 && (
            <div className="grid grid-cols-3 gap-3 mb-6">
              {[
                { label: 'Efectivo', value: dailyStats.paymentBreakdown.efectivo, color: 'text-[#7AC142]', bg: 'bg-[#7AC142]/10 border-[#7AC142]/20' },
                { label: 'Transferencia', value: dailyStats.paymentBreakdown.transferencia, color: 'text-[#F59E0B]', bg: 'bg-[#F59E0B]/10 border-[#F59E0B]/20' },
                { label: 'Tarjeta', value: dailyStats.paymentBreakdown.tarjeta, color: 'text-[#0B3B68]', bg: 'bg-[#0B3B68]/10 border-[#0B3B68]/20' },
              ].map(item => (
                <div key={item.label} className={`p-3 rounded-xl border ${item.bg}`}>
                  <p className="text-[10px] font-bold text-[#6B7280] uppercase mb-1">{item.label}</p>
                  <p className={`text-lg font-black ${item.color}`}>{formatMoney(item.value)}</p>
                  {dailyStats.revenue > 0 && <p className="text-[10px] text-[#6B7280]">{((item.value / dailyStats.revenue) * 100).toFixed(0)}% del total</p>}
                </div>
              ))}
            </div>
          )}

          {dailyStats.sales.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
              {/* GRÁFICO: por hora (día) o por día (rango) */}
              <div className="lg:col-span-2 bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                <h4 className="font-bold text-[#1F2937] text-sm mb-4 flex items-center gap-2">
                  <BarChart3 size={16}/> {reportMode === 'range' ? 'Ventas por Día' : 'Ventas por Hora'}
                </h4>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    {reportMode === 'range' ? (
                      <AreaChart data={dailyStats.rangeChartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                        <defs>
                          <linearGradient id="rangeGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#0B3B68" stopOpacity={0.15}/>
                            <stop offset="95%" stopColor="#0B3B68" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/>
                        <XAxis dataKey="date" fontSize={9} axisLine={false} tickLine={false} tick={{ fill: '#94a3b8' }}/>
                        <YAxis fontSize={9} axisLine={false} tickLine={false} tick={{ fill: '#94a3b8' }} tickFormatter={v => v === 0 ? '' : `$${v}`} width={36}/>
                        <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: '11px' }} formatter={(v: number) => [formatMoney(v), 'Ventas']}/>
                        <Area type="monotone" dataKey="total" stroke="#0B3B68" strokeWidth={2} fill="url(#rangeGrad)" dot={{ r: 3, fill: '#0B3B68', strokeWidth: 0 }} activeDot={{ r: 5, fill: '#0B3B68' }}/>
                      </AreaChart>
                    ) : (
                      <BarChart data={dailyStats.chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/>
                        <XAxis dataKey="time" fontSize={9} axisLine={false} tickLine={false} tick={{ fill: '#94a3b8' }} interval={1}/>
                        <YAxis fontSize={9} axisLine={false} tickLine={false} tick={{ fill: '#94a3b8' }} tickFormatter={v => v === 0 ? '' : `$${v}`} width={36}/>
                        <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: '11px' }} formatter={(v: number) => [formatMoney(v), 'Ventas']}/>
                        <Bar dataKey="total" fill="#0B3B68" radius={[4,4,0,0]}/>
                      </BarChart>
                    )}
                  </ResponsiveContainer>
                </div>
              </div>

              {/* TOP 5 PRODUCTOS */}
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                <h4 className="font-bold text-[#1F2937] text-sm mb-4 flex items-center gap-2"><Trophy size={16} className="text-[#F59E0B]"/> Top 5 Productos</h4>
                {dailyStats.topProducts.length === 0 ? (
                  <p className="text-xs text-[#6B7280] text-center py-8">Sin datos</p>
                ) : (
                  <div className="space-y-3">
                    {dailyStats.topProducts.map((p, i) => {
                      const maxQty = dailyStats.topProducts[0].qty;
                      const pct = maxQty > 0 ? (p.qty / maxQty) * 100 : 0;
                      return (
                        <div key={i}>
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-xs font-bold text-[#1F2937] truncate flex-1 mr-2">
                              {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`} {p.name}
                            </span>
                            <span className="text-[10px] font-black text-[#6B7280] flex-shrink-0">{p.qty} un.</span>
                          </div>
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full bg-[#0B3B68] transition-all" style={{ width: `${pct}%` }}/>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* PIE CATEGORÍAS */}
          {dailyStats.pieData.length > 0 && (
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 h-72 mb-6">
              <h4 className="font-bold text-[#1F2937] text-sm mb-4 flex items-center gap-2"><PieChartIcon size={16}/> Ingresos por Categoría</h4>
              <ResponsiveContainer width="100%" height="90%">
                <PieChart>
                  <Pie data={dailyStats.pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={4} dataKey="value" stroke="none">
                    {dailyStats.pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]}/>)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: '11px' }} formatter={(v: number) => [formatMoney(v), 'Ingresos']}/>
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '11px' }}/>
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* VENDEDORES (solo en modo rango con más de 1 vendedor) */}
          {reportMode === 'range' && dailyStats.staffList.length > 1 && (
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 mb-6">
              <h4 className="font-bold text-[#1F2937] text-sm mb-4 flex items-center gap-2"><Trophy size={16} className="text-[#7AC142]"/> Ventas por Vendedor</h4>
              <div className="space-y-2">
                {dailyStats.staffList.map((s, i) => {
                  const pct = dailyStats.revenue > 0 ? (s.total / dailyStats.revenue) * 100 : 0;
                  return (
                    <div key={i} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
                      <div className="w-7 h-7 rounded-lg bg-[#0B3B68]/10 text-[#0B3B68] flex items-center justify-center text-[10px] font-black flex-shrink-0">
                        {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : s.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center mb-1">
                          <p className="text-xs font-bold text-[#1F2937] truncate">{s.name}</p>
                          <span className="font-black text-xs text-[#7AC142] flex-shrink-0 ml-2">{formatMoney(s.total)}</span>
                        </div>
                        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-[#7AC142] transition-all" style={{ width: `${pct}%` }}/>
                        </div>
                        <p className="text-[9px] text-[#6B7280] mt-0.5">{s.count} venta{s.count !== 1 ? 's' : ''} · {pct.toFixed(0)}%</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {viewMode === 'trends' && (
        <div className="animate-in fade-in zoom-in-95 duration-300 space-y-6">
          {/* FILTRO */}
          <div className="flex gap-2">
            <button onClick={() => setTrendFilter('week')} className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${trendFilter === 'week' ? 'bg-[#0B3B68] text-white shadow-md' : 'bg-white border border-gray-200 text-[#6B7280] hover:bg-gray-50'}`}>Últimos 7 días</button>
            <button onClick={() => setTrendFilter('month')} className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${trendFilter === 'month' ? 'bg-[#0B3B68] text-white shadow-md' : 'bg-white border border-gray-200 text-[#6B7280] hover:bg-gray-50'}`}>Últimos 30 días</button>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
              <p className="text-[#6B7280] text-[10px] font-bold uppercase mb-1 flex items-center gap-1"><Hash size={11}/> Ventas</p>
              <h3 className="text-3xl font-black text-[#0B3B68]">{trendStats.count}</h3>
              <p className="text-[10px] text-[#6B7280]">tickets procesados</p>
            </div>
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
              <p className="text-[#6B7280] text-[10px] font-bold uppercase mb-1 flex items-center gap-1"><DollarSign size={11}/> Ingresos</p>
              <h3 className="text-2xl font-black text-[#1F2937]">{formatMoney(trendStats.totalRevenue)}</h3>
              <p className="text-[10px] text-[#6B7280]">total del período</p>
            </div>
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
              <p className="text-[#6B7280] text-[10px] font-bold uppercase mb-1 flex items-center gap-1"><TrendingDown size={11}/> Costos</p>
              <h3 className="text-2xl font-black text-[#1F2937]">{formatMoney(trendStats.totalCost)}</h3>
              <p className="text-[10px] text-[#6B7280]">costo del período</p>
            </div>
            <div className="bg-gradient-to-br from-[#7AC142] to-[#5a9d2e] p-5 rounded-2xl shadow-lg shadow-[#7AC142]/20 text-white">
              <p className="text-white/70 text-[10px] font-bold uppercase mb-1 flex items-center gap-1"><TrendingUp size={11}/> Ganancia</p>
              <h3 className="text-2xl font-black">{formatMoney(trendStats.totalProfit)}</h3>
              <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full font-bold">Margen {trendStats.totalMargin.toFixed(0)}%</span>
            </div>
          </div>

          {/* GRÁFICO EVOLUCIÓN */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <h4 className="font-bold text-[#1F2937] mb-1 text-sm">Evolución de Ingresos Netos</h4>
            <p className="text-[10px] text-[#6B7280] mb-4">
              {trendStats.count === 0 ? 'Sin ventas en el período' : `${trendStats.count} venta${trendStats.count !== 1 ? 's' : ''} · Prom. diario: ${formatMoney(trendStats.totalRevenue / (trendFilter === 'week' ? 7 : 30))}`}
            </p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendStats.chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#7AC142" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#7AC142" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/>
                  <XAxis dataKey="date" fontSize={10} axisLine={false} tickLine={false} tick={{ fill: '#94a3b8' }}/>
                  <YAxis fontSize={10} axisLine={false} tickLine={false} tickFormatter={v => v === 0 ? '' : `$${v}`} tick={{ fill: '#94a3b8' }} width={40}/>
                  <Tooltip
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: '11px' }}
                    formatter={(v: number) => [formatMoney(v), 'Ingresos']}
                  />
                  <Area type="monotone" dataKey="total" stroke="#7AC142" strokeWidth={2.5} fill="url(#trendGrad)" dot={{ r: 3, fill: '#7AC142', strokeWidth: 0 }} activeDot={{ r: 5, fill: '#7AC142' }}/>
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* TOP 5 PRODUCTOS DEL PERÍODO */}
          {trendStats.topProducts.length > 0 && (
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
              <h4 className="font-bold text-[#1F2937] text-sm mb-5 flex items-center gap-2">
                <Trophy size={16} className="text-[#F59E0B]"/> Top Productos del Período
              </h4>
              <div className="space-y-4">
                {trendStats.topProducts.map((p, i) => {
                  const maxRev = trendStats.topProducts[0].revenue;
                  const pct = maxRev > 0 ? (p.revenue / maxRev) * 100 : 0;
                  return (
                    <div key={i} className="flex items-center gap-4">
                      <div className="w-7 flex-shrink-0 text-center text-sm font-black text-[#6B7280]">
                        {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : <span className="text-xs">{i+1}</span>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center mb-1.5">
                          <span className="text-sm font-bold text-[#1F2937] truncate">{p.name}</span>
                          <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                            <span className="text-[10px] text-[#6B7280]">{p.qty} un.</span>
                            <span className="text-xs font-black text-[#7AC142]">{formatMoney(p.revenue)}</span>
                          </div>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${i === 0 ? 'bg-[#0B3B68]' : i === 1 ? 'bg-[#7AC142]' : i === 2 ? 'bg-[#F59E0B]' : 'bg-gray-400'}`} style={{ width: `${pct}%` }}/>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
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
          <div id="printable-report" className="bg-white p-8 rounded-none md:rounded-3xl shadow-lg border border-gray-200 print:shadow-none print:border-none print:p-0">
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

             {closingStats.staffList.length > 1 && (
               <div className="mt-6 pt-5 border-t border-dashed border-gray-200">
                 <h3 className="text-xs font-bold text-[#6B7280] uppercase mb-3 tracking-wider">Ventas por Vendedor</h3>
                 <div className="space-y-2">
                   {closingStats.staffList.map((s, i) => (
                     <div key={i} className="flex items-center justify-between p-2.5 bg-gray-50 rounded-xl border border-gray-100">
                       <div className="flex items-center gap-2">
                         <div className="w-7 h-7 rounded-lg bg-[#0B3B68]/10 text-[#0B3B68] flex items-center justify-center text-[10px] font-black">
                           {s.name.substring(0, 2).toUpperCase()}
                         </div>
                         <div>
                           <p className="text-xs font-bold text-[#1F2937]">{s.name}</p>
                           <p className="text-[10px] text-[#6B7280]">{s.count} venta{s.count !== 1 ? 's' : ''}</p>
                         </div>
                       </div>
                       <span className="font-black text-sm text-[#0B3B68]">{formatMoney(s.total)}</span>
                     </div>
                   ))}
                 </div>
               </div>
             )}
          </div>
        </div>
      )}

      {/* CSS: aislar Reporte Z igual que TicketModal al imprimir */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #printable-report, #printable-report * { visibility: visible; }
          #printable-report {
            position: absolute; left: 0; top: 0;
            width: 100%; margin: 0; padding: 16px;
            box-shadow: none !important;
            border-radius: 0 !important;
          }
        }
      `}</style>

      {/* ✅ PIN PAD MODAL PARA RETIROS, CIERRES Y ANULACIONES */}
      {pinModal.isOpen && (
        <div className="fixed inset-0 bg-[#0B3B68]/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
           <div className="bg-white rounded-3xl max-w-xs w-full max-h-[92vh] overflow-y-auto shadow-2xl scale-100 animate-in zoom-in-95 duration-200">
              <div className="text-center p-5 pb-0">
                  <div className="w-14 h-14 bg-[#EF4444]/10 rounded-full flex items-center justify-center mx-auto mb-3">
                      <Lock className="text-[#EF4444] w-7 h-7" />
                  </div>
                  <h2 className="text-lg font-black text-[#1F2937]">Acceso Restringido</h2>
                  <p className="text-xs text-[#6B7280] mt-1">Ingresa el PIN Maestro para continuar</p>
              </div>

              <div className="px-5 mt-4 mb-4">
                  <div className="flex justify-center gap-3 mb-2">
                      {[0,1,2,3].map(i => (
                          <div key={i} className={`w-4 h-4 rounded-full transition-all ${pinInput.length > i ? 'bg-[#0B3B68] scale-110' : 'bg-gray-200'}`}></div>
                      ))}
                  </div>
                  {pinAttemptsRef.current > 0 && pinLockSecondsLeft === 0 && (
                      <p className="text-center text-xs text-orange-500 font-bold mt-1">
                          {3 - pinAttemptsRef.current} intento{3 - pinAttemptsRef.current !== 1 ? 's' : ''} restante{3 - pinAttemptsRef.current !== 1 ? 's' : ''}
                      </p>
                  )}
                  {pinLockSecondsLeft > 0 && (
                      <p className="text-center text-xs text-red-500 font-bold mt-1">
                          🔒 Bloqueado — espera {Math.floor(pinLockSecondsLeft / 60)}:{String(pinLockSecondsLeft % 60).padStart(2, '0')}
                      </p>
                  )}
              </div>

              <div className="grid grid-cols-3 gap-2 px-5 mb-4">
                  {[1,2,3,4,5,6,7,8,9].map(num => (
                      <button key={num} disabled={pinLockSecondsLeft > 0} onClick={() => { if(pinInput.length < 4) setPinInput(pinInput + num) }} className="py-3.5 bg-gray-50 hover:bg-gray-100 rounded-xl text-xl font-black text-[#1F2937] transition-colors active:scale-95 disabled:opacity-30">
                          {num}
                      </button>
                  ))}
                  <button onClick={() => { setPinModal({isOpen: false, action: null}); setPinInput(''); pinAttemptsRef.current = 0; pinLockedUntilRef.current = 0; setPinLockSecondsLeft(0); }} className="py-3.5 bg-red-50 hover:bg-red-100 rounded-xl text-red-500 font-bold transition-colors flex items-center justify-center">
                      <X size={22}/>
                  </button>
                  <button disabled={pinLockSecondsLeft > 0} onClick={() => { if(pinInput.length < 4) setPinInput(pinInput + '0') }} className="py-3.5 bg-gray-50 hover:bg-gray-100 rounded-xl text-xl font-black text-[#1F2937] transition-colors active:scale-95 disabled:opacity-30">
                      0
                  </button>
                  <button disabled={pinLockSecondsLeft > 0} onClick={() => setPinInput(pinInput.slice(0, -1))} className="py-3.5 bg-gray-50 hover:bg-gray-100 rounded-xl text-[#6B7280] font-bold transition-colors flex items-center justify-center disabled:opacity-30">
                      <ArrowLeft size={22}/>
                  </button>
              </div>

              <div className="px-5 pb-5">
              <button
                  onClick={async () => {
                      if (pinLockSecondsLeft > 0) return;

                      const handleSuccess = () => {
                          pinAttemptsRef.current = 0;
                          if (pinModal.action === 'out') { setMovementType('out'); setAmount(''); }
                          if (pinModal.action === 'close') {
                            setIsClosing(true);
                            setClosingShiftStats(shiftStats); // capturar antes de que useLiveQuery lo anule
                            setAmount('');
                            // Pre-rellenar transferencias con el monto esperado para que el botón no quede bloqueado
                            if (shiftStats) setTransferCount(shiftStats.transferSales > 0 ? String(shiftStats.transferSales.toFixed(2)) : '0');
                          }
                          if (pinModal.action === 'void_sale' && pinModal.data) { handleVoidSale(pinModal.data); }
                          if (pinModal.action === 'partial_refund') {
                            handlePartialRefund();
                          }
                          setPinModal({isOpen: false, action: null, data: null});
                          setPinInput('');
                      };

                      const handleFailure = (msg?: string) => {
                          pinAttemptsRef.current += 1;
                          setPinInput('');
                          if (pinAttemptsRef.current >= 3) {
                              pinLockedUntilRef.current = Date.now() + 5 * 60 * 1000;
                              setPinLockSecondsLeft(300);
                              toast.error('PIN bloqueado 5 minutos por demasiados intentos fallidos');
                          } else {
                              toast.error(msg || `PIN incorrecto — ${3 - pinAttemptsRef.current} intento${3 - pinAttemptsRef.current !== 1 ? 's' : ''} restante${3 - pinAttemptsRef.current !== 1 ? 's' : ''}`);
                          }
                      };

                      const bId = localStorage.getItem('nexus_business_id');
                      if (!bId) { handleFailure(); return; }

                      if (isOnline()) {
                          // Enviar hash si el PIN local ya está hasheado (Supabase también lo tiene);
                          // de lo contrario enviar texto plano (migración gradual).
                          const pinToSend = masterPin && isPinHashed(masterPin)
                              ? await hashPin(pinInput, bId)
                              : pinInput;
                          const { data, error } = await supabase.rpc('verify_master_pin', {
                              p_pin: pinToSend,
                              p_business_id: bId,
                          });
                          if (error) {
                              handleFailure(error.message?.includes('bloqueado') ? error.message : undefined);
                          } else if (data === true) {
                              handleSuccess();
                          } else {
                              // Fallback: si la verificación local pasa pero Supabase falló,
                              // puede ser que el hash aún no se haya sincronizado — forzar push.
                              if (masterPin && await verifyPin(pinInput, bId, masterPin)) {
                                  handleSuccess();
                                  syncPush().catch(() => {});
                              } else {
                                  handleFailure();
                              }
                          }
                      } else {
                          // Sin internet: verificación local (soporta hash y texto plano)
                          if (!masterPin) {
                              handleFailure('PIN maestro no configurado. Ve a Ajustes para establecerlo.');
                          } else if (await verifyPin(pinInput, bId, masterPin)) {
                              handleSuccess();
                          } else {
                              handleFailure();
                          }
                      }
                  }}
                  disabled={pinInput.length < 4 || pinLockSecondsLeft > 0}
                  className="w-full py-3.5 bg-[#0B3B68] text-white font-bold rounded-xl shadow-lg transition-all active:scale-[0.98] disabled:opacity-50"
              >
                  {pinLockSecondsLeft > 0 ? `BLOQUEADO (${Math.floor(pinLockSecondsLeft/60)}:${String(pinLockSecondsLeft%60).padStart(2,'0')})` : 'VERIFICAR'}
              </button>
              </div>
           </div>
        </div>
      )}

      {/* CONFIRMACIÓN ANTES DE ANULAR VENTA */}
      {voidConfirmSale && (
        <div className="fixed inset-0 bg-[#0B3B68]/70 z-[90] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-5 max-w-sm w-full max-h-[92vh] overflow-y-auto shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-red-100 rounded-2xl flex items-center justify-center flex-shrink-0">
                <Ban className="text-red-500 w-6 h-6" />
              </div>
              <div>
                <h2 className="text-lg font-black text-[#1F2937]">¿Anular esta venta?</h2>
                <p className="text-xs text-[#6B7280]">Esta acción requiere PIN Maestro</p>
              </div>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 mb-5 text-xs space-y-1 border border-gray-100">
              <div className="flex justify-between"><span className="text-[#6B7280]">Ticket</span><span className="font-bold font-mono">#{voidConfirmSale.id.slice(0,8).toUpperCase()}</span></div>
              <div className="flex justify-between"><span className="text-[#6B7280]">Total</span><span className="font-black text-[#1F2937]">{formatMoney(safeFloat(voidConfirmSale.total))}</span></div>
              <div className="flex justify-between"><span className="text-[#6B7280]">Método</span><span className="font-bold uppercase">{voidConfirmSale.payment_method}</span></div>
              <div className="flex justify-between"><span className="text-[#6B7280]">Items</span><span className="font-bold">{voidConfirmSale.items?.length || 0} producto(s)</span></div>
            </div>
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3 mb-5">
              ⚠ Se revertirá el stock de todos los productos y se descontarán los puntos de lealtad ganados.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setVoidConfirmSale(null)}
                className="flex-1 py-3 bg-gray-100 text-[#1F2937] rounded-xl font-bold hover:bg-gray-200 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  const sale = voidConfirmSale;
                  setVoidConfirmSale(null);
                  setPinModal({ isOpen: true, action: 'void_sale', data: sale });
                }}
                className="flex-1 py-3 bg-red-500 text-white rounded-xl font-bold hover:bg-red-600 transition-colors flex items-center justify-center gap-2"
              >
                <Ban size={16} /> Continuar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DEVOLUCIÓN PARCIAL */}
      {refundSale && (
        <div className="fixed inset-0 bg-[#0B3B68]/70 z-[90] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl w-full max-w-md max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
            {/* Header */}
            <div className="p-4 bg-amber-50 border-b border-amber-100 flex justify-between items-center flex-shrink-0">
              <div>
                <h2 className="text-lg font-black text-amber-800 flex items-center gap-2"><RotateCcw size={18}/> Devolución Parcial</h2>
                <p className="text-xs text-amber-600 font-mono">Venta #{refundSale.id.slice(0, 8).toUpperCase()}</p>
              </div>
              <button onClick={() => setRefundSale(null)} className="p-1.5 text-amber-400 hover:text-amber-700 hover:bg-amber-100 rounded-full transition-colors"><X size={18}/></button>
            </div>

            {/* Items */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {(refundSale.items || []).map((item, idx) => {
                const alreadyRefunded = (refundSale.refunded_items || [])
                  .filter(r => r.product_id === item.product_id)
                  .reduce((sum, r) => sum + r.quantity, 0);
                const maxQty = item.quantity - alreadyRefunded;
                const qty = refundSelections[item.product_id] || 0;
                const itemTotal = qty * (item.custom_price ?? item.price);

                if (maxQty <= 0) return (
                  <div key={idx} className="bg-gray-50 rounded-xl p-3 opacity-50">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="font-bold text-sm text-gray-400">{item.name}</p>
                        <p className="text-[10px] text-gray-400">Ya devuelto completamente</p>
                      </div>
                      <span className="text-xs font-bold text-gray-400">x{item.quantity}</span>
                    </div>
                  </div>
                );

                return (
                  <div key={idx} className={`rounded-xl p-3 border-2 transition-all ${qty > 0 ? 'bg-amber-50 border-amber-300' : 'bg-white border-gray-100'}`}>
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm text-[#1F2937]">{item.name}</p>
                        <p className="text-[10px] text-[#6B7280]">
                          {currency.format(item.custom_price ?? item.price)} x {item.quantity} vendido(s)
                          {alreadyRefunded > 0 && <span className="text-amber-600 ml-1">({alreadyRefunded} ya devuelto)</span>}
                        </p>
                      </div>
                      {qty > 0 && <span className="text-xs font-black text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">{currency.format(itemTotal)}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] font-bold text-[#6B7280] uppercase">Devolver:</label>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setRefundSelections(prev => ({ ...prev, [item.product_id]: Math.max(0, qty - 1) }))}
                          className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center font-black text-[#6B7280] transition-colors"
                        >-</button>
                        <input
                          type="number" min={0} max={maxQty} step={1}
                          value={qty}
                          onChange={e => setRefundSelections(prev => ({ ...prev, [item.product_id]: Math.min(maxQty, Math.max(0, parseInt(e.target.value) || 0)) }))}
                          className="w-14 text-center font-bold border border-gray-200 rounded-lg py-1 text-sm outline-none focus:ring-2 focus:ring-amber-300"
                        />
                        <button
                          type="button"
                          onClick={() => setRefundSelections(prev => ({ ...prev, [item.product_id]: Math.min(maxQty, qty + 1) }))}
                          className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center font-black text-[#6B7280] transition-colors"
                        >+</button>
                      </div>
                      <span className="text-[10px] text-[#6B7280]">/ {maxQty} máx</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-200 flex-shrink-0 space-y-3 bg-white">
              {refundTotal > 0 && (
                <div className="flex justify-between items-center bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <span className="text-sm font-bold text-amber-800">Total a reembolsar</span>
                  <span className="text-xl font-black text-amber-700">{currency.format(refundTotal)}</span>
                </div>
              )}
              <div className="flex gap-3">
                <button onClick={() => setRefundSale(null)} className="flex-1 py-3 border border-gray-200 text-[#6B7280] font-bold rounded-xl hover:bg-gray-50 transition-colors">
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    setPinModal({ isOpen: true, action: 'partial_refund' as any, data: refundSale });
                  }}
                  disabled={refundTotal <= 0}
                  className="flex-1 py-3 bg-amber-500 text-white font-bold rounded-xl hover:bg-amber-600 transition-colors shadow-lg shadow-amber-200 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <RotateCcw size={16}/> Proceder
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL MOVIMIENTOS */}
      {movementType && (
        <div className="fixed inset-0 bg-[#0B3B68]/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-2xl p-5 max-w-sm w-full max-h-[92vh] overflow-y-auto shadow-2xl">
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
      {isClosing && (closingShiftStats || shiftStats) && (() => {
        const ss = closingShiftStats || shiftStats;
        const cashDiffPreview = amount !== '' ? safeFloat(amount) - ss.expectedCash : null;
        const transferDiffPreview = transferCount !== '' ? safeFloat(transferCount) - ss.transferSales : null;
        return (
        <div className="fixed inset-0 bg-[#0B3B68]/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-2xl p-0 max-w-md w-full shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
                <div className="bg-[#0B3B68] p-6 text-white flex justify-between items-center sticky top-0 z-10">
                    <h2 className="text-xl font-black flex items-center gap-2"><Lock className="text-[#7AC142]"/> CORTE DE CAJA</h2>
                    <button onClick={() => { setIsClosing(false); setClosingShiftStats(null); setAmount(''); setTransferCount(''); }}><X className="text-gray-400 hover:text-white"/></button>
                </div>
                <div className="p-6 space-y-5">
                    {/* SECCIÓN EFECTIVO */}
                    <div>
                      <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 mb-3">
                          <div className="flex justify-between items-center">
                              <span className="text-xs font-bold text-blue-600 uppercase flex items-center gap-1.5"><Wallet size={14}/> Efectivo Esperado</span>
                              <span className="text-lg font-black text-[#0B3B68]">{formatMoney(ss.expectedCash)}</span>
                          </div>
                          <p className="text-[10px] text-blue-400 mt-1">Apertura {formatMoney(ss.startAmount)} + Ventas {formatMoney(ss.cashSales)} + Ingresos {formatMoney(ss.cashIn)} − Retiros {formatMoney(ss.cashOut)}</p>
                      </div>
                      <label className="block text-xs font-bold text-[#6B7280] uppercase mb-2">Conteo real de efectivo</label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#6B7280] text-xl font-bold">$</span>
                        <input type="number" step="0.01" autoFocus value={amount} onChange={e => setAmount(e.target.value)} className="w-full pl-10 pr-4 py-3.5 text-2xl font-black border-2 rounded-xl focus:border-[#0B3B68] outline-none transition-colors" placeholder="0.00" />
                      </div>
                      {cashDiffPreview !== null && (
                        <div className={`mt-2 px-3 py-2 rounded-lg text-sm font-bold flex justify-between ${cashDiffPreview === 0 ? 'bg-green-50 text-green-700' : cashDiffPreview > 0 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'}`}>
                          <span>Diferencia</span>
                          <span>{cashDiffPreview >= 0 ? '+' : ''}{formatMoney(cashDiffPreview)}</span>
                        </div>
                      )}
                    </div>

                    {/* SEPARADOR */}
                    <div className="border-t border-dashed border-gray-200" />

                    {/* SECCIÓN TRANSFERENCIAS */}
                    <div>
                      <div className="bg-purple-50 p-4 rounded-xl border border-purple-100 mb-3">
                          <div className="flex justify-between items-center">
                              <span className="text-xs font-bold text-purple-600 uppercase flex items-center gap-1.5"><ArrowRightLeft size={14}/> Transferencias Esperadas</span>
                              <span className="text-lg font-black text-purple-800">{formatMoney(ss.transferSales)}</span>
                          </div>
                          <p className="text-[10px] text-purple-400 mt-1">{shiftData?.sales.filter(s => s.status !== 'voided' && ['transferencia','transfer','mixto'].includes(s.payment_method?.toLowerCase() || '')).length || 0} venta(s) con transferencia (incl. mixtas)</p>
                      </div>
                      <label className="block text-xs font-bold text-[#6B7280] uppercase mb-2">Monto verificado en transferencias</label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#6B7280] text-xl font-bold">$</span>
                        <input type="number" step="0.01" value={transferCount} onChange={e => setTransferCount(e.target.value)} className="w-full pl-10 pr-4 py-3.5 text-2xl font-black border-2 rounded-xl focus:border-purple-500 outline-none transition-colors" placeholder="0.00" />
                      </div>
                      {transferDiffPreview !== null && (
                        <div className={`mt-2 px-3 py-2 rounded-lg text-sm font-bold flex justify-between ${transferDiffPreview === 0 ? 'bg-green-50 text-green-700' : transferDiffPreview > 0 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'}`}>
                          <span>Diferencia</span>
                          <span>{transferDiffPreview >= 0 ? '+' : ''}{formatMoney(transferDiffPreview)}</span>
                        </div>
                      )}
                    </div>

                    {/* RESUMEN TOTAL */}
                    {amount !== '' && transferCount !== '' && (
                      <div className={`p-4 rounded-xl border-2 ${(cashDiffPreview! + transferDiffPreview!) === 0 ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
                        <div className="flex justify-between items-center">
                          <span className="text-sm font-black text-[#1F2937] uppercase">Diferencia Total</span>
                          <span className={`text-xl font-black ${(cashDiffPreview! + transferDiffPreview!) === 0 ? 'text-green-700' : (cashDiffPreview! + transferDiffPreview!) > 0 ? 'text-amber-700' : 'text-red-600'}`}>
                            {(cashDiffPreview! + transferDiffPreview!) >= 0 ? '+' : ''}{formatMoney(cashDiffPreview! + transferDiffPreview!)}
                          </span>
                        </div>
                      </div>
                    )}

                    <button type="button" onClick={handleCloseShift} disabled={isLoading || amount === '' || transferCount === ''} className="w-full py-4 bg-[#0B3B68] text-white font-black rounded-xl text-lg hover:bg-[#092b4d] transition-all active:scale-95 disabled:opacity-50 shadow-lg shadow-[#0B3B68]/20">
                        {isLoading ? <Loader2 className="animate-spin mx-auto" /> : 'FINALIZAR TURNO'}
                    </button>
                </div>
            </div>
        </div>
        );
      })()}

      {selectedTicket && <TicketModal sale={selectedTicket} onClose={() => setSelectedTicket(null)} />}
    </div>
  );
}