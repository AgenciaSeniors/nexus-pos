/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __BUILD_ID__: string;

interface Window {
  // Aquí definimos lo que expusimos en el preload.js
  electronAPI?: {
    getVersion: () => Promise<string>;
    printTicket: () => void;
    printRaw?: (host: string, port: number, bytes: number[]) => Promise<{ ok: boolean; error?: string }>;
    onPrintResult: (callback: (success: boolean, errorType: string | null) => void) => void;
    onNavigate: (callback: (path: string) => void) => (() => void);
  };
}