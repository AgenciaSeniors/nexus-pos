-- ============================================================================
-- Modo restaurante — Fase 4: dividir cuenta + propinas
-- ============================================================================
-- 1. Columnas nuevas en sales: comanda_id, tip_amount, tip_staff_id,
--    split_group_id, split_index. La propina se guarda aparte (NO suma a total
--    ni entra a la caja).
-- 2. close_comanda v2: descuenta stock UNA sola vez desde comanda_items
--    (independiente del split) e inserta la(s) venta(s) como registros
--    financieros. Idempotente por p_idempotency_key.
--
-- ⚠️ VERIFICAR los nombres de columna de `sales` contra el esquema real antes de
--    aplicar (la tabla la crea/usa process_sale_transaction en el proyecto real).
-- Aplicar con confirmación al proyecto REAL de nexus-pos (NO a TriciGo).
-- ============================================================================

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS comanda_id uuid;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS tip_amount numeric;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS tip_staff_id uuid;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS split_group_id uuid;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS split_index integer;

CREATE INDEX IF NOT EXISTS idx_sales_split_group ON public.sales(split_group_id);
CREATE INDEX IF NOT EXISTS idx_sales_comanda ON public.sales(comanda_id);

-- --------------------------------------------------------------------------
-- close_comanda v2
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

  -- Conflicto de stock: agregado por producto sobre los ítems vivos de la comanda.
  SELECT array_agg(p.name) INTO v_conflicts
  FROM (
    SELECT product_id, SUM(quantity) AS qty
    FROM comanda_items
    WHERE comanda_id = p_comanda_id AND business_id = p_business_id AND COALESCE(voided, false) = false
    GROUP BY product_id
  ) n
  JOIN products p ON p.id = n.product_id
  WHERE p.stock < n.qty;

  IF v_conflicts IS NOT NULL AND array_length(v_conflicts, 1) > 0 THEN
    RETURN jsonb_build_object('conflict', true, 'conflict_items', to_jsonb(v_conflicts));
  END IF;

  -- Descontar stock UNA vez (agregado por producto), independiente del split.
  UPDATE products p
  SET stock = p.stock - n.qty, updated_at = now()
  FROM (
    SELECT product_id, SUM(quantity) AS qty
    FROM comanda_items
    WHERE comanda_id = p_comanda_id AND business_id = p_business_id AND COALESCE(voided, false) = false
    GROUP BY product_id
  ) n
  WHERE p.id = n.product_id AND p.business_id = p_business_id;

  -- Insertar la(s) venta(s) como registros financieros (idempotente por id).
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
