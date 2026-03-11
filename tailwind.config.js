/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Colores Primarios del Manual
        bisne: {
          navy: '#0B3B68',   // Azul Profundo (Barras laterales, textos fuertes)
          blue: '#3B82F6',   // Azul Información
        },
        talla: {
          growth: '#7AC142', // Verde Vibrante (Botones, dinero, éxito)
          dark: '#5a962e',   // Verde un poco más oscuro para hover
        },
        // Colores Semánticos y Neutros personalizados
        surface: '#FFFFFF',
        background: '#F3F4F6', // Gris suave de fondo
        text: {
          main: '#1F2937',      // Gris casi negro (Legibilidad)
          secondary: '#6B7280', // Gris medio (Metadatos)
        },
        state: {
          error: '#EF4444',
          warning: '#F59E0B',
          success: '#7AC142',
        }
      },
      fontFamily: {
        // Montserrat para encabezados (Headings)
        heading: ['Montserrat', 'sans-serif'],
        // Inter para cuerpo y números (Body)
        body: ['Inter', 'sans-serif'],
      }
    },
  },
  plugins: [
    function({ addUtilities }) {
      addUtilities({
        '.pt-safe': { 'padding-top': 'env(safe-area-inset-top, 0px)' },
        '.pb-safe': { 'padding-bottom': 'env(safe-area-inset-bottom, 0px)' },
        '.pl-safe': { 'padding-left': 'env(safe-area-inset-left, 0px)' },
        '.pr-safe': { 'padding-right': 'env(safe-area-inset-right, 0px)' },
        '.mt-safe': { 'margin-top': 'env(safe-area-inset-top, 0px)' },
        '.mb-safe': { 'margin-bottom': 'env(safe-area-inset-bottom, 0px)' },
      });
    }
  ],
}