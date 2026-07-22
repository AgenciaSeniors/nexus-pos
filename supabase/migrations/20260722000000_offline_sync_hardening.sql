-- ============================================================================
-- Endurecimiento de la sincronización offline — 2026-07-22
-- ============================================================================
-- Corrige los hallazgos críticos y medios de la auditoría de offline/sync:
--
--   1. process_sale_transaction:
--      a) CRÍTICO: una venta en stock_conflict jamás descontaba stock al
--         reintentarse (el guard de idempotencia cortaba antes del descuento).
--         Ahora el reintento re-verifica stock y, si alcanza, descuenta y
--         completa la venta de forma atómica.
--      b) CRÍTICO: era SECURITY DEFINER sin validación de tenant — cualquier
--         usuario autenticado podía escribir en el business_id de otro negocio.
--      c) MEDIO: el bloque EXCEPTION WHEN OTHERS enmascaraba el SQLSTATE real
--         (un 23505 llegaba como P0001 y el cliente no reconocía el duplicado).
--   2. add_loyalty_points: validación de tenant + reclamo ATÓMICO del
--      idempotency_key (antes SELECT+UPDATE permitían doble aplicación del
--      delta con llamadas concurrentes).
--   3. updated_at server-side: las tablas retail no tenían trigger — el pull
--      incremental y la resolución de conflictos dependían del reloj del
--      cliente (actualizaciones perdidas con relojes desfasados). Ahora TODAS
--      las tablas sincronizadas fuerzan updated_at = now() en INSERT y UPDATE.
--   4. set_kitchen_status: implementa de verdad el guard de escrituras viejas
--      que el cliente asume (columna kitchen_updated_at, solo KDS-vs-KDS para
--      no mezclar reloj de mesero y de cocina).
--   5. close_comanda: guard por estado de la comanda — un reintento con
--      idempotency_key regenerado ya no puede descontar stock dos veces.
--   6. Consolidación: processed_mutations y los RPC críticos ahora viven en
--      supabase/migrations/ (antes solo en db-migrations/ como scripts sueltos).
--
-- Es idempotente (IF NOT EXISTS / OR REPLACE) — seguro de re-ejecutar.
-- Aplicar en: SQL Editor de Supabase del proyecto REAL de nexus-pos.
-- Requiere: get_user_business_id() e is_super_admin() (security_hardening).
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 0. Infraestructura: processed_mutations (antes solo en db-migrations/)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.processed_mutations (
    idempotency_key uuid PRIMARY KEY,
    operation text NOT NULL,
    business_id uuid,
    result jsonb,
    processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_processed_mutations_age
    ON public.processed_mutations(processed_at);

ALTER TABLE public.processed_mutations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS processed_mutations_read ON public.processed_mutations;
CREATE POLICY processed_mutations_read ON public.processed_mutations
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_super_admin = true));

DROP POLICY IF EXISTS processed_mutations_no_insert ON public.processed_mutations;
CREATE POLICY processed_mutations_no_insert ON public.processed_mutations
    FOR INSERT TO authenticated WITH CHECK (false);


