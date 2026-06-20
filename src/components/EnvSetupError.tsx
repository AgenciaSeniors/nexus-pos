// src/components/EnvSetupError.tsx
// Pantalla a prueba de fallos que se muestra cuando faltan las variables de
// entorno de Supabase, en lugar de dejar la app en blanco. Es puramente visual
// y no depende del cliente de Supabase ni de la capa de datos.
import { AlertTriangle } from 'lucide-react';

interface EnvSetupErrorProps {
  /** Variables que faltan (en convención Vite), de readSupabaseEnv(). */
  missing: string[];
}

export function EnvSetupError({ missing }: EnvSetupErrorProps) {
  const envExample = [
    'VITE_SUPABASE_URL=https://TU_PROYECTO.supabase.co',
    'VITE_SUPABASE_ANON_KEY=eyJ...tu_anon_key',
  ].join('\n');

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F3F4F6] p-4 antialiased">
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl ring-1 ring-black/5 overflow-hidden">
        <div className="bg-gradient-to-br from-[#0B3B68] to-[#092b4d] px-6 py-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10">
            <AlertTriangle className="h-5 w-5 text-amber-300" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">Falta configuración</h1>
            <p className="text-sm text-white/70">No se pudo conectar con Supabase</p>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4 text-[#1F2937]">
          <p className="text-sm">
            La aplicación no encuentra estas variables de entorno
            {missing.length === 1 ? '' : 's'}:
          </p>

          <ul className="space-y-1">
            {missing.map((name) => (
              <li
                key={name}
                className="font-mono text-sm rounded-md bg-red-50 text-red-700 px-3 py-1.5 ring-1 ring-red-100"
              >
                {name}
              </li>
            ))}
          </ul>

          <div className="space-y-2">
            <p className="text-sm font-semibold text-[#0B3B68]">
              Cómo solucionarlo
            </p>
            <ol className="list-decimal pl-5 text-sm space-y-1.5 text-gray-600">
              <li>
                Crea (o edita) el archivo <code className="font-mono text-[#0B3B68]">.env.local</code> en la
                raíz del proyecto.
              </li>
              <li>Agrega tus valores reales:</li>
            </ol>

            <pre className="rounded-lg bg-[#0B3B68] text-green-200 text-xs sm:text-sm font-mono px-4 py-3 overflow-x-auto whitespace-pre">
{envExample}
            </pre>

            <ol className="list-decimal pl-5 text-sm space-y-1.5 text-gray-600" start={3}>
              <li>
                Guarda y <strong>reinicia el servidor</strong> (<code className="font-mono">Ctrl + C</code> y
                de nuevo <code className="font-mono">npm run dev</code>): Vite solo lee el
                {' '}<code className="font-mono">.env</code> al arrancar.
              </li>
            </ol>
          </div>

          <p className="text-xs text-gray-400 border-t border-gray-100 pt-3">
            También se aceptan nombres <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> y{' '}
            <code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> como respaldo. Los valores los
            obtienes del panel de Supabase → Settings → API.
          </p>
        </div>
      </div>
    </div>
  );
}
