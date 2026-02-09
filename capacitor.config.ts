import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.bisne.contalla', // El ID que pusiste antes
  appName: 'Bisne con Talla',
  webDir: 'dist', // Vite genera la carpeta 'dist'
  server: {
    androidScheme: 'https' // Necesario para que funcione bien la API
  }
};

export default config;