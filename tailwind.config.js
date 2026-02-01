/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // 1. PALETA DE COLORES "BISNE CON TALLA"
      colors: {
        // Verde Esmeralda Profundo (Crecimiento, Estabilidad)
        primary: {
          DEFAULT: '#005A3F',
          light: '#007A55', // Para hovers
          dark: '#003D2A', // Para textos oscuros o bordes
          50: '#E6F4F0', // Fondos muy claros
          100: '#C1E5D9',
        },
        // Amarillo Mostaza Vibrante (Energía, Optimismo)
        secondary: {
          DEFAULT: '#FFB800',
          light: '#FFC933',
          dark: '#E6A600',
          50: '#FFF8E6', // Fondos de alerta/badges
        },
        // Terracota (Acento, Calidez)
        accent: {
          DEFAULT: '#D35400',
          light: '#E67E22',
          50: '#FADBD8',
        },
        // Neutros del Manual
        cream: '#F4F4F0', // Fondo principal
        dark: '#2C3E50', // Gris Carbón para texto principal
        medium: '#7F8C8D', // Gris medio para texto secundario
      },
      // 2. TIPOGRAFÍA
      fontFamily: {
        // Montserrat para títulos (fuerza)
        heading: ['Montserrat', 'sans-serif'],
        // Roboto/Open Sans para cuerpo (legibilidad)
        body: ['Roboto', 'sans-serif'], 
      },
      // 3. BORDES REDONDEADOS (Amigables)
      borderRadius: {
        'xl': '1rem',
        '2xl': '1.5rem',
        '3xl': '2rem',
      }
    },
  },
  plugins: [],
}