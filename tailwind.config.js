/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Colores Senio (tomados de los píxeles reales del logo)
        bisne: {
          navy: '#0040FC',   // Azul Senio (barras laterales, botones, textos fuertes)
          blue: '#3B82F6',   // Azul Información
        },
        talla: {
          growth: '#16A34A', // Verde de éxito (dinero, confirmaciones)
          dark: '#15803D',   // Verde de éxito más oscuro (texto, hover)
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
          success: '#16A34A',
        }
      },
      fontFamily: {
        // Montserrat para encabezados (Headings)
        heading: ['Montserrat', 'sans-serif'],
        // Inter para cuerpo y números (Body) — también el sans por defecto
        body: ['Inter', 'sans-serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        // Sombras tintadas de marca (azul Senio) para una sensación premium y suave.
        card: '0 1px 2px rgba(0,64,252,0.04), 0 4px 12px rgba(0,64,252,0.06)',
        'card-hover': '0 10px 28px rgba(0,64,252,0.12)',
        modal: '0 24px 64px rgba(0,64,252,0.28)',
        'glow-green': '0 6px 20px rgba(22,163,74,0.30)',
        'glow-navy': '0 6px 20px rgba(0,64,252,0.25)',
      },
      backgroundImage: {
        'grad-navy': 'linear-gradient(135deg, #0040FC 0%, #0030CC 100%)',
        'grad-green': 'linear-gradient(135deg, #16A34A 0%, #15803D 100%)',
      },
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