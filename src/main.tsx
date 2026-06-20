import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { readSupabaseEnv } from './lib/env'

const root = createRoot(document.getElementById('root')!)
const env = readSupabaseEnv()

// Validamos la configuración ANTES de importar App. App importa el cliente de
// Supabase, que lanza un error en tiempo de import si faltan las variables; con
// el import dinámico evitamos ese crash y mostramos una pantalla clara.
if (!env.isValid) {
  import('./components/EnvSetupError').then(({ EnvSetupError }) =>
    root.render(
      <StrictMode>
        <EnvSetupError missing={env.missing} />
      </StrictMode>,
    ),
  )
} else {
  import('./App.tsx').then(({ default: App }) =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  )
}