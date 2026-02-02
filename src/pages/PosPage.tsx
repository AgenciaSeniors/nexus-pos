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
    // Aseguramos obtener el turno abierto correcto
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

  // --- PROCESAMIENTO DE VENTA (CORE FIX) ---
 const handleCheckout = async (methodInput: string, tendered: number, change: number) => {
    // 1. VALIDACIÓN PREVIA (Rápida, sin tocar DB)
    if (!activeShift || !activeShift.id) return toast.error("Caja cerrada o turno inválido");
    
    setIsCheckout(true);
    setShowPaymentModal(false);

    try {
        // 2. PREPARACIÓN DE DATOS (Síncrono - Fuera de la transacción)
        // Normalizamos el método de pago antes de entrar a la lógica crítica
        let normalizedMethod: 'efectivo' | 'transferencia' | 'tarjeta' | 'mixto' = 'efectivo';
        const m = methodInput.toLowerCase().trim();
        
        if (m.includes('transf')) normalizedMethod = 'transferencia';
        else if (m.includes('tarj')) normalizedMethod = 'tarjeta';
        else if (m.includes('mix')) normalizedMethod = 'mixto';
        else normalizedMethod = 'efectivo';

        const saleId = crypto.randomUUID();
        const total = cart.reduce((sum, i) => sum + (i.price * i.quantity), 0);
        
        // Preparamos los items de venta
        const saleItems: SaleItem[] = cart.map(i => ({
            product_id: i.id,
            name: i.name,
            quantity: i.quantity,
            price: i.price,
            cost: i.cost,
            unit: i.unit
        }));

        // Construimos el objeto de venta completo
        const sale: Sale = {
            id: saleId,
            business_id: businessId!,
            date: new Date().toISOString(),
            shift_id: activeShift.id, // Vinculación crítica al turno
            staff_id: currentStaff.id,
            staff_name: currentStaff.name,
            total: total,
            payment_method: normalizedMethod,
            amount_tendered: tendered,
            change: change,
            items: saleItems,
            customer_id: selectedCustomer?.id,
            customer_name: selectedCustomer?.name,
            sync_status: 'pending_create'
        };

        // 3. TRANSACCIÓN ATÓMICA (Dexie)
        // Usamos 'rw' (lectura/escritura) en todas las tablas involucradas
        await db.transaction('rw', [db.sales, db.products, db.movements, db.action_queue, db.audit_logs, db.customers], async () => {
            
            // A. Guardar la Venta
            await db.sales.add(sale);
            
            // B. Actualizar Stock (PARALELIZADO CON PROMISE.ALL)
            // Esto evita que la transacción se "duerma" esperando iteración por iteración
            const updateStockPromises = cart.map(async (item) => {
                const product = await db.products.get(item.id);
                if (product) {
                    await db.products.update(item.id, { 
                        stock: product.stock - item.quantity, 
                        sync_status: 'pending_update' 
                    });
                }
            });
            await Promise.all(updateStockPromises);

            // C. Puntos de fidelidad (Si aplica)
            if (selectedCustomer?.id) {
                const pointsEarned = Math.floor(total / 10);
                // Leemos el cliente fresco dentro de la transacción para evitar condiciones de carrera
                const freshCustomer = await db.customers.get(selectedCustomer.id);
                
                if (freshCustomer) {
                    await db.customers.update(selectedCustomer.id, {
                        loyalty_points: (freshCustomer.loyalty_points || 0) + pointsEarned,
                        sync_status: 'pending_update'
                    });
                }
            }

            // D. Cola de Sincronización y Auditoría
            // Ambas operaciones son locales en Dexie y deben ser parte de la atomicidad
            await addToQueue('SALE', { sale, items: saleItems });
            await logAuditAction('SALE', { total: sale.total, method: sale.payment_method }, currentStaff);
        });

        // 4. ACTUALIZACIÓN DE ESTADO Y UI (Fuera de la transacción)
        // Si llegamos aquí, la transacción fue exitosa (Commit implícito)
        setLastSale(sale);
        setCart([]);
        setSelectedCustomer(null);
        setMobileView('catalog');
        toast.success(`Venta completada. Cambio: ${currency.format(sale.change || 0)}`);
        
        // 5. SINCRONIZACIÓN DE RED (Background)
        // Disparamos el push sin 'await' para no bloquear la UI del usuario
        syncPush().catch(error => {
            console.error("⚠️ La venta se guardó localmente, pero falló el sync inmediato:", error);
            // No mostramos error al usuario porque la venta YA es válida localmente ("Offline-First")
        });

    } catch (error) {
        console.error("❌ Error crítico en transacción de venta:", error);
        
        // Manejo específico de errores de Dexie
        if (error instanceof Error && (error.name === 'TransactionInactiveError' || error.name === 'AbortError')) {
             toast.error("Error de concurrencia en base de datos. Por favor intente de nuevo.");
        } else {
             toast.error("Error al procesar la venta. Verifique el stock.");
        }
        // Nota: Como la transacción falló, Dexie hace rollback automático de todos los cambios (stock, venta, puntos)
    } finally {
        setIsCheckout(false);
    }
  };

  const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  // --- UI RENDER ---
  return (
    <div className="flex flex-col md:flex-row h-[calc(100vh-60px)] md:h-screen bg-background overflow-hidden font-body">
      
      {/* COLUMNA IZQUIERDA: CATÁLOGO */}
      <div className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${mobileView === 'cart' ? 'hidden md:flex' : 'flex'}`}>
        
        {/* Barra Superior */}
        <div className="p-4 bg-surface border-b border-gray-200 sticky top-0 z-10 shadow-sm flex flex-col gap-3">
            <div className="relative w-full">
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
            {!activeShift && (
                <div className="mb-6 p-4 bg-state-warning/10 border border-state-warning rounded-xl flex flex-col md:flex-row items-center justify-center gap-2 text-state-warning font-bold animate-pulse text-center font-heading">
                    <Lock size={20}/>
                    <span>ATENCIÓN: La caja está cerrada. Debes abrir un turno para vender.</span>
                </div>
            )}

            {filteredProducts.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-text-secondary opacity-50 py-10">
                    <Package size={64} className="mb-4 stroke-1"/>
                    <p className="text-xl font-bold font-heading text-bisne-navy">Sin resultados</p>
                    <p className="text-sm font-body">Intenta con otro término de búsqueda</p>
                </div>
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
                                    {product.stock <= 5 && (
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
        
        <div className="p-5 bg-bisne-navy text-white flex justify-between items-center shadow-md shrink-0">
            <div className="flex items-center gap-3">
                <div className="p-2 bg-white/10 rounded-xl relative">
                    <ShoppingCart size={24} className="text-talla-growth"/>
                    {cartCount > 0 && (
                        <span className="absolute -top-1 -right-1 bg-talla-growth text-bisne-navy text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center border-2 border-bisne-navy">
                            {cartCount > 99 ? '99+' : cartCount}
                        </span>
                    )}
                </div>
                <div>
                    <h2 className="font-bold text-lg leading-tight font-heading">Orden Actual</h2>
                    <p className="text-xs text-gray-300 font-body">{cart.length} productos distintos</p>
                </div>
            </div>
            <div className="flex gap-2">
                {cart.length > 0 && (
                    <button onClick={clearCart} className="p-2 hover:bg-white/10 rounded-lg text-state-error bg-surface transition-colors" title="Vaciar Carrito">
                        <Trash2 size={20} />
                    </button>
                )}
                <button onClick={() => setMobileView('catalog')} className="md:hidden p-2 hover:bg-white/10 rounded-lg text-white">
                    <X size={24} />
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
                cart.map(item => (
                    <div key={item.id} className="bg-surface p-3 rounded-xl border border-gray-200 shadow-sm flex flex-col gap-2 animate-in slide-in-from-right-4 duration-200">
                        <div className="flex justify-between items-start">
                            <div className="flex-1 pr-2">
                                <h4 className="font-bold text-text-main text-sm leading-tight line-clamp-2 font-heading">{item.name}</h4>
                                <p className="text-xs text-text-secondary font-mono mt-0.5">
                                    {currency.format(item.price)} <span className="opacity-70">x unidad</span>
                                </p>
                            </div>
                            <div className="font-black text-text-main text-lg text-right whitespace-nowrap font-body">
                                {currency.format(item.price * item.quantity)}
                            </div>
                        </div>
                        <div className="flex justify-between items-center bg-background p-1 rounded-lg mt-1 border border-gray-100">
                            <div className="flex items-center gap-1">
                                <button onClick={() => updateQuantity(item.id, -1)} className="w-9 h-9 flex items-center justify-center bg-surface rounded-md text-text-main shadow-sm hover:bg-gray-100 border border-gray-200 active:scale-95 transition-all">
                                    <Minus size={16}/>
                                </button>
                                <span className="font-bold text-lg text-bisne-navy w-10 text-center tabular-nums font-body">{item.quantity}</span>
                                <button onClick={() => updateQuantity(item.id, 1)} className="w-9 h-9 flex items-center justify-center bg-bisne-navy text-white rounded-md shadow-sm hover:bg-bisne-navy/90 active:scale-95 transition-all">
                                    <Plus size={16}/>
                                </button>
                            </div>
                            <button onClick={() => removeFromCart(item.id)} className="p-2 text-gray-400 hover:text-state-error hover:bg-red-50 rounded-lg transition-colors">
                                <X size={18} />
                            </button>
                        </div>
                    </div>
                ))
            )}
        </div>

        <div className="p-5 bg-surface border-t border-gray-200 shadow-[0_-4px_20px_-5px_rgba(0,0,0,0.1)] relative z-30 shrink-0">
            <div className="grid grid-cols-2 gap-3 mb-4">
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

            <div className="space-y-1 mb-5">
                <div className="flex justify-between items-end border-b border-gray-100 pb-2 mb-2">
                    <span className="text-sm font-medium text-text-secondary font-heading">Subtotal</span>
                    <span className="text-sm font-bold text-text-main font-body">{currency.format(totalAmount)}</span>
                </div>
                <div className="flex justify-between items-end">
                    <span className="font-bold text-lg text-text-main flex items-center gap-2 font-heading">
                        <Keyboard size={18} className="hidden md:block text-text-secondary"/> Total a Pagar
                    </span>
                    <span className="font-black text-4xl text-bisne-navy tracking-tight font-body">{currency.format(totalAmount)}</span>
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
                      <span className="font-black text-xl font-body">{currency.format(totalAmount)}</span>
                      <ChevronRight size={24} className="text-talla-growth" />
                  </div>
              </button>
          </div>
      )}

      {showPaymentModal && <PaymentModal total={totalAmount} onCancel={() => setShowPaymentModal(false)} onConfirm={handleCheckout} />}
      {showParkedModal && <ParkedOrdersModal onClose={() => setShowParkedModal(false)} onRestore={handleRestoreOrder} />}
      {lastSale && <TicketModal sale={lastSale} onClose={() => { setLastSale(null); setTimeout(() => searchInputRef.current?.focus(), 100); }} />}
    </div>
  );
}