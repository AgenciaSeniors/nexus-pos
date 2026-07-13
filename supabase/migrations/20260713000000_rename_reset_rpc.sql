-- =============================================================================
-- NEXUS-POS: Renombrar RPC de restablecer contraseña a un nombre neutro
-- =============================================================================
-- El RPC anterior se llamaba `reset_user_password`, por lo que su URL era
--   /rest/v1/rpc/reset_user_password
-- Los bloqueadores/adblockers, extensiones de privacidad y algunos antivirus
-- CANCELAN peticiones cuya URL contiene "password"/"reset" (el navegador
-- reporta ERR_BLOCKED_BY_CLIENT, que en la app aparecía como "Failed to fetch").
--
-- Solución: exponer exactamente la misma lógica bajo un nombre neutro que
-- ningún filtro reconozca. La función es idéntica en comportamiento; solo
-- cambian el nombre y los parámetros.
--
-- El frontend ahora llama:
--   supabase.rpc('admin_update_member_access', {
--     p_member_id: <uuid>,
--     p_new_access: <text>
--   })
-- =============================================================================

-- pgcrypto provee crypt() y gen_salt() (bcrypt). En Supabase vive en `extensions`.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION admin_update_member_access(p_member_id UUID, p_new_access TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- 1. Solo un super admin puede restablecer contraseñas ajenas.
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'No autorizado: solo un super admin puede restablecer contraseñas.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Validación mínima (espejo del check del cliente).
  IF p_new_access IS NULL OR length(p_new_access) < 6 THEN
    RAISE EXCEPTION 'La contraseña debe tener al menos 6 caracteres.'
      USING ERRCODE = '22023';
  END IF;

  -- 3. Actualizar el hash bcrypt en auth.users. gen_salt('bf', 10) genera un
  --    hash $2a$ con coste 10, que GoTrue verifica correctamente en el login.
  UPDATE auth.users
     SET encrypted_password = extensions.crypt(p_new_access, extensions.gen_salt('bf', 10)),
         updated_at         = NOW()
   WHERE id = p_member_id;

  -- 4. Si el usuario no existe, avisar en vez de fallar en silencio.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado.' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

-- Solo usuarios autenticados pueden invocarla; la propia función re-valida
-- que sean super admin.
REVOKE ALL ON FUNCTION admin_update_member_access(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_update_member_access(UUID, TEXT) TO authenticated;

-- Eliminar la función anterior con nombre bloqueable (ya no se usa).
DROP FUNCTION IF EXISTS reset_user_password(UUID, TEXT);

-- =============================================================================
-- FIN DE LA MIGRACIÓN
-- Para aplicar: copia este archivo y pégalo en Supabase > SQL Editor > Run
-- =============================================================================
