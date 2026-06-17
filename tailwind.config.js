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
        // Inter para cuerpo y números (Body) — también el sans por defecto
        body: ['Inter', 'sans-serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        // Sombras tintadas de marca (navy) para una sensación premium y suave.
        card: '0 1px 2px rgba(11,59,104,0.04), 0 4px 12px rgba(11,59,104,0.06)',
        'card-hover': '0 10px 28px rgba(11,59,104,0.12)',
        modal: '0 24px 64px rgba(11,59,104,0.28)',
        'glow-green': '0 6px 20px rgba(122,193,66,0.30)',
        'glow-navy': '0 6px 20px rgba(11,59,104,0.25)',
      },
      backgroundImage: {
        'grad-navy': 'linear-gradient(135deg, #0B3B68 0%, #092b4d 100%)',
        'grad-green': 'linear-gradient(135deg, #7AC142 0%, #5a9d2e 100%)',
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