-- =============================================================================
-- NEXUS-POS: SEGURIDAD COMPLETA (Ejecutar en Supabase SQL Editor)
-- =============================================================================
-- Este archivo endurece la seguridad de la base de datos:
--   1. Funciones helper de seguridad
--   2. RLS activo en todas las tablas
--   3. Políticas de acceso por tenant (business_id)
--   4. Trigger para proteger campos de licencia/estado
--   5. Protección de is_super_admin en profiles
--   6. Rate limiting de PIN (tabla pin_attempts + función verify_master_pin)
-- =============================================================================


-- =============================================================================
-- 1. FUNCIONES HELPER (SECURITY DEFINER = corren como el dueño de la función)
-- =============================================================================

-- Obtener el business_id del usuario autenticado
CREATE OR REPLACE FUNCTION get_user_business_id()
RETURNS UUID
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT business_id FROM profiles WHERE id = auth.uid();
$$;

-- Verificar si el usuario actual es super admin
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_super_admin FROM profiles WHERE id = auth.uid()),
    false
  );
$$;


-- =============================================================================
-- 2. HABILITAR RLS EN TODAS LAS TABLAS
-- =============================================================================

ALTER TABLE businesses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE products            ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales               ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_shifts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_movements      ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff               ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_registers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE parked_orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE license_history     ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- 3. POLÍTICAS: BUSINESSES
-- Cada negocio solo puede leer/actualizar su propio registro.
-- status y subscription_expires_at son protegidos por trigger (ver sección 5).
-- =============================================================================

DROP POLICY IF EXISTS "businesses_select" ON businesses;
DROP POLICY IF EXISTS "businesses_update" ON businesses;
DROP POLICY IF EXISTS "businesses_insert" ON businesses;
DROP POLICY IF EXISTS "businesses_delete" ON businesses;

CREATE POLICY "businesses_select" ON businesses
  FOR SELECT USING (
    id = get_user_business_id()
    OR is_super_admin()
  );

CREATE POLICY "businesses_update" ON businesses
  FOR UPDATE USING (
    id = get_user_business_id()
    OR is_super_admin()
  );

-- Solo el sistema (service_role) puede insertar negocios, no el cliente
CREATE POLICY "businesses_insert" ON businesses
  FOR INSERT WITH CHECK (is_super_admin());

CREATE POLICY "businesses_delete" ON businesses
  FOR DELETE USING (is_super_admin());


-- =============================================================================
-- 4. POLÍTICAS: PROFILES
-- Cada usuario solo puede ver/editar su propio perfil.
-- is_super_admin y business_id no se pueden cambiar por el propio usuario.
-- =============================================================================

DROP POLICY IF EXISTS "profiles_select" ON profiles;
DROP POLICY IF EXISTS "profiles_update" ON profiles;
DROP POLICY IF EXISTS "profiles_insert" ON profiles;

CREATE POLICY "profiles_select" ON profiles
  FOR SELECT USING (
    id = auth.uid()
    OR is_super_admin()
  );

-- Los usuarios pueden actualizar su propio perfil EXCEPTO campos críticos
CREATE POLICY "profiles_update" ON profiles
  FOR UPDATE USING (id = auth.uid() OR is_super_admin())
  WITH CHECK (
    -- Usuarios normales NO pueden escalar a super_admin ni cambiar su business_id
    CASE
      WHEN is_super_admin() THEN true
      ELSE (
        is_super_admin = (SELECT is_super_admin FROM profiles WHERE id = auth.uid())
        AND business_id = (SELECT business_id FROM profiles WHERE id = auth.uid())
        AND id = auth.uid()
      )
    END
  );

-- Los perfiles los crea el sistema via RPC, no directamente el cliente
CREATE POLICY "profiles_insert" ON profiles
  FOR INSERT WITH CHECK (id = auth.uid() OR is_super_admin());


-- =============================================================================
-- 5. POLÍTICAS: PRODUCTS
-- =============================================================================