-- ────────────────────────────────────────────────────────────────────────────
-- 1. updated_at mantenido por el SERVIDOR en todas las tablas sincronizadas
-- ────────────────────────────────────────────────────────────────────────────
-- El pull incremental (updated_at > since) y la resolución de conflictos
-- last-writer-wins comparan updated_at. Si lo escribe el cliente, un reloj
-- atrasado produce cambios "en el pasado" que los demás dispositivos nunca
-- descargan. El trigger fuerza now() del servidor en INSERT y UPDATE
-- (los triggers previos de restaurante eran solo BEFORE UPDATE: el INSERT
-- inicial quedaba con reloj de cliente).
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    -- retail (no tenían trigger; algunas ni columna)
    'products', 'customers', 'sales', 'staff', 'cash_shifts', 'cash_movements',
    'inventory_movements', 'audit_logs', 'businesses', 'cash_registers',
    -- restaurante (tenían trigger solo BEFORE UPDATE)
    'restaurant_areas', 'restaurant_tables', 'comandas', 'comanda_items',
    'modifier_groups', 'modifiers', 'product_modifier_groups', 'recipe_ingredients'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'Tabla % no existe — omitida', t;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
      t, t
    );
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. process_sale_transaction — tenant + resolución real de stock_conflict
-- ────────────────────────────────────────────────────────────────────────────
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

  -- 1. Idempotencia. Si la venta existe COMPLETADA (o anulada/devuelta), no
  --    reprocesar. Si existe en stock_conflict es el REINTENTO de resolución:
  --    hay que re-verificar stock y descontarlo — el bug histórico era cortar
  --    aquí y no descontar stock jamás.
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
      -- Sigue sin alcanzar el stock: la venta queda en conflicto.
      RETURN jsonb_build_object('success', true, 'conflict', true,
                                'conflict_items', to_jsonb(v_conflicts));
    END IF;

    -- Reclamar la venta ANTES de descontar: si dos dispositivos reintentan a
    -- la vez, el lock de fila serializa y solo el primero descuenta stock.
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

  -- 4. Venta NUEVA: insertar con TODAS las columnas
  INSERT INTO sales (
    id, business_id, date, total, payment_method,
    amount_tendered, change, staff_id, staff_name, shift_id,
    status, created_at,
    customer_id, customer_name,
    discount_amount, discount_type, discount_input,
    cash_amount, transfer_amount, redeemed_points,
    items
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
    p_items
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

-- SIN bloque EXCEPTION: la invocación ya es atómica (rollback total si algo
-- falla) y así los SQLSTATE reales (23505, 42501…) llegan al cliente en vez
-- de un P0001 genérico que rompía la detección de duplicados.
END;
$function$;

GRANT EXECUTE ON FUNCTION public.process_sale_transaction TO authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. add_loyalty_points — tenant + reclamo atómico del idempotency_key
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.add_loyalty_points(
    p_customer_id uuid,
    p_business_id uuid,
    p_delta integer,
    p_idempotency_key uuid
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_new_points integer;
    v_existing jsonb;
BEGIN
    -- Tenant: SECURITY DEFINER salta RLS.
    IF p_business_id <> get_user_business_id() AND NOT is_super_admin() THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    -- Reclamo ATÓMICO del key: el INSERT gana o pierde en el índice único.
    -- Dos llamadas concurrentes con el mismo key ya no aplican el delta dos
    -- veces (la segunda espera el lock y lee el resultado del primero).
    -- Si esta transacción falla más abajo, el reclamo hace rollback también.
    INSERT INTO processed_mutations (idempotency_key, operation, business_id, result)
    VALUES (p_idempotency_key, 'add_loyalty_points', p_business_id, NULL)
    ON CONFLICT (idempotency_key) DO NOTHING;

    IF NOT FOUND THEN
        -- Key ya procesado: retornar el total guardado.
        SELECT result INTO v_existing
          FROM processed_mutations WHERE idempotency_key = p_idempotency_key;
        IF v_existing IS NOT NULL THEN
            RETURN (v_existing->>'new_points')::integer;
        END IF;
        -- Defensivo (no debería ocurrir): retornar el total actual sin re-aplicar.
        SELECT loyalty_points INTO v_new_points
          FROM customers WHERE id = p_customer_id AND business_id = p_business_id;
        RETURN COALESCE(v_new_points, 0);
    END IF;

    UPDATE customers
    SET loyalty_points = GREATEST(0, COALESCE(loyalty_points, 0) + p_delta)
    WHERE id = p_customer_id AND business_id = p_business_id
    RETURNING loyalty_points INTO v_new_points;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer not found' USING ERRCODE = 'P0002';
    END IF;

    UPDATE processed_mutations
    SET result = jsonb_build_object('new_points', v_new_points, 'delta', p_delta)
    WHERE idempotency_key = p_idempotency_key;

    RETURN v_new_points;
END; $$;

GRANT EXECUTE ON FUNCTION public.add_loyalty_points TO authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 4. set_kitchen_status — guard real contra escrituras viejas (KDS)
-- ────────────────────────────────────────────────────────────────────────────
-- El cliente siempre asumió este guard pero no existía: un reintento offline
-- con timestamp viejo pisaba un estado de cocina más nuevo. Se compara contra
-- una columna PROPIA del KDS (kitchen_updated_at) y no contra item_updated_at,
-- porque item_updated_at lo escribe también el mesero con now() del servidor y
-- mezclar ambos relojes rechazaría actualizaciones legítimas de cocina.
ALTER TABLE public.comanda_items ADD COLUMN IF NOT EXISTS kitchen_updated_at timestamptz;

CREATE OR REPLACE FUNCTION public.set_kitchen_status(
  p_item_id uuid,
  p_business_id uuid,
  p_status text,
  p_item_updated_at timestamptz
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_business_id <> get_user_business_id() AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('pending', 'sent', 'preparando', 'listo', 'served', 'cancelled') THEN
    RAISE EXCEPTION 'Estado de cocina inválido: %', p_status;
  END IF;

  UPDATE comanda_items
  SET kitchen_status = p_status,
      sent_at  = CASE WHEN p_status = 'sent'  AND sent_at  IS NULL THEN now() ELSE sent_at  END,
      ready_at = CASE WHEN p_status = 'listo'                      THEN now() ELSE ready_at END,
      kitchen_updated_at = p_item_updated_at,
      -- item_updated_at nunca retrocede (frescura del pull/merge)
      item_updated_at = GREATEST(COALESCE(item_updated_at, p_item_updated_at), p_item_updated_at)
  WHERE id = p_item_id AND business_id = p_business_id
    -- Guard: descartar escrituras de cocina más viejas que la última aplicada
    AND (kitchen_updated_at IS NULL OR kitchen_updated_at <= p_item_updated_at);
END; $$;

GRANT EXECUTE ON FUNCTION public.set_kitchen_status TO authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 5. close_comanda v4 — guard por estado: no descontar stock dos veces
-- ────────────────────────────────────────────────────────────────────────────
-- v3 protegía el descuento SOLO con el idempotency_key: si el cliente
-- regeneraba el key (re-cierre manual), el stock se descontaba de nuevo.
-- Ahora, además del key, se bloquea la fila de la comanda y se verifica su
-- estado: una comanda ya cerrada retorna ok sin tocar inventario.
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
  v_comanda_status text;
  v_conflicts text[];
  v_sale jsonb;
BEGIN
  IF p_business_id <> get_user_business_id() AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT result INTO v_existing FROM processed_mutations WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN RETURN v_existing; END IF;

  -- Lock + guard de estado: serializa cierres concurrentes y hace el cierre
  -- idempotente por COMANDA, no solo por key.
  SELECT status INTO v_comanda_status
    FROM comandas WHERE id = p_comanda_id AND business_id = p_business_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comanda no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_comanda_status = 'closed' THEN
    RETURN jsonb_build_object('ok', true, 'message', 'already_closed');
  END IF;

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
  SELECT array_agg(p.name || ' (stock: ' || p.stock || ', pedido: ' || n.qty || ')')
    INTO v_conflicts
  FROM _needs n JOIN products p ON p.id = n.product_id
  WHERE p.stock < n.qty;

  IF v_conflicts IS NOT NULL AND array_length(v_conflicts, 1) > 0 THEN
    RETURN jsonb_build_object('conflict', true, 'conflict_items', to_jsonb(v_conflicts));
  END IF;

  -- Descontar stock
  UPDATE products p
  SET stock = p.stock - n.qty
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


-- ────────────────────────────────────────────────────────────────────────────
-- 6. Verificación post-migración
-- ────────────────────────────────────────────────────────────────────────────
-- Triggers de updated_at (deben salir las 18 tablas existentes):
--   SELECT event_object_table, trigger_name FROM information_schema.triggers
--   WHERE trigger_name LIKE 'trg_%_updated' ORDER BY 1;
--
-- Tenant check en los RPC (debe fallar con 42501 usando un usuario de otro negocio):
--   SELECT process_sale_transaction('{"id":"00000000-0000-0000-0000-000000000001",
--     "business_id":"<OTRO_NEGOCIO>"}'::jsonb, '[]'::jsonb);
