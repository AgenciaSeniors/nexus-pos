/**
 * Verifica que la sesión actual tenga `is_super_admin = true` consultando
 * Supabase en vivo (no fiándose del estado local cargado al montar).
 *
 * Defensa en profundidad: el componente `<AdminRoute>` verifica al montar el
 * panel, pero si el flag se revoca durante la sesión, el frontend no lo detecta
 * hasta recargar. Esta función debe llamarse antes de cualquier operación
 * destructiva (suspend, delete, extend, reset password) para garantizar que el
 * usuario aún tiene permisos AHORA, no hace 5 minutos cuando entró al panel.
 *
 * No es sustituto de RLS server-side — es complemento. RLS es la barrera real;
 * esta función previene operaciones cliente que rompan la UI sin razón.
 */

import { supabase } from './supabase';

interface AuthResult {
  authorized: boolean;
  userId?: string;
  reason?: string;
}

let cachedAt = 0;
let cachedResult: AuthResult | null = null;
const CACHE_TTL_MS = 30_000; // 30 segundos — re-valida si pasaron más

/**
 * Verifica si el usuario actual es super_admin.
 *
 * @param forceFresh Si true, ignora el cache y consulta de inmediato.
 *                   Usar en operaciones destructivas.
 */
export async function requireSuperAdmin(forceFresh = true): Promise<AuthResult> {
  // Cache solo se usa cuando NO es destructivo (ej: condicional de UI)
  if (!forceFresh && cachedResult && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedResult;
  }

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      const result: AuthResult = { authorized: false, reason: 'Sesión expirada' };
      cachedResult = result;
      cachedAt = Date.now();
      return result;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('is_super_admin, status')
      .eq('id', user.id)
      .single();

    if (error) {
      return { authorized: false, userId: user.id, reason: 'No se pudo verificar permisos' };
    }
    if (!data?.is_super_admin) {
      return { authorized: false, userId: user.id, reason: 'No tienes permisos de administrador' };
    }
    if (data.status === 'suspended') {
      return { authorized: false, userId: user.id, reason: 'Tu cuenta está suspendida' };
    }

    const result: AuthResult = { authorized: true, userId: user.id };
    cachedResult = result;
    cachedAt = Date.now();
    return result;
  } catch (err) {
    return {
      authorized: false,
      reason: err instanceof Error ? err.message : 'Error de red al verificar permisos',
    };
  }
}

/**
 * Wrapper conveniente: ejecuta `fn()` solo si el usuario sigue siendo super_admin.
 * Si no, lanza un Error con el motivo (el caller lo captura y muestra toast).
 *
 * @example
 *   await withSuperAdmin(async () => {
 *     await supabase.from('businesses').update({status:'suspended'}).eq('id', x);
 *   });
 */
export async function withSuperAdmin<T>(fn: () => Promise<T>): Promise<T> {
  const auth = await requireSuperAdmin(true);
  if (!auth.authorized) {
    throw new Error(auth.reason || 'No autorizado');
  }
  return fn();
}

/**
 * Limpia el cache. Útil tras un logout o cuando se sabe que el flag cambió.
 */
export function clearSuperAdminCache(): void {
  cachedResult = null;
  cachedAt = 0;
}
