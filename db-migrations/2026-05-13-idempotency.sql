-- ============================================================================
-- Migración: Idempotency en LOYALTY_CHANGE y SALE
-- Fecha: 2026-05-13
-- ============================================================================
-- Estas migraciones previenen aplicar la misma mutación dos veces cuando un
-- item de cola se reintenta tras un fallo de red (la red corta justo cuando
-- el RPC ya ejecutó pero antes de que el cliente reciba la respuesta).
--
-- Aplicar en Supabase SQL Editor.
-- ============================================================================


-- --------------------------------------------------------------------------
-- 1. Tabla de keys procesadas (audit de idempotencia)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.processed_mutations (
    idempotency_key uuid PRIMARY KEY,
    operation text NOT NULL,
    business_id uuid,
    result jsonb,
    processed_at timestamptz NOT NULL DEFAULT now()
);

-- Limpieza: items procesados >7 días son seguros de borrar
-- (cualquier reintento legítimo ocurre en minutos, no días)
CREATE INDEX IF NOT EXISTS idx_processed_mutations_age
    ON public.processed_mutations(processed_at);

-- Función para borrar registros viejos (correr periódicamente con pg_cron o manual)
CREATE OR REPLACE FUNCTION public.prune_processed_mutations()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE deleted_count integer;
BEGIN
    DELETE FROM processed_mutations
    WHERE processed_at < now() - interval '7 days';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END; $$;


-- --------------------------------------------------------------------------
-- 2. add_loyalty_points: idempotente por p_idempotency_key
-- --------------------------------------------------------------------------
-- Reemplaza el RPC actual con uno que verifica si el key ya se procesó.
-- Si sí → retorna el total guardado en processed_mutations (no aplica el delta).
-- Si no → aplica el delta, guarda el key, retorna el nuevo total.

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
    -- 1. Verificar si este key ya se procesó
    SELECT result INTO v_existing
    FROM processed_mutations
    WHERE idempotency_key = p_idempotency_key;

    IF FOUND THEN
        -- Ya procesado: retornar el total que se guardó
        RETURN (v_existing->>'new_points')::integer;
    END IF;

    -- 2. Aplicar el delta atómicamente
    UPDATE customers
    SET loyalty_points = GREATEST(0, COALESCE(loyalty_points, 0) + p_delta),
        updated_at = now()
    WHERE id = p_customer_id AND business_id = p_business_id
    RETURNING loyalty_points INTO v_new_points;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer not found' USING ERRCODE = 'P0002';
    END IF;

    -- 3. Registrar el key procesado (insert idempotente por si dos requests
    --    paralelos llegan con el mismo key — el primero gana)
    INSERT INTO processed_mutations (idempotency_key, operation, business_id, result)
    VALUES (
        p_idempotency_key,
        'add_loyalty_points',
        p_business_id,
        jsonb_build_object('new_points', v_new_points, 'delta', p_delta)
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    RETURN v_new_points;
END; $$;

GRANT EXECUTE ON FUNCTION public.add_loyalty_points TO authenticated;


-- --------------------------------------------------------------------------
-- 3. process_sale_transaction: idempotente por sale.id
-- --------------------------------------------------------------------------
-- La identidad natural de una venta ES `sale.id` (UUID generado en el cliente).
-- El RPC debe usar INSERT ... ON CONFLICT (id) DO NOTHING para que reintentos
-- no decrementen stock dos veces.
--
-- IMPORTANTE: este script asume que `process_sale_transaction` ya existe.
-- Solo agregar la verificación de existencia al inicio (sin tocar el resto).
--
-- Si necesitas la versión completa, copia la del proyecto y aplica este patch.

-- VERIFICACIÓN MANUAL: revisa que tu function actual tenga al menos algo así:
--
-- IF EXISTS (SELECT 1 FROM sales WHERE id = (p_sale->>'id')::uuid) THEN
--     RETURN jsonb_build_object('already_processed', true);
-- END IF;
--
-- ANTES de cualquier UPDATE de stock o INSERT de movements.

-- Si no la tiene, este SELECT te muestra el cuerpo actual para revisar:
--   SELECT pg_get_functiondef('public.process_sale_transaction'::regproc);


-- --------------------------------------------------------------------------
-- 4. RLS: solo super_admins pueden leer la tabla de auditoría
-- --------------------------------------------------------------------------
ALTER TABLE public.processed_mutations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS processed_mutations_read ON public.processed_mutations;
CREATE POLICY processed_mutations_read ON public.processed_mutations
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE id = auth.uid() AND is_super_admin = true
        )
    );

-- Nadie escribe directamente — solo los RPC con SECURITY DEFINER
DROP POLICY IF EXISTS processed_mutations_no_insert ON public.processed_mutations;
CREATE POLICY processed_mutations_no_insert ON public.processed_mutations
    FOR INSERT TO authenticated WITH CHECK (false);
