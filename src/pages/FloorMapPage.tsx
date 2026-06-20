import { useOutletContext, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Comanda, type RestaurantTable, type Staff } from '../lib/db';
import { addToQueue } from '../lib/sync';
import { comandaTotal } from '../lib/comanda';
import { UtensilsCrossed, Plus, Settings as SettingsIcon, Clock, CircleDollarSign, Armchair } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader, EmptyState, Button, StatCard } from '../components/ui';
import { useNow, minutesSince, formatElapsed } from '../lib/time';

const STATE_STYLES: Record<RestaurantTable['state'], { box: string; dot: string; label: string }> = {
  libre: { box: 'border-[#7AC142]/30 bg-[#7AC142]/5 hover:border-[#7AC142] hover:shadow-card-hover', dot: 'bg-[#7AC142] shadow-[0_0_6px_#7AC142]', label: 'Libre' },
  ocupada: { box: 'border-amber-300 bg-amber-50 hover:border-amber-400 hover:shadow-card-hover', dot: 'bg-amber-500 shadow-[0_0_6px_#f59e0b]', label: 'Ocupada' },
  por_cobrar: { box: 'border-red-300 bg-red-50 hover:border-red-400 hover:shadow-card-hover', dot: 'bg-red-500 shadow-[0_0_6px_#ef4444]', label: 'Por cobrar' },
  reservada: { box: 'border-blue-300 bg-blue-50 hover:border-blue-400 hover:shadow-card-hover', dot: 'bg-blue-500 shadow-[0_0_6px_#3b82f6]', label: 'Reservada' },
};

