import { useLiveQuery } from 'dexie-react-hooks';
import { db, type ComandaItem } from '../lib/db';
import { addToQueue } from '../lib/sync';
import { ChefHat, Clock, Check, Flame } from 'lucide-react';
import { PageHeader, EmptyState, Skeleton } from '../components/ui';
import { useNow, minutesSince, formatElapsed } from '../lib/time';

// Escalado de urgencia por minutos en cocina (estándar de un KDS).
function urgency(mins: number) {
  if (mins >= 10) return { ring: 'border-red-400 shadow-[0_0_0_1px_#f87171]', chip: 'bg-red-500 text-white', head: 'from-red-600 to-red-700' };
  if (mins >= 5) return { ring: 'border-amber-300', chip: 'bg-amber-400 text-amber-950', head: 'from-amber-500 to-amber-600' };
  return { ring: 'border-gray-200', chip: 'bg-white/20 text-white', head: 'from-[#0B3B68] to-[#092b4d]' };
}

type KStatus = ComandaItem['kitchen_status'];

// Estados que se muestran en el tablero de cocina (activos).
const ACTIVE: KStatus[] = ['sent', 'preparando'];

export default function KdsPage() {
  const businessId = localStorage.getItem('nexus_business_id') || '';
  const now = useNow(15000);

  const itemsQuery = useLiveQuery(async () => {
    if (!businessId) return [] as ComandaItem[];
    const rows = await db.comanda_items
      .where('[business_id+kitchen_status]')
      .anyOf(ACTIVE.map(s => [businessId, s]))
      .toArray();
    return rows
      .filter(i => !i.voided)
      .sort((a, b) => (a.sent_at || a.created_at || '').localeCompare(b.sent_at || b.created_at || ''));
  }, [businessId]);

  const loading = itemsQuery === undefined;
  const items = itemsQuery ?? [];

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
      <PageHeader title="Cocina" icon={<ChefHat className="text-[#0B3B68]" />} className="mb-5" />

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
      ) : comandaIds.length === 0 ? (
        <div className="flex items-center justify-center min-h-[50vh]">
          <EmptyState icon={<Clock size={32} />} title="Todo al día"
            description="No hay pedidos en cocina por ahora. Las nuevas comandas aparecerán aquí." />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {comandaIds.map(cid => {
            const ticket = groups[cid];
            // Antigüedad del ticket = ítem más viejo enviado a cocina.
            const oldest = ticket.reduce((min, it) => {
              const t = it.sent_at || it.created_at;
              return t && (!min || t < min) ? t : min;
            }, undefined as string | undefined);
            const mins = minutesSince(oldest, now);
            const u = urgency(mins);
            return (
              <div key={cid} className={`bg-white rounded-2xl border-2 overflow-hidden shadow-card nx-rise ${u.ring}`}>
                <div className={`bg-gradient-to-r ${u.head} text-white px-4 py-2.5 flex items-center justify-between gap-2`}>
                  <span className="font-black truncate">{tableByComanda[cid] || 'Mesa'}</span>
                  <span className={`inline-flex items-center gap-1 text-xs font-black px-2 py-0.5 rounded-full ${u.chip}`}>
                    <Clock size={12} /> {formatElapsed(mins)}
                  </span>
                </div>
                <div className="p-3 space-y-2">
                  {ticket.map(it => (
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
                      <div className="flex gap-2 mt-2.5">
                        {it.kitchen_status === 'sent' && (
                          <button onClick={() => setStatus(it, 'preparando')}
                            className="flex-1 bg-amber-500 text-white text-sm font-bold py-2.5 rounded-lg flex items-center justify-center gap-1.5 active:scale-95 transition-transform">
                            <Flame size={16} /> Preparar
                          </button>
                        )}
                        <button onClick={() => setStatus(it, 'listo')}
                          className="flex-1 bg-grad-green text-white text-sm font-bold py-2.5 rounded-lg flex items-center justify-center gap-1.5 shadow-glow-green active:scale-95 transition-transform">
                          <Check size={16} /> Listo
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
