// src/lib/env.ts
// Lectura centralizada de las variables de entorno de Supabase.
// IMPORTANTE: este módulo NO importa @supabase/supabase-js, por lo que puede
// usarse en main.tsx para validar la configuración ANTES de montar la app,
// sin disparar el cliente (y sin riesgo de pantalla en blanco).

export interface SupabaseEnv {
  url: string;
  key: string;
  isValid: boolean;
  /** Nombres de las variables que faltan (en convención Vite). */
  missing: string[];
}

/**
 * Lee la URL y la anon key de Supabase. Acepta los nombres de Vite
 * (`VITE_*`) y, como respaldo, los de Next.js (`NEXT_PUBLIC_*`) para que un
 * `.env.local` heredado de otro proyecto siga funcionando.
 */
export function readSupabaseEnv(): SupabaseEnv {
  const e = import.meta.env as unknown as Record<string, string | undefined>;

  const url = e.VITE_SUPABASE_URL ?? e.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = e.VITE_SUPABASE_ANON_KEY ?? e.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

  const missing: string[] = [];
  if (!url) missing.push('VITE_SUPABASE_URL');
  if (!key) missing.push('VITE_SUPABASE_ANON_KEY');

  return { url, key, isValid: missing.length === 0, missing };
}
