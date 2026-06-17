import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type RestaurantArea, type RestaurantTable } from '../lib/db';
import { addToQueue, syncPush } from '../lib/sync';
import { Plus, Trash2, UtensilsCrossed, MapPin } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Administración de áreas y mesas (modo restaurante). Crea/elimina (soft-delete)
 * áreas y mesas, encolando AREA_SYNC / TABLE_SYNC. Se monta en la pestaña
 * "Restaurante" de Configuración.
 */
export function RestaurantAdmin() {
  const businessId = localStorage.getItem('nexus_business_id') || '';
  const [areaName, setAreaName] = useState('');
  const [tableName, setTableName] = useState('');
  const [tableAreaId, setTableAreaId] = useState('');

  const areas = useLiveQuery(async () => {
    if (!businessId) return [];
    const rows = await db.restaurant_areas.where('business_id').equals(businessId).toArray();
    return rows.filter(a => !a.deleted_at).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }, [businessId]) || [];

  const tables = useLiveQuery(async () => {
    if (!businessId) return [];
    const rows = await db.restaurant_tables.where('business_id').equals(businessId).toArray();
    return rows.filter(t => !t.deleted_at).sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
  }, [businessId]) || [];

  const addArea = async () => {
    const name = areaName.trim();
    if (!name) return;
    const area: RestaurantArea = {
      id: crypto.randomUUID(), business_id: businessId, name,
      sort_order: areas.length, sync_status: 'pending_create',
    };
    await db.transaction('rw', [db.restaurant_areas, db.action_queue], async () => {
      await db.restaurant_areas.add(area);
      await addToQueue('AREA_SYNC', area);
    });
    setAreaName('');
    syncPush().catch(() => {});
  };

  const removeArea = async (area: RestaurantArea) => {
    if (tables.some(t => t.area_id === area.id)) {
      toast.error('Mueve o elimina primero las mesas de esta área');
      return;
    }
    const updated: RestaurantArea = { ...area, deleted_at: new Date().toISOString(), sync_status: 'pending_update' };
    await db.transaction('rw', [db.restaurant_areas, db.action_queue], async () => {
      await db.restaurant_areas.update(area.id, { deleted_at: updated.deleted_at, sync_status: 'pending_update' });
      await addToQueue('AREA_SYNC', updated);
    });
    syncPush().catch(() => {});
  };

  const addTable = async () => {
    const name = tableName.trim();
    if (!name) return toast.error('Escribe un nombre de mesa');
    const areaId = tableAreaId || areas[0]?.id;
    if (!areaId) return toast.error('Crea un área primero');
    const table: RestaurantTable = {
      id: crypto.randomUUID(), business_id: businessId, area_id: areaId, name,
      state: 'libre', sync_status: 'pending_create',
    };
    await db.transaction('rw', [db.restaurant_tables, db.action_queue], async () => {
      await db.restaurant_tables.add(table);
      await addToQueue('TABLE_SYNC', table);
    });
    setTableName('');
    syncPush().catch(() => {});
  };

  const removeTable = async (table: RestaurantTable) => {
    const updated: RestaurantTable = { ...table, deleted_at: new Date().toISOString(), sync_status: 'pending_update' };
    await db.transaction('rw', [db.restaurant_tables, db.action_queue], async () => {
      await db.restaurant_tables.update(table.id, { deleted_at: updated.deleted_at, sync_status: 'pending_update' });
      await addToQueue('TABLE_SYNC', updated);
    });
    syncPush().catch(() => {});
  };

  return (
    <div className="space-y-8">
      {/* Áreas */}
      <div>
        <h3 className="font-black text-[#1F2937] flex items-center gap-2 mb-3"><MapPin size={18} className="text-[#0B3B68]" /> Áreas</h3>
        <div className="flex gap-2 mb-3">
          <input value={areaName} onChange={e => setAreaName(e.target.value)} placeholder="Ej. Salón, Terraza"
            onKeyDown={e => e.key === 'Enter' && addArea()}
            className="flex-1 p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] outline-none" />
          <button onClick={addArea} className="bg-[#0B3B68] text-white px-4 rounded-xl font-bold flex items-center gap-1"><Plus size={18} /> Añadir</button>
        </div>
        <div className="flex flex-wrap gap-2">
          {areas.map(a => (
            <span key={a.id} className="inline-flex items-center gap-2 bg-gray-100 rounded-full pl-3 pr-1.5 py-1.5 text-sm font-bold text-[#1F2937]">
              {a.name}
              <button onClick={() => removeArea(a)} className="p-1 rounded-full text-red-500 hover:bg-red-100"><Trash2 size={13} /></button>
            </span>
          ))}
          {areas.length === 0 && <p className="text-sm text-[#9CA3AF]">Aún no hay áreas.</p>}
        </div>
      </div>

      {/* Mesas */}
      <div>
        <h3 className="font-black text-[#1F2937] flex items-center gap-2 mb-3"><UtensilsCrossed size={18} className="text-[#0B3B68]" /> Mesas</h3>
        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <input value={tableName} onChange={e => setTableName(e.target.value)} placeholder="Ej. Mesa 1"
            onKeyDown={e => e.key === 'Enter' && addTable()}
            className="flex-1 p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] outline-none" />
          <select value={tableAreaId} onChange={e => setTableAreaId(e.target.value)}
            className="p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] outline-none bg-white">
            <option value="">{areas[0] ? areas[0].name : 'Sin áreas'}</option>
            {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button onClick={addTable} className="bg-[#0B3B68] text-white px-4 py-3 rounded-xl font-bold flex items-center justify-center gap-1"><Plus size={18} /> Añadir</button>
        </div>
        <div className="space-y-4">
          {areas.map(area => {
            const areaTables = tables.filter(t => t.area_id === area.id);
            if (areaTables.length === 0) return null;
            return (
              <div key={area.id}>
                <p className="text-xs font-black text-[#6B7280] uppercase mb-2">{area.name}</p>
                <div className="flex flex-wrap gap-2">
                  {areaTables.map(t => (
                    <span key={t.id} className="inline-flex items-center gap-2 bg-white border border-gray-200 rounded-xl pl-3 pr-1.5 py-1.5 text-sm font-bold text-[#1F2937]">
                      {t.name}
                      <button onClick={() => removeTable(t)} className="p-1 rounded-lg text-red-500 hover:bg-red-50"><Trash2 size={13} /></button>
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
          {tables.length === 0 && <p className="text-sm text-[#9CA3AF]">Aún no hay mesas.</p>}
        </div>
      </div>
    </div>
  );
}
