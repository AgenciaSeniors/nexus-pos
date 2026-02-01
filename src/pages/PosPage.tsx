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
  Plus, Minus, X, Lock, ShoppingCart, ChevronRight, Package, Trash2 
} from 'lucide-react';
import { toast } from 'sonner';

interface CartItem extends Product {
  quantity: number;
}

export function PosPage() {
  const { currentStaff } = useOutletContext<{ currentStaff: Staff }>();
  const searchInputRef = useRef<HTMLInputElement>(null);

  // --- ESTADOS DE LA VENTA ---
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('Todo');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCheckout, setIsCheckout] = useState(false);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  
  // --- MODALES Y CLIENTE ---
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showParkedModal, setShowParkedModal] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // --- ESTADO VISUAL MÓVIL ---
  // 'catalog' = Viendo productos | 'cart' = Viendo carrito (Solo afecta a móviles)
  const [mobileView, setMobileView] = useState<'catalog' | 'cart'>('catalog');

  const businessId = localStorage.getItem('nexus_business_id');

  // --- CARGA DE DATOS ---
  const products = useLiveQuery(async () => {
    if (!businessId) return [];
    return await db.products
        .where('business_id').equals(businessId)
        .filter(p => !p.deleted_at && p.stock > 0)
        .reverse()
        .sortBy('name');
  }, [businessId]) || [];

  const activeShift = useLiveQuery(async () => {
    if (!businessId) return null;
    return await db.cash_shifts
        .where({ business_id: businessId, status: 'open' })
        .first();
  }, [businessId]);

  const parkedCount = useLiveQuery(async () => {
      if (!businessId) return 0;
      return await db.parked_orders.where('business_id').equals(businessId).count();
  }, [businessId]) || 0;

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
    
    // Feedback rápido
    if (navigator.vibrate) navigator.vibrate(50);
    toast.success("Agregado", { duration: 800, position: 'bottom-center' });
  };

  const updateQuantity = (id: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        const newQty = Math.max(1, item.quantity + delta);
        if (delta > 0 && newQty > item.stock) {
            toast.warning(`Solo hay ${item.stock} en stock`);
            return item;
        }
        return { ...item, quantity: newQty };
      }
      return item;
    }));
  };

  const removeFromCart = (id: string) => {
    setCart(prev => prev.filter(item => item.id !== id));
  };

  const clearCart = () => {
    if(confirm('¿Vaciar carrito?')) setCart([]);
  };

  // --- LÓGICA DE ÓRDENES GUARDADAS ---
  const handleParkOrder = async () => {
      if (cart.length === 0 || !businessId) return;
      try {
          const parked: ParkedOrder = {
              id: crypto.randomUUID(),
              business_id: businessId,
              date: new Date().toISOString(),
              items: cart.map(i => ({ 
                  product_id: i.id, name: i.name, price: i.price, 
                  quantity: i.quantity, cost: i.cost, unit: i.unit 
              })),
              total: cart.reduce((sum, i) => sum + (i.price * i.quantity), 0),
              customer_id: selectedCustomer?.id,
              customer_name: selectedCustomer?.name
          };
          await db.parked_orders.add(parked);
          setCart([]);
          setSelectedCustomer(null);
          setMobileView('catalog');
          toast.success("Orden guardada en pendientes");
      } catch (e) {console.error(e);
        toast.error("Error al guardar orden"); }
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
          await db.parked_orders.delete(order.id);
          setShowParkedModal(false);
          setMobileView('cart');
          toast.success("Orden restaurada");
      } else {
          toast.error("Los productos de esta orden ya no existen o no tienen stock");
      }
  };

  // --- PROCESAMIENTO DE VENTA ---
  const handleCheckout = async (method: 'efectivo' | 'transferencia', tendered: number, change: number) => {
    if (!activeShift) return toast.error("Caja cerrada");
    setIsCheckout(true);
    setShowPaymentModal(false);

    try {
        const saleId = crypto.randomUUID();
        const total = cart.reduce((sum, i) => sum + (i.price * i.quantity), 0);
        
        const saleItems: SaleItem[] = cart.map(i => ({
            product_id: i.id,
            name: i.name,
            quantity: i.quantity,
            price: i.price,
            cost: i.cost,
            unit: i.unit
        }));

        const sale: Sale = {
            id: saleId,
            business_id: businessId!,
            date: new Date().toISOString(),
            shift_id: activeShift.id,
            staff_id: currentStaff.id,
            staff_name: currentStaff.name,
            total: total,
            payment_method: method,
            amount_tendered: tendered,
            change: change,
            items: saleItems,
            customer_id: selectedCustomer?.id,
            customer_name: selectedCustomer?.name,
            sync_status: 'pending_create'
        };

        await db.transaction('rw', [db.sales, db.products, db.movements, db.action_queue, db.audit_logs, db.customers], async () => {
            // 1. Guardar Venta
            await db.sales.add(sale);
            
            // 2. Actualizar stock
            for (const item of cart) {
                const product = await db.products.get(item.id);
                if (product) {
                    await db.products.update(item.id, { 
                        stock: product.stock - item.quantity, 
                        sync_status: 'pending_update' 
                    });
                }
            }

            // 3. Puntos de fidelidad (1 pto por cada $10 gastados)
            if (selectedCustomer) {
                const pointsEarned = Math.floor(total / 10);
                const currentPoints = selectedCustomer.loyalty_points || 0;
                await db.customers.update(selectedCustomer.id, {
                    loyalty_points: currentPoints + pointsEarned,
                    sync_status: 'pending_update'
                });
            }

            // 4. Cola y Auditoría
            await addToQueue('SALE', { sale, items: saleItems });
            await logAuditAction('SALE', { total: sale.total, method: sale.payment_method }, currentStaff);
        });

        setLastSale(sale);
        setCart([]);
        setSelectedCustomer(null);
        setMobileView('catalog'); // Volver al catálogo
        toast.success(`Venta completada. Cambio: ${currency.format(sale.change || 0)}`);
        
        syncPush().catch(console.error);

    } catch (error) {
        console.error(error);
        toast.error("Error al procesar venta");
    } finally {
        setIsCheckout(false);
    }
  };

  const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  // --- RENDERIZADO (BISNE VISUAL) ---
  return (
    <div className="flex flex-col md:flex-row h-[calc(100vh-60px)] md:h-screen bg-[#F3F4F6] overflow-hidden font-sans">
      
      {/* =======================================================
          COLUMNA IZQUIERDA: CATÁLOGO DE PRODUCTOS
          En móvil se oculta si mobileView === 'cart'
         ======================================================= */}
      <div className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${mobileView === 'cart' ? 'hidden md:flex' : 'flex'}`}>
        
        {/* Barra Superior: Buscador y Categorías */}
        <div className="p-4 bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm flex flex-col gap-3">
            {/* Buscador */}
            <div className="relative w-full">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#6B7280] w-5 h-5 group-focus-within:text-[#0B3B68] transition-colors" />
                <input 
                    ref={searchInputRef}
                    type="text" 
                    placeholder="Buscar por nombre, código o SKU..." 
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    autoFocus
                    className="w-full pl-12 pr-10 py-3 bg-[#F3F4F6] border-none rounded-2xl text-lg focus:ring-2 focus:ring-[#0B3B68] focus:bg-white transition-all shadow-inner outline-none text-[#1F2937] placeholder-gray-400"
                />
                {query && (
                    <button onClick={() => {setQuery(''); searchInputRef.current?.focus();}} className="absolute right-4 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#EF4444] p-1">
                        <X size={18} />
                    </button>
                )}
            </div>

            {/* Categorías (Scroll horizontal) */}
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                {categories.map(cat => (
                    <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all border ${
                            selectedCategory === cat 
                                ? 'bg-[#0B3B68] text-white border-[#0B3B68] shadow-md shadow-[#0B3B68]/20' 
                                : 'bg-white text-[#6B7280] border-gray-200 hover:border-[#0B3B68] hover:text-[#0B3B68]'
                        }`}
                    >
                        {cat}
                    </button>
                ))}
            </div>
        </div>

        {/* Rejilla de Productos */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-[#F3F4F6] scroll-smooth">
            {!activeShift && (
                <div className="mb-6 p-4 bg-[#F59E0B]/10 border border-[#F59E0B] rounded-xl flex flex-col md:flex-row items-center justify-center gap-2 text-[#F59E0B] font-bold animate-pulse text-center">
                    <Lock size={20}/>
                    <span>ATENCIÓN: La caja está cerrada. Debes abrir un turno para vender.</span>
                </div>
            )}

            {filteredProducts.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-[#6B7280] opacity-50 py-10">
                    <Package size={64} className="mb-4 stroke-1"/>
                    <p className="text-xl font-bold font-heading text-[#0B3B68]">Sin resultados</p>
                    <p className="text-sm">Intenta con otro término de búsqueda</p>
                </div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4 pb-24 md:pb-0">
                    {filteredProducts.map(product => (
                        <button
                            key={product.id}
                            onClick={() => addToCart(product)}
                            className="bg-white p-3 md:p-4 rounded-2xl border border-gray-200 shadow-sm hover:shadow-md hover:border-[#7AC142] active:scale-[0.98] transition-all flex flex-col justify-between text-left group h-full relative overflow-hidden"
                        >
                            {/* Borde verde en hover */}
                            <div className="absolute top-0 left-0 w-1 h-full bg-[#7AC142] opacity-0 group-hover:opacity-100 transition-opacity"></div>

                            <div className="w-full mb-3">
                                <div className="flex justify-between items-start mb-1">
                                    <span className="text-[10px] font-bold uppercase text-[#6B7280] bg-gray-100 px-2 py-0.5 rounded-md truncate max-w-[70%]">
                                        {product.category || 'General'}
                                    </span>
                                    {product.stock <= 5 && (
                                        <div className="text-[#F59E0B] flex items-center gap-1 bg-[#F59E0B]/10 px-1.5 py-0.5 rounded text-[10px] font-bold">
                                            <AlertTriangle size={10} /> Bajo
                                        </div>
                                    )}
                                </div>
                                <h3 className="font-bold text-[#1F2937] text-sm md:text-base leading-tight line-clamp-2 h-10">
                                    {product.name}
                                </h3>
                            </div>
                            
                            <div className="w-full flex justify-between items-end border-t border-gray-50 pt-2 mt-auto">
                                <div className="text-xs text-[#6B7280]">
                                    Stock: <span className="font-bold text-[#1F2937]">{product.stock}</span>
                                </div>
                                <div className="text-lg font-black text-[#7AC142]">
                                    {currency.format(product.price)}
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
      </div>

      {/* =======================================================
          COLUMNA DERECHA: CARRITO DE COMPRAS
          En móvil es un overlay completo o sidebar.
         ======================================================= */}
      <div className={`w-full md:w-[420px] bg-white border-l border-gray-200 flex flex-col shadow-2xl z-20 transition-transform duration-300 absolute md:relative inset-0 md:inset-auto ${mobileView === 'cart' ? 'translate-x-0' : 'translate-x-full md:translate-x-0'}`}>
        
        {/* Header Carrito */}
        <div className="p-5 bg-[#0B3B68] text-white flex justify-between items-center shadow-md shrink-0">
            <div className="flex items-center gap-3">
                <div className="p-2 bg-white/10 rounded-xl relative">
                    <ShoppingCart size={24} className="text-[#7AC142]"/>
                    {cartCount > 0 && (
                        <span className="absolute -top-1 -right-1 bg-[#7AC142] text-[#0B3B68] text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center border-2 border-[#0B3B68]">
                            {cartCount > 99 ? '99+' : cartCount}
                        </span>
                    )}
                </div>
                <div>
                    <h2 className="font-bold text-lg leading-tight font-heading">Orden Actual</h2>
                    <p className="text-xs text-gray-300">{cart.length} productos distintos</p>
                </div>
            </div>
            
            <div className="flex gap-2">
                {cart.length > 0 && (
                    <button onClick={clearCart} className="p-2 hover:bg-white/10 rounded-lg text-[#EF4444] bg-white transition-colors" title="Vaciar Carrito">
                        <Trash2 size={20} />
                    </button>
                )}
                {/* Botón Cerrar (Solo Móvil) */}
                <button onClick={() => setMobileView('catalog')} className="md:hidden p-2 hover:bg-white/10 rounded-lg text-white">
                    <X size={24} />
                </button>
            </div>
        </div>

        {/* Selección de Cliente */}
        <div className="bg-[#F9FAFB] border-b border-gray-200 p-3">
            <CustomerSelect 
                selectedCustomer={selectedCustomer} 
                onSelect={setSelectedCustomer} 
            />
        </div>

        {/* Lista de Ítems */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#F9FAFB]">
            {cart.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-[#6B7280] opacity-60 text-center p-8 space-y-4">
                    <div className="w-20 h-20 bg-gray-200 rounded-full flex items-center justify-center">
                        <Barcode size={40} className="stroke-1"/>
                    </div>
                    <div>
                        <p className="font-bold text-[#1F2937] text-lg">Carrito Vacío</p>
                        <p className="text-sm">Escanea o selecciona productos del catálogo.</p>
                    </div>
                </div>
            ) : (
                cart.map(item => (
                    <div key={item.id} className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm flex flex-col gap-2 animate-in slide-in-from-right-4 duration-200">
                        <div className="flex justify-between items-start">
                            <div className="flex-1 pr-2">
                                <h4 className="font-bold text-[#1F2937] text-sm leading-tight line-clamp-2">{item.name}</h4>
                                <p className="text-xs text-[#6B7280] font-mono mt-0.5">
                                    {currency.format(item.price)} <span className="opacity-70">x unidad</span>
                                </p>
                            </div>
                            <div className="font-black text-[#1F2937] text-lg text-right whitespace-nowrap">
                                {currency.format(item.price * item.quantity)}
                            </div>
                        </div>
                        
                        <div className="flex justify-between items-center bg-[#F3F4F6] p-1 rounded-lg mt-1 border border-gray-100">
                            <div className="flex items-center gap-1">
                                <button onClick={() => updateQuantity(item.id, -1)} className="w-9 h-9 flex items-center justify-center bg-white rounded-md text-[#1F2937] shadow-sm hover:bg-gray-100 border border-gray-200 active:scale-95 transition-all">
                                    <Minus size={16}/>
                                </button>
                                <span className="font-bold text-lg text-[#0B3B68] w-10 text-center tabular-nums">{item.quantity}</span>
                                <button onClick={() => updateQuantity(item.id, 1)} className="w-9 h-9 flex items-center justify-center bg-[#0B3B68] text-white rounded-md shadow-sm hover:bg-[#0B3B68]/90 active:scale-95 transition-all">
                                    <Plus size={16}/>
                                </button>
                            </div>
                            <button onClick={() => removeFromCart(item.id)} className="p-2 text-gray-400 hover:text-[#EF4444] hover:bg-red-50 rounded-lg transition-colors">
                                <X size={18} />
                            </button>
                        </div>
                    </div>
                ))
            )}
        </div>

        {/* Footer: Acciones y Totales */}
        <div className="p-5 bg-white border-t border-gray-200 shadow-[0_-4px_20px_-5px_rgba(0,0,0,0.1)] relative z-30 shrink-0">
            
            {/* Botones de Acción Secundaria */}
            <div className="grid grid-cols-2 gap-3 mb-4">
                <button 
                    onClick={() => setShowParkedModal(true)} 
                    className="flex items-center justify-center gap-2 py-2.5 px-3 bg-[#F3F4F6] text-[#0B3B68] font-bold rounded-xl hover:bg-gray-200 text-xs uppercase tracking-wide transition-colors border border-gray-200"
                >
                    <ClipboardList size={16}/> 
                    <span>Pendientes {parkedCount > 0 && `(${parkedCount})`}</span>
                </button>
                <button 
                    onClick={handleParkOrder} 
                    disabled={cart.length === 0}
                    className="flex items-center justify-center gap-2 py-2.5 px-3 bg-[#F3F4F6] text-[#F59E0B] font-bold rounded-xl hover:bg-[#F59E0B]/10 text-xs uppercase tracking-wide transition-colors border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <PauseCircle size={16}/> 
                    <span>Guardar Orden</span>
                </button>
            </div>

            {/* Totales */}
            <div className="space-y-1 mb-5">
                <div className="flex justify-between items-end border-b border-gray-100 pb-2 mb-2">
                    <span className="text-sm font-medium text-[#6B7280]">Subtotal</span>
                    <span className="text-sm font-bold text-[#1F2937]">{currency.format(totalAmount)}</span>
                </div>
                <div className="flex justify-between items-end">
                    <span className="font-bold text-lg text-[#1F2937] flex items-center gap-2">
                        <Keyboard size={18} className="hidden md:block text-[#6B7280]"/> Total a Pagar
                    </span>
                    <span className="font-black text-4xl text-[#0B3B68] tracking-tight">{currency.format(totalAmount)}</span>
                </div>
            </div>

            {/* Botón Principal de Cobro */}
            <button 
                onClick={() => setShowPaymentModal(true)} 
                disabled={cart.length === 0 || isCheckout || !activeShift} 
                className={`w-full py-4 rounded-xl font-bold text-lg shadow-xl flex items-center justify-center gap-2 transition-all duration-200 uppercase tracking-wide
                    ${!activeShift 
                        ? 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none' 
                        : 'bg-[#7AC142] text-white hover:bg-[#7AC142]/90 active:scale-[0.98] hover:shadow-[#7AC142]/30 shadow-[#7AC142]/20'
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

      {/* =======================================================
          BOTÓN FLOTANTE MÓVIL (SOLO VISIBLE EN MOBILE CATALOG)
         ======================================================= */}
      {mobileView === 'catalog' && cart.length > 0 && (
          <div className="md:hidden fixed bottom-20 left-4 right-4 z-50">
              <button 
                onClick={() => setMobileView('cart')}
                className="w-full bg-[#0B3B68] text-white p-4 rounded-2xl shadow-2xl flex justify-between items-center animate-in slide-in-from-bottom-4 active:scale-95 transition-transform"
              >
                  <div className="flex items-center gap-3">
                      <div className="bg-[#7AC142] text-[#0B3B68] text-xs font-black px-2.5 py-1 rounded-full border-2 border-[#0B3B68]">
                          {cartCount}
                      </div>
                      <span className="font-bold text-sm uppercase tracking-wide">Ver Carrito</span>
                  </div>
                  <div className="flex items-center gap-2">
                      <span className="font-black text-xl">{currency.format(totalAmount)}</span>
                      <ChevronRight size={24} className="text-[#7AC142]" />
                  </div>
              </button>
          </div>
      )}

      {/* --- MODALES --- */}
      {showPaymentModal && <PaymentModal total={totalAmount} onCancel={() => setShowPaymentModal(false)} onConfirm={handleCheckout} />}
      {showParkedModal && <ParkedOrdersModal onClose={() => setShowParkedModal(false)} onRestore={handleRestoreOrder} />}
      {lastSale && <TicketModal sale={lastSale} onClose={() => { setLastSale(null); setTimeout(() => searchInputRef.current?.focus(), 100); }} />}
    </div>
  );
}