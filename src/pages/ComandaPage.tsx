import { useState, useMemo } from 'react';
import { useParams, useNavigate, useOutletContext } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type ComandaItem, type ComandaItemModifier, type Product, type Sale, type SaleItem, type Staff } from '../lib/db';
import { addToQueue, syncPush } from '../lib/sync';
import { comandaItemTotal, comandaTotal } from '../lib/comanda';
import { currency } from '../lib/currency';
import { logAuditAction } from '../lib/audit';
import { PaymentModal } from '../components/PaymentModal';
import { ModifierPickerModal } from '../components/ModifierPickerModal';
import { ArrowLeft, Search, Plus, Minus, Trash2, Package, CreditCard, ChefHat } from 'lucide-react';
import { toast } from 'sonner';

export default function ComandaPage() {
  const { id: comandaId = '' } = useParams();
  const navigate = useNavigate();
  const { currentStaff } = useOutletContext<{ currentStaff: Staff }>();
  const businessId = localStorage.getItem('nexus_business_id') || '';

  const [query, setQuery] = useState('');
  const [showPayment, setShowPayment] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [pickerProduct, setPickerProduct] = useState<Product | null>(null);

  const comanda = useLiveQuery(() => db.comandas.get(comandaId), [comandaId]);
  const table = useLiveQuery(() => comanda ? db.restaurant_tables.get(comanda.table_id) : undefined, [comanda?.table_id]);

  const items = useLiveQuery(
    () => db.comanda_items.where('comanda_id').equals(comandaId).toArray(),
    [comandaId],
  ) || [];

  const products = useLiveQuery(async () => {
    if (!businessId) return [];
    const rows = await db.products.where('business_id').equals(businessId).toArray();
    return rows.filter(p => !p.deleted_at).sort((a, b) => a.name.localeCompare(b.name));
  }, [businessId]) || [];

  const activeShift = useLiveQuery(
    () => businessId ? db.cash_shifts.where({ business_id: businessId, status: 'open' }).first() : undefined,
    [businessId],
  );

  // Config de modificadores del menú.
  const modifierGroups = useLiveQuery(async () => {
    if (!businessId) return [];
    return (await db.modifier_groups.where('business_id').equals(businessId).toArray()).filter(g => !g.deleted_at);
  }, [businessId]) || [];
  const modifiersAll = useLiveQuery(async () => {
    if (!businessId) return [];
    return (await db.modifiers.where('business_id').equals(businessId).toArray()).filter(m => !m.deleted_at);
  }, [businessId]) || [];
  const productLinks = useLiveQuery(async () => {
    if (!businessId) return [];
    return (await db.product_modifier_groups.where('business_id').equals(businessId).toArray()).filter(l => !l.deleted_at);
  }, [businessId]) || [];

  const groupsForProduct = (productId: string) => {
    const ids = new Set(productLinks.filter(l => l.product_id === productId).map(l => l.group_id));
    return modifierGroups.filter(g => ids.has(g.id)).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  };

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(p => p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q));
  }, [products, query]);

  const total = comandaTotal(items);

  const createItem = async (product: Product, modifiers?: ComandaItemModifier[], perUnitTotal?: number) => {
    if (!comanda) return;
    const hasMods = !!modifiers && modifiers.length > 0;
    try {
      // Sin modificadores ni nota: si ya existe una línea idéntica, sumar cantidad.
      if (!hasMods) {
        const existing = items.find(i => i.product_id === product.id && !i.note && !i.modifiers?.length && !i.voided);
        if (existing) {
          const updated: ComandaItem = { ...existing, quantity: existing.quantity + 1, sync_status: 'pending_update' };
          await db.transaction('rw', [db.comanda_items, db.action_queue], async () => {
            await db.comanda_items.update(existing.id, { quantity: updated.quantity, sync_status: 'pending_update' });
            await addToQueue('COMANDA_ITEM_SYNC', updated);
          });
          return;
        }
      }
      const item: ComandaItem = {
        id: crypto.randomUUID(), comanda_id: comanda.id, business_id: businessId,
        product_id: product.id, name: product.name, quantity: 1, price: product.price,
        ...(hasMods ? { modifiers, modifiers_total: perUnitTotal ?? 0 } : {}),
        kitchen_status: 'pending', sync_status: 'pending_create',
      };
      await db.transaction('rw', [db.comanda_items, db.action_queue], async () => {
        await db.comanda_items.add(item);
        await addToQueue('COMANDA_ITEM_SYNC', item);
      });
    } catch (e) {
      console.error(e);
      toast.error('No se pudo agregar el producto');
    }
  };

  const addProduct = async (product: Product) => {
    if (!comanda) return;
    // Si el producto tiene grupos de modificadores, abrir el selector.
    if (groupsForProduct(product.id).length > 0) {
      setPickerProduct(product);
      return;
    }
    await createItem(product);
  };

  const changeQty = async (item: ComandaItem, delta: number) => {
    const next = item.quantity + delta;
    if (next <= 0) { await removeItem(item); return; }
    const updated: ComandaItem = { ...item, quantity: next, sync_status: 'pending_update' };
    await db.transaction('rw', [db.comanda_items, db.action_queue], async () => {
      await db.comanda_items.update(item.id, { quantity: next, sync_status: 'pending_update' });
      await addToQueue('COMANDA_ITEM_SYNC', updated);
    });
  };

  const removeItem = async (item: ComandaItem) => {
    // Marcamos voided (no borramos): la fila ya pudo sincronizarse a otros dispositivos.
    const updated: ComandaItem = { ...item, voided: true, sync_status: 'pending_update' };
    await db.transaction('rw', [db.comanda_items, db.action_queue], async () => {
      await db.comanda_items.update(item.id, { voided: true, sync_status: 'pending_update' });
      await addToQueue('COMANDA_ITEM_SYNC', updated);
    });
  };

  const pendingToSend = items.filter(i => !i.voided && i.kitchen_status === 'pending');

  const sendToKitchen = async () => {
    if (pendingToSend.length === 0) return;
    const now = new Date().toISOString();
    await db.transaction('rw', [db.comanda_items, db.action_queue], async () => {
      for (const it of pendingToSend) {
        await db.comanda_items.update(it.id, { kitchen_status: 'sent', sent_at: now, item_updated_at: now, sync_status: 'pending_update' });
        await addToQueue('KITCHEN_STATUS', {
          item_id: it.id, comanda_id: it.comanda_id, business_id: businessId,
          kitchen_status: 'sent', item_updated_at: now,
        });
      }
    });
    toast.success('Enviado a cocina');
  };

  const handleCheckout = async (
    methodInput: string, tendered: number, change: number,
    cashAmount?: number, transferAmount?: number,
  ) => {
    if (!comanda || !activeShift?.id) { toast.error('Caja cerrada o turno inválido'); return; }
    setShowPayment(false);
    setIsClosing(true);
    try {
      const now = new Date().toISOString();
      const saleId = crypto.randomUUID();
      const method = methodInput as Sale['payment_method'];
      const liveItems = items.filter(i => !i.voided);
      if (liveItems.length === 0) { toast.error('La comanda está vacía'); setIsClosing(false); return; }

      const saleItems: SaleItem[] = liveItems.map(i => {
        // Precio unitario final incluye los modificadores (por unidad), para que
        // price × quantity coincida con el total de la línea y el de la venta.
        const unit = currency.add(i.custom_price ?? i.price, i.modifiers_total ?? 0);
        return {
          product_id: i.product_id, name: i.name, quantity: i.quantity,
          price: unit,
          custom_price: unit,
          ...(i.note && { note: i.note }),
          ...(i.modifiers?.length ? { modifiers: i.modifiers } : {}),
        };
      });

      const sale: Sale = {
        id: saleId, business_id: businessId, date: now, shift_id: activeShift.id,
        staff_id: comanda.staff_id ?? currentStaff?.id,
        staff_name: comanda.staff_name ?? currentStaff?.name ?? 'Cajero',
        total, payment_method: method, amount_tendered: tendered, change,
        items: saleItems, comanda_id: comanda.id,
        ...(cashAmount !== undefined && { cash_amount: cashAmount }),
        ...(transferAmount !== undefined && { transfer_amount: transferAmount }),
        sync_status: 'pending_create',
      };

      await db.transaction('rw',
        [db.sales, db.products, db.comandas, db.restaurant_tables, db.action_queue, db.audit_logs],
        async () => {
          await db.sales.add(sale);
          // Descuento de stock local (el RPC close_comanda lo re-aplica en el servidor).
          for (const it of saleItems) {
            const p = await db.products.get(it.product_id);
            if (p) await db.products.update(it.product_id, { stock: p.stock - it.quantity, sync_status: 'pending_update' });
          }
          await db.comandas.update(comanda.id, { status: 'closed', closed_at: now, total, sale_ids: [saleId], sync_status: 'pending_update' });
          await db.restaurant_tables.update(comanda.table_id, { state: 'libre', current_comanda_id: null, sync_status: 'pending_update' });
          await addToQueue('COMANDA_CLOSE', { comanda_id: comanda.id, sales: [sale], business_id: businessId, idempotency_key: crypto.randomUUID() });
          const freedTable = await db.restaurant_tables.get(comanda.table_id);
          if (freedTable) await addToQueue('TABLE_SYNC', freedTable);
          await logAuditAction('SALE', { total, comanda: comanda.id }, currentStaff);
        },
      );

      syncPush().catch(() => {});
      toast.success('Comanda cobrada');
      navigate('/mesas');
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : 'Error al cobrar');
    } finally {
      setIsClosing(false);
    }
  };

  if (comanda === undefined) {
    return <div className="p-6 text-center text-[#6B7280]">Cargando comanda…</div>;
  }
  if (comanda === null) {
    return (
      <div className="p-6 text-center">
        <p className="text-[#6B7280] mb-3">Esta comanda no existe.</p>
        <button onClick={() => navigate('/mesas')} className="text-[#0B3B68] font-bold">Volver a Mesas</button>
      </div>
    );
  }

  const liveItems = items.filter(i => !i.voided);

  return (
    <div className="flex flex-col lg:flex-row gap-4 p-4 md:p-6 max-w-6xl mx-auto">
      {/* Productos */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => navigate('/mesas')} className="p-2 rounded-xl bg-white border border-gray-200 hover:bg-gray-50">
            <ArrowLeft size={20} className="text-[#0B3B68]" />
          </button>
          <h1 className="text-xl font-black text-[#1F2937]">{table?.name ?? 'Comanda'}</h1>
        </div>
        <div className="relative mb-4">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar producto…"
            className="w-full pl-10 pr-3 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] outline-none" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {filteredProducts.slice(0, 60).map(p => (
            <button key={p.id} onClick={() => addProduct(p)}
              className="p-3 rounded-xl border border-gray-200 bg-white text-left hover:border-[#7AC142] transition-all active:scale-95">
              <p className="font-bold text-sm text-[#1F2937] line-clamp-2">{p.name}</p>
              <p className="text-[#7AC142] font-black text-sm mt-1">${p.price.toFixed(2)}</p>
            </button>
          ))}
          {filteredProducts.length === 0 && (
            <p className="col-span-full text-sm text-[#9CA3AF] flex items-center gap-2"><Package size={16} /> Sin productos.</p>
          )}
        </div>
      </div>

      {/* Comanda actual */}
      <div className="lg:w-96 shrink-0 bg-white rounded-2xl border border-gray-200 p-4 flex flex-col">
        <h2 className="font-black text-[#1F2937] mb-3">Comanda</h2>
        <div className="flex-1 overflow-y-auto space-y-2 min-h-[120px]">
          {liveItems.length === 0 && <p className="text-sm text-[#9CA3AF]">Agrega productos desde la izquierda.</p>}
          {liveItems.map(it => (
            <div key={it.id} className="flex items-center gap-2 p-2 rounded-xl bg-gray-50">
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm text-[#1F2937] truncate">{it.name}</p>
                {it.modifiers?.length ? (
                  <p className="text-[11px] text-[#6B7280] truncate">{it.modifiers.map(m => m.modifier_name).join(', ')}</p>
                ) : null}
                {it.note ? <p className="text-[11px] text-amber-700 truncate">📝 {it.note}</p> : null}
                <p className="text-xs text-[#6B7280]">${comandaItemTotal(it).toFixed(2)}</p>
              </div>
              <button onClick={() => changeQty(it, -1)} className="p-1.5 rounded-lg bg-white border border-gray-200"><Minus size={14} /></button>
              <span className="w-6 text-center font-bold text-sm">{it.quantity}</span>
              <button onClick={() => changeQty(it, 1)} className="p-1.5 rounded-lg bg-white border border-gray-200"><Plus size={14} /></button>
              <button onClick={() => removeItem(it)} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <div className="border-t border-gray-100 mt-3 pt-3">
          <div className="flex justify-between items-center mb-3">
            <span className="font-bold text-[#6B7280]">Total</span>
            <span className="text-2xl font-black text-[#0B3B68]">${total.toFixed(2)}</span>
          </div>
          {pendingToSend.length > 0 && (
            <button onClick={sendToKitchen}
              className="w-full mb-2 py-3 rounded-xl font-bold flex items-center justify-center gap-2 bg-[#0B3B68] text-white active:scale-95 transition-all">
              <ChefHat size={20} /> Enviar a cocina ({pendingToSend.length})
            </button>
          )}
          <button onClick={() => setShowPayment(true)}
            disabled={liveItems.length === 0 || isClosing || !activeShift}
            className={`w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all ${liveItems.length === 0 || !activeShift ? 'bg-gray-200 text-gray-400' : 'bg-[#7AC142] text-white active:scale-95'}`}>
            <CreditCard size={20} /> {!activeShift ? 'Caja cerrada' : 'Cobrar'}
          </button>
        </div>
      </div>

      {showPayment && (
        <PaymentModal total={total} customer={null} onCancel={() => setShowPayment(false)} onConfirm={handleCheckout} />
      )}

      {pickerProduct && (
        <ModifierPickerModal
          product={pickerProduct}
          groups={groupsForProduct(pickerProduct.id)}
          modifiers={modifiersAll}
          onCancel={() => setPickerProduct(null)}
          onConfirm={(mods, perUnit) => { createItem(pickerProduct, mods, perUnit); setPickerProduct(null); }}
        />
      )}
    </div>
  );
}
