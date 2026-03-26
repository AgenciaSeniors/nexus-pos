import { useState, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Product, type Sale, type ParkedOrder, type SaleItem, type Staff, type Customer } from '../lib/db';
import { addToQueue, syncPush } from '../lib/sync';
import { currency } from '../lib/currency';
import { logAuditAction } from '../lib/audit';
import { TicketModal } from '../components/TicketModal';
import { PaymentModal } from '../components/PaymentModal';
import { ParkedOrdersModal } from '../components/ParkedOrdersModal';
import { CustomerSelect } from '../components/CustomerSelect';
import {
  PauseCircle, ClipboardList, Search, Barcode, Keyboard, AlertTriangle,
  Plus, Minus, X, Lock, ShoppingCart, ChevronRight, Package, Trash2, Edit3,
  Tag, ArrowLeftRight
} from 'lucide-react';
import { toast } from 'sonner';

interface CartItem extends Product {
  quantity: number;
  note?: string;
  custom_price?: number;
}

// Unidades que permiten cantidades decimales (peso, volumen, longitud)
const DECIMAL_UNITS = ['kg', 'lb', 'g', 'gr', 'lt', 'l', 'ml', 'oz', 'm', 'cm', 'kilo', 'litro'];
const isDecimalUnit = (unit?: string) =>
  !!unit && DECIMAL_UNITS.some(u => unit.toLowerCase().startsWith(u));

const fmtQty = (qty: number) =>
  qty % 1 === 0 ? qty.toString() : qty.toFixed(2).replace(/\.?0+$/, '');

