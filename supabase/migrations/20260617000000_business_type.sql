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