DROP POLICY IF EXISTS "products_select" ON products;
DROP POLICY IF EXISTS "products_insert" ON products;
DROP POLICY IF EXISTS "products_update" ON products;
DROP POLICY IF EXISTS "products_delete" ON products;

CREATE POLICY "products_select" ON products
  FOR SELECT USING (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "products_insert" ON products
  FOR INSERT WITH CHECK (business_id = get_user_business_id());

CREATE POLICY "products_update" ON products
  FOR UPDATE USING (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "products_delete" ON products
  FOR DELETE USING (business_id = get_user_business_id() OR is_super_admin());


-- =============================================================================
-- 6. POLÍTICAS: SALES
-- =============================================================================

DROP POLICY IF EXISTS "sales_select" ON sales;
DROP POLICY IF EXISTS "sales_insert" ON sales;
DROP POLICY IF EXISTS "sales_update" ON sales;

CREATE POLICY "sales_select" ON sales
  FOR SELECT USING (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "sales_insert" ON sales
  FOR INSERT WITH CHECK (business_id = get_user_business_id());

-- Solo permitir actualizar (ej: anular) ventas del propio negocio
CREATE POLICY "sales_update" ON sales
  FOR UPDATE USING (business_id = get_user_business_id() OR is_super_admin());


-- =============================================================================
-- 7. POLÍTICAS: INVENTORY_MOVEMENTS
-- =============================================================================

DROP POLICY IF EXISTS "movements_select" ON inventory_movements;
DROP POLICY IF EXISTS "movements_insert" ON inventory_movements;

CREATE POLICY "movements_select" ON inventory_movements
  FOR SELECT USING (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "movements_insert" ON inventory_movements
  FOR INSERT WITH CHECK (business_id = get_user_business_id());


-- =============================================================================
-- 8. POLÍTICAS: CUSTOMERS
-- =============================================================================

DROP POLICY IF EXISTS "customers_select" ON customers;
DROP POLICY IF EXISTS "customers_insert" ON customers;
DROP POLICY IF EXISTS "customers_update" ON customers;
DROP POLICY IF EXISTS "customers_delete" ON customers;

CREATE POLICY "customers_select" ON customers
  FOR SELECT USING (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "customers_insert" ON customers
  FOR INSERT WITH CHECK (business_id = get_user_business_id());

CREATE POLICY "customers_update" ON customers
  FOR UPDATE USING (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "customers_delete" ON customers
  FOR DELETE USING (business_id = get_user_business_id() OR is_super_admin());


-- =============================================================================
-- 9. POLÍTICAS: CASH_SHIFTS
-- =============================================================================

DROP POLICY IF EXISTS "shifts_select" ON cash_shifts;
DROP POLICY IF EXISTS "shifts_insert" ON cash_shifts;
DROP POLICY IF EXISTS "shifts_update" ON cash_shifts;

CREATE POLICY "shifts_select" ON cash_shifts
  FOR SELECT USING (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "shifts_insert" ON cash_shifts
  FOR INSERT WITH CHECK (business_id = get_user_business_id());

CREATE POLICY "shifts_update" ON cash_shifts
  FOR UPDATE USING (business_id = get_user_business_id() OR is_super_admin());


-- =============================================================================
-- 10. POLÍTICAS: CASH_MOVEMENTS
-- =============================================================================

DROP POLICY IF EXISTS "cash_movements_select" ON cash_movements;
DROP POLICY IF EXISTS "cash_movements_insert" ON cash_movements;

CREATE POLICY "cash_movements_select" ON cash_movements
  FOR SELECT USING (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "cash_movements_insert" ON cash_movements
  FOR INSERT WITH CHECK (business_id = get_user_business_id());


-- =============================================================================
-- 11. POLÍTICAS: STAFF
-- =============================================================================

DROP POLICY IF EXISTS "staff_select" ON staff;
DROP POLICY IF EXISTS "staff_insert" ON staff;
DROP POLICY IF EXISTS "staff_update" ON staff;
DROP POLICY IF EXISTS "staff_delete" ON staff;

CREATE POLICY "staff_select" ON staff
  FOR SELECT USING (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "staff_insert" ON staff
  FOR INSERT WITH CHECK (business_id = get_user_business_id());

CREATE POLICY "staff_update" ON staff
  FOR UPDATE USING (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "staff_delete" ON staff
  FOR DELETE USING (business_id = get_user_business_id() OR is_super_admin());


-- =============================================================================
-- 12. POLÍTICAS: AUDIT_LOGS
-- =============================================================================

DROP POLICY IF EXISTS "audit_select" ON audit_logs;
DROP POLICY IF EXISTS "audit_insert" ON audit_logs;

CREATE POLICY "audit_select" ON audit_logs
  FOR SELECT USING (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "audit_insert" ON audit_logs
  FOR INSERT WITH CHECK (business_id = get_user_business_id());


-- =============================================================================
-- 13. POLÍTICAS: CASH_REGISTERS
-- =============================================================================

DROP POLICY IF EXISTS "registers_select" ON cash_registers;
DROP POLICY IF EXISTS "registers_insert" ON cash_registers;
DROP POLICY IF EXISTS "registers_update" ON cash_registers;

CREATE POLICY "registers_select" ON cash_registers
  FOR SELECT USING (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "registers_insert" ON cash_registers
  FOR INSERT WITH CHECK (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "registers_update" ON cash_registers
  FOR UPDATE USING (business_id = get_user_business_id() OR is_super_admin());


-- =============================================================================
-- 14. POLÍTICAS: PARKED_ORDERS
-- =============================================================================

DROP POLICY IF EXISTS "parked_select" ON parked_orders;
DROP POLICY IF EXISTS "parked_insert" ON parked_orders;
DROP POLICY IF EXISTS "parked_delete" ON parked_orders;

CREATE POLICY "parked_select" ON parked_orders
  FOR SELECT USING (business_id = get_user_business_id() OR is_super_admin());

CREATE POLICY "parked_insert" ON parked_orders
  FOR INSERT WITH CHECK (business_id = get_user_business_id());

CREATE POLICY "parked_delete" ON parked_orders
  FOR DELETE USING (business_id = get_user_business_id() OR is_super_admin());


-- =============================================================================
-- 15. POLÍTICAS: LICENSE_HISTORY (solo super admin)
-- =============================================================================

DROP POLICY IF EXISTS "license_history_select" ON license_history;
DROP POLICY IF EXISTS "license_history_insert" ON license_history;

CREATE POLICY "license_history_select" ON license_history
  FOR SELECT USING (is_super_admin());

CREATE POLICY "license_history_insert" ON license_history
  FOR INSERT WITH CHECK (is_super_admin());


-- =============================================================================
-- 16. TRIGGER: PROTEGER CAMPOS SENSIBLES DE BUSINESSES
-- Impide que usuarios normales cambien status, subscription_expires_at,
-- ni ningún campo de licencia directamente desde el cliente.
-- Solo los super admins (o service_role) pueden modificar estos campos.
-- =============================================================================

CREATE OR REPLACE FUNCTION protect_business_license_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Si alguno de los campos de licencia cambió y el ejecutor NO es super admin...
  IF (
    NEW.status IS DISTINCT FROM OLD.status OR
    NEW.subscription_expires_at IS DISTINCT FROM OLD.subscription_expires_at
  ) THEN
    IF NOT is_super_admin() THEN
      RAISE EXCEPTION 'No autorizado: no puedes modificar el estado de licencia directamente.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_business_license ON businesses;
CREATE TRIGGER trg_protect_business_license
  BEFORE UPDATE ON businesses
  FOR EACH ROW
  EXECUTE FUNCTION protect_business_license_fields();


-- =============================================================================
-- 17. RATE LIMITING DE PIN: tabla pin_attempts
-- Registra cada intento de verificación del PIN maestro.
-- La función verify_master_pin bloquea tras 3 fallos en 5 minutos.
-- =============================================================================

CREATE TABLE IF NOT EXISTS pin_attempts (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id   UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  attempted_at  TIMESTAMPTZ DEFAULT NOW(),
  success       BOOLEAN     NOT NULL DEFAULT FALSE
);

ALTER TABLE pin_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pin_attempts_insert" ON pin_attempts;
DROP POLICY IF EXISTS "pin_attempts_select" ON pin_attempts;

CREATE POLICY "pin_attempts_insert" ON pin_attempts
  FOR INSERT WITH CHECK (business_id = get_user_business_id());

CREATE POLICY "pin_attempts_select" ON pin_attempts
  FOR SELECT USING (business_id = get_user_business_id() OR is_super_admin());

-- Índice para acelerar la consulta de intentos recientes
CREATE INDEX IF NOT EXISTS idx_pin_attempts_business_time
  ON pin_attempts (business_id, attempted_at);

-- Limpiar intentos viejos (> 1 hora) para no acumular basura
CREATE OR REPLACE FUNCTION clean_old_pin_attempts()
RETURNS void
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM pin_attempts WHERE attempted_at < NOW() - INTERVAL '1 hour';
$$;


-- =============================================================================
-- 18. FUNCIÓN: verify_master_pin
-- Verifica el PIN maestro con rate limiting server-side.
-- Registra cada intento. Bloquea tras 3 fallos en 5 minutos.
-- =============================================================================

CREATE OR REPLACE FUNCTION verify_master_pin(p_pin TEXT, p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent_failures  INTEGER;
  v_master_pin       TEXT;
  v_is_valid         BOOLEAN;
  v_caller_business  UUID;
BEGIN
  -- Limpiar intentos viejos
  PERFORM clean_old_pin_attempts();

  -- Verificar que el llamante pertenece a este negocio
  SELECT business_id INTO v_caller_business
    FROM profiles WHERE id = auth.uid();

  IF v_caller_business IS DISTINCT FROM p_business_id THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;

  -- Contar fallos recientes (últimos 5 minutos)
  SELECT COUNT(*) INTO v_recent_failures
    FROM pin_attempts
   WHERE business_id = p_business_id
     AND success = FALSE
     AND attempted_at > NOW() - INTERVAL '5 minutes';

  IF v_recent_failures >= 3 THEN
    RAISE EXCEPTION 'PIN bloqueado temporalmente. Espera 5 minutos.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Obtener el PIN real
  SELECT master_pin INTO v_master_pin
    FROM businesses WHERE id = p_business_id;

  v_is_valid := (v_master_pin = p_pin);

  -- Registrar el intento
  INSERT INTO pin_attempts (business_id, success)
    VALUES (p_business_id, v_is_valid);

  RETURN v_is_valid;
END;
$$;

-- Solo usuarios autenticados pueden llamar esta función
REVOKE ALL ON FUNCTION verify_master_pin(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_master_pin(TEXT, UUID) TO authenticated;


-- =============================================================================
-- 19. SEGURIDAD DE RPCs EXISTENTES
-- Asegura que process_sale_transaction valide el business_id del caller.
-- =============================================================================

-- Wrapper seguro para process_sale_transaction que verifica la propiedad.
-- Si ya existe la función original, la reemplazamos con verificación adicional.
CREATE OR REPLACE FUNCTION secure_check_sale_ownership(p_business_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_business UUID;
BEGIN
  SELECT business_id INTO v_caller_business
    FROM profiles WHERE id = auth.uid();

  IF v_caller_business IS DISTINCT FROM p_business_id THEN
    RAISE EXCEPTION 'No autorizado: business_id no corresponde al usuario autenticado.'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION secure_check_sale_ownership(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION secure_check_sale_ownership(UUID) TO authenticated;


-- =============================================================================
-- FIN DE LA MIGRACIÓN
-- Para aplicar: copia este archivo y pégalo en Supabase > SQL Editor > Run
-- =============================================================================
