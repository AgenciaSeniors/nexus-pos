/// <reference types="vite/client" />

interface Window {
  // Aquí definimos lo que expusimos en el preload.js
  electronAPI?: {
    getVersion: () => Promise<string>;
    printTicket: () => void;
  };
}