-- ============================================================================
-- Migración: Columna voided_at en sales para reportes históricos inmutables
-- Fecha: 2026-05-14
-- ============================================================================
-- Problema:
-- Antes, anular una venta de un turno cerrado cambiaba RETROACTIVAMENTE el
-- reporte de ese turno (porque los reportes filtraban status != 'voided'
-- sin importar cuándo ocurrió la anulación).
--
-- Solución:
-- Marcar cada anulación con su timestamp `voided_at`. Los reportes históricos
-- consideran la venta válida si fue anulada DESPUÉS del cierre del periodo
-- (al cierre seguía contando; la anulación va al turno actual).
--
-- La lógica cliente vive en `src/lib/shiftStats.ts` (función pura testeable).
--
-- Aplicar en Supabase SQL Editor.
-- ============================================================================


-- --------------------------------------------------------------------------
-- 1. Agregar columna voided_at a sales
-- --------------------------------------------------------------------------
ALTER TABLE public.sales
ADD COLUMN IF NOT EXISTS voided_at timestamptz;

-- Índice opcional: si haces queries históricas filtrando por voided_at,
-- acelera el filtrado. No es crítico pero recomendable si tienes >100k sales.
CREATE INDEX IF NOT EXISTS idx_sales_voided_at
    ON public.sales(voided_at)
    WHERE voided_at IS NOT NULL;


-- --------------------------------------------------------------------------
-- 2. Backfill (opcional): asignar voided_at a anulaciones históricas
-- --------------------------------------------------------------------------
-- Si existen ventas marcadas como 'voided' SIN voided_at, podemos intentar
-- recuperar el timestamp desde audit_logs. Si no hay audit log, dejamos NULL
-- y el código cliente las trata como "anuladas antes del periodo" (conservador).

UPDATE public.sales s
SET voided_at = al.created_at
FROM (
    SELECT
        (details->>'sale_id')::uuid AS sale_id,
        MIN(created_at) AS created_at
    FROM public.audit_logs
    WHERE action = 'VOID_SALE'
      AND details->>'sale_id' IS NOT NULL
    GROUP BY (details->>'sale_id')::uuid
) al
WHERE s.id = al.sale_id
  AND s.status = 'voided'
  AND s.voided_at IS NULL;


-- --------------------------------------------------------------------------
-- 3. Trigger: setear voided_at automáticamente cuando status cambia a voided
-- --------------------------------------------------------------------------
-- Defensa server-side: aunque el cliente envía voided_at, si por error no lo
-- hace, el trigger lo setea con NOW(). Mejor un timestamp aproximado que NULL.

CREATE OR REPLACE FUNCTION public.set_voided_at_on_void()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status = 'voided' AND OLD.status <> 'voided' AND NEW.voided_at IS NULL THEN
        NEW.voided_at := NOW();
    END IF;
    RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_set_voided_at ON public.sales;
CREATE TRIGGER trg_set_voided_at
    BEFORE UPDATE OF status ON public.sales
    FOR EACH ROW
    EXECUTE FUNCTION public.set_voided_at_on_void();
