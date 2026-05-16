-- ============================================================================
-- MIGRACIÓN MAESTRA — Reparación completa de la sincronización
-- Bisne con Talla / Nexus POS — 2026-05-16
-- ============================================================================
-- Arregla los errores que bloqueaban la cola de sincronización:
--   1. cash_shifts: faltan columnas de transferencia
--   2. sales: faltan columnas (cliente, descuentos, pago mixto, puntos, items)
--   3. FK de staff_id rotas (el actor puede ser admin=profiles o vendedor=staff)
--   4. RPC process_sale_transaction: insertar TODAS las columnas de sales
--
-- Es 100% idempotente (IF NOT EXISTS / OR REPLACE) — seguro de re-ejecutar.
-- Aplicar en: SQL Editor de Supabase (proyecto ypbajygoqqgaurikuctd).
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. cash_shifts — columnas de transferencia faltantes
-- ────────────────────────────────────────────────────────────────────────────
-- El cierre de caja registra el conteo de transferencias (monto esperado,
-- verificado y diferencia). El código las envía pero la tabla no las tenía.
ALTER TABLE public.cash_shifts
  ADD COLUMN IF NOT EXISTS transfer_expected   numeric,
  ADD COLUMN IF NOT EXISTS transfer_count      numeric,
  ADD COLUMN IF NOT EXISTS transfer_difference numeric;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. sales — columnas faltantes
-- ────────────────────────────────────────────────────────────────────────────
-- Sin estas columnas, las ventas se guardaban incompletas en el servidor:
-- al sincronizar a otro dispositivo se perdían cliente, descuento, pago mixto,
-- puntos canjeados y los items. `items` (jsonb) permite que el pull traiga la
-- venta completa sin tener que unir con sale_items.
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS customer_id      uuid,
  ADD COLUMN IF NOT EXISTS customer_name    text,
  ADD COLUMN IF NOT EXISTS discount_amount  numeric,
  ADD COLUMN IF NOT EXISTS discount_type    text,
  ADD COLUMN IF NOT EXISTS discount_input   numeric,
  ADD COLUMN IF NOT EXISTS cash_amount      numeric,
  ADD COLUMN IF NOT EXISTS transfer_amount  numeric,
  ADD COLUMN IF NOT EXISTS redeemed_points  integer,
  ADD COLUMN IF NOT EXISTS items            jsonb;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. Eliminar las foreign keys de staff_id
