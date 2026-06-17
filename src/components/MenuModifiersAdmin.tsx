import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type ModifierGroup, type Modifier, type ProductModifierGroup } from '../lib/db';
import { addToQueue, syncPush } from '../lib/sync';
import { Plus, Trash2, SlidersHorizontal, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { SectionCard, Card, Input, Select, Button, Badge, EmptyState, SkeletonList, ConfirmDialog, cn } from './ui';

/**
 * Administración de modificadores del menú (Fase 3): grupos, sus opciones y la
 * asignación de grupos a productos. Encola MODIFIER_GROUP_SYNC / MODIFIER_SYNC /
 * PRODUCT_MODIFIER_SYNC. Se monta en la pestaña "Menú" de Configuración.
 */
export function MenuModifiersAdmin() {
  const businessId = localStorage.getItem('nexus_business_id') || '';
  const [groupName, setGroupName] = useState('');
  const [groupMulti, setGroupMulti] = useState(false);
  const [groupRequired, setGroupRequired] = useState(false);
  const [modName, setModName] = useState<Record<string, string>>({});
  const [modPrice, setModPrice] = useState<Record<string, string>>({});
  const [assignProductId, setAssignProductId] = useState('');
  const [confirm, setConfirm] = useState<{ kind: 'group' | 'modifier'; row: ModifierGroup | Modifier } | null>(null);

  const groups = useLiveQuery(async () => {
    if (!businessId) return [];
    const rows = await db.modifier_groups.where('business_id').equals(businessId).toArray();
    return rows.filter(g => !g.deleted_at).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }, [businessId]);

  const modifiers = useLiveQuery(async () => {
    if (!businessId) return [];
    const rows = await db.modifiers.where('business_id').equals(businessId).toArray();
    return rows.filter(m => !m.deleted_at);
  }, [businessId]);

  const products = useLiveQuery(async () => {
    if (!businessId) return [];
    const rows = await db.products.where('business_id').equals(businessId).toArray();
    return rows.filter(p => !p.deleted_at).sort((a, b) => a.name.localeCompare(b.name));
  }, [businessId]);

  const links = useLiveQuery(async () => {
    if (!businessId) return [];
    const rows = await db.product_modifier_groups.where('business_id').equals(businessId).toArray();
    return rows.filter(l => !l.deleted_at);
  }, [businessId]);

  const loading = groups === undefined || modifiers === undefined || products === undefined || links === undefined;
  const groupList = groups ?? [];
  const modifierList = modifiers ?? [];
  const productList = products ?? [];
  const linkList = links ?? [];

  const enqueue = (type: 'MODIFIER_GROUP_SYNC' | 'MODIFIER_SYNC' | 'PRODUCT_MODIFIER_SYNC', payload: ModifierGroup | Modifier | ProductModifierGroup) =>
    addToQueue(type, payload);

  const addGroup = async () => {
    const name = groupName.trim();
    if (!name) return;
    const group: ModifierGroup = {
      id: crypto.randomUUID(), business_id: businessId, name,
      max_select: groupMulti ? undefined : 1, required: groupRequired,
      sort_order: groupList.length, sync_status: 'pending_create',
    };
    await db.transaction('rw', [db.modifier_groups, db.action_queue], async () => {
      await db.modifier_groups.add(group);
      await enqueue('MODIFIER_GROUP_SYNC', group);
    });
    setGroupName(''); setGroupMulti(false); setGroupRequired(false);
    syncPush().catch(() => {});
  };

  const removeGroup = async (group: ModifierGroup) => {
    const updated: ModifierGroup = { ...group, deleted_at: new Date().toISOString(), sync_status: 'pending_update' };
    await db.transaction('rw', [db.modifier_groups, db.action_queue], async () => {
      await db.modifier_groups.update(group.id, { deleted_at: updated.deleted_at, sync_status: 'pending_update' });
      await enqueue('MODIFIER_GROUP_SYNC', updated);
    });
    syncPush().catch(() => {});
  };

  const addModifier = async (groupId: string) => {
    const name = (modName[groupId] || '').trim();
    if (!name) return toast.error('Escribe el nombre de la opción');
    const price = parseFloat(modPrice[groupId] || '0') || 0;
    const modifier: Modifier = {
      id: crypto.randomUUID(), business_id: businessId, group_id: groupId, name,
      price_delta: price, sync_status: 'pending_create',
    };
    await db.transaction('rw', [db.modifiers, db.action_queue], async () => {
      await db.modifiers.add(modifier);
      await enqueue('MODIFIER_SYNC', modifier);
    });
    setModName(s => ({ ...s, [groupId]: '' }));
    setModPrice(s => ({ ...s, [groupId]: '' }));
    syncPush().catch(() => {});
  };

  const removeModifier = async (modifier: Modifier) => {
    const updated: Modifier = { ...modifier, deleted_at: new Date().toISOString(), sync_status: 'pending_update' };
    await db.transaction('rw', [db.modifiers, db.action_queue], async () => {
      await db.modifiers.update(modifier.id, { deleted_at: updated.deleted_at, sync_status: 'pending_update' });
      await enqueue('MODIFIER_SYNC', updated);
    });
    syncPush().catch(() => {});
  };

  const confirmDelete = async () => {
    if (!confirm) return;
    if (confirm.kind === 'group') await removeGroup(confirm.row as ModifierGroup);
    else await removeModifier(confirm.row as Modifier);
    setConfirm(null);
  };

  const toggleAssign = async (groupId: string, checked: boolean) => {
    if (!assignProductId) return;
    const existing = linkList.find(l => l.product_id === assignProductId && l.group_id === groupId);
    if (checked && !existing) {
      const link: ProductModifierGroup = {
        id: crypto.randomUUID(), business_id: businessId, product_id: assignProductId,
        group_id: groupId, sync_status: 'pending_create',
      };
      await db.transaction('rw', [db.product_modifier_groups, db.action_queue], async () => {
        await db.product_modifier_groups.add(link);
        await enqueue('PRODUCT_MODIFIER_SYNC', link);
      });
    } else if (!checked && existing) {
      const updated: ProductModifierGroup = { ...existing, deleted_at: new Date().toISOString(), sync_status: 'pending_update' };
      await db.transaction('rw', [db.product_modifier_groups, db.action_queue], async () => {
        await db.product_modifier_groups.update(existing.id, { deleted_at: updated.deleted_at, sync_status: 'pending_update' });
        await enqueue('PRODUCT_MODIFIER_SYNC', updated);
      });
    }
    syncPush().catch(() => {});
  };

  const assignedGroupIds = new Set(linkList.filter(l => l.product_id === assignProductId).map(l => l.group_id));

  return (
    <div className="space-y-6">
      {/* Crear grupo */}
      <SectionCard title="Grupos de modificadores" icon={<SlidersHorizontal size={18} className="text-[#0B3B68]" />}
        subtitle="Ej. “Término” (única opción) o “Extras” (varias). Cada opción puede sumar precio.">
        <div className="flex flex-col sm:flex-row gap-2 mb-2">
          <Input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="Nombre del grupo (ej. Término, Extras)"
            onKeyDown={e => e.key === 'Enter' && addGroup()} aria-label="Nombre del grupo" className="flex-1" />
          <Button onClick={addGroup} icon={<Plus size={18} />} disabled={!groupName.trim()}>Crear grupo</Button>
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-[#6B7280] mb-5">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={groupMulti} onChange={e => setGroupMulti(e.target.checked)} className="accent-[#0B3B68]" />
            Permitir varias opciones
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={groupRequired} onChange={e => setGroupRequired(e.target.checked)} className="accent-[#0B3B68]" />
            Obligatorio
          </label>
        </div>

        {loading ? (
          <SkeletonList rows={2} rowClassName="h-24" />
        ) : groupList.length === 0 ? (
          <EmptyState size="sm" icon={<SlidersHorizontal size={22} />} title="Aún no hay grupos"
            description="Crea tu primer grupo para ofrecer opciones al ordenar (término, extras, salsas…)." />
        ) : (
          <div className="space-y-3">
            {groupList.map(g => (
              <Card key={g.id} className="p-3">
                <div className="flex items-center justify-between mb-2 gap-2">
                  <p className="font-bold text-[#1F2937] min-w-0 truncate">
                    {g.name}
                    <span className="ml-2 text-[11px] font-normal text-[#6B7280]">
                      {g.max_select === 1 ? 'única' : 'múltiple'}{g.required ? ' · obligatorio' : ''}
                    </span>
                  </p>
                  <button onClick={() => setConfirm({ kind: 'group', row: g })} aria-label={`Eliminar grupo ${g.name}`}
                    className="p-1 rounded-lg text-red-500 hover:bg-red-50 transition-colors shrink-0">
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 mb-2">
                  {modifierList.filter(m => m.group_id === g.id).map(m => (
                    <Badge key={m.id} color="gray" className="pr-1.5 font-medium">
                      {m.name}{m.price_delta ? ` +$${m.price_delta.toFixed(2)}` : ''}
                      <button onClick={() => setConfirm({ kind: 'modifier', row: m })} aria-label={`Eliminar opción ${m.name}`}
                        className="p-0.5 rounded-full text-red-500 hover:bg-red-100 transition-colors">
                        <Trash2 size={12} />
                      </button>
                    </Badge>
                  ))}
                  {modifierList.filter(m => m.group_id === g.id).length === 0 && (
                    <span className="text-xs text-[#9CA3AF]">Sin opciones todavía.</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input value={modName[g.id] || ''} onChange={e => setModName(s => ({ ...s, [g.id]: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && addModifier(g.id)}
                    placeholder="Opción (ej. Bien cocido)" aria-label="Nombre de la opción" className="flex-1" />
                  <Input value={modPrice[g.id] || ''} onChange={e => setModPrice(s => ({ ...s, [g.id]: e.target.value }))}
                    placeholder="+$" inputMode="decimal" aria-label="Precio extra" className="w-24" />
                  <Button variant="secondary" size="sm" onClick={() => addModifier(g.id)} icon={<Plus size={16} />}
                    aria-label="Añadir opción" />
                </div>
              </Card>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Asignar a productos */}
      {groupList.length > 0 && (
        <SectionCard title="Asignar a un producto" icon={<Link2 size={18} className="text-[#0B3B68]" />}
          subtitle="Elige un producto y marca qué grupos de modificadores se ofrecen al pedirlo.">
          <Select value={assignProductId} onChange={e => setAssignProductId(e.target.value)} aria-label="Producto" className="mb-3">
            <option value="">Elige un producto…</option>
            {productList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          {assignProductId && (
            <div className="flex flex-wrap gap-2">
              {groupList.map(g => (
                <label key={g.id}
                  className={cn(
                    'inline-flex items-center gap-2 px-3 py-2 rounded-xl border-2 cursor-pointer text-sm font-bold transition-colors',
                    assignedGroupIds.has(g.id) ? 'border-[#7AC142] bg-[#7AC142]/5 text-[#0B3B68]' : 'border-gray-200 text-[#6B7280] hover:border-gray-300',
                  )}>
                  <input type="checkbox" checked={assignedGroupIds.has(g.id)} onChange={e => toggleAssign(g.id, e.target.checked)}
                    className="accent-[#7AC142]" />
                  {g.name}
                </label>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.kind === 'group' ? 'Eliminar grupo' : 'Eliminar opción'}
          message={<>¿Seguro que quieres eliminar <span className="font-bold text-[#1F2937]">{confirm.row.name}</span>?{confirm.kind === 'group' ? ' Se quitarán también sus opciones.' : ''}</>}
          onConfirm={confirmDelete}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
