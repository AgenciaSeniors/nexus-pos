/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    // Inyecta la versión de package.json en tiempo de compilación
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'Bisne con Talla',
        short_name: 'Bisne',
        description: 'Sistema de Punto de Venta Offline-First',
        theme_color: '#0f172a',
        background_color: '#f8fafc',
        display: 'standalone', // Esto oculta la barra de URL del navegador
        orientation: 'landscape', // Fuerza horizontal (ideal para POS)
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ],
  base: './', // Importante para Electron o hosting relativo
  build: {
    rollupOptions: {
      output: {
        // Separar deps grandes en chunks dedicados para que la carga inicial
        // del POS no traiga recharts/xlsx (solo se necesitan en Finanzas/Inventario).
        // En conexiones lentas (típico CU), esto reduce ~600KB del first paint.
        manualChunks: {
          recharts: ['recharts'],
          supabase: ['@supabase/supabase-js'],
          dexie: ['dexie', 'dexie-react-hooks'],
          icons: ['lucide-react'],
        },
      },
    },
    // El bundle de FinancePage es naturalmente grande (gráficos + estadísticas).
    // Subir el límite del warning a 700KB evita falsos positivos sin tapar
    // crecimiento real del bundle.
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    globals: false,
  },
})