import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type RecipeIngredient, type Product } from '../lib/db';
import { addToQueue, syncPush } from '../lib/sync';
import { Plus, Trash2, Carrot, ChefHat } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Administración de recetas (Fase 5): marca productos como ingredientes y define
 * la lista de materiales de cada plato. Encola RECIPE_SYNC y PRODUCT_SYNC.
 */
export function RecipeAdmin() {
  const businessId = localStorage.getItem('nexus_business_id') || '';
  const [dishId, setDishId] = useState('');
  const [ingId, setIngId] = useState('');
  const [qty, setQty] = useState('');

  const products = useLiveQuery(async () => {
    if (!businessId) return [];
    const rows = await db.products.where('business_id').equals(businessId).toArray();
    return rows.filter(p => !p.deleted_at).sort((a, b) => a.name.localeCompare(b.name));
  }, [businessId]) || [];

  const recipes = useLiveQuery(async () => {
    if (!businessId) return [];
    return (await db.recipe_ingredients.where('business_id').equals(businessId).toArray()).filter(r => !r.deleted_at);
  }, [businessId]) || [];

  const ingredients = products.filter(p => p.is_ingredient);
  const dishes = products.filter(p => !p.is_ingredient);
  const nameById = (id: string) => products.find(p => p.id === id)?.name || '—';

  const toggleIngredient = async (product: Product, checked: boolean) => {
    const updated: Product = { ...product, is_ingredient: checked, sync_status: 'pending_update' };
    await db.transaction('rw', [db.products, db.action_queue], async () => {
      await db.products.update(product.id, { is_ingredient: checked, sync_status: 'pending_update' });
      await addToQueue('PRODUCT_SYNC', updated);
    });
    syncPush().catch(() => {});
  };

  const addIngredient = async () => {
    if (!dishId) return toast.error('Elige un plato');
    if (!ingId) return toast.error('Elige un ingrediente');
    const q = parseFloat(qty);
    if (!q || q <= 0) return toast.error('Cantidad inválida');
    const ingProduct = products.find(p => p.id === ingId);
    const row: RecipeIngredient = {
      id: crypto.randomUUID(), business_id: businessId,
      dish_product_id: dishId, ingredient_product_id: ingId,
      quantity: q, unit: ingProduct?.unit, sync_status: 'pending_create',
    };
    await db.transaction('rw', [db.recipe_ingredients, db.products, db.action_queue], async () => {
      await db.recipe_ingredients.add(row);
      await addToQueue('RECIPE_SYNC', row);
      // Marcar el plato como tracks_recipe (informativo)
      const dish = await db.products.get(dishId);
      if (dish && !dish.tracks_recipe) {
        const updated: Product = { ...dish, tracks_recipe: true, sync_status: 'pending_update' };
        await db.products.update(dishId, { tracks_recipe: true, sync_status: 'pending_update' });
        await addToQueue('PRODUCT_SYNC', updated);
      }
    });
    setIngId(''); setQty('');
    syncPush().catch(() => {});
  };

  const removeRecipe = async (row: RecipeIngredient) => {
    const updated: RecipeIngredient = { ...row, deleted_at: new Date().toISOString(), sync_status: 'pending_update' };
    await db.transaction('rw', [db.recipe_ingredients, db.action_queue], async () => {
      await db.recipe_ingredients.update(row.id, { deleted_at: updated.deleted_at, sync_status: 'pending_update' });
      await addToQueue('RECIPE_SYNC', updated);
    });
    syncPush().catch(() => {});
  };

  const dishRecipe = recipes.filter(r => r.dish_product_id === dishId);

  return (
    <div className="space-y-8">
      {/* Marcar ingredientes */}
      <div>
        <h3 className="font-black text-[#1F2937] flex items-center gap-2 mb-1"><Carrot size={18} className="text-[#7AC142]" /> Ingredientes</h3>
        <p className="text-xs text-[#6B7280] mb-3">Marca los productos que son insumos (no se venden en el menú; se descuentan por receta).</p>
        <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto">
          {products.map(p => (
            <label key={p.id} className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border-2 cursor-pointer text-sm font-bold ${p.is_ingredient ? 'border-[#7AC142] bg-[#7AC142]/5 text-[#0B3B68]' : 'border-gray-200 text-[#6B7280]'}`}>
              <input type="checkbox" checked={!!p.is_ingredient} onChange={e => toggleIngredient(p, e.target.checked)} />
              {p.name}
            </label>
          ))}
          {products.length === 0 && <p className="text-sm text-[#9CA3AF]">No hay productos.</p>}
        </div>
      </div>

      {/* Recetas por plato */}
      <div>
        <h3 className="font-black text-[#1F2937] flex items-center gap-2 mb-3"><ChefHat size={18} className="text-[#0B3B68]" /> Receta de un plato</h3>
        <select value={dishId} onChange={e => setDishId(e.target.value)}
          className="w-full p-3 border border-gray-200 rounded-xl bg-white focus:ring-2 focus:ring-[#0B3B68] outline-none mb-3">
          <option value="">Elige un plato…</option>
          {dishes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        {dishId && (
          <>
            <div className="space-y-2 mb-3">
              {dishRecipe.map(r => (
                <div key={r.id} className="flex items-center gap-2 p-2 rounded-xl bg-gray-50">
                  <span className="flex-1 text-sm font-bold text-[#1F2937]">{nameById(r.ingredient_product_id)}</span>
                  <span className="text-sm text-[#6B7280]">{r.quantity}{r.unit ? ` ${r.unit}` : ''}</span>
                  <button onClick={() => removeRecipe(r)} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50"><Trash2 size={14} /></button>
                </div>
              ))}
              {dishRecipe.length === 0 && <p className="text-sm text-[#9CA3AF]">Este plato aún no tiene ingredientes.</p>}
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <select value={ingId} onChange={e => setIngId(e.target.value)}
                className="flex-1 p-3 border border-gray-200 rounded-xl bg-white outline-none focus:ring-2 focus:ring-[#0B3B68]">
                <option value="">Ingrediente…</option>
                {ingredients.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input value={qty} onChange={e => setQty(e.target.value)} inputMode="decimal" placeholder="Cantidad"
                className="w-32 p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#0B3B68]" />
              <button onClick={addIngredient} className="bg-[#0B3B68] text-white px-4 py-3 rounded-xl font-bold flex items-center justify-center gap-1"><Plus size={18} /> Añadir</button>
            </div>
            {ingredients.length === 0 && <p className="text-xs text-amber-600 mt-2">Primero marca algún producto como ingrediente arriba.</p>}
          </>
        )}
      </div>
    </div>
  );
}
