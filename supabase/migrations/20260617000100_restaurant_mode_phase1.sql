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
