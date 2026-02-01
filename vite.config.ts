import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'Nexus POS System',
        short_name: 'NexusPOS',
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
})