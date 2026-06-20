-- ============================================================================
-- MODO RESTAURANTE — SCRIPT CONSOLIDADO (Fases 0 a 5)
-- ============================================================================
-- Pega y ejecuta TODO este script en el SQL Editor del proyecto Supabase REAL
-- de nexus-pos (NO en TriciGo). Es idempotente: puedes re-ejecutarlo sin riesgo.
--
-- ⚠️ ANTES DE CORRER: verifica que la tabla `sales` tenga las columnas que usa
--    el INSERT de close_comanda (id, business_id, date, shift_id, total, items,
--    staff_id, staff_name, customer_id, customer_name, payment_method,
--    amount_tendered, change, status, discount_amount, discount_type,
--    cash_amount, transfer_amount, redeemed_points). Las columnas nuevas
--    (comanda_id, tip_amount, tip_staff_id, split_group_id, split_index) las
--    agrega este script. Si algún nombre difiere, ajústalo en el bloque de Fase 4/5.
--
-- Requiere que ya existan en tu proyecto: get_user_business_id(), is_super_admin(),
-- processed_mutations y process_sale_transaction(p_sale jsonb, p_items jsonb).
-- ============================================================================


-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  20260617000000_business_type.sql
-- ╚════════════════════════════════════════════════════════════════════════╝
-- Modo restaurante — Fase 0: flag business_type en businesses
--
-- Añade la columna que decide el modo de la app por negocio. Default 'retail'
-- para que todos los negocios existentes sigan exactamente igual que hoy.
--
-- El cliente sincroniza este campo vía el caso SETTINGS_SYNC (src/lib/sync.ts).
-- Aplicar en producción con confirmación (Supabase MCP apply_migration o manual).

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS business_type text NOT NULL DEFAULT 'retail';

-- Validación de valores permitidos (idempotente).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'businesses_business_type_check'
  ) THEN
    ALTER TABLE public.businesses
      ADD CONSTRAINT businesses_business_type_check
      CHECK (business_type IN ('retail', 'restaurant'));
  END IF;
END $$;

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  20260617000100_restaurant_mode_phase1.sql
-- ╚════════════════════════════════════════════════════════════════════════╝
-- ============================================================================
-- Modo restaurante — Fase 1: mesas, comandas y cierre→venta
-- ============================================================================
-- Crea las 4 tablas base (áreas, mesas, comandas, ítems de comanda), su RLS por
-- tenant (mismo patrón que products/sales vía get_user_business_id()) y el RPC
-- close_comanda, que reutiliza process_sale_transaction para descontar stock e
-- insertar la(s) venta(s) de forma idempotente.
--
-- Requiere que ya existan: get_user_business_id(), is_super_admin(),
-- processed_mutations y process_sale_transaction(p_sale jsonb, p_items jsonb).
-- Aplicar con confirmación (Supabase MCP apply_migration o SQL Editor).
-- ============================================================================

-- --------------------------------------------------------------------------
-- 0. Trigger genérico de updated_at (idempotente)
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

