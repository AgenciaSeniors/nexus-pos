import { useState, useEffect, useRef } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Product, type Sale, type ParkedOrder, type SaleItem, type Staff, type InventoryMovement } from '../lib/db';
import { supabase } from '../lib/supabase';
import { addToQueue, syncPush } from '../lib/sync';
import { currency } from '../lib/currency';
import { logAuditAction } from '../lib/audit';
import { TicketModal } from '../components/TicketModal';
import { PaymentModal } from '../components/PaymentModal';
import { ParkedOrdersModal } from '../components/ParkedOrdersModal';
import { PauseCircle, ClipboardList, Users, Search, Barcode, Keyboard, AlertTriangle, Plus, Minus, X, Lock } from 'lucide-react';
import { toast } from 'sonner';

interface CartItem extends Product {
  quantity: number;
}

export function PosPage() {
  const { currentStaff } = useOutletContext<{ currentStaff: Staff }>();
  const navigate = useNavigate();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('Todo');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCheckout, setIsCheckout] = useState(false);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showParkedModal, setShowParkedModal] = useState(false);
  
  const parkedCount = useLiveQuery(() => db.parked_orders.count()) || 0;
  const businessId = localStorage.getItem('nexus_business_id');
  
  // 🔥 1. VITAL: Detectar el Turno Activo para vincular la venta
  const activeShift = useLiveQuery(async () => {
    if (!businessId) return null;
    return await db.cash_shifts
      .where({ business_id: businessId, status: 'open' })
      .first();
  }, [businessId]);

  const allProducts = useLiveQuery(async () => {
    if (!businessId) return [];
    return await db.products
      .where('business_id').equals(businessId)
      .filter(p => !p.deleted_at) 
      .toArray();
  }, [businessId]) || [];

  useEffect(() => {
    if (searchInputRef.current) searchInputRef.current.focus();
  }, []);
  
  const categories = ['Todo', ...new Set(allProducts.map(p => p.category).filter((c): c is string => !!c))].sort();

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Bloquear atajos si no hay turno
      if (e.key === 'F1') {
        e.preventDefault();
        if (cart.length > 0 && !showPaymentModal && !lastSale && !isCheckout && activeShift) {
          setShowPaymentModal(true);
        }
      }
      if (e.key === 'F2') {
        e.preventDefault();
        searchInputRef.current?.focus();
        setQuery('');
      }
      if (e.key === 'Escape') {
        if (showPaymentModal) setShowPaymentModal(false);
        else if (showParkedModal) setShowParkedModal(false);
        else if (lastSale) setLastSale(null);
        else if (document.activeElement === searchInputRef.current) {
            if(query) setQuery('');
            else searchInputRef.current?.blur();
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [cart, showPaymentModal, showParkedModal, lastSale, isCheckout, query, activeShift]);

  // Caché de Business ID
  useEffect(() => {
    const cacheBusinessId = async () => {
      if (!navigator.onLine) return;
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { data: perfil } = await supabase
          .from('profiles')
          .select('business_id')
          .eq('id', session.user.id)
          .single();
        if (perfil?.business_id) {
          localStorage.setItem('nexus_business_id', perfil.business_id);
        }
      }
    };
    cacheBusinessId();
  }, []);

  const filteredProducts = allProducts.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(query.toLowerCase()) || p.sku.includes(query);
    const matchesCategory = selectedCategory === 'Todo' || p.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        return prev.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && query.trim() !== '') {
        const exactMatch = allProducts.find(p => p.sku === query.trim());
        if (exactMatch) {
            addToCart(exactMatch);
            setQuery(''); 
        } else {
            if (filteredProducts.length === 1) {
                addToCart(filteredProducts[0]);
                setQuery('');
            } else {
                toast.warning("Producto no encontrado");
            }
        }
    }
  };

  const removeFromCart = (id: string) => setCart(prev => prev.filter(item => item.id !== id));
  
  const updateQuantity = (id: string, newValue: number) => {
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        const validQty = Math.max(0, parseFloat(newValue.toFixed(3)));
        return { ...item, quantity: validQty };
      }
      return item;
    }));
  };

  const totalAmount = currency.calculateTotal(cart);

  const handleParkOrder = async () => {
    if (cart.length === 0) return;
    const businessId = localStorage.getItem('nexus_business_id') || 'unknown';
    const itemsToPark: SaleItem[] = cart.map(item => ({
        product_id: item.id,
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        unit: item.unit
    }));

    await db.parked_orders.add({
      id: crypto.randomUUID(),
      business_id: businessId,
      date: new Date().toISOString(),
      items: itemsToPark,
      total: totalAmount
    });
    
    setCart([]);
    toast.info("Orden puesta en espera");
    setTimeout(() => searchInputRef.current?.focus(), 100);
  };

  const handleRestoreOrder = (order: ParkedOrder) => {
    const doRestore = () => {
        const restoredCart: CartItem[] = order.items.map(item => ({
            id: item.product_id,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            unit: item.unit,
            stock: 999,
            sku: '',
            business_id: order.business_id,
            sync_status: 'synced',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }));
        setCart(restoredCart);
        db.parked_orders.delete(order.id);
        setShowParkedModal(false);
        toast.success("Venta recuperada");
    };

    if (cart.length > 0) {
      toast("Hay una venta en curso", {
        description: "¿Deseas reemplazarla por la orden en espera?",
        action: { label: "Reemplazar", onClick: doRestore },
        cancel: { label: "Cancelar", onClick:()=>{} },
        duration: 5000,
      });
      return;
    }
    doRestore();
  };

  const handleCheckout = async (paymentMethod: 'efectivo' | 'transferencia' | 'tarjeta' | 'mixto', tendered: number, change: number) => {
    // 🔥 2. BLOQUEO DE SEGURIDAD: No vender sin caja abierta
    if (!activeShift) {
        toast.error('⚠️ DEBES ABRIR CAJA PRIMERO');
        navigate('/finanzas'); 
        return;
    }

    if (cart.length === 0) return;
    setIsCheckout(true);
    setShowPaymentModal(false);
    
    const checkoutPromise = async () => {
        const businessId = localStorage.getItem('nexus_business_id');
        if (!businessId) throw new Error("No se detecta el ID del negocio");

        const saleId = crypto.randomUUID();
        const saleDate = new Date().toISOString();
        
        const newSale: Sale = {
          id: saleId,
          business_id: businessId,
          // 🔥 3. VINCULACIÓN CRÍTICA: Aquí guardamos el shift_id
          shift_id: activeShift.id, 
          total: totalAmount,
          date: saleDate,
          items: cart.map(item => ({ 
              product_id: item.id, 
              name: item.name, 
              quantity: item.quantity, 
              price: item.price,
              unit: item.unit,
              cost: item.cost 
          })),
          staff_id: currentStaff.id,
          staff_name: currentStaff.name,
          payment_method: paymentMethod,
          amount_tendered: tendered,
          change: change,
          sync_status: 'pending_create'
        };

        const saleItemsForQueue = cart.map(item => ({
          sale_id: saleId,
          business_id: businessId,
          product_id: item.id,
          name: item.name,
          quantity: item.quantity,
          price: item.price,
          unit_cost: item.cost || 0,
          total: currency.multiply(item.price, item.quantity)
        }));

        await db.transaction('rw', [db.products, db.sales, db.movements, db.audit_logs, db.action_queue], async () => {
          // 1. Guardar venta local
          await db.sales.add(newSale);
          // 2. Encolar venta completa
          await addToQueue('SALE', { sale: newSale, items: saleItemsForQueue });

          // 3. Actualizar stock local y registrar movimientos
          for (const item of cart) {
            const product = await db.products.get(item.id);
            if (product) {
              await db.products.update(item.id, { stock: product.stock - item.quantity, sync_status: 'pending_update' });
              
              const movement: InventoryMovement = {
                  id: crypto.randomUUID(),
                  business_id: businessId,
                  product_id: item.id,
                  qty_change: -item.quantity, 
                  reason: 'sale',
                  created_at: saleDate,
                  staff_id: currentStaff.id,
                  sync_status: 'pending_create'
              };
              await db.movements.add(movement);
              await addToQueue('MOVEMENT', movement);
            }
          }
          
          // 4. Auditoría
          await logAuditAction('SALE', { sale_id: saleId, total: totalAmount }, {
              id: currentStaff.id, name: currentStaff.name, business_id: businessId
          } as Staff);
        });

        return newSale;
    };

    toast.promise(checkoutPromise(), {
        loading: 'Procesando venta...',
        success: (newSale) => {
            setCart([]);
            setLastSale(newSale);
            setTimeout(() => {
                setQuery('');
                searchInputRef.current?.focus();
            }, 200);
            
            syncPush().catch(console.error);
            return `Venta registrada: ${currency.format(totalAmount)}`;
        },
        error: (err) => {
            console.error(err);
            return "Error al guardar la venta";
        },
        finally: () => setIsCheckout(false)
    });
  };

  return (
    <div className="flex flex-col md:flex-row h-[calc(100dvh-4rem)] md:h-[calc(100dvh-2rem)] overflow-hidden">
      
      {/* IZQUIERDA: Catálogo */}
      <div className="w-full md:w-2/3 p-4 flex flex-col gap-4 bg-slate-50 border-r border-slate-200">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="relative w-full flex-1">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                    <Search size={20} />
                </div>
                <input 
                    ref={searchInputRef}
                    type="text" 
                    className="w-full pl-10 pr-12 py-3 border border-slate-300 rounded-xl shadow-sm focus:ring-2 focus:ring-indigo-500 outline-none text-lg" 
                    placeholder="Escanear código o buscar (F2)..." 
                    value={query} 
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 flex items-center gap-2">
                    <span className="hidden sm:inline text-[10px] font-bold bg-slate-100 px-1.5 py-0.5 rounded text-slate-500 border border-slate-200">F2</span>
                    <Barcode size={24} />
                </div>
            </div>
            
            {/* INDICADOR DE CAJA */}
            <div className={`flex items-center gap-2 border rounded-lg px-3 py-2 shadow-sm flex-shrink-0 self-end sm:self-auto ${activeShift ? 'bg-indigo-50 border-indigo-100' : 'bg-red-50 border-red-100'}`}>
               <Users size={18} className={activeShift ? 'text-indigo-600' : 'text-red-500'} />
               <div className="flex flex-col">
                 <span className={`text-[10px] leading-none font-bold uppercase ${activeShift ? 'text-indigo-400' : 'text-red-400'}`}>
                    {activeShift ? 'Caja Abierta' : 'Caja Cerrada'}
                 </span>
                 <span className={`text-sm font-bold leading-none ${activeShift ? 'text-indigo-700' : 'text-red-700'}`}>
                    {currentStaff.name}
                 </span>
               </div>
            </div>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {categories.map(cat => (
                <button key={cat} onClick={() => setSelectedCategory(cat)} className={`px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-all ${selectedCategory === cat ? 'bg-slate-800 text-white shadow-md' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'}`}>{cat}</button>
            ))}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 overflow-y-auto pb-24 content-start pr-1">
            {filteredProducts.map(p => (
                 <button key={p.id} onClick={() => addToCart(p)} className="group relative bg-white rounded-2xl p-4 shadow-sm hover:shadow-xl border border-slate-100 hover:border-indigo-100 transition-all duration-300 flex flex-col justify-between h-40 overflow-hidden text-left active:scale-95 touch-manipulation">
                 <div className="absolute inset-0 bg-gradient-to-br from-transparent to-indigo-50 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                 <div className="relative z-10">
                    {p.category && (
                      <span className="inline-block px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-2 group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-colors">
                        {p.category}
                      </span>
                    )}
                    <h3 className={`font-bold text-slate-700 leading-snug text-sm line-clamp-2 group-hover:text-indigo-900 ${!p.category ? 'mt-4' : ''}`}>
                      {p.name}
                    </h3>
                 </div>
                 <div className="relative z-10 flex justify-between items-end mt-2">
                    <div className="text-xs text-slate-400 font-medium flex flex-col">
                        <span>Stock:</span>
                        <span className={`${p.stock < 5 ? 'text-red-500' : 'text-slate-600'}`}>{p.stock} <span className="text-[10px] uppercase">{p.unit || 'un'}</span></span>
                    </div>
                    <div className="bg-slate-50 text-slate-900 font-bold px-3 py-1.5 rounded-lg text-sm shadow-sm group-hover:bg-indigo-600 group-hover:text-white group-hover:shadow-indigo-200 transition-all">
                        {currency.format(p.price)}
                    </div>
                 </div>
               </button>
            ))}
        </div>
      </div>

      {/* DERECHA: Carrito */}
      <div className="w-full md:w-1/3 bg-white shadow-2xl flex flex-col h-full z-20">
        <div className="p-4 bg-slate-50 border-b flex justify-between items-center shrink-0">
             <h2 className="font-bold text-lg flex items-center gap-2 text-slate-800">
               Ticket <span className="text-xs font-normal text-slate-400 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 hidden md:inline">F1</span>
             </h2>
             <span className="text-xs bg-indigo-100 text-indigo-700 font-bold px-2 py-1 rounded-full">{cart.length} ítems</span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
            {cart.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-slate-300 opacity-60">
                <ClipboardList size={48} className="mb-2" />
                <p>Carrito vacío</p>
              </div>
            )}
            
            {cart.map(item => {
              const isStockProblem = item.quantity > item.stock;

              return (
                <div key={item.id} className={`flex flex-col gap-2 bg-white p-3 rounded-xl border shadow-sm animate-in slide-in-from-right duration-200 ${isStockProblem ? 'border-amber-200 bg-amber-50' : 'border-slate-100'}`}>
                  
                  <div className="flex justify-between items-start">
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-slate-800 truncate">{item.name}</div>
                      <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                        <span>{currency.format(item.price)} x {item.unit || 'un'}</span>
                        {isStockProblem && (
                          <span className="flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-100 px-1.5 rounded">
                            <AlertTriangle size={10} /> Stock: {item.stock}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="font-bold text-slate-900 text-lg ml-2">
                        {currency.format(currency.multiply(item.price, item.quantity))}
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between mt-1">
                    <div className="flex items-center bg-slate-100 rounded-lg p-1 gap-1 border border-slate-200">
                      <button 
                        onClick={() => updateQuantity(item.id, item.quantity - 1)} 
                        className="w-10 h-10 flex items-center justify-center bg-white text-slate-600 rounded-md shadow-sm active:scale-95 transition-all border border-slate-200"
                      >
                        <Minus size={18} />
                      </button>
                      
                      <div className="relative">
                        <input 
                            type="text" 
                            inputMode="numeric"
                            pattern="[0-9]*"
                            className="w-12 text-center bg-transparent font-bold text-slate-800 focus:outline-none p-0 appearance-none text-base"
                            value={item.quantity}
                            onChange={(e) => updateQuantity(item.id, parseFloat(e.target.value) || 0)}
                            onFocus={(e) => e.target.select()}
                        />
                      </div>
                      
                      <button 
                        onClick={() => updateQuantity(item.id, item.quantity + 1)} 
                        className="w-10 h-10 flex items-center justify-center bg-indigo-600 text-white rounded-md shadow-sm shadow-indigo-200 active:scale-95 transition-all"
                      >
                        <Plus size={18} />
                      </button>
                    </div>

                    <button 
                      onClick={() => removeFromCart(item.id)} 
                      className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <X size={20} />
                    </button>
                  </div>

                </div>
              );
            })}
        </div>

        <div className="p-4 bg-white border-t border-slate-200 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] shrink-0 z-30 pb- safe-area-inset-bottom">
          <div className="grid grid-cols-2 gap-3 mb-4">
             <button
               onClick={handleParkOrder}
               disabled={cart.length === 0}
               className="flex items-center justify-center gap-2 py-3 bg-orange-50 text-orange-700 font-bold rounded-xl border border-orange-100 hover:bg-orange-100 transition-colors disabled:opacity-50 touch-manipulation"
             >
               <PauseCircle size={20} />
               <span className="text-sm">Espera</span>
             </button>

             <button
               onClick={() => setShowParkedModal(true)}
               className="relative flex items-center justify-center gap-2 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl border border-slate-200 hover:bg-slate-200 transition-colors touch-manipulation"
             >
               <ClipboardList size={20} />
               <span className="text-sm">Pendientes</span>
               {parkedCount > 0 && (
                 <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full shadow-sm animate-bounce">
                   {parkedCount}
                 </span>
               )}
             </button>
          </div>

          <div className="flex justify-between items-end mb-3">
            <span className="text-slate-500 font-medium flex items-center gap-2">
                <Keyboard size={18} className="hidden md:block"/> Total
            </span>
            <span className="text-3xl font-black text-slate-900 tracking-tight">{currency.format(totalAmount)}</span>
          </div>
          
          {/* 🔥 BOTÓN COBRAR BLOQUEADO SI NO HAY TURNO */}
          <button 
            onClick={() => setShowPaymentModal(true)} 
            disabled={cart.length === 0 || isCheckout || !activeShift} 
            className={`w-full font-bold py-4 rounded-xl shadow-lg transition-transform active:scale-[0.98] text-xl 
                ${!activeShift ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-slate-900 hover:bg-black text-white shadow-slate-300'}
            `}
          >
            {!activeShift ? <span className="flex items-center justify-center gap-2"><Lock size={20}/> CAJA CERRADA</span> : (isCheckout ? 'Procesando...' : 'COBRAR')}
          </button>
        </div>
      </div>

      {showPaymentModal && <PaymentModal total={totalAmount} onCancel={() => setShowPaymentModal(false)} onConfirm={handleCheckout} />}
      {lastSale && (
        <TicketModal 
            sale={lastSale} 
            onClose={() => { 
                setLastSale(null); 
                setTimeout(() => searchInputRef.current?.focus(), 100);
            }} 
        />
      )}
      
      {showParkedModal && (
        <ParkedOrdersModal 
          onClose={() => setShowParkedModal(false)} 
          onRestore={handleRestoreOrder} 
        />
      )}
    </div>
  );
}