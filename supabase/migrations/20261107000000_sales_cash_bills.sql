-- ────────────────────────────────────────────────────────────────────────────
-- Billetes con que pagó el cliente (sales.cash_bills)
-- ────────────────────────────────────────────────────────────────────────────
-- La app permite registrar, al cobrar en efectivo, con qué billetes paga el cliente
-- ({"1000": 2, "500": 1}) para saber cuántos billetes de cada tipo entraron en el turno
-- o en el día. Sin esta columna el dato se queda solo en el teléfono que cobró:
-- process_sale_transaction inserta columnas explícitas e ignora claves desconocidas.
--
-- Es seguro ejecutarla en cualquier momento: la app funciona igual antes y después.

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS cash_bills jsonb;

-- Misma función que en 20260722000000_offline_sync_hardening.sql + la columna nueva (paso 4).
CREATE OR REPLACE FUNCTION public.process_sale_transaction(p_sale jsonb, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  item             jsonb;
  v_product_id     uuid;
  v_qty            numeric;
  v_sale_id        uuid;
  v_business       uuid;
  v_existing_status text;
  v_avail          numeric;
  v_pname          text;
  v_conflict       boolean := false;
  v_conflicts      text[]  := '{}';
BEGIN
  -- 0. Validaciones del payload
  v_sale_id := NULLIF(p_sale->>'id', '')::uuid;
  IF v_sale_id IS NULL THEN
    RAISE EXCEPTION 'La venta no tiene un id válido (payload corrupto)';
  END IF;

  v_business := NULLIF(p_sale->>'business_id', '')::uuid;
  IF v_business IS NULL THEN
    RAISE EXCEPTION 'La venta no tiene business_id (payload corrupto)';
  END IF;

  -- 0b. Tenant: SECURITY DEFINER salta RLS, así que validamos aquí.
  IF v_business <> get_user_business_id() AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- 1. Idempotencia (ver migración anterior).
  SELECT status INTO v_existing_status
    FROM sales WHERE id = v_sale_id AND business_id = v_business;
  IF FOUND AND v_existing_status IS DISTINCT FROM 'stock_conflict' THEN
    RETURN jsonb_build_object('success', true, 'conflict', false,
                              'message', 'already_processed');
  END IF;

  -- 2. Verificar stock de TODOS los ítems antes de tocar nada
  FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (item->>'product_id')::uuid;
    v_qty        := COALESCE((item->>'quantity')::numeric, 1);

    IF v_product_id IS NOT NULL THEN
      SELECT stock, name INTO v_avail, v_pname
        FROM products WHERE id = v_product_id AND business_id = v_business;

      IF FOUND AND v_avail < v_qty THEN
        v_conflict  := true;
        v_conflicts := array_append(
          v_conflicts,
          v_pname || ' (stock: ' || v_avail || ', pedido: ' || v_qty || ')'
        );
      END IF;
    END IF;
  END LOOP;

  -- 3. REINTENTO de una venta que quedó en stock_conflict
  IF v_existing_status = 'stock_conflict' THEN
    IF v_conflict THEN
      RETURN jsonb_build_object('success', true, 'conflict', true,
                                'conflict_items', to_jsonb(v_conflicts));
    END IF;

    UPDATE sales SET status = 'completed'
     WHERE id = v_sale_id AND business_id = v_business AND status = 'stock_conflict';
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', true, 'conflict', false,
                                'message', 'already_processed');
    END IF;

    FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      v_product_id := (item->>'product_id')::uuid;
      v_qty        := COALESCE((item->>'quantity')::numeric, 1);
      IF v_product_id IS NOT NULL THEN
        UPDATE products SET stock = stock - v_qty
         WHERE id = v_product_id AND business_id = v_business;
      END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'conflict', false,
                              'conflict_items', '[]'::jsonb);
  END IF;

  -- 4. Venta NUEVA: insertar con TODAS las columnas (+ cash_bills)
  INSERT INTO sales (
    id, business_id, date, total, payment_method,
    amount_tendered, change, staff_id, staff_name, shift_id,
    status, created_at,
    customer_id, customer_name,
    discount_amount, discount_type, discount_input,
    cash_amount, transfer_amount, redeemed_points,
    items, cash_bills
  ) VALUES (
    v_sale_id,
    v_business,
    (p_sale->>'date')::timestamptz,
    (p_sale->>'total')::numeric,
    COALESCE(p_sale->>'payment_method', 'efectivo'),
    (p_sale->>'amount_tendered')::numeric,
    (p_sale->>'change')::numeric,
    NULLIF(p_sale->>'staff_id', '')::uuid,
    p_sale->>'staff_name',
    NULLIF(p_sale->>'shift_id', '')::uuid,
    CASE WHEN v_conflict THEN 'stock_conflict' ELSE 'completed' END,
    now(),
    NULLIF(p_sale->>'customer_id', '')::uuid,
    p_sale->>'customer_name',
    (p_sale->>'discount_amount')::numeric,
    NULLIF(p_sale->>'discount_type', ''),
    (p_sale->>'discount_input')::numeric,
    (p_sale->>'cash_amount')::numeric,
    (p_sale->>'transfer_amount')::numeric,
    (p_sale->>'redeemed_points')::integer,
    p_items,
    CASE WHEN jsonb_typeof(p_sale->'cash_bills') = 'object' THEN p_sale->'cash_bills' ELSE NULL END
  );

  -- 5. sale_items + descuento de stock SOLO si no hay conflicto
  FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (item->>'product_id')::uuid;
    v_qty        := COALESCE((item->>'quantity')::numeric, 1);

    INSERT INTO sale_items (
      id, sale_id, business_id, product_id, name,
      quantity, price, unit_cost, total
    ) VALUES (
      COALESCE(NULLIF(item->>'id','')::uuid, gen_random_uuid()),
      v_sale_id,
      v_business,
      v_product_id,
      item->>'name',
      v_qty,
      COALESCE((item->>'price')::numeric, 0),
      COALESCE((item->>'unit_cost')::numeric, (item->>'cost')::numeric, 0),
      COALESCE((item->>'total')::numeric, (item->>'price')::numeric * v_qty, 0)
    ) ON CONFLICT (id) DO NOTHING;

    IF NOT v_conflict AND v_product_id IS NOT NULL THEN
      UPDATE products SET stock = stock - v_qty
       WHERE id = v_product_id AND business_id = v_business;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success',        true,
    'conflict',       v_conflict,
    'conflict_items', to_jsonb(v_conflicts)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.process_sale_transaction TO authenticated;

-- Verificación:
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'sales' AND column_name = 'cash_bills';