-- ────────────────────────────────────────────────────────────────────────────
-- PROBLEMA: la app tiene DOS tipos de usuario:
--   - Admin    → vive en la tabla `profiles`
--   - Vendedor → vive en la tabla `staff`
-- Pero los FK de staff_id apuntaban inconsistentemente:
--   cash_shifts.staff_id        → staff.id     (rompe si el actor es admin)
--   sales.staff_id              → staff.id     (rompe si el actor es admin)
--   audit_logs.staff_id         → profiles.id  (rompe si el actor es vendedor)
--   inventory_movements.staff_id→ profiles.id  (rompe si el actor es vendedor)
-- Ninguna FK puede ser correcta para ambos tipos de usuario.
--
-- SOLUCIÓN: staff_id queda como un uuid informativo SIN foreign key. La
-- integridad real la dan business_id (multi-tenant) y RLS. Esto es el patrón
-- correcto para sistemas offline-first donde el orden de inserción no se
-- puede garantizar.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tc.constraint_name, tc.table_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema   = kcu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema    = 'public'
      AND kcu.column_name    = 'staff_id'
      AND tc.table_name IN ('cash_shifts','sales','audit_logs','inventory_movements')
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.table_name, r.constraint_name);
    RAISE NOTICE 'FK eliminada: %.% (staff_id)', r.table_name, r.constraint_name;
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 4. RPC process_sale_transaction — versión completa
-- ────────────────────────────────────────────────────────────────────────────
-- Cambios respecto a la versión anterior:
--   - Valida que la venta traiga un id válido (defensa ante payloads corruptos)
--   - Inserta TODAS las columnas de sales (cliente, descuento, mixto, puntos,
--     items) — antes solo insertaba 12 y se perdía el resto
--   - Mantiene: idempotencia, detección de conflicto de stock, sale_items
CREATE OR REPLACE FUNCTION public.process_sale_transaction(p_sale jsonb, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  item           jsonb;
  v_product_id   uuid;
  v_qty          numeric;
  v_sale_id      uuid;
  v_sale_exists  boolean;
  v_avail        numeric;
  v_pname        text;
  v_conflict     boolean := false;
  v_conflicts    text[]  := '{}';
BEGIN
  -- 0. Validar id de la venta (un payload corrupto sin id ya no rompe con
  --    un error genérico — da un mensaje claro)
  v_sale_id := NULLIF(p_sale->>'id', '')::uuid;
  IF v_sale_id IS NULL THEN
    RAISE EXCEPTION 'La venta no tiene un id válido (payload corrupto)';
  END IF;

  -- 1. Idempotencia: si la venta ya existe, no reprocesar
  SELECT EXISTS(SELECT 1 FROM sales WHERE id = v_sale_id) INTO v_sale_exists;
  IF v_sale_exists THEN
    RETURN jsonb_build_object('success', true, 'conflict', false,
                              'message', 'already_processed');
  END IF;

  -- 2. Verificar stock de TODOS los ítems antes de tocar nada
  FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (item->>'product_id')::uuid;
    v_qty        := COALESCE((item->>'quantity')::numeric, 1);

    IF v_product_id IS NOT NULL THEN
      SELECT stock, name INTO v_avail, v_pname
        FROM products WHERE id = v_product_id;

      IF FOUND AND v_avail < v_qty THEN
        v_conflict  := true;
        v_conflicts := array_append(
          v_conflicts,
          v_pname || ' (stock: ' || v_avail || ', pedido: ' || v_qty || ')'
        );
      END IF;
    END IF;
  END LOOP;

  -- 3. Insertar la venta con TODAS las columnas
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
    (p_sale->>'business_id')::uuid,
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

  -- 4. Insertar ítems en sale_items + descontar stock SOLO si no hay conflicto
  FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (item->>'product_id')::uuid;
    v_qty        := COALESCE((item->>'quantity')::numeric, 1);

    INSERT INTO sale_items (
      id, sale_id, business_id, product_id, name,
      quantity, price, unit_cost, total
    ) VALUES (
      COALESCE(NULLIF(item->>'id','')::uuid, gen_random_uuid()),
      v_sale_id,
      (p_sale->>'business_id')::uuid,
      v_product_id,
      item->>'name',
      v_qty,
      COALESCE((item->>'price')::numeric, 0),
      COALESCE((item->>'unit_cost')::numeric, (item->>'cost')::numeric, 0),
      COALESCE((item->>'total')::numeric, (item->>'price')::numeric * v_qty, 0)
    ) ON CONFLICT (id) DO NOTHING;

    IF NOT v_conflict AND v_product_id IS NOT NULL THEN
      UPDATE products
         SET stock = stock - v_qty, updated_at = now()
       WHERE id = v_product_id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success',        true,
    'conflict',       v_conflict,
    'conflict_items', to_jsonb(v_conflicts)
  );

EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Error procesando venta: %', SQLERRM;
END;
$function$;


-- ────────────────────────────────────────────────────────────────────────────
-- 5. Verificación post-migración
-- ────────────────────────────────────────────────────────────────────────────
-- Ejecuta esto después para confirmar que todo quedó bien:
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name='cash_shifts' AND column_name LIKE 'transfer%';
--   -- debe devolver 3 filas
--
--   SELECT count(*) FROM information_schema.table_constraints tc
--   JOIN information_schema.key_column_usage kcu USING (constraint_name)
--   WHERE tc.constraint_type='FOREIGN KEY' AND kcu.column_name='staff_id';
--   -- debe devolver 0
