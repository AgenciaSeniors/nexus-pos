import { useState, useMemo } from 'react';
import { useParams, useNavigate, useOutletContext } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type ComandaItem, type ComandaItemModifier, type Product, type Sale, type SaleItem, type Staff } from '../lib/db';
import { addToQueue, syncPush } from '../lib/sync';
import { comandaItemTotal, comandaTotal } from '../lib/comanda';
import { computeStockDeductions } from '../lib/recipe';
import { currency } from '../lib/currency';
import { logAuditAction } from '../lib/audit';
import { PaymentModal } from '../components/PaymentModal';
import { ModifierPickerModal } from '../components/ModifierPickerModal';
import { SplitBillModal } from '../components/SplitBillModal';
import { ArrowLeft, Search, Trash2, Package, CreditCard, ChefHat, Users, ClipboardList, User } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Input, EmptyState, Stepper, IconButton } from '../components/ui';

export default function ComandaPage() {
  const { id: comandaId = '' } = useParams();
  const navigate = useNavigate();
  const { currentStaff } = useOutletContext<{ currentStaff: Staff }>();
  const businessId = localStorage.getItem('nexus_business_id') || '';

  const [query, setQuery] = useState('');
  const [showPayment, setShowPayment] = useState(false);
  const [showSplit, setShowSplit] = useState(false);
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
    // Los ingredientes (is_ingredient) no se venden en el menú.
    return rows.filter(p => !p.deleted_at && !p.is_ingredient).sort((a, b) => a.name.localeCompare(b.name));
  }, [businessId]) || [];

  // Recetas (plato → ingredientes) para descontar stock al cobrar.
  const recipesByDish = useLiveQuery(async () => {
    if (!businessId) return new Map<string, import('../lib/db').RecipeIngredient[]>();
    const rows = (await db.recipe_ingredients.where('business_id').equals(businessId).toArray()).filter(r => !r.deleted_at);
    const map = new Map<string, import('../lib/db').RecipeIngredient[]>();
    for (const r of rows) { const arr = map.get(r.dish_product_id) || []; arr.push(r); map.set(r.dish_product_id, arr); }
    return map;
  }, [businessId]) || new Map();

  const activeShift = useLiveQuery(
    () => businessId ? db.cash_shifts.where({ business_id: businessId, status: 'open' }).first() : undefined,
    [businessId],
  );

  // Meseros activos para acreditar la propina.
  const staffList = useLiveQuery(async () => {
    if (!businessId) return [];
    const rows = await db.staff.where('business_id').equals(businessId).toArray();
    return rows.filter(s => s.active !== false).map(s => ({ id: s.id, name: s.name }));
  }, [businessId]) || [];

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

  // Convierte una línea de comanda en línea de venta (modificadores plegados en el precio).
  const buildSaleItem = (i: ComandaItem): SaleItem => {
    const unit = currency.add(i.custom_price ?? i.price, i.modifiers_total ?? 0);
    return {
      product_id: i.product_id, name: i.name, quantity: i.quantity,
      price: unit, custom_price: unit,
      ...(i.note && { note: i.note }),
      ...(i.modifiers?.length ? { modifiers: i.modifiers } : {}),
    };
  };

  // Cierra la comanda: descuenta stock UNA sola vez (todos los ítems vivos) e
  // inserta la(s) venta(s). Sirve para cobro completo y para cobro dividido.
  const finalizeComanda = async (sales: Sale[]) => {
    if (!comanda) return;
    setIsClosing(true);
    try {
      const now = new Date().toISOString();
      const live = items.filter(i => !i.voided);
      const grandTotal = comandaTotal(items);
      await db.transaction('rw',
        [db.sales, db.products, db.comandas, db.restaurant_tables, db.action_queue, db.audit_logs],
        async () => {
          for (const s of sales) await db.sales.add(s);
          // Descuento de stock (una sola vez): por receta si el plato la tiene, o su
          // propio stock si no. El RPC close_comanda re-aplica esto en el servidor.
          const deductions = computeStockDeductions(
            live.map(i => ({ product_id: i.product_id, quantity: i.quantity })),
            recipesByDish,
          );
          for (const [pid, qty] of deductions) {
            const p = await db.products.get(pid);
            if (p) await db.products.update(pid, { stock: p.stock - qty, sync_status: 'pending_update' });
          }
          await db.comandas.update(comanda.id, { status: 'closed', closed_at: now, total: grandTotal, sale_ids: sales.map(s => s.id), sync_status: 'pending_update' });
          await db.restaurant_tables.update(comanda.table_id, { state: 'libre', current_comanda_id: null, sync_status: 'pending_update' });
          await addToQueue('COMANDA_CLOSE', { comanda_id: comanda.id, sales, business_id: businessId, idempotency_key: crypto.randomUUID() });
          const freed = await db.restaurant_tables.get(comanda.table_id);
          if (freed) await addToQueue('TABLE_SYNC', freed);
          await logAuditAction('SALE', { total: grandTotal, comanda: comanda.id, ventas: sales.length }, currentStaff);
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

  // Cobro COMPLETO (una sola venta). Recibe propina opcional desde PaymentModal.
  const handleCheckout = async (
    methodInput: string, tendered: number, change: number,
    cashAmount?: number, transferAmount?: number, _redeemed?: number,
    tipAmount?: number, tipStaffId?: string,
  ) => {
    if (!comanda || !activeShift?.id) { toast.error('Caja cerrada o turno inválido'); return; }
    const live = items.filter(i => !i.voided);
    if (live.length === 0) { toast.error('La comanda está vacía'); return; }
    setShowPayment(false);
    const sale: Sale = {
      id: crypto.randomUUID(), business_id: businessId, date: new Date().toISOString(), shift_id: activeShift.id,
      staff_id: comanda.staff_id ?? currentStaff?.id,
      staff_name: comanda.staff_name ?? currentStaff?.name ?? 'Cajero',
      total, payment_method: methodInput as Sale['payment_method'], amount_tendered: tendered, change,
      items: live.map(buildSaleItem), comanda_id: comanda.id,
      ...(cashAmount !== undefined && { cash_amount: cashAmount }),
      ...(transferAmount !== undefined && { transfer_amount: transferAmount }),
      ...(tipAmount ? { tip_amount: tipAmount, ...(tipStaffId ? { tip_staff_id: tipStaffId } : {}) } : {}),
      sync_status: 'pending_create',
    };
    await finalizeComanda([sale]);
  };

  if (comanda === undefined) {
    return <div className="p-6 text-center text-[#6B7280]">Cargando comanda…</div>;
  }
  if (comanda === null) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <EmptyState
          icon={<ClipboardList size={32} />}
          title="Esta comanda no existe"
          description="Pudo haberse cobrado o cerrado desde otro dispositivo."
          action={<Button variant="navy" icon={<ArrowLeft size={18} />} onClick={() => navigate('/mesas')}>Volver a Mesas</Button>}
        />
      </div>
    );
  }

  const liveItems = items.filter(i => !i.voided);

  return (
    <div className="flex flex-col lg:flex-row gap-4 p-4 md:p-6 max-w-6xl mx-auto">
      {/* Productos */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-4">
          <IconButton label="Volver a Mesas" icon={<ArrowLeft size={20} />} onClick={() => navigate('/mesas')} />
          <div className="min-w-0">
            <h1 className="text-xl font-black text-[#1F2937] truncate">{table?.name ?? 'Comanda'}</h1>
            {comanda.staff_name && (
              <p className="text-xs text-[#6B7280] flex items-center gap-1"><User size={12} /> {comanda.staff_name}</p>
            )}
          </div>
        </div>
        <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar producto…"
          aria-label="Buscar producto" icon={<Search size={18} />} className="mb-4" />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {filteredProducts.slice(0, 60).map(p => (
            <button key={p.id} onClick={() => addProduct(p)}
              className="p-3 rounded-xl border border-gray-200 bg-white text-left shadow-card hover:border-[#7AC142] hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200 active:scale-95">
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
      <div className="lg:w-96 shrink-0 bg-white rounded-2xl border border-gray-200 shadow-card p-4 flex flex-col lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100vh-3rem)]">
        <h2 className="font-black text-[#1F2937] mb-3 flex items-center gap-2"><ClipboardList size={18} className="text-[#0B3B68]" /> Comanda</h2>
        <div className="flex-1 overflow-y-auto space-y-2 min-h-[120px]">
          {liveItems.length === 0 && (
            <EmptyState size="sm" icon={<ClipboardList size={22} />} title="Comanda vacía"
              description="Agrega productos desde la izquierda." />
          )}
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
              <Stepper size="sm" value={it.quantity} label={`Cantidad de ${it.name}`}
                onDecrement={() => changeQty(it, -1)} onIncrement={() => changeQty(it, 1)} />
              <IconButton size="sm" variant="danger" label={`Quitar ${it.name}`} icon={<Trash2 size={14} />} onClick={() => removeItem(it)} />
            </div>
          ))}
        </div>
        <div className="border-t border-gray-100 mt-3 pt-3">
          <div className="flex justify-between items-center mb-3 bg-[#0B3B68]/5 rounded-xl px-3 py-2.5">
            <span className="font-bold text-[#6B7280] uppercase text-xs tracking-wide">Total</span>
            <span className="text-2xl font-black text-[#0B3B68]">${total.toFixed(2)}</span>
          </div>
          {pendingToSend.length > 0 && (
            <Button variant="navy" fullWidth size="lg" className="mb-2" onClick={sendToKitchen} icon={<ChefHat size={20} />}>
              Enviar a cocina ({pendingToSend.length})
            </Button>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" size="lg" onClick={() => setShowSplit(true)}
              disabled={liveItems.length === 0 || isClosing || !activeShift}
              className="border-2 border-[#0B3B68] text-[#0B3B68]" icon={<Users size={18} />}>
              Dividir
            </Button>
            <Button variant="primary" size="lg" fullWidth onClick={() => setShowPayment(true)}
              disabled={liveItems.length === 0 || isClosing || !activeShift}
              loading={isClosing} icon={<CreditCard size={20} />}>
              {!activeShift ? 'Caja cerrada' : 'Cobrar'}
            </Button>
          </div>
        </div>
      </div>

      {showPayment && (
        <PaymentModal total={total} customer={null} tipEnabled staffList={staffList}
          onCancel={() => setShowPayment(false)} onConfirm={handleCheckout} />
      )}

      {showSplit && (
        <SplitBillModal
          liveItems={liveItems}
          grandTotal={total}
          shiftId={activeShift?.id || ''}
          businessId={businessId}
          comandaId={comanda.id}
          staffId={comanda.staff_id ?? currentStaff?.id}
          staffName={comanda.staff_name ?? currentStaff?.name}
          staffList={staffList}
          buildSaleItem={buildSaleItem}
          onCancel={() => setShowSplit(false)}
          onComplete={(sales) => { setShowSplit(false); finalizeComanda(sales); }}
        />
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
