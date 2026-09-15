-- ============================================================================
-- Cuadre por conteo — contar productos al abrir y cerrar el turno
-- ============================================================================
-- Para los negocios que no teclean venta por venta (bares, cafeterías, puntos
-- de venta con cola): se cuenta al abrir, se cuenta al cerrar, y lo que falta
-- es lo que se vendió.
--
-- 1. Tabla shift_counts (un conteo por producto y turno) + RLS multi-tenant.
-- 2. Columna count_expected en cash_shifts (lo que el conteo espera en caja).
-- 3. Columna count_reconciliation en business_settings (interruptor del modo).
--
-- No-op para quien no active el modo: toda columna nueva es NULL/false.
-- Aplicar con confirmación al proyecto REAL de nexus-pos (NO a TriciGo).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.shift_counts (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL,
  shift_id uuid NOT NULL,
  product_id uuid NOT NULL,
  -- Fotos del momento de abrir: si mañana cambia el precio o el nombre, el
  -- cuadre de ESTE turno tiene que seguir leyéndose como se hizo.
  product_name text NOT NULL,
  unit_price numeric NOT NULL DEFAULT 0,
  opening_qty numeric NOT NULL DEFAULT 0,
  closing_qty numeric,
  loss_qty numeric,
  loss_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Un solo conteo por producto y turno: el cierre hace upsert sobre la fila
  -- que creó la apertura, y dos dispositivos no pueden duplicarla.
  CONSTRAINT shift_counts_unique_product_per_shift UNIQUE (shift_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_shift_counts_shift ON public.shift_counts(business_id, shift_id);

-- updated_at lo mantiene el SERVIDOR (igual que el resto de tablas sincronizadas):
-- un dispositivo con el reloj atrasado produciría cambios que los demás nunca
-- descargan, porque el pull incremental filtra por updated_at > watermark.
DROP TRIGGER IF EXISTS trg_shift_counts_updated ON public.shift_counts;
CREATE TRIGGER trg_shift_counts_updated BEFORE INSERT OR UPDATE ON public.shift_counts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.shift_counts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shift_counts_tenant ON public.shift_counts;
CREATE POLICY shift_counts_tenant ON public.shift_counts FOR ALL TO authenticated
  USING (business_id = get_user_business_id() OR is_super_admin())
  WITH CHECK (business_id = get_user_business_id() OR is_super_admin());

-- --------------------------------------------------------------------------
-- Columnas nuevas
-- --------------------------------------------------------------------------
ALTER TABLE public.cash_shifts ADD COLUMN IF NOT EXISTS count_expected numeric;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS count_reconciliation boolean DEFAULT false;
