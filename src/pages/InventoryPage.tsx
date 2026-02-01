import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { db, type Product, type Staff, type InventoryMovement } from '../lib/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { 
    Plus, Search, Edit2, Trash2, Package, Loader2, History as HistoryIcon, 
    LayoutList, ClipboardEdit, AlertTriangle, ArrowRightLeft, X 
} from 'lucide-react';
import { syncPush, addToQueue } from '../lib/sync';
import { currency } from '../lib/currency';
import { toast } from 'sonner';
import { logAuditAction } from '../lib/audit';
import { InventoryHistory } from '../components/InventoryHistory';

export function InventoryPage() {
  const { currentStaff } = useOutletContext<{ currentStaff: Staff }>();
  const businessId = localStorage.getItem('nexus_business_id');

  const [activeTab, setActiveTab] = useState<'stock' | 'history'>('stock');
  const [searchTerm, setSearchTerm] = useState('');
  
  // MODALES
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isStockModalOpen, setIsStockModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // --- DATOS FORMULARIO PRODUCTO ---
  const [formData, setFormData] = useState({
    name: '', price: '', sku: '', cost: '',
    category: 'General', unit: 'un', expiration_date: ''
  });

  // --- DATOS AJUSTE STOCK ---
  const [stockAdjustment, setStockAdjustment] = useState({
      newStock: 0,
      reason: 'restock',
      notes: ''
  });

  // CARGA DE PRODUCTOS
  const products = useLiveQuery(async () => {
    if (!businessId) return [];
    return await db.products
      .where('business_id').equals(businessId)
      .filter(p => !p.deleted_at)
      .reverse()
      .sortBy('created_at');
  }, [businessId]) || [];

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.sku?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // --- LOGICA DE GUARDADO ---
  const handleSubmitProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) return;
    setIsLoading(true);

    try {
        if (formData.sku) {
            const duplicate = await db.products
                .where({ business_id: businessId, sku: formData.sku })
                .filter(p => !p.deleted_at && p.id !== editingProduct?.id)
                .first();
            
            if (duplicate) {
                toast.warning(`El SKU "${formData.sku}" ya existe.`);
                setIsLoading(false);
                return;
            }
        }

        const productData = {
            name: formData.name.trim(),
            price: parseFloat(formData.price) || 0,
            cost: parseFloat(formData.cost) || 0,
            sku: formData.sku.trim(),
            category: formData.category.trim() || 'General',
            unit: formData.unit,
            expiration_date: formData.expiration_date
        };

        if (editingProduct) {
            const updated = { ...editingProduct, ...productData, sync_status: 'pending_update' as const };
            await db.products.put(updated);
            await addToQueue('PRODUCT_SYNC', updated);
            await logAuditAction('UPDATE_PRODUCT', { name: updated.name }, currentStaff);
            toast.success('Información actualizada');
        } else {
            const newProduct: Product = {
                id: crypto.randomUUID(),
                business_id: businessId,
                ...productData,
                stock: 0,
                sync_status: 'pending_create',
                created_at: new Date().toISOString()
            };

            await db.products.add(newProduct);
            await addToQueue('PRODUCT_SYNC', newProduct);
            await logAuditAction('CREATE_PRODUCT', { name: newProduct.name }, currentStaff);
            
            toast.success('Producto creado (Stock en 0)');
        }

        setIsFormOpen(false);
        resetForm();
        syncPush().catch(console.error);

    } catch (error) {
        console.error(error);
        toast.error('Error al guardar');
    } finally {
        setIsLoading(false);
    }
  };

  const handleStockAdjustment = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!editingProduct || !businessId) return;
      setIsLoading(true);

      try {
          const currentStock = editingProduct.stock;
          const newStock = parseFloat(stockAdjustment.newStock.toString());
          const difference = newStock - currentStock;

          if (difference === 0) {
              toast.info("No hay cambios en el stock");
              setIsStockModalOpen(false);
              return;
          }

          await db.transaction('rw', [db.products, db.movements, db.action_queue, db.audit_logs], async () => {
              const updatedProduct = { 
                  ...editingProduct, 
                  stock: newStock, 
                  sync_status: 'pending_update' as const 
              };
              await db.products.put(updatedProduct);
              await addToQueue('PRODUCT_SYNC', updatedProduct);

              const movement: InventoryMovement = {
                  id: crypto.randomUUID(),
                  business_id: businessId,
                  product_id: editingProduct.id,
                  staff_id: currentStaff.id,
                  qty_change: difference,
                  reason: stockAdjustment.reason,
                  created_at: new Date().toISOString(),
                  sync_status: 'pending_create'
              };
              await db.movements.add(movement);
              await addToQueue('MOVEMENT', movement);

              await logAuditAction('UPDATE_STOCK', { 
                  product: editingProduct.name, 
                  old: currentStock, 
                  new: newStock,
                  reason: stockAdjustment.reason 
              }, currentStaff);
          });

          toast.success(`Stock actualizado: ${difference > 0 ? '+' : ''}${difference}`);
          setIsStockModalOpen(false);
          setEditingProduct(null);
          syncPush().catch(console.error);

      } catch (error) {
          console.error(error);
          toast.error("Error al ajustar stock");
      } finally {
          setIsLoading(false);
      }
  };

  const handleDelete = async (product: Product) => {
      if (!confirm(`¿Eliminar "${product.name}"?`)) return;
      try {
          const deleted = { ...product, deleted_at: new Date().toISOString(), sync_status: 'pending_update' as const };
          await db.products.put(deleted);
          await addToQueue('PRODUCT_SYNC', deleted);
          await logAuditAction('DELETE_PRODUCT', { name: product.name }, currentStaff);
          toast.success("Producto eliminado");
          syncPush().catch(console.error);
      } catch {
          toast.error("Error al eliminar");
      }
  };

  const openEdit = (p: Product) => {
      setEditingProduct(p);
      setFormData({
          name: p.name, price: p.price.toString(), cost: p.cost?.toString() || '',
          sku: p.sku || '', category: p.category || 'General', unit: p.unit || 'un',
          expiration_date: p.expiration_date || ''
      });
      setIsFormOpen(true);
  };

  const openStock = (p: Product) => {
      setEditingProduct(p);
      setStockAdjustment({ newStock: p.stock, reason: 'restock', notes: '' });
      setIsStockModalOpen(true);
  };

  const openHistory = (p: Product) => {
      setEditingProduct(p);
      setIsHistoryModalOpen(true);
  };

  const resetForm = () => {
      setEditingProduct(null);
      setFormData({ name: '', price: '', cost: '', sku: '', category: 'General', unit: 'un', expiration_date: '' });
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto pb-24 animate-in fade-in duration-300">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#0B3B68] flex items-center gap-2">
            <Package className="text-[#7AC142]"/> Inventario
          </h1>
          <p className="text-[#6B7280] text-sm">Control de existencias y precios</p>
        </div>

        <div className="flex bg-white p-1 rounded-xl border border-gray-200 shadow-sm">
            <button 
                onClick={() => setActiveTab('stock')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'stock' ? 'bg-[#0B3B68] text-white shadow-md' : 'text-[#6B7280] hover:bg-gray-50'}`}
            >
                <LayoutList size={16} /> Stock
            </button>
            <button 
                onClick={() => setActiveTab('history')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'history' ? 'bg-[#0B3B68] text-white shadow-md' : 'text-[#6B7280] hover:bg-gray-50'}`}
            >
                <HistoryIcon size={16} /> Global
            </button>
        </div>

        {activeTab === 'stock' && (
            <div className="flex gap-2 w-full md:w-auto">
                <div className="relative flex-1 md:w-64 group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280] w-4 h-4 group-focus-within:text-[#0B3B68]" />
                    <input 
                        type="text" 
                        placeholder="Buscar..." 
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#0B3B68] outline-none shadow-sm transition-all text-[#1F2937]"
                    />
                </div>
                <button 
                    onClick={() => { resetForm(); setIsFormOpen(true); }}
                    className="bg-[#7AC142] hover:bg-[#7AC142]/90 text-white px-4 py-2 rounded-xl flex items-center gap-2 font-bold text-sm transition-colors shadow-lg shadow-[#7AC142]/20"
                >
                    <Plus size={18}/> <span className="hidden sm:inline">Nuevo</span>
                </button>
            </div>
        )}
      </div>

      {activeTab === 'stock' ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            {filteredProducts.length === 0 ? (
                <div className="p-12 text-center text-[#6B7280]">
                    <Package className="w-12 h-12 opacity-20 mb-2 mx-auto"/>
                    <p>No se encontraron productos.</p>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="mobile-card-table w-full text-left border-collapse">
                        <thead className="bg-[#F3F4F6] text-[#6B7280] uppercase text-xs font-bold tracking-wider">
                            <tr>
                                <th className="p-4">Detalle Producto</th>
                                <th className="p-4">Precios</th>
                                <th className="p-4 text-center">Existencia</th>
                                <th className="p-4 text-right">Gestión</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filteredProducts.map(product => (
                                <tr key={product.id} className="hover:bg-gray-50 transition-colors group">
                                    <td className="p-4" data-label="Producto">
                                        <div className="text-right md:text-left">
                                            <div className="font-bold text-[#1F2937]">{product.name}</div>
                                            <div className="flex items-center justify-end md:justify-start gap-2 mt-1">
                                                <span className="text-[10px] font-mono bg-gray-100 px-1.5 rounded text-[#6B7280] border border-gray-200">{product.sku || 'SIN SKU'}</span>
                                                <span className="text-[10px] bg-[#0B3B68]/10 text-[#0B3B68] px-1.5 rounded font-bold uppercase">{product.category}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-4 text-sm" data-label="Precio">
                                        <div className="text-right md:text-left">
                                            <div className="font-bold text-[#7AC142]">{currency.format(product.price)}</div>
                                            {product.cost && <div className="text-xs text-[#6B7280]">Costo: {currency.format(product.cost)}</div>}
                                        </div>
                                    </td>
                                    <td className="p-4 text-center" data-label="Stock">
                                        <div className="flex flex-col items-end md:items-center w-full">
                                            <div className={`inline-flex flex-col items-center justify-center px-3 py-1 rounded-lg border ${
                                                product.stock <= 5 
                                                    ? 'bg-[#F59E0B]/10 border-[#F59E0B]/20 text-[#F59E0B]' 
                                                    : 'bg-[#7AC142]/10 border-[#7AC142]/20 text-[#7AC142]'
                                            }`}>
                                                <span className="text-lg font-black leading-none">{product.stock}</span>
                                                <span className="text-[9px] uppercase font-bold opacity-70">{product.unit}</span>
                                            </div>
                                            {product.stock <= 5 && (
                                                <div className="text-[9px] font-bold text-[#F59E0B] flex items-center justify-center gap-1 mt-1 animate-pulse">
                                                    <AlertTriangle size={10}/> BAJO STOCK
                                                </div>
                                            )}
                                        </div>
                                    </td>
                                    <td className="p-4 text-right" data-label="Acciones">
                                        <div className="flex justify-end gap-2 w-full">
                                            <button onClick={() => openStock(product)} className="p-2 text-[#0B3B68] bg-[#0B3B68]/10 hover:bg-[#0B3B68]/20 rounded-lg transition-colors" title="Ajustar Stock">
                                                <ClipboardEdit size={18}/>
                                            </button>
                                            <button onClick={() => openHistory(product)} className="p-2 text-[#6B7280] hover:text-[#1F2937] hover:bg-gray-100 rounded-lg transition-colors" title="Ver Movimientos">
                                                <HistoryIcon size={18}/>
                                            </button>
                                            <div className="w-px h-8 bg-gray-200 mx-1"></div>
                                            <button onClick={() => openEdit(product)} className="p-2 text-[#6B7280] hover:text-[#0B3B68] hover:bg-[#0B3B68]/5 rounded-lg" title="Editar Info">
                                                <Edit2 size={18}/>
                                            </button>
                                            <button onClick={() => handleDelete(product)} className="p-2 text-[#6B7280] hover:text-[#EF4444] hover:bg-[#EF4444]/10 rounded-lg" title="Eliminar">
                                                <Trash2 size={18}/>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
          </div>
      ) : (
          <InventoryHistory /> 
      )}

      {/* --- MODAL 1: FORMULARIO PRODUCTO --- */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-[#0B3B68]/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-[#F3F4F6]">
               <h3 className="font-bold text-lg text-[#0B3B68]">
                 {editingProduct ? 'Editar Detalles' : 'Nuevo Producto'}
               </h3>
               <button onClick={() => setIsFormOpen(false)}><X className="text-gray-400 hover:text-gray-600"/></button>
            </div>
            
            <form onSubmit={handleSubmitProduct} className="p-6 space-y-4">
               <div>
                 <label className="text-xs font-bold text-[#6B7280] uppercase">Nombre del Producto</label>
                 <input required type="text" className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] outline-none font-medium" 
                   value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}/>
               </div>
               
               <div className="grid grid-cols-2 gap-4">
                   <div>
                     <label className="text-xs font-bold text-[#6B7280] uppercase">Precio Venta</label>
                     <input required type="number" step="0.01" className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] outline-none font-bold text-[#7AC142]" 
                       value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})}/>
                   </div>
                   <div>
                     <label className="text-xs font-bold text-[#6B7280] uppercase">Costo (Opcional)</label>
                     <input type="number" step="0.01" className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] outline-none" 
                       value={formData.cost} onChange={e => setFormData({...formData, cost: e.target.value})}/>
                   </div>
               </div>

               <div className="grid grid-cols-2 gap-4">
                   <div>
                     <label className="text-xs font-bold text-[#6B7280] uppercase">Código / SKU</label>
                     <input type="text" className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] outline-none font-mono text-sm" 
                       value={formData.sku} onChange={e => setFormData({...formData, sku: e.target.value})}/>
                   </div>
                   <div>
                     <label className="text-xs font-bold text-[#6B7280] uppercase">Categoría</label>
                     <input type="text" list="categories" className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68] outline-none" 
                       value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}/>
                     <datalist id="categories">
                       <option value="General"/><option value="Bebidas"/><option value="Alimentos"/>
                     </datalist>
                   </div>
               </div>

                <div className="grid grid-cols-2 gap-4">
                   <div>
                     <label className="text-xs font-bold text-[#6B7280] uppercase">Unidad</label>
                     <select className="w-full p-3 border border-gray-200 rounded-xl bg-white focus:ring-2 focus:ring-[#0B3B68]" 
                       value={formData.unit} onChange={e => setFormData({...formData, unit: e.target.value})}>
                        <option value="un">Unidad</option><option value="kg">Kilos</option><option value="lt">Litros</option><option value="pq">Paquete</option>
                     </select>
                   </div>
                   <div>
                     <label className="text-xs font-bold text-[#6B7280] uppercase">Vencimiento</label>
                     <input type="date" className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0B3B68]" 
                       value={formData.expiration_date} onChange={e => setFormData({...formData, expiration_date: e.target.value})}/>
                   </div>
               </div>

               <div className="pt-4 flex gap-3">
                 <button type="button" onClick={() => setIsFormOpen(false)} className="flex-1 py-3 bg-white border border-[#0B3B68] text-[#0B3B68] font-bold rounded-xl hover:bg-[#0B3B68]/5">Cancelar</button>
                 <button type="submit" disabled={isLoading} className="flex-1 py-3 bg-[#7AC142] text-white font-bold rounded-xl hover:bg-[#7AC142]/90 flex justify-center items-center gap-2 shadow-lg shadow-[#7AC142]/20">
                   {isLoading ? <Loader2 className="animate-spin text-white"/> : 'Guardar Datos'}
                 </button>
               </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL 2: AJUSTE DE STOCK --- */}
      {isStockModalOpen && editingProduct && (
        <div className="fixed inset-0 bg-[#0B3B68]/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border-t-4 border-[#0B3B68]">
                <div className="p-6 bg-[#F3F4F6] border-b border-gray-100 text-center">
                    <h3 className="font-black text-[#1F2937] text-lg uppercase tracking-wide mb-1">Ajuste de Inventario</h3>
                    <p className="text-[#0B3B68] font-bold">{editingProduct.name}</p>
                </div>
                
                <form onSubmit={handleStockAdjustment} className="p-6 space-y-5">
                    
                    <div className="flex items-center justify-between bg-gray-100 p-3 rounded-xl border border-gray-200">
                        <div className="text-center flex-1">
                            <span className="block text-[10px] font-bold text-[#6B7280] uppercase">Actual</span>
                            <span className="text-xl font-bold text-[#1F2937]">{editingProduct.stock}</span>
                        </div>
                        <ArrowRightLeft className="text-[#6B7280]"/>
                        <div className="text-center flex-1">
                            <span className="block text-[10px] font-bold text-[#0B3B68] uppercase">Nuevo</span>
                            <input 
                                type="number" step="0.01" autoFocus required
                                className="w-20 text-center font-bold text-xl bg-transparent border-b-2 border-[#0B3B68] outline-none text-[#0B3B68]"
                                value={stockAdjustment.newStock}
                                onChange={e => setStockAdjustment({...stockAdjustment, newStock: parseFloat(e.target.value) || 0})}
                                onFocus={e => e.target.select()}
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-bold text-[#6B7280] uppercase">Motivo del Ajuste</label>
                        <div className="grid grid-cols-2 gap-2">
                            <button type="button" onClick={() => setStockAdjustment({...stockAdjustment, reason: 'restock'})} className={`p-2 text-xs font-bold rounded-lg border ${stockAdjustment.reason === 'restock' ? 'bg-[#0B3B68]/10 border-[#0B3B68] text-[#0B3B68]' : 'bg-white border-gray-200 text-[#6B7280]'}`}>Compra</button>
                            <button type="button" onClick={() => setStockAdjustment({...stockAdjustment, reason: 'damage'})} className={`p-2 text-xs font-bold rounded-lg border ${stockAdjustment.reason === 'damage' ? 'bg-[#EF4444]/10 border-[#EF4444] text-[#EF4444]' : 'bg-white border-gray-200 text-[#6B7280]'}`}>Merma/Daño</button>
                            <button type="button" onClick={() => setStockAdjustment({...stockAdjustment, reason: 'return'})} className={`p-2 text-xs font-bold rounded-lg border ${stockAdjustment.reason === 'return' ? 'bg-[#F59E0B]/10 border-[#F59E0B] text-[#F59E0B]' : 'bg-white border-gray-200 text-[#6B7280]'}`}>Devolución</button>
                            <button type="button" onClick={() => setStockAdjustment({...stockAdjustment, reason: 'correction'})} className={`p-2 text-xs font-bold rounded-lg border ${stockAdjustment.reason === 'correction' ? 'bg-gray-100 border-gray-500 text-[#1F2937]' : 'bg-white border-gray-200 text-[#6B7280]'}`}>Corrección</button>
                        </div>
                    </div>

                    <button type="submit" disabled={isLoading} className="w-full py-3 bg-[#0B3B68] hover:bg-[#0B3B68]/90 text-white font-bold rounded-xl shadow-lg transition-all flex justify-center items-center gap-2">
                        {isLoading ? <Loader2 className="animate-spin"/> : 'Confirmar Ajuste'}
                    </button>
                    <button type="button" onClick={() => setIsStockModalOpen(false)} className="w-full text-xs text-[#6B7280] hover:text-[#1F2937] font-bold">Cancelar</button>
                </form>
            </div>
        </div>
      )}

      {/* --- MODAL 3: HISTORIAL PRODUCTO --- */}
      {isHistoryModalOpen && editingProduct && (
          <div className="fixed inset-0 bg-[#0B3B68]/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in zoom-in duration-200">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl h-[80vh] flex flex-col">
                  <div className="p-4 border-b flex justify-between items-center bg-[#F3F4F6] rounded-t-2xl">
                      <div>
                        <h3 className="font-bold text-[#1F2937] flex items-center gap-2"><HistoryIcon size={18}/> Historial de Movimientos</h3>
                        <p className="text-xs text-[#0B3B68] font-bold uppercase">{editingProduct.name}</p>
                      </div>
                      <button onClick={() => setIsHistoryModalOpen(false)}><X className="text-[#6B7280] hover:text-[#1F2937]"/></button>
                  </div>
                  <div className="flex-1 overflow-hidden p-0 bg-gray-50">
                      <InventoryHistory productId={editingProduct.id} />
                  </div>
              </div>
          </div>
      )}

    </div>
  );
}