export default function FloorMapPage() {
  const { currentStaff } = useOutletContext<{ currentStaff: Staff }>();
  const navigate = useNavigate();
  const businessId = localStorage.getItem('nexus_business_id') || '';
  const now = useNow();

  const areas = useLiveQuery(async () => {
    if (!businessId) return [];
    const rows = await db.restaurant_areas.where('business_id').equals(businessId).toArray();
    return rows.filter(a => !a.deleted_at).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
  }, [businessId]) || [];

  const tables = useLiveQuery(async () => {
    if (!businessId) return [];
    const rows = await db.restaurant_tables.where('business_id').equals(businessId).toArray();
    return rows.filter(t => !t.deleted_at).sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
  }, [businessId]) || [];

  // Comandas abiertas indexadas por mesa (fuente de verdad de "ocupada").
  const openByTable = useLiveQuery(async () => {
    if (!businessId) return {} as Record<string, Comanda>;
    const rows = await db.comandas.where('[business_id+status]').equals([businessId, 'open']).toArray();
    const map: Record<string, Comanda> = {};
    for (const c of rows) map[c.table_id] = c;
    return map;
  }, [businessId]) || {};

  // Totales en vivo por comanda abierta (para mostrar el monto en la mesa).
  const itemsByComanda = useLiveQuery(async () => {
    const ids = Object.values(openByTable).map(c => c.id);
    if (ids.length === 0) return {} as Record<string, number>;
    const all = await db.comanda_items.where('comanda_id').anyOf(ids).toArray();
    const totals: Record<string, number> = {};
    for (const id of ids) totals[id] = comandaTotal(all.filter(i => i.comanda_id === id));
    return totals;
  }, [JSON.stringify(Object.values(openByTable).map(c => c.id))]) || {};

  const openTable = async (table: RestaurantTable) => {
    const existing = openByTable[table.id];
    if (existing) {
      navigate(`/comanda/${existing.id}`);
      return;
    }
    try {
      const comandaId = crypto.randomUUID();
      const now = new Date().toISOString();
      const comanda: Comanda = {
        id: comandaId, business_id: businessId, table_id: table.id, area_id: table.area_id,
        staff_id: currentStaff?.id, staff_name: currentStaff?.name,
        opened_at: now, status: 'open', sync_status: 'pending_create',
      };
      const updatedTable: RestaurantTable = { ...table, state: 'ocupada', current_comanda_id: comandaId, sync_status: 'pending_update' };
      await db.transaction('rw', [db.comandas, db.restaurant_tables, db.action_queue], async () => {
        await db.comandas.add(comanda);
        await addToQueue('COMANDA_SYNC', comanda);
        await db.restaurant_tables.update(table.id, { state: 'ocupada', current_comanda_id: comandaId, sync_status: 'pending_update' });
        await addToQueue('TABLE_SYNC', updatedTable);
      });
      navigate(`/comanda/${comandaId}`);
    } catch (e) {
      console.error(e);
      toast.error('No se pudo abrir la mesa');
    }
  };

  const tablesByArea = (areaId: string) => tables.filter(t => t.area_id === areaId);
  const tablesNoArea = tables.filter(t => !areas.some(a => a.id === t.area_id));

  if (tables.length === 0) {
    return (
      <div className="flex items-center justify-center h-full min-h-[60vh]">
        <EmptyState
          icon={<UtensilsCrossed size={32} />}
          title="Aún no hay mesas"
          description="Crea tus áreas (salón, terraza…) y mesas desde Configuración para empezar a tomar comandas."
          action={
            <Button variant="navy" icon={<SettingsIcon size={18} />} onClick={() => navigate('/configuracion?tab=restaurant')}>
              Configurar mesas
            </Button>
          }
        />
      </div>
    );
  }

  // Resumen para la barra superior.
  const occupiedCount = tables.filter(t => openByTable[t.id]).length;
  const freeCount = tables.length - occupiedCount;
  const totalInProgress = Object.values(openByTable).reduce((sum, c) => sum + (itemsByComanda[c.id] ?? 0), 0);

  const renderTable = (table: RestaurantTable) => {
    const comanda = openByTable[table.id];
    const state: RestaurantTable['state'] = comanda ? (table.state === 'por_cobrar' ? 'por_cobrar' : 'ocupada') : 'libre';
    const style = STATE_STYLES[state];
    const total = comanda ? itemsByComanda[comanda.id] ?? 0 : 0;
    const mins = comanda ? minutesSince(comanda.opened_at, now) : 0;
    return (
      <button key={table.id} onClick={() => openTable(table)}
        className={`relative p-4 rounded-2xl border-2 text-left transition-all duration-200 active:scale-95 shadow-card hover:-translate-y-0.5 ${style.box}`}>
        <div className="flex items-center justify-between mb-1">
          <span className="font-black text-[#1F2937] text-lg truncate">{table.name}</span>
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${style.dot}`} />
        </div>
        <p className="text-[11px] font-bold text-[#6B7280] uppercase">{style.label}</p>
        {comanda && (
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-sm font-black text-[#0B3B68]">${total.toFixed(2)}</span>
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#6B7280]">
              <Clock size={11} /> {formatElapsed(mins)}
            </span>
          </div>
        )}
      </button>
    );
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <PageHeader
        title="Mesas"
        icon={<UtensilsCrossed className="text-[#0B3B68]" />}
        className="mb-4"
        action={
          <Button variant="ghost" size="sm" icon={<Plus size={16} />} onClick={() => navigate('/configuracion?tab=restaurant')}>
            Áreas y mesas
          </Button>
        }
      />

      <div className="grid grid-cols-3 gap-3 mb-6">
        <StatCard label="Libres" value={freeCount} icon={<Armchair size={16} />} />
        <StatCard label="Ocupadas" value={occupiedCount} icon={<Clock size={16} />} />
        <StatCard tone="green" label="En curso" value={`$${totalInProgress.toFixed(2)}`} icon={<CircleDollarSign size={16} />} />
      </div>

      {areas.map(area => (
        <section key={area.id} className="mb-6">
          <h2 className="text-xs font-black text-[#6B7280] uppercase tracking-wide mb-2">{area.name}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {tablesByArea(area.id).map(renderTable)}
            {tablesByArea(area.id).length === 0 && (
              <p className="text-sm text-[#9CA3AF] col-span-full">Sin mesas en esta área.</p>
            )}
          </div>
        </section>
      ))}

      {tablesNoArea.length > 0 && (
        <section className="mb-6">
          <h2 className="text-xs font-black text-[#6B7280] uppercase tracking-wide mb-2">Sin área</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {tablesNoArea.map(renderTable)}
          </div>
        </section>
      )}
    </div>
  );
}
