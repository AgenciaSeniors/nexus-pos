-- ============================================================================
-- Desactivar `on_inventory_movement`: duplicaba el stock en el servidor
-- ============================================================================
-- SÍNTOMA MEDIDO (cuenta real, 15-sep-2026):
--   Ajuste de un producto a 20 en vitrina → Supabase quedó en 28 (= 20 + 8,
--   el qty_change del movimiento). Repetido dos veces con el mismo patrón.
--   Peor: ese valor inflado baja en el siguiente pull y SOBRESCRIBE el stock
--   correcto del dispositivo, así que la corrupción vuelve al POS.
--
-- CAUSA: el cliente es la autoridad del stock y sube el valor ABSOLUTO por
-- PRODUCT_SYNC (cada sitio que inserta un movimiento actualiza además el
-- producto: InventoryPage, FinancePage anulación/devolución, ComandaPage).
-- Las RPC de restaurante (close_comanda, process_sale_transaction) también
-- descuentan ellas mismas. El trigger `on_inventory_movement` vuelve a aplicar
-- el `qty_change` encima de todo eso, así que TODA baja o alta se cuenta dos
-- veces en la nube.
--
-- Ningún SQL de este repositorio inserta en inventory_movements: los
-- movimientos vienen siempre del cliente, emparejados con su PRODUCT_SYNC.
--
-- POR QUÉ DISABLE Y NO DROP: es reversible en un segundo y conserva la
-- función por si resultara que hace algo más que sumar stock. Si tras unos
-- días el inventario cuadra, se puede borrar de verdad (ver el final).
-- ============================================================================

ALTER TABLE public.inventory_movements DISABLE TRIGGER on_inventory_movement;

-- --------------------------------------------------------------------------
-- COMPROBACIÓN — debe devolver tgenabled = 'D' (disabled)
-- --------------------------------------------------------------------------
SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgrelid = 'public.inventory_movements'::regclass
  AND tgname = 'on_inventory_movement';

-- --------------------------------------------------------------------------
-- REVERTIR (si algo saliera mal):
--   ALTER TABLE public.inventory_movements ENABLE TRIGGER on_inventory_movement;
--
-- BORRAR DEFINITIVAMENTE (solo cuando el inventario lleve días cuadrando):
--   DROP TRIGGER on_inventory_movement ON public.inventory_movements;
--   DROP FUNCTION IF EXISTS public.handle_inventory_movement();
-- --------------------------------------------------------------------------
