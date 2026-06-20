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
