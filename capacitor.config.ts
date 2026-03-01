import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
appId: 'com.bisne.contalla',
  appName: 'Bisne con Talla',
  webDir: 'dist', 
  server: {
    androidScheme: 'https' 
  }
};

export default config;