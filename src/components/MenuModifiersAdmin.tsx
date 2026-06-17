import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type ModifierGroup, type Modifier, type ProductModifierGroup } from '../lib/db';
import { addToQueue, syncPush } from '../lib/sync';
import { Plus, Trash2, SlidersHorizontal, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';

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

  const groups = useLiveQuery(async () => {
    if (!businessId) return [];
    const rows = await db.modifier_groups.where('business_id').equals(businessId).toArray();
    return rows.filter(g => !g.deleted_at).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }, [businessId]) || [];

  const modifiers = useLiveQuery(async () => {
    if (!businessId) return [];
    const rows = await db.modifiers.where('business_id').equals(businessId).toArray();
    return rows.filter(m => !m.deleted_at);
  }, [businessId]) || [];

  const products = useLiveQuery(async () => {
    if (!businessId) return [];
    const rows = await db.products.where('business_id').equals(businessId).toArray();
    return rows.filter(p => !p.deleted_at).sort((a, b) => a.name.localeCompare(b.name));
  }, [businessId]) || [];

  const links = useLiveQuery(async () => {
    if (!businessId) return [];
    const rows = await db.product_modifier_groups.where('business_id').equals(businessId).toArray();
    return rows.filter(l => !l.deleted_at);
  }, [businessId]) || [];

  const enqueue = (type: 'MODIFIER_GROUP_SYNC' | 'MODIFIER_SYNC' | 'PRODUCT_MODIFIER_SYNC', payload: ModifierGroup | Modifier | ProductModifierGroup) =>
    addToQueue(type, payload);

  const addGroup = async () => {
    const name = groupName.trim();
    if (!name) return;
    const group: ModifierGroup = {
      id: crypto.randomUUID(), business_id: businessId, name,
      max_select: groupMulti ? undefined : 1, required: groupRequired,
      sort_order: groups.length, sync_status: 'pending_create',
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

  const toggleAssign = async (groupId: string, checked: boolean) => {
    if (!assignProductId) return;
    const existing = links.find(l => l.product_id === assignProductId && l.group_id === groupId);
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

  const assignedGroupIds = new Set(links.filter(l => l.product_id === assignProductId).map(l => l.group_id));

  return (
    <div className="space-y-8">
      {/* Crear grupo */}
      <div>
        <h3 className="font-black text-[#1F2937] flex items-center gap-2 mb-3"><SlidersHorizontal size={18} className="text-[#0B3B68]" /> Grupos de modificadores</h3>
        <div className="flex flex-col sm:flex-row gap-2 mb-2">
          <input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="Ej. Término, Extras"
            onKeyDown={e => e.key === 'Enter' && addGroup()}
            className="flex-1 p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] outline-none" />
          <button onClick={addGroup} className="bg-[#0B3B68] text-white px-4 py-3 rounded-xl font-bold flex items-center justify-center gap-1"><Plus size={18} /> Grupo</button>
        </div>
        <div className="flex gap-4 text-sm text-[#6B7280] mb-4">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={groupMulti} onChange={e => setGroupMulti(e.target.checked)} /> Permitir varias opciones</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={groupRequired} onChange={e => setGroupRequired(e.target.checked)} /> Obligatorio</label>
        </div>

        <div className="space-y-3">
          {groups.map(g => (
            <div key={g.id} className="border border-gray-200 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="font-bold text-[#1F2937]">{g.name}
                  <span className="ml-2 text-[11px] font-normal text-[#6B7280]">{g.max_select === 1 ? 'única' : 'múltiple'}{g.required ? ' · obligatorio' : ''}</span>
                </p>
                <button onClick={() => removeGroup(g)} className="p-1 rounded-lg text-red-500 hover:bg-red-50"><Trash2 size={14} /></button>
              </div>
              <div className="flex flex-wrap gap-2 mb-2">
                {modifiers.filter(m => m.group_id === g.id).map(m => (
                  <span key={m.id} className="inline-flex items-center gap-1.5 bg-gray-100 rounded-full pl-3 pr-1.5 py-1 text-sm">
                    {m.name}{m.price_delta ? ` +$${m.price_delta.toFixed(2)}` : ''}
                    <button onClick={() => removeModifier(m)} className="p-0.5 rounded-full text-red-500 hover:bg-red-100"><Trash2 size={12} /></button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={modName[g.id] || ''} onChange={e => setModName(s => ({ ...s, [g.id]: e.target.value }))} placeholder="Opción (ej. Bien cocido)"
                  className="flex-1 p-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#0B3B68]" />
                <input value={modPrice[g.id] || ''} onChange={e => setModPrice(s => ({ ...s, [g.id]: e.target.value }))} placeholder="+$" inputMode="decimal"
                  className="w-20 p-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#0B3B68]" />
                <button onClick={() => addModifier(g.id)} className="bg-gray-100 px-3 rounded-lg font-bold text-[#0B3B68]"><Plus size={16} /></button>
              </div>
            </div>
          ))}
          {groups.length === 0 && <p className="text-sm text-[#9CA3AF]">Aún no hay grupos de modificadores.</p>}
        </div>
      </div>

      {/* Asignar a productos */}
      {groups.length > 0 && (
        <div>
          <h3 className="font-black text-[#1F2937] flex items-center gap-2 mb-3"><ChevronDown size={18} className="text-[#0B3B68]" /> Asignar a un producto</h3>
          <select value={assignProductId} onChange={e => setAssignProductId(e.target.value)}
            className="w-full p-3 border border-gray-200 rounded-xl bg-white focus:ring-2 focus:ring-[#0B3B68] outline-none mb-3">
            <option value="">Elige un producto…</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {assignProductId && (
            <div className="flex flex-wrap gap-2">
              {groups.map(g => (
                <label key={g.id} className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border-2 cursor-pointer text-sm font-bold ${assignedGroupIds.has(g.id) ? 'border-[#7AC142] bg-[#7AC142]/5 text-[#0B3B68]' : 'border-gray-200 text-[#6B7280]'}`}>
                  <input type="checkbox" checked={assignedGroupIds.has(g.id)} onChange={e => toggleAssign(g.id, e.target.checked)} />
                  {g.name}
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
