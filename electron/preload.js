const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Función para pedir la versión de la app
    getVersion: () => ipcRenderer.invoke('get-version'),

    // Función para imprimir (la usaremos más adelante)
    printTicket: (content) => ipcRenderer.send('print-ticket', content)
});