const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Función para pedir la versión de la app
    getVersion: () => ipcRenderer.invoke('get-version'),

    // Función para imprimir
    printTicket: () => ipcRenderer.send('print-ticket'),

    // Escucha el resultado de la impresión (success: bool, errorType: string|null)
    onPrintResult: (callback) => {
        ipcRenderer.on('print-ticket-result', (_event, success, errorType) => callback(success, errorType));
    }
});