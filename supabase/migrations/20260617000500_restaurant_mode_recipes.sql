-- ============================================================================
-- Modo restaurante — Fase 5: inventario por recetas
-- ============================================================================
-- 1. Tabla recipe_ingredients (lista de materiales plato→ingrediente) + RLS.
-- 2. Columnas is_ingredient / tracks_recipe en products.
-- 3. close_comanda v3: al cerrar, descuenta INGREDIENTES para los platos con
--    receta y el propio stock para los que no la tienen (cantidades fraccionales).
-- Aplicar con confirmación al proyecto REAL de nexus-pos (NO a TriciGo).
-- ============================================================================

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_ingredient boolean DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS tracks_recipe boolean DEFAULT false;

CREATE TABLE IF NOT EXISTS public.recipe_ingredients (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL,
  dish_product_id uuid NOT NULL,
  ingredient_product_id uuid NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  unit text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_dish ON public.recipe_ingredients(business_id, dish_product_id);

DROP TRIGGER IF EXISTS trg_recipe_ingredients_updated ON public.recipe_ingredients;
CREATE TRIGGER trg_recipe_ingredients_updated BEFORE UPDATE ON public.recipe_ingredients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.recipe_ingredients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recipe_ingredients_tenant ON public.recipe_ingredients;
CREATE POLICY recipe_ingredients_tenant ON public.recipe_ingredients FOR ALL TO authenticated
  USING (business_id = get_user_business_id() OR is_super_admin())
  WITH CHECK (business_id = get_user_business_id() OR is_super_admin());

-- --------------------------------------------------------------------------
-- close_comanda v3 — descuento por receta (o stock propio si no hay receta)
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_comanda(
  p_comanda_id uuid,
  p_sales jsonb,
  p_business_id uuid,
  p_idempotency_key uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_existing jsonb;
  v_conflicts text[];
  v_sale jsonb;
BEGIN
  IF p_business_id <> get_user_business_id() AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT result INTO v_existing FROM processed_mutations WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN RETURN v_existing; END IF;

  -- Necesidades de stock: ingredientes para platos con receta, stock propio si no.
  CREATE TEMP TABLE _needs ON COMMIT DROP AS
  WITH live AS (
    SELECT product_id, SUM(quantity) AS qty
    FROM comanda_items
    WHERE comanda_id = p_comanda_id AND business_id = p_business_id AND COALESCE(voided, false) = false
    GROUP BY product_id
  ),
  expanded AS (
    SELECT r.ingredient_product_id AS product_id, SUM(r.quantity * l.qty) AS qty
    FROM live l
    JOIN recipe_ingredients r
      ON r.dish_product_id = l.product_id AND r.business_id = p_business_id AND r.deleted_at IS NULL
    GROUP BY r.ingredient_product_id
    UNION ALL
    SELECT l.product_id, l.qty
    FROM live l
    WHERE NOT EXISTS (
      SELECT 1 FROM recipe_ingredients r
      WHERE r.dish_product_id = l.product_id AND r.business_id = p_business_id AND r.deleted_at IS NULL
    )
  )
  SELECT product_id, SUM(qty) AS qty FROM expanded GROUP BY product_id;

  -- Conflictos: stock insuficiente
  SELECT array_agg(p.name) INTO v_conflicts
  FROM _needs n JOIN products p ON p.id = n.product_id
  WHERE p.stock < n.qty;

  IF v_conflicts IS NOT NULL AND array_length(v_conflicts, 1) > 0 THEN
    RETURN jsonb_build_object('conflict', true, 'conflict_items', to_jsonb(v_conflicts));
  END IF;

  -- Descontar stock
  UPDATE products p
  SET stock = p.stock - n.qty, updated_at = now()
  FROM _needs n
  WHERE p.id = n.product_id AND p.business_id = p_business_id;

  -- Insertar la(s) venta(s) como registros financieros (idempotente por id)
  FOR v_sale IN SELECT * FROM jsonb_array_elements(p_sales)
  LOOP
    INSERT INTO sales (
      id, business_id, date, shift_id, total, items, staff_id, staff_name,
      customer_id, customer_name, payment_method, amount_tendered, change, status,
      discount_amount, discount_type, cash_amount, transfer_amount, redeemed_points,
      comanda_id, tip_amount, tip_staff_id, split_group_id, split_index
    ) VALUES (
      (v_sale->>'id')::uuid, p_business_id, COALESCE((v_sale->>'date')::timestamptz, now()),
      NULLIF(v_sale->>'shift_id', '')::uuid, COALESCE((v_sale->>'total')::numeric, 0),
      COALESCE(v_sale->'items', '[]'::jsonb),
      NULLIF(v_sale->>'staff_id', '')::uuid, v_sale->>'staff_name',
      NULLIF(v_sale->>'customer_id', '')::uuid, v_sale->>'customer_name',
      v_sale->>'payment_method', NULLIF(v_sale->>'amount_tendered', '')::numeric,
      NULLIF(v_sale->>'change', '')::numeric, COALESCE(v_sale->>'status', 'completed'),
      NULLIF(v_sale->>'discount_amount', '')::numeric, v_sale->>'discount_type',
      NULLIF(v_sale->>'cash_amount', '')::numeric, NULLIF(v_sale->>'transfer_amount', '')::numeric,
      NULLIF(v_sale->>'redeemed_points', '')::integer,
      p_comanda_id, NULLIF(v_sale->>'tip_amount', '')::numeric, NULLIF(v_sale->>'tip_staff_id', '')::uuid,
      NULLIF(v_sale->>'split_group_id', '')::uuid, NULLIF(v_sale->>'split_index', '')::integer
    )
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  UPDATE comandas SET status = 'closed', closed_at = now()
  WHERE id = p_comanda_id AND business_id = p_business_id;

  INSERT INTO processed_mutations (idempotency_key, operation, business_id, result)
  VALUES (p_idempotency_key, 'close_comanda', p_business_id, jsonb_build_object('ok', true))
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN jsonb_build_object('ok', true);
END; $$;

GRANT EXECUTE ON FUNCTION public.close_comanda TO authenticated;
