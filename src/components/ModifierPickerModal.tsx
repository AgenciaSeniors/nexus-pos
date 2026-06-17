import { useState } from 'react';
import type { Product, ModifierGroup, Modifier, ComandaItemModifier } from '../lib/db';
import { modifiersTotal as sumDeltas, validateGroupSelection } from '../lib/modifiers';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { Modal, Button } from './ui';

interface Props {
  product: Product;
  groups: ModifierGroup[];                 // grupos asignados a este producto
  modifiers: Modifier[];                   // todos los modificadores (se filtran por grupo)
  onCancel: () => void;
  onConfirm: (selected: ComandaItemModifier[], perUnitTotal: number) => void;
}

export function ModifierPickerModal({ product, groups, modifiers, onCancel, onConfirm }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const modsOf = (groupId: string) => modifiers.filter(m => m.group_id === groupId && !m.deleted_at);

  const toggle = (group: ModifierGroup, modId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      const single = (group.max_select ?? 1) === 1;
      if (single) {
        // Deseleccionar las demás opciones del mismo grupo.
        for (const m of modsOf(group.id)) next.delete(m.id);
        next.add(modId);
      } else {
        if (next.has(modId)) next.delete(modId); else next.add(modId);
      }
      return next;
    });
  };

  const selectedModifiers = (): ComandaItemModifier[] => {
    const out: ComandaItemModifier[] = [];
    for (const g of groups) {
      for (const m of modsOf(g.id)) {
        if (selected.has(m.id)) {
          out.push({ group_id: g.id, group_name: g.name, modifier_id: m.id, modifier_name: m.name, price_delta: m.price_delta || 0 });
        }
      }
    }
    return out;
  };

  const confirm = () => {
    for (const g of groups) {
      const count = modsOf(g.id).filter(m => selected.has(m.id)).length;
      const err = validateGroupSelection(g, count);
      if (err) return toast.error(`${g.name}: ${err}`);
    }
    const chosen = selectedModifiers();
    onConfirm(chosen, sumDeltas(chosen));
  };

  const total = sumDeltas(selectedModifiers());

  return (
    <Modal
      title={product.name}
      onClose={onCancel}
      size="md"
      footer={
        <Button variant="navy" fullWidth size="lg" onClick={confirm}>
          Agregar{total > 0 ? ` (+$${total.toFixed(2)})` : ''}
        </Button>
      }
    >
      <div className="p-4 space-y-5">
        {groups.map(g => (
          <div key={g.id}>
            <p className="font-bold text-[#1F2937] mb-2">
              {g.name}
              <span className="ml-2 text-[11px] font-normal text-[#6B7280]">
                {(g.max_select ?? 1) === 1 ? 'elige una' : 'varias'}{g.required ? ' · obligatorio' : ''}
              </span>
            </p>
            <div className="space-y-1.5">
              {modsOf(g.id).map(m => {
                const on = selected.has(m.id);
                return (
                  <button key={m.id} onClick={() => toggle(g, m.id)} aria-pressed={on}
                    className={`w-full flex items-center justify-between p-3 rounded-xl border-2 text-left transition-all active:scale-[0.99] ${on ? 'border-[#7AC142] bg-[#7AC142]/5' : 'border-gray-200 hover:border-gray-300'}`}>
                    <span className="font-medium text-[#1F2937]">{m.name}</span>
                    <span className="flex items-center gap-2">
                      {m.price_delta ? <span className="text-sm text-[#6B7280]">+${m.price_delta.toFixed(2)}</span> : null}
                      {on && <Check size={16} className="text-[#7AC142]" />}
                    </span>
                  </button>
                );
              })}
              {modsOf(g.id).length === 0 && <p className="text-sm text-[#9CA3AF]">Sin opciones.</p>}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
