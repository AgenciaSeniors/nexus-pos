import { useMemo } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Staff } from '../lib/db';
import { isRestaurantMode } from '../lib/businessType';
import { currency } from '../lib/currency';
import {
  computeDayKpis,
  compareValues,
  localDateStr,
  type Delta,
} from '../lib/salesStats';
import { StatCard, SectionCard, Badge } from '../components/ui';
import { CHART_TOOLTIP_STYLE } from '../lib/chartTheme';
import {
  AreaChart, Area, XAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Minus, DollarSign, Wallet, Receipt, Hash,
  ShoppingBag, Package, Trophy, AlertTriangle, Clock, ChevronRight,
  UtensilsCrossed, ChefHat, Users as UsersIcon, PieChart as PieChartIcon,
} from 'lucide-react';

const NAVY = '#0B3B68';
const GREEN = '#7AC142';
const LOW_STOCK_DEFAULT = 5;

const formatMoney = (val: number): string => {
  if (val === undefined || val === null || isNaN(val)) return '$0.00';
  try {
    return currency.format(val);
  } catch {
    return `$${val.toFixed(2)}`;
  }
};

const daysUntil = (dateString?: string): number | null => {
  if (!dateString) return null;
  const exp = new Date(dateString);
  if (isNaN(exp.getTime())) return null;
  exp.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((exp.getTime() - today.getTime()) / 86400000);
};

/** Pequeña insignia de variación (▲/▼/—) respecto al día anterior. */
function DeltaBadge({ delta, onDark = false }: { delta: Delta; onDark?: boolean }) {
  const { direction, pct } = delta;
  const label =
    pct === null ? 'nuevo' : `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`;
  const Icon = direction === 'up' ? TrendingUp : direction === 'down' ? TrendingDown : Minus;

  const tone = onDark
    ? 'bg-white/20 text-white'
    : direction === 'up'
      ? 'bg-[#7AC142]/15 text-[#5a962e]'
      : direction === 'down'
        ? 'bg-red-100 text-red-600'
        : 'bg-gray-100 text-gray-500';

  return (
    <span className={`inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${tone}`}>
      <Icon size={12} />
      {label}
      <span className={onDark ? 'text-white/70 font-medium' : 'text-current/70 font-medium'}>vs. ayer</span>
    </span>
  );
}

