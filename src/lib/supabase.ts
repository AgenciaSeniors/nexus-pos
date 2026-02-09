// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Faltan las variables de entorno de Supabase (.env.local)');
}

export const supabase = createClient(supabaseUrl, supabaseKey);

// 👇 ESTA LÍNEA ES LA CLAVE (Asegúrate de que esté aquí)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
//(window as any).supabase = supabase;