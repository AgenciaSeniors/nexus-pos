import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type RecipeIngredient, type Product } from '../lib/db';
import { addToQueue, syncPush } from '../lib/sync';
import { Plus, Trash2, Carrot, ChefHat, PackageSearch } from 'lucide-react';
import { toast } from 'sonner';
import { SectionCard, Input, Select, Button, EmptyState, SkeletonList, ConfirmDialog } from './ui';
import { cn } from './ui';

/**
 * Administración de recetas (Fase 5): marca productos como ingredientes y define
 * la lista de materiales de cada plato. Encola RECIPE_SYNC y PRODUCT_SYNC.
 */
export function RecipeAdmin() {
  const businessId = localStorage.getItem('nexus_business_id') || '';
  const [dishId, setDishId] = useState('');
  const [ingId, setIngId] = useState('');
  const [qty, setQty] = useState('');
  const [confirm, setConfirm] = useState<RecipeIngredient | null>(null);

  const products = useLiveQuery(async () => {
    if (!businessId) return [];
    const rows = await db.products.where('business_id').equals(businessId).toArray();
    return rows.filter(p => !p.deleted_at).sort((a, b) => a.name.localeCompare(b.name));
  }, [businessId]);

  const recipes = useLiveQuery(async () => {
    if (!businessId) return [];
    return (await db.recipe_ingredients.where('business_id').equals(businessId).toArray()).filter(r => !r.deleted_at);
  }, [businessId]);

  const loading = products === undefined || recipes === undefined;
  const productList = products ?? [];
  const recipeList = recipes ?? [];

  const ingredients = productList.filter(p => p.is_ingredient);
  const dishes = productList.filter(p => !p.is_ingredient);
  const nameById = (id: string) => productList.find(p => p.id === id)?.name || '—';

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
    const ingProduct = productList.find(p => p.id === ingId);
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

  const confirmDelete = async () => {
    if (!confirm) return;
    await removeRecipe(confirm);
    setConfirm(null);
  };

  const dishRecipe = recipeList.filter(r => r.dish_product_id === dishId);

  return (
    <div className="space-y-6">
      {/* Marcar ingredientes */}
      <SectionCard title="Ingredientes" icon={<Carrot size={18} className="text-[#5a9d2e]" />} accent="green"
        subtitle="Marca los productos que son insumos: no se venden en el menú; se descuentan por receta.">
        {loading ? (
          <SkeletonList rows={2} rowClassName="h-9 w-32" className="flex flex-wrap gap-2 space-y-0" />
        ) : productList.length === 0 ? (
          <EmptyState size="sm" icon={<PackageSearch size={22} />} title="No hay productos"
            description="Crea productos en Inventario para marcarlos como ingredientes." />
        ) : (
          <div className="flex flex-wrap gap-2 max-h-52 overflow-y-auto">
            {productList.map(p => (
              <label key={p.id}
                className={cn(
                  'inline-flex items-center gap-2 px-3 py-2 rounded-xl border-2 cursor-pointer text-sm font-bold transition-colors',
                  p.is_ingredient ? 'border-[#7AC142] bg-[#7AC142]/5 text-[#0B3B68]' : 'border-gray-200 text-[#6B7280] hover:border-gray-300',
                )}>
                <input type="checkbox" checked={!!p.is_ingredient} onChange={e => toggleIngredient(p, e.target.checked)}
                  className="accent-[#7AC142]" />
                {p.name}
              </label>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Recetas por plato */}
      <SectionCard title="Receta de un plato" icon={<ChefHat size={18} className="text-[#0B3B68]" />}
        subtitle="Elige un plato y define qué ingredientes consume cada unidad.">
        <Select value={dishId} onChange={e => setDishId(e.target.value)} aria-label="Plato" className="mb-4"
          disabled={loading || dishes.length === 0}>
          <option value="">{dishes.length === 0 ? 'No hay platos' : 'Elige un plato…'}</option>
          {dishes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>

        {dishId && (
          <>
            {dishRecipe.length === 0 ? (
              <EmptyState size="sm" icon={<ChefHat size={22} />} title="Sin ingredientes"
                description="Este plato aún no tiene receta. Agrégale ingredientes abajo." />
            ) : (
              <div className="space-y-2 mb-4">
                {dishRecipe.map(r => (
                  <div key={r.id} className="flex items-center gap-2 p-3 rounded-xl bg-gray-50 border border-gray-100">
                    <span className="flex-1 text-sm font-bold text-[#1F2937] truncate">{nameById(r.ingredient_product_id)}</span>
                    <span className="text-sm text-[#6B7280] shrink-0">{r.quantity}{r.unit ? ` ${r.unit}` : ''}</span>
                    <button onClick={() => setConfirm(r)} aria-label={`Quitar ${nameById(r.ingredient_product_id)} de la receta`}
                      className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors shrink-0">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2">
              <Select value={ingId} onChange={e => setIngId(e.target.value)} aria-label="Ingrediente" className="flex-1"
                disabled={ingredients.length === 0}>
                <option value="">Ingrediente…</option>
                {ingredients.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
              <Input value={qty} onChange={e => setQty(e.target.value)} inputMode="decimal" placeholder="Cantidad"
                aria-label="Cantidad" className="sm:w-32" />
              <Button onClick={addIngredient} icon={<Plus size={18} />} disabled={!ingId || !qty.trim()}>Añadir</Button>
            </div>
            {ingredients.length === 0 && (
              <p className="text-xs text-amber-600 mt-2">Primero marca algún producto como ingrediente arriba.</p>
            )}
          </>
        )}
      </SectionCard>

      {confirm && (
        <ConfirmDialog
          title="Quitar ingrediente"
          confirmLabel="Quitar"
          message={<>¿Quitar <span className="font-bold text-[#1F2937]">{nameById(confirm.ingredient_product_id)}</span> de esta receta?</>}
          onConfirm={confirmDelete}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
