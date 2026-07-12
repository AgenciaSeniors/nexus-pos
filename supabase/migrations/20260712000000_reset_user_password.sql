-- =============================================================================
-- NEXUS-POS: FUNCIÓN reset_user_password (Ejecutar en Supabase SQL Editor)
-- =============================================================================
-- El panel de Super Admin ("Restablecer Contraseña") llama a este RPC:
--
--     supabase.rpc('reset_user_password', {
--       target_user_id: <uuid>,
--       new_password:   <text>
--     })
--
-- Hasta ahora la función NO existía en la base de datos, por lo que la llamada
-- fallaba a nivel de red y el cliente mostraba "Failed to fetch".
--
-- Esta migración crea la función de forma SEGURA:
--   - SECURITY DEFINER: corre con privilegios del dueño para poder tocar
--     el schema `auth` (que el rol `authenticated` no puede modificar).
--   - Solo un super admin autenticado puede ejecutarla (defensa server-side,
--     no confía en el frontend).
--   - Cambia el hash bcrypt en auth.users usando pgcrypto, compatible con
--     el verificador de GoTrue (Supabase Auth) al iniciar sesión.
-- =============================================================================

-- pgcrypto provee crypt() y gen_salt() (bcrypt). En Supabase vive en `extensions`.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION reset_user_password(target_user_id UUID, new_password TEXT)
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

  -- 2. Validación mínima de la contraseña (espejo del check del cliente).
  IF new_password IS NULL OR length(new_password) < 6 THEN
    RAISE EXCEPTION 'La contraseña debe tener al menos 6 caracteres.'
      USING ERRCODE = '22023';
  END IF;

  -- 3. Actualizar el hash bcrypt en auth.users. gen_salt('bf', 10) genera un
  --    hash $2a$ con coste 10, que GoTrue verifica correctamente en el login.
  UPDATE auth.users
     SET encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf', 10)),
         updated_at         = NOW()
   WHERE id = target_user_id;

  -- 4. Si el usuario no existe, avisar en vez de fallar en silencio.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado.' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

-- Solo usuarios autenticados pueden invocarla; la propia función re-valida
-- que sean super admin. Nadie más (anon, public) tiene acceso.
REVOKE ALL ON FUNCTION reset_user_password(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reset_user_password(UUID, TEXT) TO authenticated;

-- =============================================================================
-- FIN DE LA MIGRACIÓN
-- Para aplicar: copia este archivo y pégalo en Supabase > SQL Editor > Run
-- =============================================================================
