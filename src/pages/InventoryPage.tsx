import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Product } from '../lib/db'; // Importamos type Product correctamente
import { syncPull, syncPush } from '../lib/sync';
import { supabase } from '../lib/supabase';

export function InventoryPage() {
  // Filtramos para NO mostrar los que están marcados para borrar
  const productos = useLiveQuery(() => 
    db.products.where('sync_status').notEqual('pending_delete').toArray()
  );
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  // Estado para saber si estamos editando uno existente
  const [editingId, setEditingId] = useState<string | null>(null);

  // AQUI ESTA EL CAMBIO: Agregamos 'category' al estado inicial
  const [formData, setFormData] = useState({
    name: '',
    price: '',
    stock: '',
    sku: '',
    cost: '',
    expiration_date: '',
    category: '' ,
    unit: 'un'// <--- Nuevo campo
  });

  // Abrir formulario para crear (limpio)
  const openCreate = () => {
    setEditingId(null);
    setFormData({ 
      name: '', price: '', stock: '', sku: '', cost: '', expiration_date: '', 
      category: '', unit: 'un' // <--- Limpiamos categoría
    });
    setIsFormOpen(true);
  };

  // Abrir formulario para editar (con datos)
  const openEdit = (p: Product) => {
    setEditingId(p.id);
    setFormData({
      name: p.name,
      price: p.price.toString(),
      stock: p.stock.toString(),
      sku: p.sku,
      cost: p.cost?.toString() || '',
      expiration_date: p.expiration_date || '',
      category: p.category || 'General',
      unit: p.unit || 'un'// <--- Corgamos la categoría existente
    });
    setIsFormOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // Preparamos los datos comunes
      const productData = {
        name: formData.name,
        price: parseFloat(formData.price),
        stock: parseInt(formData.stock),
        sku: formData.sku || crypto.randomUUID().slice(0, 8),
        cost: formData.cost ? parseFloat(formData.cost) : 0,
        expiration_date: formData.expiration_date || undefined,
        category: formData.category || 'General',
        unit: formData.unit || 'un' 
      };

      if (editingId) {
        // --- MODO EDICIÓN ---
        const original = await db.products.get(editingId);
        if (!original) return;

        const newStatus = original.sync_status === 'pending_create' 
          ? 'pending_create' 
          : 'pending_update';

        await db.products.update(editingId, {
          ...productData,
          sync_status: newStatus
        });

      } else {
        // --- MODO CREACIÓN ---
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("Sin sesión");
        
        const { data: perfil } = await supabase
          .from('profiles').select('business_id').eq('id', session.user.id).single();

        if (!perfil) throw new Error("Sin negocio");

        await db.products.add({
          id: crypto.randomUUID(),
          business_id: perfil.business_id,
          ...productData,
          sync_status: 'pending_create'
        });
      }

      setIsFormOpen(false);
      setEditingId(null);
      syncPush(); // Intentar subir cambios

    } catch (error) {
      console.error(error);
      alert("Error al guardar");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (p: Product) => {
    if (!confirm(`¿Seguro que quieres eliminar "${p.name}"?`)) return;

    try {
      if (p.sync_status === 'pending_create') {
        await db.products.delete(p.id);
      } else {
        await db.products.update(p.id, { sync_status: 'pending_delete' });
      }
      syncPush();
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div className="p-6 pb-20">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-800">📦 Inventario</h1>
        <div className="flex gap-2">
           <button onClick={async () => { await syncPush(); await syncPull(); }} className="text-blue-600 hover:bg-blue-50 px-3 py-2 rounded font-medium text-sm">🔄 Sincronizar</button>
          <button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded shadow flex items-center gap-2">＋ Nuevo</button>
        </div>
      </div>

      {isFormOpen && (
        <div className="bg-white p-6 rounded-lg shadow-lg mb-6 border border-blue-100 animate-fade-in">
          <h3 className="font-bold text-lg mb-4 text-gray-700">{editingId ? '✏️ Editar' : '✨ Nuevo'}</h3>
          <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700">Nombre</label>
              <input required type="text" className="w-full mt-1 p-2 border rounded" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700">Categoría</label>
              <input list="categories-list" type="text" className="w-full mt-1 p-2 border rounded" placeholder="Ej: Bebidas..." value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})} />
              <datalist id="categories-list">
                <option value="General" /><option value="Bebidas" /><option value="Comida" /><option value="Postres" />
              </datalist>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700">Precio ($)</label>
                    <input required type="number" step="0.01" className="w-full mt-1 p-2 border rounded" value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})} />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 text-slate-500">Costo ($)</label>
                    <input type="number" step="0.01" className="w-full mt-1 p-2 border rounded bg-slate-50" value={formData.cost} onChange={e => setFormData({...formData, cost: e.target.value})} />
                </div>
            </div>

            {/* --- SECCIÓN NUEVA DE STOCK Y UNIDAD --- */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Stock</label>
                <input required type="number" step="0.001" className="w-full mt-1 p-2 border rounded" value={formData.stock} onChange={e => setFormData({...formData, stock: e.target.value})} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Unidad</label>
                <select className="w-full mt-1 p-2 border rounded bg-white" value={formData.unit} onChange={e => setFormData({...formData, unit: e.target.value})}>
                  <option value="un">Unidad (un)</option>
                  <option value="kg">Kilogramo (kg)</option>
                  <option value="lb">Libra (lb)</option>
                  <option value="lt">Litro (lt)</option>
                  <option value="mt">Metro (mt)</option>
                </select>
              </div>
            </div>
            {/* -------------------------------------- */}

            <div>
              <label className="block text-sm font-medium text-gray-700">SKU</label>
              <input type="text" className="w-full mt-1 p-2 border rounded" value={formData.sku} onChange={e => setFormData({...formData, sku: e.target.value})} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Vencimiento</label>
              <input type="date" className="w-full mt-1 p-2 border rounded" value={formData.expiration_date} onChange={e => setFormData({...formData, expiration_date: e.target.value})} />
            </div>

            <div className="md:col-span-2 mt-4 flex gap-2">
              <button disabled={isLoading} className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-2 rounded shadow">
                {isLoading ? 'Guardando...' : '💾 Guardar'}
              </button>
              <button type="button" onClick={() => setIsFormOpen(false)} className="px-4 py-2 bg-slate-200 rounded text-slate-700">Cancelar</button>
            </div>
          </form>
        </div>
      )}

      {/* Tabla */}
      <div className="bg-white rounded-lg shadow overflow-hidden overflow-x-auto">
        <table className="w-full text-left min-w-[600px]">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="p-4 font-semibold text-gray-600">Producto</th>
              <th className="p-4 font-semibold text-gray-600">Precio</th>
              <th className="p-4 font-semibold text-gray-600">Stock</th>
              <th className="p-4 font-semibold text-center">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {productos?.map(p => (
                <tr key={p.id} className="hover:bg-gray-50 group">
                    <td className="p-4">
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-gray-400">
                           <span className="bg-slate-100 px-1 rounded text-slate-500 mr-1">{p.category || 'General'}</span> 
                           {p.sku}
                        </div>
                    </td>
                    <td className="p-4 font-mono text-blue-600 font-bold">${p.price.toFixed(2)}</td>
                    <td className={`p-4 font-bold ${p.stock < 5 ? 'text-red-500' : 'text-green-600'}`}>
                        {p.stock} <span className="text-xs text-gray-400 font-normal uppercase">{p.unit || 'un'}</span>
                    </td>
                    <td className="p-4 text-center">
                        <div className="flex justify-center gap-2">
                            <button onClick={() => openEdit(p)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-full">✏️</button>
                            <button onClick={() => handleDelete(p)} className="p-2 text-red-500 hover:bg-red-50 rounded-full">🗑️</button>
                        </div>
                    </td>
                </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}