export function HomePage() {
  const { currentStaff } = useOutletContext<{ currentStaff: Staff }>();
  const businessId = localStorage.getItem('nexus_business_id') || '';

  const settingsRows = useLiveQuery(() => db.settings.toArray());
  const isRestaurant = isRestaurantMode(settingsRows);
  const businessName = settingsRows?.[0]?.name || 'tu negocio';

  const allSales = useLiveQuery(
    () => (businessId ? db.sales.where('business_id').equals(businessId).toArray() : Promise.resolve([])),
    [businessId],
  ) ?? [];

  const products = useLiveQuery(
    () => (businessId
      ? db.products.where('business_id').equals(businessId).filter(p => !p.deleted_at).toArray()
      : Promise.resolve([])),
    [businessId],
  ) ?? [];

  const activeShift = useLiveQuery(
    () => (businessId
      ? db.cash_shifts.where('business_id').equals(businessId).filter(s => s.status === 'open').first()
      : Promise.resolve(undefined)),
    [businessId],
  );

  const today = localDateStr();
  const yesterday = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return localDateStr(d);
  }, []);

  const todayKpis = useMemo(() => computeDayKpis(allSales, products, today), [allSales, products, today]);
  const yesterdayKpis = useMemo(() => computeDayKpis(allSales, products, yesterday), [allSales, products, yesterday]);

  const deltas = useMemo(() => ({
    revenue: compareValues(todayKpis.revenue, yesterdayKpis.revenue),
    profit: compareValues(todayKpis.profit, yesterdayKpis.profit),
    avgTicket: compareValues(todayKpis.avgTicket, yesterdayKpis.avgTicket),
    count: compareValues(todayKpis.count, yesterdayKpis.count),
  }), [todayKpis, yesterdayKpis]);

  // Solo las horas con actividad (o entre la primera y la última venta) para un gráfico limpio.
  const hourlyChart = useMemo(() => {
    const withSales = todayKpis.hourly.filter(h => h.total > 0);
    if (withSales.length === 0) return [];
    const first = todayKpis.hourly.findIndex(h => h.total > 0);
    const last = todayKpis.hourly.length - 1 - [...todayKpis.hourly].reverse().findIndex(h => h.total > 0);
    return todayKpis.hourly.slice(Math.max(0, first - 1), last + 2);
  }, [todayKpis.hourly]);

  const { lowStock, expiring } = useMemo(() => {
    const low = products.filter(p => p.stock <= (p.low_stock_threshold ?? LOW_STOCK_DEFAULT));
    const exp = products.filter(p => {
      const d = daysUntil(p.expiration_date);
      return d !== null && d <= 90;
    });
    return { lowStock: low, expiring: exp };
  }, [products]);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Buenos días';
    if (h < 19) return 'Buenas tardes';
    return 'Buenas noches';
  })();
  const todayLabel = new Date().toLocaleDateString('es', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  const quickActions = isRestaurant
    ? [
        { to: '/mesas', label: 'Mesas', icon: <UtensilsCrossed size={22} />, accent: 'bg-[#7AC142]' },
        { to: '/cocina', label: 'Cocina', icon: <ChefHat size={22} />, accent: 'bg-[#0B3B68]' },
        { to: '/inventario', label: 'Inventario', icon: <Package size={22} />, accent: 'bg-amber-500' },
        { to: '/finanzas', label: 'Finanzas', icon: <PieChartIcon size={22} />, accent: 'bg-indigo-500' },
      ]
    : [
        { to: '/venta', label: 'Vender', icon: <ShoppingBag size={22} />, accent: 'bg-[#7AC142]' },
        { to: '/inventario', label: 'Inventario', icon: <Package size={22} />, accent: 'bg-amber-500' },
        { to: '/clientes', label: 'Clientes', icon: <UsersIcon size={22} />, accent: 'bg-[#0B3B68]' },
        { to: '/finanzas', label: 'Finanzas', icon: <PieChartIcon size={22} />, accent: 'bg-indigo-500' },
      ];

  const maxTopQty = todayKpis.topProducts[0]?.qty || 1;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      {/* Saludo */}
      <div>
        <h1 className="text-2xl md:text-3xl font-black text-[#0B3B68]">
          {greeting}, {currentStaff?.name?.split(' ')[0] || ''} 👋
        </h1>
        <p className="text-sm text-[#6B7280] mt-1 capitalize">
          {businessName} · {todayLabel}
        </p>
      </div>

      {/* KPIs del día */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard
          tone="green"
          label="Ventas de hoy"
          icon={<DollarSign size={18} />}
          value={
            <span className="flex flex-col">
              {formatMoney(todayKpis.revenue)}
              <DeltaBadge delta={deltas.revenue} onDark />
            </span>
          }
        />
        <StatCard
          tone="navy"
          label={
            <span className="flex items-center gap-2">
              Ganancia de hoy
              <span className="bg-white/20 px-2 py-0.5 rounded-full text-[10px] font-bold normal-case">
                Margen {todayKpis.margin.toFixed(0)}%
              </span>
            </span>
          }
          icon={<Wallet size={18} />}
          value={
            <span className="flex flex-col">
              {formatMoney(todayKpis.profit)}
              <DeltaBadge delta={deltas.profit} onDark />
            </span>
          }
        />
        <StatCard
          label="Ticket promedio"
          icon={<Receipt size={18} />}
          value={
            <span className="flex flex-col">
              {formatMoney(todayKpis.avgTicket)}
              <DeltaBadge delta={deltas.avgTicket} />
            </span>
          }
        />
        <StatCard
          label="N° de ventas"
          icon={<Hash size={18} />}
          value={
            <span className="flex flex-col">
              {todayKpis.count}
              <DeltaBadge delta={deltas.count} />
            </span>
          }
        />
      </div>

      {/* Accesos rápidos */}
      <div className="grid grid-cols-4 gap-3">
        {quickActions.map(a => (
          <Link
            key={a.to}
            to={a.to}
            className="group flex flex-col items-center justify-center gap-2 bg-white border border-gray-200 rounded-2xl py-4 shadow-card hover:shadow-card-hover hover:-translate-y-0.5 transition-all"
          >
            <span className={`w-11 h-11 rounded-xl ${a.accent} text-white flex items-center justify-center shadow-md`}>
              {a.icon}
            </span>
            <span className="text-xs font-bold text-[#1F2937]">{a.label}</span>
          </Link>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4 md:gap-6">
        {/* Ventas por hora */}
        <SectionCard
          title="Ventas por hora"
          subtitle="Movimiento de hoy"
          icon={<TrendingUp size={18} className="text-[#0B3B68]" />}
        >
          {hourlyChart.length === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center text-center text-[#6B7280]">
              <Clock size={28} className="mb-2 opacity-50" />
              <p className="text-sm font-bold">Aún no hay ventas hoy</p>
              <p className="text-xs">Cuando vendas, verás aquí tu actividad por hora.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={hourlyChart} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="homeHourly" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={GREEN} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={GREEN} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(v: number) => [formatMoney(v), 'Ventas']}
                  contentStyle={CHART_TOOLTIP_STYLE}
                />
                <Area type="monotone" dataKey="total" stroke={GREEN} strokeWidth={2.5} fill="url(#homeHourly)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        {/* Top productos del día */}
        <SectionCard
          title="Productos más vendidos"
          subtitle="Hoy, por cantidad"
          icon={<Trophy size={18} className="text-amber-500" />}
          accent="amber"
        >
          {todayKpis.topProducts.length === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center text-center text-[#6B7280]">
              <ShoppingBag size={28} className="mb-2 opacity-50" />
              <p className="text-sm font-bold">Sin ventas todavía</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {todayKpis.topProducts.map((p, i) => (
                <li key={p.name} className="flex items-center gap-3">
                  <span className={`w-6 h-6 shrink-0 rounded-lg flex items-center justify-center text-[11px] font-black ${i === 0 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline gap-2">
                      <span className="text-sm font-bold text-[#1F2937] truncate">{p.name}</span>
                      <span className="text-xs font-bold text-[#6B7280] shrink-0">{p.qty} u · {formatMoney(p.revenue)}</span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#7AC142] to-[#5a962e]"
                        style={{ width: `${Math.max(6, (p.qty / maxTopQty) * 100)}%` }}
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* Estado y alertas */}
      <div className="grid lg:grid-cols-2 gap-4 md:gap-6">
        {/* Caja / turno */}
        <SectionCard
          title="Estado de caja"
          icon={<Wallet size={18} className="text-[#0B3B68]" />}
          action={
            <Link to="/finanzas" className="text-xs font-bold text-[#0B3B68] hover:underline flex items-center gap-1">
              Finanzas <ChevronRight size={14} />
            </Link>
          }
        >
          {activeShift ? (
            <div className="flex items-center gap-3">
              <Badge color="green">Turno abierto</Badge>
              <span className="text-sm text-[#6B7280]">
                Desde {new Date(activeShift.opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {' · '}fondo inicial {formatMoney(activeShift.start_amount)}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Badge color="gray">Caja cerrada</Badge>
              <span className="text-sm text-[#6B7280]">Abre un turno desde Finanzas para registrar el efectivo.</span>
            </div>
          )}
        </SectionCard>

        {/* Alertas de inventario */}
        <SectionCard
          title="Alertas de inventario"
          icon={<AlertTriangle size={18} className="text-amber-500" />}
          accent="amber"
          action={
            <Link to="/inventario" className="text-xs font-bold text-[#0B3B68] hover:underline flex items-center gap-1">
              Inventario <ChevronRight size={14} />
            </Link>
          }
        >
          {lowStock.length === 0 && expiring.length === 0 ? (
            <p className="text-sm text-[#6B7280]">Todo en orden — sin productos bajos de stock ni por vencer. ✅</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {lowStock.length > 0 && (
                <Badge color="red" icon={<Package size={12} />}>{lowStock.length} con stock bajo</Badge>
              )}
              {expiring.length > 0 && (
                <Badge color="amber" icon={<Clock size={12} />}>{expiring.length} por vencer</Badge>
              )}
              {lowStock.slice(0, 4).map(p => (
                <span key={p.id} className="text-xs bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-[#6B7280]">
                  {p.name}: <strong className="text-red-600">{p.stock}</strong>
                </span>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

export default HomePage;