export function PosPage() {
  const { currentStaff, onChangeStaff } = useOutletContext<{ currentStaff: Staff; onChangeStaff?: () => void }>();
  const searchInputRef = useRef<HTMLInputElement>(null);

  // --- ESTADOS DE LA VENTA ---
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('Todo');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCheckout, setIsCheckout] = useState(false);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [orderNote, setOrderNote] = useState('');

  // --- DESCUENTO ---
  const [discount, setDiscount] = useState<{ type: 'pct' | 'fixed'; value: number } | null>(null);
  const [showDiscountEditor, setShowDiscountEditor] = useState(false);
  const [discountInput, setDiscountInput] = useState('');
  const [discountType, setDiscountType] = useState<'pct' | 'fixed'>('pct');

  // --- MODALES Y CLIENTE ---
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showParkedModal, setShowParkedModal] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // --- EDITOR INLINE DE ÍTEM (nota + precio personalizado) ---
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editNote, setEditNote] = useState('');
  const [editPrice, setEditPrice] = useState('');

  // --- EDITOR INLINE DE CANTIDAD ---
  const [editingQtyId, setEditingQtyId] = useState<string | null>(null);
  const [editQtyValue, setEditQtyValue] = useState('');

  // --- ESTADO VISUAL MÓVIL ---
  const [mobileView, setMobileView] = useState<'catalog' | 'cart'>('catalog');
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // --- MULTI-VENDEDOR ---
  const multipleStaff = useLiveQuery(async () => {
    const bId = localStorage.getItem('nexus_business_id');
    if (!bId) return false;
    const count = await db.staff.where('business_id').equals(bId).filter(s => s.active !== false).count();
    return count > 1;
  }, []) || false;

  // --- FUNCIÓN DE RECUPERACIÓN DE ID ROBUSTA ---
  const getTargetId = async () => {
    let bId = localStorage.getItem('nexus_business_id');
    if (!bId) {
        const settings = await db.settings.toArray();
        if (settings.length > 0) {
            bId = settings[0].id;
            localStorage.setItem('nexus_business_id', bId);
        }
    }
    return bId;
  };

  // --- CARGA DE DATOS ---
  const products = useLiveQuery(async () => {
    const bId = await getTargetId();
    if (!bId) return [];
    return await db.products
        .where('business_id').equals(bId)
        .filter(p => !p.deleted_at && p.stock > 0)
        .reverse()
        .sortBy('name');
  }, []) || [];

  const activeShift = useLiveQuery(async () => {
    const bId = await getTargetId();
    if (!bId) return null;
    const shift = await db.cash_shifts.where({ business_id: bId, status: 'open' }).first();
    return shift || null;
  }, []);

  const parkedCount = useLiveQuery(async () => {
      const bId = await getTargetId();
      if (!bId) return 0;
      return await db.parked_orders.where('business_id').equals(bId).count();
  }, []) || 0;

  // --- FILTROS ---
  const categories = ['Todo', ...new Set(products.map(p => p.category || 'General'))];
  
  const filteredProducts = products.filter(p => {
    const matchQuery = p.name.toLowerCase().includes(query.toLowerCase()) || p.sku.includes(query);
    const matchCat = selectedCategory === 'Todo' || p.category === selectedCategory;
    return matchQuery && matchCat;
  });

  // --- LÓGICA DEL CARRITO ---
  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) {
            toast.error('Stock insuficiente');
            return prev;
        }
        return prev.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { ...product, quantity: 1 }];
    });
    
    if (navigator.vibrate) navigator.vibrate(50);
    toast.success("Agregado", { duration: 800, position: 'bottom-center' });
  };

  const updateQuantity = (id: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        const step = isDecimalUnit(item.unit) ? 0.1 : 1;
        const newQty = Math.max(step, parseFloat((item.quantity + delta * step).toFixed(3)));
        if (delta > 0 && newQty > item.stock) {
          toast.warning(`Solo hay ${item.stock} en stock`);
          return item;
        }
        return { ...item, quantity: newQty };
      }
      return item;
    }));
  };

  const setDirectQuantity = (id: string, raw: string) => {
    const val = parseFloat(raw);
    if (isNaN(val) || val <= 0) return;
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        const capped = Math.min(val, item.stock);
        if (val > item.stock) toast.warning(`Solo hay ${item.stock} en stock`);
        return { ...item, quantity: parseFloat(capped.toFixed(3)) };
      }
      return item;
    }));
    setEditingQtyId(null);
  };

  const removeFromCart = (id: string) => {
    setCart(prev => prev.filter(item => item.id !== id));
  };

  const clearCart = () => {
    setShowClearConfirm(true);
  };

  // --- LÓGICA DE ÓRDENES GUARDADAS ---
  const handleParkOrder = async () => {
      const bId = await getTargetId();
      if (cart.length === 0 || !bId) return;
      try {
          const parked: ParkedOrder = {
              id: crypto.randomUUID(),
              business_id: bId,
              date: new Date().toISOString(),
              items: cart.map(i => ({
                  product_id: i.id, name: i.name,
                  price: i.custom_price ?? i.price,
                  quantity: i.quantity, cost: i.cost, unit: i.unit,
                  ...(i.note && { note: i.note }),
                  ...(i.custom_price !== undefined && { custom_price: i.custom_price }),
              })),
              total: subtotal,
              customer_id: selectedCustomer?.id,
              customer_name: selectedCustomer?.name,
              note: orderNote.trim() // ✅ SE GUARDA LA NOTA/MESA AQUÍ
          };
          await db.parked_orders.add(parked);
          
          // Limpiar todo después de guardar
          setCart([]);
          setSelectedCustomer(null);
          setOrderNote(''); // Limpia el nombre/mesa
          setMobileView('catalog');
          
          toast.success("Orden guardada en pendientes");
      } catch (e) {
          console.error(e);
          toast.error("Error al guardar orden"); 
      }
  };

  const handleRestoreOrder = async (order: ParkedOrder) => {
      const restoredCart: CartItem[] = [];
      
      for (const item of order.items) {
          const product = await db.products.get(item.product_id);
          if (product && product.stock > 0) {
              restoredCart.push({
                  ...product,
                  quantity: item.quantity
              });
          }
      }

      if (restoredCart.length > 0) {
          setCart(restoredCart);
          if (order.customer_id) {
              const customer = await db.customers.get(order.customer_id);
              if (customer) setSelectedCustomer(customer);
          }
          // ✅ Restaura la nota si existía
          if (order.note) setOrderNote(order.note);

          await db.parked_orders.delete(order.id);
          setShowParkedModal(false);
          setMobileView('cart');
          toast.success("Orden restaurada");
      } else {
          toast.error("Los productos de esta orden ya no existen o no tienen stock");
      }
  };

  // --- PROCESAMIENTO DE VENTA ---
  const handleCheckout = async (
    methodInput: string,
    tendered: number,
    change: number,
    cashAmount?: number,
    transferAmount?: number,
    redeemedPoints?: number
  ) => {
    if (!activeShift || !activeShift.id) return toast.error("Caja cerrada o turno inválido");

    setIsCheckout(true);
    setShowPaymentModal(false);

    try {
        const bId = await getTargetId();
        if (!bId) throw new Error("Falta ID de negocio");

        let normalizedMethod: 'efectivo' | 'transferencia' | 'tarjeta' | 'mixto' = 'efectivo';
        const m = methodInput.toLowerCase().trim();
        if (m.includes('transf')) normalizedMethod = 'transferencia';
        else if (m.includes('tarj')) normalizedMethod = 'tarjeta';
        else if (m.includes('mix')) normalizedMethod = 'mixto';
        else normalizedMethod = 'efectivo';

        const saleId = crypto.randomUUID();
        const subtotalRaw = currency.calculateTotal(cart);
        const pointsDiscount = Math.round((redeemedPoints || 0) * 0.10 * 100) / 100;
        const saleTotal = Math.max(0, Math.round((finalTotal - pointsDiscount) * 100) / 100);

        const saleItems: SaleItem[] = cart.map(i => ({
            product_id: i.id,
            name: i.name,
            quantity: i.quantity,
            price: i.custom_price ?? i.price,
            cost: i.cost,
            unit: i.unit,
            ...(i.note && { note: i.note }),
            ...(i.custom_price !== undefined && { custom_price: i.custom_price }),
        }));

        const sale: Sale = {
            id: saleId,
            business_id: bId,
            date: new Date().toISOString(),
            shift_id: activeShift.id,
            staff_id: currentStaff?.id || 'admin',
            staff_name: currentStaff?.name || 'Cajero',
            total: saleTotal,
            payment_method: normalizedMethod,
            amount_tendered: tendered,
            change: change,
            items: saleItems,
            customer_id: selectedCustomer?.id,
            customer_name: selectedCustomer?.name,
            // Descuento
            ...(discountAmount > 0 && {
                discount_amount: discountAmount,
                discount_type: discount?.type === 'pct' ? 'percentage' : 'fixed',
                discount_input: discount?.value,
            }),
            // Pago mixto
            ...(cashAmount !== undefined && { cash_amount: cashAmount }),
            ...(transferAmount !== undefined && { transfer_amount: transferAmount }),
            // Puntos canjeados
            ...(redeemedPoints && redeemedPoints > 0 && { redeemed_points: redeemedPoints }),
            sync_status: 'pending_create'
        };

        const staffPayload = { id: sale.staff_id, name: sale.staff_name, business_id: bId };

        await db.transaction('rw', [db.sales, db.products, db.movements, db.action_queue, db.audit_logs, db.customers], async () => {
            await db.sales.add(sale);

            const updateStockPromises = cart.map(async (item) => {
                const product = await db.products.get(item.id);
                if (product) {
                    if (product.stock < item.quantity) {
                        throw new Error(`Stock insuficiente para "${product.name}": disponible ${product.stock}, solicitado ${item.quantity}`);
                    }
                    await db.products.update(item.id, {
                        stock: product.stock - item.quantity,
                        sync_status: 'pending_update'
                    });
                }
            });
            await Promise.all(updateStockPromises);

            if (selectedCustomer?.id) {
                const pointsEarned = Math.floor(saleTotal / 10);
                const freshCustomer = await db.customers.get(selectedCustomer.id);
                if (freshCustomer && !freshCustomer.deleted_at) {
                    const currentPoints = freshCustomer.loyalty_points || 0;
                    const newPoints = Math.max(0, currentPoints - (redeemedPoints || 0) + pointsEarned);
                    await db.customers.update(selectedCustomer.id, {
                        loyalty_points: newPoints,
                        sync_status: 'pending_update'
                    });
                }
            }

            await addToQueue('SALE', { sale, items: saleItems });
            await logAuditAction('SALE', { total: sale.total, method: sale.payment_method, discount: discountAmount, redeemed_points: redeemedPoints }, staffPayload as any);
        });

        setLastSale(sale);
        setCart([]);
        setSelectedCustomer(null);
        setOrderNote('');
        setDiscount(null);
        setDiscountInput('');
        setMobileView('catalog');

        const changeMsg = normalizedMethod === 'efectivo' && change > 0 ? ` Cambio: ${currency.format(change)}` : '';
        toast.success(`Venta completada.${changeMsg}`);

        syncPush().catch(error => {
            console.error("⚠️ Sync background falló:", error);
        });

        // Suprimir referencia para evitar warning de variable no usada
        void subtotalRaw;

    } catch (error) {
        console.error("❌ Error crítico en transacción de venta:", error);
        if (error instanceof Error && (error.name === 'TransactionInactiveError' || error.name === 'AbortError')) {
            toast.error("Error de concurrencia en base de datos. Por favor intente de nuevo.");
        } else {
            toast.error("Error al procesar la venta. Verifique el stock.");
        }
    } finally {
        setIsCheckout(false);
    }
  };

  // --- CÁLCULOS DEL CARRITO ---
  // Usa custom_price si el ítem fue personalizado, si no el precio estándar
  const subtotal = Math.round(
    cart.reduce((sum, i) => sum + Math.round((i.custom_price ?? i.price) * 100) * i.quantity, 0)
  ) / 100;
  const discountAmount = discount
    ? (discount.type === 'pct'
        ? Math.round(subtotal * discount.value / 100 * 100) / 100
        : Math.min(discount.value, subtotal))
    : 0;
  const finalTotal = Math.max(0, Math.round((subtotal - discountAmount) * 100) / 100);
  const cartCount = parseFloat(cart.reduce((sum, item) => sum + item.quantity, 0).toFixed(3));

  // --- EDITOR INLINE: abrir/guardar/cancelar ---
  const openItemEditor = (item: CartItem) => {
    setEditingItemId(item.id);
    setEditNote(item.note || '');
    setEditPrice(item.custom_price !== undefined ? String(item.custom_price) : String(item.price));
  };

  const saveItemEditor = (itemId: string) => {
    const parsedPrice = parseFloat(editPrice);
    setCart(prev => prev.map(i => {
      if (i.id !== itemId) return i;
      const newCustomPrice = !isNaN(parsedPrice) && parsedPrice > 0 && parsedPrice !== i.price
        ? parsedPrice : undefined;
      return { ...i, note: editNote.trim() || undefined, custom_price: newCustomPrice };
    }));
    setEditingItemId(null);
  };

  // --- UI RENDER ---
  return (
    <div className="flex flex-col md:flex-row h-[calc(100vh-60px)] md:h-screen bg-background overflow-hidden font-body">
      
      {/* COLUMNA IZQUIERDA: CATÁLOGO */}
      <div className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${mobileView === 'cart' ? 'hidden md:flex' : 'flex'}`}>
        
        {/* Barra Superior */}
        <div className="p-4 bg-surface border-b border-gray-200 sticky top-0 z-10 shadow-sm flex flex-col gap-3">
            <div className="flex gap-2 items-center">
                <div className="relative flex-1">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary w-5 h-5 group-focus-within:text-bisne-navy transition-colors" />
                    <input
                        ref={searchInputRef}
                        type="text"
                        placeholder="Buscar por nombre, código o SKU..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        autoFocus
                        className="w-full pl-12 pr-10 py-3 bg-background border-none rounded-2xl text-lg focus:ring-2 focus:ring-bisne-navy focus:bg-surface transition-all shadow-inner outline-none text-text-main placeholder-gray-400 font-body"
                    />
                    {query && (
                        <button onClick={() => {setQuery(''); searchInputRef.current?.focus();}} className="absolute right-4 top-1/2 -translate-y-1/2 text-text-secondary hover:text-state-error p-1">
                            <X size={18} />
                        </button>
                    )}
                </div>
                <button
                    onClick={() => setMobileView('cart')}
                    className="md:hidden relative flex-shrink-0 flex flex-col items-center justify-center gap-0.5 p-2.5 bg-background border border-gray-200 rounded-2xl text-bisne-navy shadow-inner min-w-[56px]"
                >
                    <ClipboardList size={22} />
                    {parkedCount > 0 && (
                        <span className="text-[10px] font-black text-talla-growth leading-none font-body">{parkedCount}</span>
                    )}
                </button>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                {categories.map(cat => (
                    <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={`px-4 py-2 rounded-xl text-xs font-bold font-heading whitespace-nowrap transition-all border ${
                            selectedCategory === cat 
                                ? 'bg-bisne-navy text-white border-bisne-navy shadow-md shadow-bisne-navy/20' 
                                : 'bg-surface text-text-secondary border-gray-200 hover:border-bisne-navy hover:text-bisne-navy'
                        }`}
                    >
                        {cat}
                    </button>
                ))}
            </div>
        </div>

        {/* Rejilla de Productos */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-background scroll-smooth">
            {filteredProducts.length === 0 ? (
                products.length === 0 ? (
                    /* Onboarding: negocio sin productos todavía */
                    <div className="h-full flex flex-col items-center justify-center py-10 px-4">
                        <div className="max-w-sm w-full">
                            <div className="text-center mb-6">
                                <div className="w-16 h-16 rounded-2xl bg-[#0B3B68] flex items-center justify-center mx-auto mb-4">
                                    <ShoppingCart size={32} className="text-white" />
                                </div>
                                <h2 className="text-2xl font-black text-bisne-navy font-heading">¡Bienvenido!</h2>
                                <p className="text-sm text-text-secondary mt-1">Sigue estos pasos para empezar a vender</p>
                            </div>
                            <div className="space-y-3">
                                <div className="flex items-center gap-4 bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
                                    <div className="w-9 h-9 rounded-xl bg-[#7AC142] flex items-center justify-center flex-shrink-0">
                                        <span className="text-white font-black text-sm">1</span>
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-bold text-bisne-navy text-sm">Agrega tus productos</p>
                                        <p className="text-xs text-text-secondary">Ve a <span className="font-bold">Inventario</span> y crea tu catálogo</p>
                                    </div>
                                    <Package size={18} className="text-gray-300 flex-shrink-0 ml-auto" />
                                </div>
                                <div className="flex items-center gap-4 bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
                                    <div className="w-9 h-9 rounded-xl bg-[#0B3B68] flex items-center justify-center flex-shrink-0">
                                        <span className="text-white font-black text-sm">2</span>
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-bold text-bisne-navy text-sm">Abre un turno de caja</p>
                                        <p className="text-xs text-text-secondary">Ve a <span className="font-bold">Finanzas</span> y abre tu primer turno</p>
                                    </div>
                                    <Lock size={18} className="text-gray-300 flex-shrink-0 ml-auto" />
                                </div>
                                <div className="flex items-center gap-4 bg-white border border-[#7AC142]/40 rounded-2xl p-4 shadow-sm bg-[#7AC142]/5">
                                    <div className="w-9 h-9 rounded-xl bg-gray-200 flex items-center justify-center flex-shrink-0">
                                        <span className="text-gray-500 font-black text-sm">3</span>
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-bold text-bisne-navy text-sm">¡Empieza a vender!</p>
                                        <p className="text-xs text-text-secondary">Vuelve aquí y realiza tu primera venta</p>
                                    </div>
                                    <Tag size={18} className="text-[#7AC142] flex-shrink-0 ml-auto" />
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    /* Sin resultados de búsqueda */
                    <div className="h-full flex flex-col items-center justify-center text-text-secondary opacity-50 py-10">
                        <Package size={64} className="mb-4 stroke-1"/>
                        <p className="text-xl font-bold font-heading text-bisne-navy">Sin resultados</p>
                        <p className="text-sm font-body">Intenta con otro término de búsqueda</p>
                    </div>
                )
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4 pb-24 md:pb-0">
                    {filteredProducts.map(product => (
                        <button
                            key={product.id}
                            onClick={() => addToCart(product)}
                            className="bg-surface p-3 md:p-4 rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-talla-growth active:scale-[0.98] transition-all flex flex-col justify-between text-left group h-full relative overflow-hidden"
                        >
                            <div className="absolute top-0 left-0 w-1 h-full bg-talla-growth opacity-0 group-hover:opacity-100 transition-opacity"></div>
                            <div className="w-full mb-3">
                                <div className="flex justify-between items-start mb-1">
                                    <span className="text-[10px] font-bold uppercase text-text-secondary bg-gray-100 px-2 py-0.5 rounded-md truncate max-w-[70%] font-heading">
                                        {product.category || 'General'}
                                    </span>
                                    {product.stock <= (product.low_stock_threshold ?? 5) && (
                                        <div className="text-state-warning flex items-center gap-1 bg-state-warning/10 px-1.5 py-0.5 rounded text-[10px] font-bold">
                                            <AlertTriangle size={10} /> Bajo
                                        </div>
                                    )}
                                </div>
                                <h3 className="font-bold text-bisne-navy text-sm md:text-base leading-tight line-clamp-2 h-10 font-heading">
                                    {product.name}
                                </h3>
                            </div>
                            <div className="w-full flex justify-between items-end border-t border-gray-50 pt-2 mt-auto">
                                <div className="text-xs text-text-secondary font-body">
                                    Stock: <span className="font-bold text-text-main">{product.stock}</span>
                                </div>
                                <div className="text-lg font-bold text-talla-growth font-body">
                                    {currency.format(product.price)}
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
      </div>

      {/* COLUMNA DERECHA: CARRITO */}
      <div className={`w-full md:w-[420px] bg-surface border-l border-gray-200 flex flex-col shadow-2xl z-20 transition-transform duration-300 absolute md:relative inset-0 md:inset-auto ${mobileView === 'cart' ? 'translate-x-0' : 'translate-x-full md:translate-x-0'}`}>
        
        <div className="p-4 bg-bisne-navy text-white flex justify-between items-center shadow-md shrink-0 gap-3">
            <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 bg-white/10 rounded-xl relative flex-shrink-0">
                    <ShoppingCart size={22} className="text-talla-growth"/>
                    {cartCount > 0 && (
                        <span className="absolute -top-1 -right-1 bg-talla-growth text-bisne-navy text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center border-2 border-bisne-navy">
                            {cartCount > 99 ? '99+' : cartCount}
                        </span>
                    )}
                </div>
                <div className="min-w-0">
                    <h2 className="font-bold text-base leading-tight font-heading">Orden Actual</h2>
                    <p className="text-[11px] text-gray-300 font-body truncate">{cart.length} producto{cart.length !== 1 ? 's' : ''}</p>
                </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
                {/* Badge de vendedor activo */}
                {multipleStaff && onChangeStaff ? (
                    <button
                        onClick={onChangeStaff}
                        className="flex items-center gap-1.5 bg-white/10 hover:bg-talla-growth/20 border border-white/10 hover:border-talla-growth/50 px-2.5 py-1.5 rounded-xl transition-all"
                        title="Cambiar vendedor"
                    >
                        <div className="w-5 h-5 rounded-full bg-talla-growth flex items-center justify-center text-bisne-navy text-[9px] font-black flex-shrink-0">
                            {currentStaff?.name.substring(0, 2).toUpperCase() || '?'}
                        </div>
                        <span className="text-[11px] font-bold text-white max-w-[60px] truncate">{currentStaff?.name.split(' ')[0]}</span>
                        <ArrowLeftRight size={11} className="text-talla-growth flex-shrink-0"/>
                    </button>
                ) : (
                    <div className="flex items-center gap-1.5 bg-white/10 px-2.5 py-1.5 rounded-xl">
                        <div className="w-5 h-5 rounded-full bg-talla-growth flex items-center justify-center text-bisne-navy text-[9px] font-black">
                            {currentStaff?.name.substring(0, 2).toUpperCase() || '?'}
                        </div>
                        <span className="text-[11px] font-bold text-white max-w-[60px] truncate">{currentStaff?.name.split(' ')[0]}</span>
                    </div>
                )}
                {cart.length > 0 && (
                    <button onClick={clearCart} className="p-2 hover:bg-white/10 rounded-lg text-red-300 transition-colors" title="Vaciar Carrito">
                        <Trash2 size={18} />
                    </button>
                )}
                <button onClick={() => setMobileView('catalog')} className="md:hidden p-2 hover:bg-white/10 rounded-lg text-white">
                    <X size={22} />
                </button>
            </div>
        </div>

        <div className="bg-background border-b border-gray-200 p-3">
            <CustomerSelect selectedCustomer={selectedCustomer} onSelect={setSelectedCustomer} />
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-background">
            {cart.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-text-secondary opacity-60 text-center p-8 space-y-4">
                    <div className="w-20 h-20 bg-gray-200 rounded-full flex items-center justify-center">
                        <Barcode size={40} className="stroke-1"/>
                    </div>
                    <div>
                        <p className="font-bold text-bisne-navy text-lg font-heading">Carrito Vacío</p>
                        <p className="text-sm font-body">Escanea o selecciona productos del catálogo.</p>
                    </div>
                </div>
            ) : (
                cart.map(item => {
                  const effectivePrice = item.custom_price ?? item.price;
                  const isEditing = editingItemId === item.id;
                  return (
                    <div key={item.id} className={`bg-surface p-3 rounded-xl border shadow-sm flex flex-col gap-2 animate-in slide-in-from-right-4 duration-200 ${isEditing ? 'border-[#0B3B68]/40 ring-1 ring-[#0B3B68]/20' : 'border-gray-200'}`}>
                        <div className="flex justify-between items-start">
                            <div className="flex-1 pr-2 min-w-0">
                                <h4 className="font-bold text-text-main text-sm leading-tight line-clamp-2 font-heading">{item.name}</h4>
                                <p className="text-xs text-text-secondary font-mono mt-0.5">
                                    {item.custom_price !== undefined
                                        ? <><span className="line-through opacity-40">{currency.format(item.price)}</span> <span className="text-[#0B3B68] font-bold">{currency.format(item.custom_price)}</span></>
                                        : <>{currency.format(item.price)}</>
                                    } <span className="opacity-70">x unidad</span>
                                </p>
                                {item.note && !isEditing && (
                                    <p className="text-xs text-[#0B3B68] bg-[#0B3B68]/8 rounded-md px-2 py-0.5 mt-1 italic">📝 {item.note}</p>
                                )}
                            </div>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                                <div className="font-black text-text-main text-lg text-right whitespace-nowrap font-body">
                                    {currency.format(effectivePrice * item.quantity)}
                                </div>
                                <button
                                    onClick={() => isEditing ? setEditingItemId(null) : openItemEditor(item)}
                                    className={`p-1.5 rounded-lg transition-colors ${isEditing ? 'text-[#0B3B68] bg-[#0B3B68]/10' : 'text-gray-400 hover:text-[#0B3B68] hover:bg-[#0B3B68]/8'}`}
                                    title="Nota y precio personalizado"
                                >
                                    <Edit3 size={14}/>
                                </button>
                            </div>
                        </div>

                        {/* Editor inline de nota + precio */}
                        {isEditing && (
                            <div className="flex flex-col gap-2 pt-1 border-t border-[#0B3B68]/10">
                                <input
                                    type="text"
                                    placeholder="Nota del ítem (ej: sin cebolla, extra queso…)"
                                    value={editNote}
                                    onChange={e => setEditNote(e.target.value)}
                                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-[#0B3B68] outline-none"
                                    autoFocus
                                />
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-text-secondary whitespace-nowrap">Precio:</span>
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={editPrice}
                                        onChange={e => setEditPrice(e.target.value)}
                                        className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-mono focus:ring-2 focus:ring-[#0B3B68] outline-none"
                                    />
                                    <button
                                        onClick={() => saveItemEditor(item.id)}
                                        className="px-3 py-2 bg-[#0B3B68] text-white text-xs font-bold rounded-lg hover:bg-[#0B3B68]/90 transition-colors whitespace-nowrap"
                                    >
                                        Listo
                                    </button>
                                </div>
                            </div>
                        )}

                        <div className="flex justify-between items-center bg-background p-1 rounded-lg mt-1 border border-gray-100">
                            <div className="flex items-center gap-1">
                                <button onClick={() => updateQuantity(item.id, -1)} className="w-9 h-9 flex items-center justify-center bg-surface rounded-md text-text-main shadow-sm hover:bg-gray-100 border border-gray-200 active:scale-95 transition-all">
                                    <Minus size={16}/>
                                </button>
                                {editingQtyId === item.id ? (
                                    <input
                                        autoFocus
                                        type="number"
                                        min="0.001"
                                        step={isDecimalUnit(item.unit) ? '0.1' : '1'}
                                        value={editQtyValue}
                                        onChange={e => setEditQtyValue(e.target.value)}
                                        onBlur={() => { setDirectQuantity(item.id, editQtyValue); }}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') setDirectQuantity(item.id, editQtyValue);
                                            if (e.key === 'Escape') setEditingQtyId(null);
                                        }}
                                        className="w-14 text-center font-bold text-base text-bisne-navy border-b-2 border-bisne-navy outline-none bg-transparent tabular-nums"
                                    />
                                ) : (
                                    <button
                                        onClick={() => { setEditingQtyId(item.id); setEditQtyValue(fmtQty(item.quantity)); }}
                                        className="font-bold text-lg text-bisne-navy w-10 text-center tabular-nums font-body hover:text-talla-growth transition-colors"
                                        title="Toca para editar cantidad"
                                    >
                                        {fmtQty(item.quantity)}
                                    </button>
                                )}
                                <button onClick={() => updateQuantity(item.id, 1)} className="w-9 h-9 flex items-center justify-center bg-bisne-navy text-white rounded-md shadow-sm hover:bg-bisne-navy/90 active:scale-95 transition-all">
                                    <Plus size={16}/>
                                </button>
                            </div>
                            {item.unit && <span className="text-[10px] text-gray-400 font-medium">{item.unit}</span>}
                            <button onClick={() => removeFromCart(item.id)} className="p-2 text-gray-400 hover:text-state-error hover:bg-red-50 rounded-lg transition-colors">
                                <X size={18} />
                            </button>
                        </div>
                    </div>
                  );
                })
            )}
        </div>

        <div className="p-5 bg-surface border-t border-gray-200 shadow-[0_-4px_20px_-5px_rgba(0,0,0,0.1)] relative z-30 shrink-0">
            
            {/* ✅ CAMPO DE TEXTO OPCIONAL PARA NOMBRE/MESA AÑADIDO AQUÍ */}
            <div className="mb-3">
                <div className="relative flex items-center">
                    <Edit3 className="absolute left-3 text-gray-400 w-4 h-4" />
                    <input 
                        type="text" 
                        placeholder="Nombre o Mesa (Opcional)" 
                        value={orderNote}
                        onChange={(e) => setOrderNote(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-[#1F2937] focus:ring-2 focus:ring-[#0B3B68] focus:bg-white outline-none transition-all placeholder-gray-400"
                    />
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
                <button
                    onClick={() => setShowParkedModal(true)}
                    className="flex items-center justify-center gap-2 py-2.5 px-3 bg-background text-bisne-navy font-bold rounded-xl hover:bg-gray-200 text-xs uppercase tracking-wide transition-colors border border-gray-200 font-heading"
                >
                    <ClipboardList size={16}/>
                    <span>Pendientes {parkedCount > 0 && `(${parkedCount})`}</span>
                </button>
                <button
                    onClick={handleParkOrder}
                    disabled={cart.length === 0}
                    className="flex items-center justify-center gap-2 py-2.5 px-3 bg-background text-state-warning font-bold rounded-xl hover:bg-state-warning/10 text-xs uppercase tracking-wide transition-colors border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed font-heading"
                >
                    <PauseCircle size={16}/>
                    <span>Guardar Orden</span>
                </button>
            </div>

            {/* --- DESCUENTO --- */}
            <div className="mb-3">
                {showDiscountEditor ? (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 animate-in slide-in-from-top-2 duration-200">
                        <div className="flex gap-2 mb-2">
                            <button onClick={() => setDiscountType('pct')} className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${discountType === 'pct' ? 'bg-amber-500 text-white' : 'bg-white text-amber-600 border border-amber-200'}`}>% Porcentaje</button>
                            <button onClick={() => setDiscountType('fixed')} className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${discountType === 'fixed' ? 'bg-amber-500 text-white' : 'bg-white text-amber-600 border border-amber-200'}`}>$ Monto fijo</button>
                        </div>
                        <div className="flex gap-2">
                            <input
                                type="number"
                                autoFocus
                                min="0"
                                value={discountInput}
                                onChange={e => setDiscountInput(e.target.value)}
                                placeholder={discountType === 'pct' ? 'Ej: 10' : 'Ej: 5.00'}
                                className="flex-1 px-3 py-2 bg-white border border-amber-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-amber-300 text-text-main"
                            />
                            <button
                                onClick={() => {
                                    const v = parseFloat(discountInput) || 0;
                                    if (v > 0) setDiscount({ type: discountType, value: v });
                                    setShowDiscountEditor(false);
                                }}
                                className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-bold hover:bg-amber-600 transition-colors"
                            >OK</button>
                            <button
                                onClick={() => { setDiscount(null); setDiscountInput(''); setShowDiscountEditor(false); }}
                                className="px-3 py-2 bg-white text-amber-600 border border-amber-200 rounded-lg text-sm font-bold hover:bg-amber-50 transition-colors"
                            ><X size={14}/></button>
                        </div>
                    </div>
                ) : (
                    <button
                        onClick={() => { setDiscountInput(discount ? String(discount.value) : ''); setDiscountType(discount?.type || 'pct'); setShowDiscountEditor(true); }}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-bold transition-colors ${discount ? 'bg-amber-50 text-amber-600 border border-amber-200 hover:bg-amber-100' : 'bg-gray-50 text-gray-400 border border-dashed border-gray-200 hover:border-amber-300 hover:text-amber-500'}`}
                    >
                        <span className="flex items-center gap-2">
                            <Tag size={13}/>
                            {discount ? `Descuento aplicado (${discount.type === 'pct' ? discount.value + '%' : '$' + discount.value.toFixed(2)})` : 'Agregar descuento'}
                        </span>
                        {discount && <span className="font-black">-{currency.format(discountAmount)}</span>}
                    </button>
                )}
            </div>

            {/* --- TOTALES --- */}
            <div className="space-y-1 mb-5">
                {discountAmount > 0 ? (
                    <>
                        <div className="flex justify-between items-end border-b border-gray-100 pb-2 mb-1">
                            <span className="text-sm font-medium text-text-secondary font-heading">Subtotal</span>
                            <span className="text-sm font-bold text-text-main font-body">{currency.format(subtotal)}</span>
                        </div>
                        <div className="flex justify-between items-end border-b border-gray-100 pb-2 mb-2">
                            <span className="text-sm font-medium text-amber-500 font-heading flex items-center gap-1"><Tag size={12}/>Descuento</span>
                            <span className="text-sm font-bold text-amber-500 font-body">-{currency.format(discountAmount)}</span>
                        </div>
                    </>
                ) : (
                    <div className="flex justify-between items-end border-b border-gray-100 pb-2 mb-2">
                        <span className="text-sm font-medium text-text-secondary font-heading">Subtotal</span>
                        <span className="text-sm font-bold text-text-main font-body">{currency.format(subtotal)}</span>
                    </div>
                )}
                <div className="flex justify-between items-end">
                    <span className="font-bold text-lg text-text-main flex items-center gap-2 font-heading">
                        <Keyboard size={18} className="hidden md:block text-text-secondary"/> Total a Pagar
                    </span>
                    <span className="font-black text-4xl text-bisne-navy tracking-tight font-body">{currency.format(finalTotal)}</span>
                </div>
            </div>

            <button
                onClick={() => setShowPaymentModal(true)}
                disabled={cart.length === 0 || isCheckout || !activeShift}
                className={`w-full py-4 rounded-xl font-bold text-lg shadow-xl flex items-center justify-center gap-2 transition-all duration-200 uppercase tracking-wide font-heading
                    ${!activeShift
                        ? 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none'
                        : 'bg-talla-growth text-white hover:bg-talla-dark active:scale-[0.98] hover:shadow-talla-growth/30 shadow-talla-growth/20'
                    }`}
            >
                {!activeShift ? (
                    <span className="flex items-center gap-2"><Lock size={20}/> CAJA CERRADA</span>
                ) : (
                    isCheckout ? 'Procesando...' : 'COBRAR AHORA'
                )}
            </button>
        </div>
      </div>

      {mobileView === 'catalog' && cart.length > 0 && (
          <div className="md:hidden fixed bottom-20 left-4 right-4 z-50">
              <button 
                onClick={() => setMobileView('cart')}
                className="w-full bg-bisne-navy text-white p-4 rounded-2xl shadow-2xl flex justify-between items-center animate-in slide-in-from-bottom-4 active:scale-95 transition-transform"
              >
                  <div className="flex items-center gap-3">
                      <div className="bg-talla-growth text-bisne-navy text-xs font-black px-2.5 py-1 rounded-full border-2 border-bisne-navy font-body">
                          {cartCount}
                      </div>
                      <span className="font-bold text-sm uppercase tracking-wide font-heading">Ver Carrito</span>
                  </div>
                  <div className="flex items-center gap-2">
                      <span className="font-black text-xl font-body">{currency.format(finalTotal)}</span>
                      <ChevronRight size={24} className="text-talla-growth" />
                  </div>
              </button>
          </div>
      )}

      {showPaymentModal && <PaymentModal total={finalTotal} customer={selectedCustomer} onCancel={() => setShowPaymentModal(false)} onConfirm={handleCheckout} />}
      {showParkedModal && <ParkedOrdersModal onClose={() => setShowParkedModal(false)} onRestore={handleRestoreOrder} />}
      {lastSale && <TicketModal sale={lastSale} onClose={() => { setLastSale(null); setTimeout(() => searchInputRef.current?.focus(), 100); }} />}

      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-xs w-full text-center animate-in zoom-in-95 duration-200">
            <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <Trash2 size={28} className="text-state-error" />
            </div>
            <h3 className="font-bold text-lg text-text-main mb-1">¿Vaciar carrito?</h3>
            <p className="text-sm text-text-secondary mb-6">Se eliminarán los {cartCount} artículos seleccionados.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="flex-1 py-2.5 border border-gray-200 text-text-main font-bold rounded-xl hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => { setCart([]); setOrderNote(''); setShowClearConfirm(false); }}
                className="flex-1 py-2.5 bg-state-error text-white font-bold rounded-xl hover:bg-state-error/90 transition-colors"
              >
                Vaciar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}