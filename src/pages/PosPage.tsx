import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom'; // <--- IMPORTANTE: Para recibir al empleado del PIN
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Product, type Sale, type Customer, type ParkedOrder, type SaleItem, type Staff } from '../lib/db';
import { supabase } from '../lib/supabase';
import { syncPush } from '../lib/sync';
import { TicketModal } from '../components/TicketModal';
import { PaymentModal } from '../components/PaymentModal';
import { CustomerSelect } from '../components/CustomerSelect';
import { ParkedOrdersModal } from '../components/ParkedOrdersModal';
import { PauseCircle, ClipboardList, Users } from 'lucide-react';

interface CartItem extends Product {
  quantity: number;
}

export function PosPage() {
  // 1. RECUPERAMOS AL EMPLEADO AUTOMÁTICAMENTE (Viene del Layout/PIN)
  const { currentStaff } = useOutletContext<{ currentStaff: Staff }>();

  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('Todo');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCheckout, setIsCheckout] = useState(false);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [currentCustomer, setCurrentCustomer] = useState<Customer | null>(null);
  
  const [showParkedModal, setShowParkedModal] = useState(false);
  const parkedCount = useLiveQuery(() => db.parked_orders.count()) || 0;

  const allProducts = useLiveQuery(() => db.products.toArray()) || [];
  const categories = ['Todo', ...new Set(allProducts.map(p => p.category || 'General'))].sort();

  // 2. CACHÉ AUTOMÁTICA DEL NEGOCIO (Offline-Ready)
  useEffect(() => {
    const cacheBusinessId = async () => {
      // Solo intentamos si hay internet. Si falla, no pasa nada, usamos lo que haya en caché.
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
    const matchesCategory = selectedCategory === 'Todo' || (p.category || 'General') === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) return prev.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      return [...prev, { ...product, quantity: 1 }];
    });
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

  const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  // --- LÓGICA DE CUENTAS EN ESPERA ---
  const handleParkOrder = async () => {
    if (cart.length === 0) return;
    
    const itemsToPark: SaleItem[] = cart.map(item => ({
        product_id: item.id,
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        unit: item.unit
    }));

    await db.parked_orders.add({
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      items: itemsToPark,
      total: totalAmount
    });
    
    setCart([]);
    setCurrentCustomer(null);
  };

  const handleRestoreOrder = (order: ParkedOrder) => {
    if (cart.length > 0) {
      if (!confirm("Hay una venta en curso. ¿Deseas reemplazarla?")) return;
    }
    
    const restoredCart: CartItem[] = order.items.map(item => ({
        id: item.product_id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        unit: item.unit,
        stock: 999, // Stock visual temporal
        sku: '',
        business_id: ''
    }));

    setCart(restoredCart);
    db.parked_orders.delete(order.id);
    setShowParkedModal(false);
  };

  // --- FUNCIÓN DE COBRO (OFFLINE-FIRST CON VENDEDOR AUTOMÁTICO) ---
  const handleCheckout = async (paymentMethod: 'efectivo' | 'transferencia', tendered: number, change: number) => {
    if (cart.length === 0) return;
    setIsCheckout(true);
    setShowPaymentModal(false);

    try {
      // Usamos el ID de localStorage (Caché)
      const businessId = localStorage.getItem('nexus_business_id');
      
      if (!businessId) {
        alert("⚠️ Error: No se detecta el ID del negocio. Inicia sesión con internet al menos una vez.");
        setIsCheckout(false);
        return;
      }

      const saleId = crypto.randomUUID();
      
      const newSale: Sale = {
        id: saleId,
        business_id: businessId,
        total: totalAmount,
        date: new Date().toISOString(),
        items: cart.map(item => ({ 
            product_id: item.id, 
            name: item.name, 
            quantity: item.quantity, 
            price: item.price,
            unit: item.unit 
        })),
        customer_id: currentCustomer?.id,
        
        // ✅ AQUÍ LA CLAVE: Guardamos al empleado que desbloqueó con PIN
        staff_id: currentStaff.id,
        staff_name: currentStaff.name,
        
        payment_method: paymentMethod,
        amount_tendered: tendered,
        change: change,
        sync_status: 'pending' // Pendiente de subir
      };

      // Guardamos en Dexie (Instantáneo)
      await db.transaction('rw', db.products, db.sales, async () => {
        await db.sales.add(newSale);
        for (const item of cart) {
          const product = await db.products.get(item.id);
          if (product) {
            await db.products.update(item.id, { 
              stock: product.stock - item.quantity, 
              sync_status: 'pending_update' 
            });
          }
        }
      });

      // Limpieza UI
      setCart([]);
      setLastSale(newSale);
      setCurrentCustomer(null);
      
      // Intentar subir sin bloquear
      syncPush().catch(() => console.log("Guardado localmente.")); 

    } catch (error) {
      console.error(error);
      alert("Error al guardar venta");
    } finally {
      setIsCheckout(false);
    }
  };

  return (
    <div className="flex h-full flex-col md:flex-row h-[calc(100vh-2rem)] overflow-hidden">
      
      {/* IZQUIERDA: Catálogo */}
      <div className="w-full md:w-2/3 p-4 flex flex-col gap-4 bg-slate-50">
        <div className="flex justify-between items-center gap-4">
            <h1 className="text-2xl font-bold text-gray-800 hidden md:block whitespace-nowrap">🛒 Punto de Venta</h1>
            
            {/* --- INDICADOR DE EMPLEADO (SOLO LECTURA) --- */}
            {/* Ya no es un Select, es un aviso fijo de quién está operando */}
            <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2 shadow-sm flex-shrink-0">
               <Users size={18} className="text-indigo-600" />
               <div className="flex flex-col">
                 <span className="text-[10px] text-indigo-400 leading-none font-bold uppercase">Atendiendo</span>
                 <span className="text-sm font-bold text-indigo-700 leading-none">{currentStaff.name}</span>
               </div>
            </div>
            {/* --------------------------------------------- */}

            <input type="text" className="flex-1 min-w-0 p-3 border border-slate-300 rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="🔍 Buscar..." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {categories.map(cat => (
                <button key={cat} onClick={() => setSelectedCategory(cat)} className={`px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-all ${selectedCategory === cat ? 'bg-slate-800 text-white shadow-md' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'}`}>{cat}</button>
            ))}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 overflow-y-auto pb-24 content-start pr-1">
            {filteredProducts.map(p => (
                 <button key={p.id} onClick={() => addToCart(p)} className="group relative bg-white rounded-2xl p-4 shadow-sm hover:shadow-xl border border-slate-100 hover:border-indigo-100 transition-all duration-300 flex flex-col justify-between h-40 overflow-hidden text-left">
                 <div className="absolute inset-0 bg-gradient-to-br from-transparent to-indigo-50 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                 <div className="relative z-10">
                    <span className="inline-block px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-2 group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-colors">{p.category || 'General'}</span>
                    <h3 className="font-bold text-slate-700 leading-snug text-sm line-clamp-2 group-hover:text-indigo-900">{p.name}</h3>
                 </div>
                 <div className="relative z-10 flex justify-between items-end mt-2">
                    <div className="text-xs text-slate-400 font-medium flex flex-col">
                        <span>Stock:</span>
                        <span className={`${p.stock < 5 ? 'text-red-500' : 'text-slate-600'}`}>{p.stock} <span className="text-[10px] uppercase">{p.unit || 'un'}</span></span>
                    </div>
                    <div className="bg-slate-50 text-slate-900 font-bold px-3 py-1.5 rounded-lg text-sm shadow-sm group-hover:bg-indigo-600 group-hover:text-white group-hover:shadow-indigo-200 transition-all">${p.price}</div>
                 </div>
               </button>
            ))}
        </div>
      </div>

      {/* DERECHA: Carrito */}
      <div className="w-full md:w-1/3 bg-white border-l shadow-xl flex flex-col h-full z-10">
        <div className="p-4 bg-slate-50 border-b flex justify-between items-center">
             <h2 className="font-bold text-lg">Ticket Actual</h2>
             <span className="text-xs bg-white border px-2 py-1 rounded text-slate-500">{cart.length} productos</span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {cart.map(item => (
              <div key={item.id} className="flex justify-between items-center bg-white p-2 rounded-lg border border-slate-100 shadow-sm">
                <div className="flex-1">
                  <div className="font-medium text-sm">{item.name}</div>
                  <div className="text-xs text-gray-500">${item.price} x {item.unit || 'un'}</div>
                </div>
                
                <div className="flex items-center gap-1 bg-gray-50 rounded px-1 py-1 mx-2 border">
                  <button onClick={() => updateQuantity(item.id, item.quantity - 1)} className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-white rounded font-bold transition-all">-</button>
                  <div className="relative">
                    <input 
                        type="number" step="0.01" min="0"
                        className="w-14 text-center bg-transparent font-mono text-sm font-bold focus:outline-none p-0 appearance-none"
                        value={item.quantity}
                        onChange={(e) => updateQuantity(item.id, parseFloat(e.target.value) || 0)}
                        onFocus={(e) => e.target.select()}
                    />
                    <span className="absolute -top-2 -right-1 text-[8px] text-gray-400 font-bold uppercase pointer-events-none">{item.unit || 'un'}</span>
                  </div>
                  <button onClick={() => updateQuantity(item.id, item.quantity + 1)} className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-green-600 hover:bg-white rounded font-bold transition-all">+</button>
                </div>

                <div className="font-bold text-sm w-16 text-right">${(item.price * item.quantity).toFixed(2)}</div>
                <button onClick={() => removeFromCart(item.id)} className="text-slate-300 hover:text-red-500 px-2 transition-colors">×</button>
              </div>
            ))}
        </div>

        <div className="px-4 mt-2">
            <CustomerSelect 
              selectedCustomer={currentCustomer} 
              onSelect={setCurrentCustomer} 
            />
        </div>

        <div className="p-4 bg-slate-50 border-t space-y-3 pb-24 md:pb-4">
          
          <div className="grid grid-cols-2 gap-2">
             <button
               onClick={handleParkOrder}
               disabled={cart.length === 0}
               className="flex items-center justify-center gap-2 py-3 bg-orange-100 text-orange-700 font-bold rounded-xl hover:bg-orange-200 transition-colors disabled:opacity-50"
             >
               <PauseCircle size={20} />
               <span className="text-sm">En Espera</span>
             </button>

             <button
               onClick={() => setShowParkedModal(true)}
               className="relative flex items-center justify-center gap-2 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200 transition-colors"
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

          <div className="flex justify-between text-xl font-bold text-slate-800 pt-2">
            <span>Total</span>
            <span>${totalAmount.toFixed(2)}</span>
          </div>
          <button onClick={() => setShowPaymentModal(true)} disabled={cart.length === 0 || isCheckout} className="w-full bg-slate-900 hover:bg-black text-white font-bold py-3 rounded-xl shadow-lg transition-transform active:scale-95 disabled:bg-slate-300">
            {isCheckout ? 'Procesando...' : 'Cobrar Ticket'}
          </button>
        </div>
      </div>

      {showPaymentModal && <PaymentModal total={totalAmount} onCancel={() => setShowPaymentModal(false)} onConfirm={handleCheckout} />}
      {lastSale && <TicketModal sale={lastSale} onClose={() => setLastSale(null)} />}
      
      {showParkedModal && (
        <ParkedOrdersModal 
          onClose={() => setShowParkedModal(false)} 
          onRestore={handleRestoreOrder} 
        />
      )}
    </div>
  );
}