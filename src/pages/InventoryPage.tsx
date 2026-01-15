import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { db, type Product, type Staff, type InventoryMovement } from '../lib/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Search, Edit2, Trash2, Package, Loader2, History as HistoryIcon, LayoutList } from 'lucide-react';
// ✅ CORRECCIÓN: Importamos syncPush que faltaba
import { syncPush, addToQueue } from '../lib/sync';
import { currency } from '../lib/currency';
import { toast } from 'sonner';
import { logAuditAction } from '../lib/audit';
import { InventoryHistory } from '../components/InventoryHistory';

export function InventoryPage() {
  // 1. Obtener usuario y Negocio (Contexto y LocalStorage)
  const { currentStaff } = useOutletContext<{ currentStaff: Staff }>();
  const businessId = localStorage.getItem('nexus_business_id');

  const [activeTab, setActiveTab] = useState<'stock' | 'history'>('stock');

  // 2. Consulta de productos (BLINDADA por Negocio)
  const products = useLiveQuery(async () => {
    if (!businessId) return [];
    return await db.products
      .where('business_id').equals(businessId)
      .filter(p => !p.deleted_at)
      .toArray();
  }, [businessId]) || [];

  const [searchTerm, setSearchTerm] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    price: '',
    stock: '',
    sku: '',
    cost: '',
    category: 'General',
    unit: 'un',
    expiration_date: ''
  });

  const filteredProducts = products?.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.sku?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      if (!businessId) {
        throw new Error("No se identificó el negocio. Reinicia sesión.");
      }

      // VALIDACIÓN: SKU ÚNICO
      if (formData.sku && formData.sku.trim() !== '') {
        const duplicate = await db.products
          .where({ business_id: businessId, sku: formData.sku })
          .first();
        
        if (duplicate && duplicate.id !== editingId) {
          toast.error(`El SKU "${formData.sku}" ya existe en el producto "${duplicate.name}"`);
          setIsLoading(false);
          return;
        }
      }

      const productData: Partial<Product> = {
        name: formData.name,
        price: parseFloat(formData.price) || 0,
        stock: parseFloat(formData.stock) || 0,
        sku: formData.sku || crypto.randomUUID().slice(0, 8),
        cost: formData.cost ? parseFloat(formData.cost) : 0,
        category: formData.category || 'General',
        unit: formData.unit || 'un',
      };
      
      if(formData.expiration_date) {
        (productData as Product & { expiration_date?: string }).expiration_date = formData.expiration_date;
      }

      if (editingId) {
        // === MODO EDICIÓN ===
        const original = await db.products.get(editingId);
        if (!original) return;

        const finalBusinessId = original.business_id || businessId;
        const oldStock = original.stock;
        const newStock = productData.stock || 0;
        const difference = newStock - oldStock;

        // ✅ CORRECCIÓN CRÍTICA: Agregamos db.audit_logs a la transacción
        await db.transaction('rw', [db.products, db.movements, db.action_queue, db.audit_logs], async () => {
            // 1. Actualizar Producto
            const updatedProduct = {
              ...original,
              ...productData,
              business_id: finalBusinessId,
              sync_status: 'pending_update' as const
            };
            
            await db.products.update(editingId, updatedProduct);
            await addToQueue('PRODUCT_SYNC', updatedProduct);

            // 2. Registrar Movimiento (si cambió el stock)
            if (difference !== 0) {
                const movement: InventoryMovement = {
                    id: crypto.randomUUID(),
                    business_id: finalBusinessId,
                    product_id: editingId,
                    staff_id: currentStaff?.id || 'system',
                    qty_change: difference,
                    reason: 'correction', 
                    created_at: new Date().toISOString(),
                    sync_status: 'pending_create'
                };

                await db.movements.add(movement);
                await addToQueue('MOVEMENT', movement);

                // 3. Auditoría (Ahora sí funciona porque db.audit_logs está en la transacción)
                await logAuditAction('UPDATE_STOCK', {
                    product: productData.name,
                    diff: difference
                }, currentStaff);
            }
        });

        toast.success('Producto actualizado');

      } else {
        // === MODO CREACIÓN ===
        const newProductId = crypto.randomUUID();
        const initialStock = productData.stock || 0;

        // También agregamos db.audit_logs aquí por si acaso decidas auditar la creación en el futuro
        await db.transaction('rw', [db.products, db.movements, db.action_queue, db.audit_logs], async () => {
            const newProduct = {
                id: newProductId,
                business_id: businessId,
                name: productData.name!,
                price: productData.price!,
                stock: initialStock,
                sku: productData.sku,
                cost: productData.cost,
                category: productData.category,
                unit: productData.unit,
                sync_status: 'pending_create' as const,
                ...(formData.expiration_date ? { expiration_date: formData.expiration_date } : {})
            } as Product;

            await db.products.add(newProduct);
            await addToQueue('PRODUCT_SYNC', newProduct);

            if (initialStock !== 0) {
                const movement: InventoryMovement = {
                    id: crypto.randomUUID(),
                    business_id: businessId,
                    product_id: newProductId,
                    staff_id: currentStaff?.id || 'system',
                    qty_change: initialStock,
                    reason: 'initial',
                    created_at: new Date().toISOString(),
                    sync_status: 'pending_create'
                };

                await db.movements.add(movement);
                await addToQueue('MOVEMENT', movement);
            }
        });
        
        toast.success('Producto creado correctamente');
      }

      setIsFormOpen(false);
      resetForm();
      syncPush(); // ✅ Ahora sí existe esta función gracias a la corrección en sync.ts

    } catch (error: unknown) {
      console.error(error);
      const msg = error instanceof Error ? error.message : "Error desconocido";
      toast.error("Error: " + msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEdit = (product: Product) => {
    setEditingId(product.id);
    setFormData({
      name: product.name,
      price: product.price.toString(),
      stock: product.stock.toString(),
      sku: product.sku || '',
      cost: product.cost?.toString() || '',
      category: product.category || 'General',
      unit: product.unit || 'un',
      expiration_date: (product as Product & { expiration_date?: string }).expiration_date || ''
    });
    setIsFormOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Estás seguro de eliminar este producto?')) return;

    try {
      const product = await db.products.get(id);
      if (!product) return;

      const changes = {
        deleted_at: new Date().toISOString(),
        sync_status: 'pending_update' as const
      };

      await db.products.update(id, changes);
      await addToQueue('PRODUCT_SYNC', { ...product, ...changes });
      await logAuditAction('DELETE_PRODUCT', { productName: product.name, id: product.id }, currentStaff);

      toast.success('Producto eliminado');
    } catch (error) {
      console.error(error);
      toast.error('Error al eliminar');
    }
  };

  const resetForm = () => {
    setFormData({
      name: '', price: '', stock: '', sku: '', cost: '',
      category: 'General', unit: 'un', expiration_date: ''
    });
    setEditingId(null);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto pb-24">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Package className="text-indigo-600"/> Inventario
          </h1>
          <p className="text-slate-500 text-sm">Gestiona productos y rastrea movimientos</p>
        </div>

        <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button 
                onClick={() => setActiveTab('stock')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'stock' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
                <LayoutList size={16} /> Stock Actual
            </button>
            <button 
                onClick={() => setActiveTab('history')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'history' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
                <HistoryIcon size={16} /> Historial
            </button>
        </div>

        {activeTab === 'stock' && (
            <div className="flex gap-2 w-full md:w-auto">
            <div className="relative flex-1 md:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input 
                type="text" 
                placeholder="Buscar..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                />
            </div>
            <button 
                onClick={() => { resetForm(); setIsFormOpen(true); }}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 font-bold text-sm transition-colors shadow-sm"
            >
                <Plus size={18}/> <span className="hidden sm:inline">Nuevo</span>
            </button>
            </div>
        )}
      </div>

      {/* CONTENIDO PRINCIPAL */}
      {activeTab === 'stock' ? (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in duration-200">
            {!products ? (
            <div className="p-12 flex justify-center"><Loader2 className="animate-spin text-indigo-500"/></div>
            ) : filteredProducts?.length === 0 ? (
            <div className="p-12 text-center text-slate-400 flex flex-col items-center">
                <Package className="w-12 h-12 opacity-20 mb-2"/>
                <p>No se encontraron productos.</p>
            </div>
            ) : (
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                <thead className="bg-slate-50 text-slate-500 uppercase text-xs font-bold">
                    <tr>
                    <th className="p-4">Producto</th>
                    <th className="p-4">Categoría</th>
                    <th className="p-4 text-right">Precio</th>
                    <th className="p-4 text-center">Stock</th>
                    <th className="p-4 text-right">Acciones</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {filteredProducts?.map(product => (
                    <tr key={product.id} className="hover:bg-slate-50/80 transition-colors group">
                        <td className="p-4">
                        <div className="font-bold text-slate-800">{product.name}</div>
                        <div className="text-xs text-slate-400 font-mono">{product.sku}</div>
                        </td>
                        <td className="p-4 text-sm text-slate-600">
                        <span className="bg-slate-100 px-2 py-1 rounded text-xs font-bold text-slate-500 border border-slate-200">
                            {product.category}
                        </span>
                        </td>
                        <td className="p-4 text-right font-bold text-indigo-600">
                        {currency.format(product.price)}
                        </td>
                        <td className="p-4 text-center">
                        <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                            product.stock <= 5 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                        }`}>
                            {product.stock} {product.unit}
                        </span>
                        </td>
                        <td className="p-4 text-right">
                        <div className="flex justify-end gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => handleEdit(product)} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg">
                            <Edit2 size={16}/>
                            </button>
                            <button onClick={() => handleDelete(product.id)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                            <Trash2 size={16}/>
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
          <div className="animate-in fade-in duration-200">
              <InventoryHistory />
          </div>
      )}

      {/* MODAL FORMULARIO */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-slate-50 p-4 border-b border-slate-200 flex justify-between items-center">
               <h2 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                 {editingId ? <Edit2 size={18} className="text-indigo-600"/> : <Plus size={18} className="text-indigo-600"/>}
                 {editingId ? 'Editar Producto' : 'Nuevo Producto'}
               </h2>
               <button onClick={() => setIsFormOpen(false)} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
               <div className="sm:col-span-2">
                 <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nombre</label>
                 <input required type="text" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" 
                   value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}/>
               </div>
               <div>
                 <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Precio</label>
                 <input required type="number" step="0.01" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-bold text-indigo-600" 
                   value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})}/>
               </div>
               <div>
                 <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Costo</label>
                 <input type="number" step="0.01" className="w-full p-2 border border-slate-300 rounded-lg" 
                   value={formData.cost} onChange={e => setFormData({...formData, cost: e.target.value})}/>
               </div>
               <div>
                 <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Stock</label>
                 <input required type="number" step="0.01" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" 
                   value={formData.stock} onChange={e => setFormData({...formData, stock: e.target.value})}/>
               </div>
               <div>
                 <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Unidad</label>
                 <select className="w-full p-2 border border-slate-300 rounded-lg bg-white" 
                   value={formData.unit} onChange={e => setFormData({...formData, unit: e.target.value})}>
                    <option value="un">Unidad</option>
                    <option value="kg">Kilogramo</option>
                    <option value="lt">Litro</option>
                    <option value="m">Metro</option>
                    <option value="pq">Paquete</option>
                 </select>
               </div>
               <div>
                 <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Código</label>
                 <input type="text" className="w-full p-2 border border-slate-300 rounded-lg" 
                   value={formData.sku} onChange={e => setFormData({...formData, sku: e.target.value})}/>
               </div>
               <div>
                 <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Categoría</label>
                 <input type="text" list="categories" className="w-full p-2 border border-slate-300 rounded-lg" 
                   value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}/>
                 <datalist id="categories">
                   <option value="General"/><option value="Bebidas"/><option value="Alimentos"/><option value="Limpieza"/>
                 </datalist>
               </div>
               <div className="sm:col-span-2">
                 <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Vencimiento</label>
                 <input type="date" className="w-full p-2 border border-slate-300 rounded-lg" 
                   value={formData.expiration_date} onChange={e => setFormData({...formData, expiration_date: e.target.value})}/>
               </div>

               <div className="sm:col-span-2 pt-4 flex gap-3">
                 <button type="button" onClick={() => setIsFormOpen(false)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200">Cancelar</button>
                 <button type="submit" disabled={isLoading} className="flex-1 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 flex justify-center items-center gap-2">
                   {isLoading ? <Loader2 className="animate-spin"/> : 'Guardar'}
                 </button>
               </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}