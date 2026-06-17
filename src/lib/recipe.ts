import type { RecipeIngredient } from './db';

/** Redondeo a 3 decimales para stock fraccional (ej. 0.15 kg) sin deriva de float. */
export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Calcula cuánto stock descontar por producto al cerrar una comanda/venta.
 * - Si el producto vendido TIENE receta → descuenta sus ingredientes
 *   (cantidad de receta × cantidad vendida).
 * - Si NO tiene receta → descuenta su propio stock (comportamiento clásico).
 */
export function computeStockDeductions(
  soldItems: { product_id: string; quantity: number }[],
  recipesByDish: Map<string, RecipeIngredient[]>,
): Map<string, number> {
  const out = new Map<string, number>();
  const add = (pid: string, qty: number) => out.set(pid, round3((out.get(pid) ?? 0) + qty));
  for (const it of soldItems) {
    const recipe = recipesByDish.get(it.product_id);
    if (recipe && recipe.length > 0) {
      for (const ing of recipe) add(ing.ingredient_product_id, ing.quantity * it.quantity);
    } else {
      add(it.product_id, it.quantity);
    }
  }
  return out;
}

/** Nombres de productos cuyo stock quedaría negativo dadas las deducciones. */
export function findStockConflicts(
  deductions: Map<string, number>,
  productById: Map<string, { id: string; name: string; stock: number }>,
): string[] {
  const names: string[] = [];
  for (const [pid, qty] of deductions) {
    const p = productById.get(pid);
    if (p && p.stock < qty) names.push(p.name);
  }
  return names;
}
