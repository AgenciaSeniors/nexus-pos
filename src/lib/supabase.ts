// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';
import { readSupabaseEnv } from './env';

const { url: supabaseUrl, key: supabaseKey, isValid, missing } = readSupabaseEnv();

// Red de seguridad: en la práctica main.tsx valida la config antes de importar
// la app, así que este throw casi nunca se alcanza. El mensaje es descriptivo
// para que, si se llega aquí, quede claro qué variable falta.
if (!isValid) {
  throw new Error(
    `Faltan variables de entorno de Supabase: ${missing.join(', ')} — revisa tu .env.local`
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,       // Guarda sesión en localStorage (sobrevive reinicios)
    autoRefreshToken: true,     // Renueva el access token automáticamente antes de expirar
    detectSessionInUrl: true,   // Detecta tokens de recuperación de contraseña en la URL
  }
});