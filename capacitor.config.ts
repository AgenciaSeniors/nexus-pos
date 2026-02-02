import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.nexus.pos', // El ID que pusiste antes
  appName: 'BISNE CON TALLA',
  webDir: 'dist', // Vite genera la carpeta 'dist'
  server: {
    androidScheme: 'https' // Necesario para que funcione bien la API
  }
};

export default config;