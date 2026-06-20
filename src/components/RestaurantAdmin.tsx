import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type RestaurantArea, type RestaurantTable } from '../lib/db';
import { addToQueue, syncPush } from '../lib/sync';
import { Plus, Trash2, UtensilsCrossed, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { SectionCard, Input, Select, Button, Badge, EmptyState, SkeletonList, ConfirmDialog } from './ui';

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
  // Pendiente de confirmación de borrado: área o mesa.
  const [confirm, setConfirm] = useState<{ kind: 'area' | 'table'; row: RestaurantArea | RestaurantTable } | null>(null);

  const areas = useLiveQuery(async () => {
    if (!businessId) return [];
    const rows = await db.restaurant_areas.where('business_id').equals(businessId).toArray();
    return rows.filter(a => !a.deleted_at).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }, [businessId]);

  const tables = useLiveQuery(async () => {
    if (!businessId) return [];
    const rows = await db.restaurant_tables.where('business_id').equals(businessId).toArray();
    return rows.filter(t => !t.deleted_at).sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
  }, [businessId]);

  const loading = areas === undefined || tables === undefined;
  const areaList = areas ?? [];
  const tableList = tables ?? [];

  const addArea = async () => {
    const name = areaName.trim();
    if (!name) return;
    const area: RestaurantArea = {
      id: crypto.randomUUID(), business_id: businessId, name,
      sort_order: areaList.length, sync_status: 'pending_create',
    };
    await db.transaction('rw', [db.restaurant_areas, db.action_queue], async () => {
      await db.restaurant_areas.add(area);
      await addToQueue('AREA_SYNC', area);
    });
    setAreaName('');
    syncPush().catch(() => {});
  };

  const removeArea = async (area: RestaurantArea) => {
    if (tableList.some(t => t.area_id === area.id)) {
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
    const areaId = tableAreaId || areaList[0]?.id;
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

  const confirmDelete = async () => {
    if (!confirm) return;
    if (confirm.kind === 'area') await removeArea(confirm.row as RestaurantArea);
    else await removeTable(confirm.row as RestaurantTable);
    setConfirm(null);
  };

  return (
    <div className="space-y-6">
      {/* Áreas */}
      <SectionCard title="Áreas" icon={<MapPin size={18} className="text-[#0B3B68]" />}
        subtitle="Zonas de tu local (salón, terraza, barra…).">
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <Input value={areaName} onChange={e => setAreaName(e.target.value)} placeholder="Ej. Salón, Terraza"
            onKeyDown={e => e.key === 'Enter' && addArea()} aria-label="Nombre del área" className="flex-1" />
          <Button onClick={addArea} icon={<Plus size={18} />} disabled={!areaName.trim()}>Añadir</Button>
        </div>
        {loading ? (
          <SkeletonList rows={2} rowClassName="h-9 w-40" className="flex flex-wrap gap-2 space-y-0" />
        ) : areaList.length === 0 ? (
          <EmptyState size="sm" icon={<MapPin size={22} />} title="Aún no hay áreas"
            description="Crea tu primera área para poder agregar mesas." />
        ) : (
          <div className="flex flex-wrap gap-2">
            {areaList.map(a => (
              <Badge key={a.id} color="navy" className="pr-1.5">
                {a.name}
                <button onClick={() => setConfirm({ kind: 'area', row: a })}
                  aria-label={`Eliminar área ${a.name}`}
                  className="p-1 rounded-full text-red-500 hover:bg-red-100 transition-colors">
                  <Trash2 size={13} />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Mesas */}
      <SectionCard title="Mesas" icon={<UtensilsCrossed size={18} className="text-[#0B3B68]" />}
        subtitle="Cada mesa abre una comanda independiente.">
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <Input value={tableName} onChange={e => setTableName(e.target.value)} placeholder="Ej. Mesa 1"
            onKeyDown={e => e.key === 'Enter' && addTable()} aria-label="Nombre de la mesa" className="flex-1" />
          <Select value={tableAreaId} onChange={e => setTableAreaId(e.target.value)} aria-label="Área de la mesa"
            className="sm:w-44" disabled={areaList.length === 0}>
            <option value="">{areaList[0] ? areaList[0].name : 'Sin áreas'}</option>
            {areaList.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
          <Button onClick={addTable} icon={<Plus size={18} />} disabled={!tableName.trim() || areaList.length === 0}>
            Añadir
          </Button>
        </div>

        {loading ? (
          <SkeletonList rows={3} />
        ) : tableList.length === 0 ? (
          <EmptyState size="sm" icon={<UtensilsCrossed size={22} />} title="Aún no hay mesas"
            description={areaList.length === 0 ? 'Primero crea un área arriba.' : 'Agrega tu primera mesa para empezar a tomar comandas.'} />
        ) : (
          <div className="space-y-4">
            {areaList.map(area => {
              const areaTables = tableList.filter(t => t.area_id === area.id);
              if (areaTables.length === 0) return null;
              return (
                <div key={area.id}>
                  <p className="text-xs font-black text-[#6B7280] uppercase tracking-wide mb-2">{area.name}</p>
                  <div className="flex flex-wrap gap-2">
                    {areaTables.map(t => (
                      <Badge key={t.id} color="gray" className="bg-white border border-gray-200 pr-1.5">
                        {t.name}
                        <button onClick={() => setConfirm({ kind: 'table', row: t })}
                          aria-label={`Eliminar ${t.name}`}
                          className="p-1 rounded-lg text-red-500 hover:bg-red-50 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {confirm && (
        <ConfirmDialog
          title={confirm.kind === 'area' ? 'Eliminar área' : 'Eliminar mesa'}
          message={<>¿Seguro que quieres eliminar <span className="font-bold text-[#1F2937]">{confirm.row.name}</span>? Esta acción no se puede deshacer.</>}
          onConfirm={confirmDelete}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
