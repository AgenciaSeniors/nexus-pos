import { useOutletContext, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Comanda, type RestaurantTable, type Staff } from '../lib/db';
import { addToQueue } from '../lib/sync';
import { comandaTotal } from '../lib/comanda';
import { UtensilsCrossed, Plus, Settings as SettingsIcon } from 'lucide-react';
import { toast } from 'sonner';

const STATE_STYLES: Record<RestaurantTable['state'], { box: string; dot: string; label: string }> = {
  libre: { box: 'border-[#7AC142]/30 bg-[#7AC142]/5 hover:border-[#7AC142]', dot: 'bg-[#7AC142]', label: 'Libre' },
  ocupada: { box: 'border-amber-300 bg-amber-50 hover:border-amber-400', dot: 'bg-amber-500', label: 'Ocupada' },
  por_cobrar: { box: 'border-red-300 bg-red-50 hover:border-red-400', dot: 'bg-red-500', label: 'Por cobrar' },
  reservada: { box: 'border-blue-300 bg-blue-50 hover:border-blue-400', dot: 'bg-blue-500', label: 'Reservada' },
};

export default function FloorMapPage() {
  const { currentStaff } = useOutletContext<{ currentStaff: Staff }>();
  const navigate = useNavigate();
  const businessId = localStorage.getItem('nexus_business_id') || '';

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
      <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center px-6">
        <div className="w-16 h-16 rounded-2xl bg-[#0B3B68]/5 flex items-center justify-center mb-4">
          <UtensilsCrossed className="text-[#0B3B68]" size={32} />
        </div>
        <h1 className="text-xl font-bold text-[#1F2937] mb-1">Aún no hay mesas</h1>
        <p className="text-sm text-[#6B7280] max-w-sm mb-4">
          Crea tus áreas (salón, terraza…) y mesas desde Configuración para empezar a tomar comandas.
        </p>
        <button onClick={() => navigate('/configuracion?tab=restaurant')}
          className="bg-[#0B3B68] text-white font-bold py-2.5 px-5 rounded-xl flex items-center gap-2">
          <SettingsIcon size={18} /> Configurar mesas
        </button>
      </div>
    );
  }

  const renderTable = (table: RestaurantTable) => {
    const comanda = openByTable[table.id];
    const state: RestaurantTable['state'] = comanda ? (table.state === 'por_cobrar' ? 'por_cobrar' : 'ocupada') : 'libre';
    const style = STATE_STYLES[state];
    const total = comanda ? itemsByComanda[comanda.id] ?? 0 : 0;
    return (
      <button key={table.id} onClick={() => openTable(table)}
        className={`relative p-4 rounded-2xl border-2 text-left transition-all active:scale-95 ${style.box}`}>
        <div className="flex items-center justify-between mb-1">
          <span className="font-black text-[#1F2937] text-lg">{table.name}</span>
          <span className={`w-2.5 h-2.5 rounded-full ${style.dot}`} />
        </div>
        <p className="text-[11px] font-bold text-[#6B7280] uppercase">{style.label}</p>
        {comanda && (
          <p className="text-sm font-bold text-[#0B3B68] mt-1">${total.toFixed(2)}</p>
        )}
      </button>
    );
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-black text-[#1F2937] flex items-center gap-2">
          <UtensilsCrossed className="text-[#0B3B68]" /> Mesas
        </h1>
        <button onClick={() => navigate('/configuracion?tab=restaurant')}
          className="text-sm font-bold text-[#0B3B68] flex items-center gap-1.5 hover:underline">
          <Plus size={16} /> Áreas y mesas
        </button>
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
