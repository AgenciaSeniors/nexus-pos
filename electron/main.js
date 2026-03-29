import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(
    import.meta.url));

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        title: "Nexus POS",
        webPreferences: {
            nodeIntegration: false, // Bloqueamos acceso directo a Node (Seguridad)
            contextIsolation: true, // Aislamos el contexto (Seguridad)
            preload: path.join(__dirname, 'preload.js') // Cargamos el puente seguro
        }
    });

    const isDev = !app.isPackaged;

    if (isDev) {
        win.loadURL('http://localhost:5173');
        win.webContents.openDevTools(); // Abre la consola para depurar
    } else {
        win.loadFile(path.join(__dirname, '../dist/index.html'));
        // Bloquear DevTools en producción (F12, Ctrl+Shift+I, Ctrl+Shift+J)
        win.webContents.on('before-input-event', (event, input) => {
            if (input.key === 'F12') { event.preventDefault(); return; }
            if (input.control && input.shift && (input.key === 'I' || input.key === 'i')) { event.preventDefault(); return; }
            if (input.control && input.shift && (input.key === 'J' || input.key === 'j')) { event.preventDefault(); return; }
            if (input.control && input.shift && (input.key === 'C' || input.key === 'c')) { event.preventDefault(); return; }
        });
    }

    win.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
    createWindow();

    // 1. Obtener versión
    ipcMain.handle('get-version', () => app.getVersion());

    // 2. Manejar impresión (LÓGICA IMPLEMENTADA)
    ipcMain.on('print-ticket', (event) => {
        console.log("🖨️ Imprimiendo ticket...");

        const options = {
            silent: true, // true = Imprime directo (sin cuadro de diálogo).
            printBackground: true, // IMPORTANTE: Para que se vean los estilos del ticket
            color: false // Optimizado para impresoras térmicas (B/N)
        };

        // event.sender es la ventana que envió la orden
        event.sender.print(options, (success, errorType) => {
            if (!success) console.log("❌ Error de impresión:", errorType);
            else console.log("✅ Impresión enviada correctamente");
            // Notificar al renderer para mostrar toast al usuario
            event.sender.send('print-ticket-result', success, errorType || null);
        });
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});