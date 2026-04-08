import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(
    import.meta.url));

// ─── PERSISTENCIA DEL TAMAÑO Y POSICIÓN DE LA VENTANA ─────────────────────
const windowStatePath = () => path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
    try {
        return JSON.parse(fs.readFileSync(windowStatePath(), 'utf-8'));
    } catch {
        return { width: 1200, height: 800 };
    }
}

function saveWindowState(win) {
    try {
        if (win.isMaximized() || win.isFullScreen()) return; // no guardar en maximizado
        const bounds = win.getBounds();
        fs.writeFileSync(windowStatePath(), JSON.stringify(bounds), 'utf-8');
    } catch {}
}

function createWindow() {
    const saved = loadWindowState();
    const win = new BrowserWindow({
        width: saved.width || 1200,
        height: saved.height || 800,
        x: saved.x,
        y: saved.y,
        title: "Nexus POS",
        webPreferences: {
            nodeIntegration: false, // Bloqueamos acceso directo a Node (Seguridad)
            contextIsolation: true, // Aislamos el contexto (Seguridad)
            preload: path.join(__dirname, 'preload.js') // Cargamos el puente seguro
        }
    });

    // Guardar tamaño/posición al cerrar y al mover/redimensionar
    win.on('close', () => saveWindowState(win));
    let resizeTimer;
    win.on('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => saveWindowState(win), 500); });
    win.on('move',   () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => saveWindowState(win), 500); });

    const isDev = !app.isPackaged;

    if (isDev) {
        win.loadURL('http://localhost:5173');
        win.webContents.openDevTools(); // Abre la consola para depurar
    } else {
        win.loadFile(path.join(__dirname, '../dist/index.html'));
        // Bloquear DevTools en producción (F12, Ctrl+Shift+I, Ctrl+Shift+J)
        // Atajos de navegación: F1=POS, F2=Inventario, F4=Finanzas, F5=Clientes
        win.webContents.on('before-input-event', (event, input) => {
            if (input.key === 'F12') { event.preventDefault(); return; }
            if (input.control && input.shift && (input.key === 'I' || input.key === 'i')) { event.preventDefault(); return; }
            if (input.control && input.shift && (input.key === 'J' || input.key === 'j')) { event.preventDefault(); return; }
            if (input.control && input.shift && (input.key === 'C' || input.key === 'c')) { event.preventDefault(); return; }
            // Navegación por teclado (solo cuando no hay ningún input de texto activo)
            if (input.type === 'keyDown' && !input.control && !input.alt && !input.meta) {
                const navMap = { F1: '/', F2: '/inventario', F4: '/finanzas', F5: '/clientes' };
                if (navMap[input.key]) {
                    win.webContents.send('navigate', navMap[input.key]);
                    event.preventDefault();
                }
            }
        });
    }

    win.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
    // ─── CSP: Content Security Policy ────────────────────────────────────
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [
                    "default-src 'self'; " +
                    "script-src 'self'; " +
                    "style-src 'self' 'unsafe-inline'; " +
                    "img-src 'self' data: blob: https:; " +
                    "font-src 'self' data:; " +
                    "connect-src 'self' https://*.supabase.co wss://*.supabase.co; " +
                    "frame-src 'none'; " +
                    "object-src 'none'; " +
                    "base-uri 'self';"
                ]
            }
        });
    });

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