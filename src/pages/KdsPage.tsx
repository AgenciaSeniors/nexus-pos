import { useLiveQuery } from 'dexie-react-hooks';
import { db, type ComandaItem } from '../lib/db';
import { addToQueue } from '../lib/sync';
import { ChefHat, Clock, Check, Flame } from 'lucide-react';

type KStatus = ComandaItem['kitchen_status'];

// Estados que se muestran en el tablero de cocina (activos).
const ACTIVE: KStatus[] = ['sent', 'preparando'];

export default function KdsPage() {
  const businessId = localStorage.getItem('nexus_business_id') || '';

  const items = useLiveQuery(async () => {
    if (!businessId) return [] as ComandaItem[];
    const rows = await db.comanda_items
      .where('[business_id+kitchen_status]')
      .anyOf(ACTIVE.map(s => [businessId, s]))
      .toArray();
    return rows
      .filter(i => !i.voided)
      .sort((a, b) => (a.sent_at || a.created_at || '').localeCompare(b.sent_at || b.created_at || ''));
  }, [businessId]) || [];

  // Nombres de mesa por comanda (para encabezar cada ticket).
  const tableByComanda = useLiveQuery(async () => {
    if (!businessId) return {} as Record<string, string>;
    const comandas = await db.comandas.where('business_id').equals(businessId).toArray();
    const tables = await db.restaurant_tables.where('business_id').equals(businessId).toArray();
    const tName: Record<string, string> = {};
    for (const t of tables) tName[t.id] = t.name;
    const map: Record<string, string> = {};
    for (const c of comandas) map[c.id] = tName[c.table_id] || 'Mesa';
    return map;
  }, [businessId]) || {};

  const setStatus = async (item: ComandaItem, status: KStatus) => {
    const now = new Date().toISOString();
    const patch: Partial<ComandaItem> = {
      kitchen_status: status,
      item_updated_at: now,
      sync_status: 'pending_update',
      ...(status === 'listo' ? { ready_at: now } : {}),
    };
    await db.transaction('rw', [db.comanda_items, db.action_queue], async () => {
      await db.comanda_items.update(item.id, patch);
      await addToQueue('KITCHEN_STATUS', {
        item_id: item.id, comanda_id: item.comanda_id, business_id: businessId,
        kitchen_status: status, item_updated_at: now,
      });
    });
  };

  // Agrupar por comanda (cada comanda = un ticket en cocina).
  const groups = items.reduce((acc, it) => {
    (acc[it.comanda_id] ||= []).push(it);
    return acc;
  }, {} as Record<string, ComandaItem[]>);
  const comandaIds = Object.keys(groups);

  return (
    <div className="p-4 md:p-6">
      <h1 className="text-2xl font-black text-[#1F2937] flex items-center gap-2 mb-5">
        <ChefHat className="text-[#0B3B68]" /> Cocina
      </h1>

      {comandaIds.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
          <Clock className="text-[#9CA3AF] mb-3" size={40} />
          <p className="text-[#6B7280] font-medium">No hay pedidos en cocina por ahora.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {comandaIds.map(cid => (
            <div key={cid} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="bg-[#0B3B68] text-white px-4 py-2 font-black">{tableByComanda[cid] || 'Mesa'}</div>
              <div className="p-3 space-y-2">
                {groups[cid].map(it => (
                  <div key={it.id} className={`p-3 rounded-xl border ${it.kitchen_status === 'preparando' ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-bold text-[#1F2937]">
                          <span className="text-[#0B3B68]">{it.quantity}×</span> {it.name}
                        </p>
                        {it.modifiers?.length ? (
                          <p className="text-xs text-[#0B3B68] mt-0.5">{it.modifiers.map(m => m.modifier_name).join(', ')}</p>
                        ) : null}
                        {it.note && <p className="text-xs text-amber-700 mt-0.5">📝 {it.note}</p>}
                      </div>
                    </div>
                    <div className="flex gap-2 mt-2">
                      {it.kitchen_status === 'sent' && (
                        <button onClick={() => setStatus(it, 'preparando')}
                          className="flex-1 bg-amber-500 text-white text-sm font-bold py-1.5 rounded-lg flex items-center justify-center gap-1">
                          <Flame size={14} /> Preparar
                        </button>
                      )}
                      <button onClick={() => setStatus(it, 'listo')}
                        className="flex-1 bg-[#7AC142] text-white text-sm font-bold py-1.5 rounded-lg flex items-center justify-center gap-1">
                        <Check size={14} /> Listo
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