-- --------------------------------------------------------------------------
-- 1. Tablas
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.restaurant_areas (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL,
  name text NOT NULL,
  sort_order integer DEFAULT 0,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.restaurant_tables (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL,
  area_id uuid,
  name text NOT NULL,
  capacity integer,
  pos_x numeric,
  pos_y numeric,
  state text NOT NULL DEFAULT 'libre' CHECK (state IN ('libre','ocupada','por_cobrar','reservada')),
  current_comanda_id uuid,
  assigned_staff_id uuid,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.comandas (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL,
  table_id uuid NOT NULL,
  area_id uuid,
  staff_id uuid,
  staff_name text,
  customer_id uuid,
  customer_name text,
  opened_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','por_cobrar','closed','cancelled')),
  closed_at timestamptz,
  guests integer,
  note text,
  total numeric,
  tip_total numeric,
  sale_ids jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.comanda_items (
  id uuid PRIMARY KEY,
  comanda_id uuid NOT NULL,
  business_id uuid NOT NULL,
  product_id uuid NOT NULL,
  name text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  price numeric NOT NULL DEFAULT 0,
  custom_price numeric,
  note text,
  modifiers jsonb,
  modifiers_total numeric,
  course integer,
  kitchen_status text NOT NULL DEFAULT 'pending'
    CHECK (kitchen_status IN ('pending','sent','preparando','listo','served','cancelled')),
  sent_at timestamptz,
  ready_at timestamptz,
  voided boolean DEFAULT false,
  item_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Índices de consulta (reflejan los índices Dexie locales)
CREATE INDEX IF NOT EXISTS idx_restaurant_areas_business ON public.restaurant_areas(business_id);
CREATE INDEX IF NOT EXISTS idx_restaurant_tables_business ON public.restaurant_tables(business_id);
CREATE INDEX IF NOT EXISTS idx_comandas_business_status ON public.comandas(business_id, status);
CREATE INDEX IF NOT EXISTS idx_comanda_items_business_kitchen ON public.comanda_items(business_id, kitchen_status);
CREATE INDEX IF NOT EXISTS idx_comanda_items_comanda ON public.comanda_items(comanda_id);

-- Triggers updated_at
DROP TRIGGER IF EXISTS trg_restaurant_areas_updated ON public.restaurant_areas;
CREATE TRIGGER trg_restaurant_areas_updated BEFORE UPDATE ON public.restaurant_areas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_restaurant_tables_updated ON public.restaurant_tables;
CREATE TRIGGER trg_restaurant_tables_updated BEFORE UPDATE ON public.restaurant_tables
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_comandas_updated ON public.comandas;
CREATE TRIGGER trg_comandas_updated BEFORE UPDATE ON public.comandas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_comanda_items_updated ON public.comanda_items;
CREATE TRIGGER trg_comanda_items_updated BEFORE UPDATE ON public.comanda_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- --------------------------------------------------------------------------
-- 2. RLS por tenant (mismo patrón que products/sales)
-- --------------------------------------------------------------------------
ALTER TABLE public.restaurant_areas  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comandas          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comanda_items     ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['restaurant_areas','restaurant_tables','comandas','comanda_items']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant ON public.%I;', t, t);
    EXECUTE format($f$
      CREATE POLICY %I_tenant ON public.%I FOR ALL TO authenticated
        USING (business_id = get_user_business_id() OR is_super_admin())
        WITH CHECK (business_id = get_user_business_id() OR is_super_admin());
    $f$, t, t);
  END LOOP;
END $$;

-- --------------------------------------------------------------------------
-- 3. RPC close_comanda: cierra la comanda creando la(s) venta(s)
-- --------------------------------------------------------------------------
-- Reutiliza process_sale_transaction (descuento de stock + idempotencia por
-- sale.id + contrato de conflicto). Idempotente además por p_idempotency_key.
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
  v_sale jsonb;
  v_res jsonb;
  v_conflicts jsonb := '[]'::jsonb;
BEGIN
  SELECT result INTO v_existing FROM processed_mutations WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN RETURN v_existing; END IF;

  FOR v_sale IN SELECT * FROM jsonb_array_elements(p_sales)
  LOOP
    v_res := public.process_sale_transaction(
      p_sale := (v_sale - 'sync_status'),
      p_items := COALESCE(v_sale->'items', '[]'::jsonb)
    );
    IF COALESCE((v_res->>'conflict')::boolean, false) THEN
      v_conflicts := v_conflicts || COALESCE(v_res->'conflict_items', '[]'::jsonb);
    END IF;
  END LOOP;

  IF jsonb_array_length(v_conflicts) > 0 THEN
    -- No cerramos la comanda: el cliente marcará las ventas en stock_conflict.
    RETURN jsonb_build_object('conflict', true, 'conflict_items', v_conflicts);
  END IF;

  UPDATE comandas
  SET status = 'closed', closed_at = now()
  WHERE id = p_comanda_id AND business_id = p_business_id;

  INSERT INTO processed_mutations (idempotency_key, operation, business_id, result)
  VALUES (p_idempotency_key, 'close_comanda', p_business_id, jsonb_build_object('ok', true))
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN jsonb_build_object('ok', true);
END; $$;

GRANT EXECUTE ON FUNCTION public.close_comanda TO authenticated;

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  20260617000200_restaurant_mode_kds.sql
-- ╚════════════════════════════════════════════════════════════════════════╝
-- ============================================================================
-- Modo restaurante — Fase 2: KDS (cocina) + Realtime
-- ============================================================================
-- Implementa la "propiedad de columnas disjunta": el mesero y la cocina (KDS)
-- escriben conjuntos de columnas distintos de comanda_items, así nunca se pisan.
--   - upsert_comanda_item: SOLO columnas del mesero (cantidad/precio/nota/...).
--   - set_kitchen_status:  SOLO columnas de cocina (kitchen_status/sent_at/ready_at).
-- Y habilita Realtime en comandas/comanda_items para el KDS.
--
-- Requiere las tablas de la Fase 1 + get_user_business_id()/is_super_admin().
-- Aplicar con confirmación al proyecto REAL de nexus-pos (NO a TriciGo).
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. upsert_comanda_item — escribe SOLO columnas del mesero
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_comanda_item(p_item jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_business uuid := (p_item->>'business_id')::uuid;
BEGIN
  IF v_business <> get_user_business_id() AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO comanda_items (
    id, comanda_id, business_id, product_id, name, quantity, price, custom_price,
    note, modifiers, modifiers_total, course, voided, item_updated_at
  ) VALUES (
    (p_item->>'id')::uuid,
    (p_item->>'comanda_id')::uuid,
    v_business,
    (p_item->>'product_id')::uuid,
    p_item->>'name',
    COALESCE((p_item->>'quantity')::numeric, 1),
    COALESCE((p_item->>'price')::numeric, 0),
    NULLIF(p_item->>'custom_price', '')::numeric,
    p_item->>'note',
    CASE WHEN p_item ? 'modifiers' THEN p_item->'modifiers' ELSE NULL END,
    NULLIF(p_item->>'modifiers_total', '')::numeric,
    NULLIF(p_item->>'course', '')::integer,
    COALESCE((p_item->>'voided')::boolean, false),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    quantity        = EXCLUDED.quantity,
    price           = EXCLUDED.price,
    custom_price    = EXCLUDED.custom_price,
    note            = EXCLUDED.note,
    modifiers       = EXCLUDED.modifiers,
    modifiers_total = EXCLUDED.modifiers_total,
    course          = EXCLUDED.course,
    voided          = EXCLUDED.voided,
    item_updated_at = now();
  -- kitchen_status / sent_at / ready_at NO se tocan aquí: los posee el KDS.
END; $$;

GRANT EXECUTE ON FUNCTION public.upsert_comanda_item TO authenticated;

-- --------------------------------------------------------------------------
-- 2. set_kitchen_status — escribe SOLO columnas de cocina
-- --------------------------------------------------------------------------
-- Las columnas de cocina son de propiedad exclusiva del KDS, así que aplicar el
-- último estado recibido es seguro (no hay contención con el mesero). Igualmente
-- registramos item_updated_at para frescura del pull/merge.
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
  IF p_status NOT IN ('pending','sent','preparando','listo','served','cancelled') THEN
    RAISE EXCEPTION 'estado de cocina inválido: %', p_status;
  END IF;

  UPDATE comanda_items
  SET kitchen_status = p_status,
      sent_at  = CASE WHEN p_status = 'sent'  AND sent_at  IS NULL THEN now() ELSE sent_at  END,
      ready_at = CASE WHEN p_status = 'listo'                      THEN now() ELSE ready_at END,
      item_updated_at = p_item_updated_at
  WHERE id = p_item_id AND business_id = p_business_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.set_kitchen_status TO authenticated;

-- --------------------------------------------------------------------------
-- 3. Realtime: publicar comandas y comanda_items (alta rotación)
-- --------------------------------------------------------------------------
-- No publicamos products/sales: el volumen Realtime queda acotado al KDS/plano.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'comandas'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.comandas;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'comanda_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.comanda_items;
  END IF;
END $$;

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  20260617000300_restaurant_mode_modifiers.sql
-- ╚════════════════════════════════════════════════════════════════════════╝
-- ============================================================================
-- Modo restaurante — Fase 3: modificadores estructurados
-- ============================================================================
-- Configuración del menú: grupos de modificadores, sus opciones y la asignación
-- de grupos a productos. Los modificadores APLICADOS viajan embebidos en
-- comanda_items.modifiers (jsonb), así que no necesitan tabla propia.
-- Aplicar con confirmación al proyecto REAL de nexus-pos (NO a TriciGo).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.modifier_groups (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL,
  name text NOT NULL,
  min_select integer,
  max_select integer,
  required boolean DEFAULT false,
  sort_order integer DEFAULT 0,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.modifiers (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL,
  group_id uuid NOT NULL,
  name text NOT NULL,
  price_delta numeric NOT NULL DEFAULT 0,
  sort_order integer DEFAULT 0,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.product_modifier_groups (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL,
  product_id uuid NOT NULL,
  group_id uuid NOT NULL,
  sort_order integer DEFAULT 0,
  deleted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_modifier_groups_business ON public.modifier_groups(business_id);
CREATE INDEX IF NOT EXISTS idx_modifiers_group ON public.modifiers(group_id);
CREATE INDEX IF NOT EXISTS idx_pmg_product ON public.product_modifier_groups(business_id, product_id);

-- Triggers updated_at (reusa set_updated_at de la Fase 1)
DROP TRIGGER IF EXISTS trg_modifier_groups_updated ON public.modifier_groups;
CREATE TRIGGER trg_modifier_groups_updated BEFORE UPDATE ON public.modifier_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_modifiers_updated ON public.modifiers;
CREATE TRIGGER trg_modifiers_updated BEFORE UPDATE ON public.modifiers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_pmg_updated ON public.product_modifier_groups;
CREATE TRIGGER trg_pmg_updated BEFORE UPDATE ON public.product_modifier_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS por tenant
ALTER TABLE public.modifier_groups         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modifiers               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_modifier_groups ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['modifier_groups','modifiers','product_modifier_groups']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant ON public.%I;', t, t);
    EXECUTE format($f$
      CREATE POLICY %I_tenant ON public.%I FOR ALL TO authenticated
        USING (business_id = get_user_business_id() OR is_super_admin())
        WITH CHECK (business_id = get_user_business_id() OR is_super_admin());
    $f$, t, t);
  END LOOP;
END $$;

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  20260617000400_restaurant_mode_split_tips.sql
-- ╚════════════════════════════════════════════════════════════════════════╝
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

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  20260617000500_restaurant_mode_recipes.sql
-- ╚════════════════════════════════════════════════════════════════════════╝
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
