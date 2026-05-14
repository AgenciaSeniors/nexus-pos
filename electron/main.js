import { app, BrowserWindow, ipcMain, session, shell, Menu } from 'electron';
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

    // ─── NAVEGACIÓN SEGURA ───────────────────────────────────────────────
    // 1. Cualquier link target="_blank" o window.open() abre en el navegador del SO,
    //    no en una BrowserWindow nueva con permisos Electron (que sería un agujero
    //    de seguridad). Esto incluye los links de WhatsApp del Layout.
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https://') || url.startsWith('http://') || url.startsWith('mailto:') || url.startsWith('tel:')) {
            shell.openExternal(url).catch(err => console.error('openExternal falló:', err));
        }
        return { action: 'deny' };
    });

    // 2. Bloquear navegación a URLs externas dentro de la ventana principal.
    //    La app es una SPA con hash routing; cualquier cambio de origen es sospechoso.
    win.webContents.on('will-navigate', (event, navigationUrl) => {
        const isLocalhost = navigationUrl.startsWith('http://localhost:5173');
        const isFileProtocol = navigationUrl.startsWith('file://');
        if (!isLocalhost && !isFileProtocol) {
            event.preventDefault();
            // Si parece un link externo legítimo, abrirlo en el navegador
            if (navigationUrl.startsWith('https://') || navigationUrl.startsWith('http://')) {
                shell.openExternal(navigationUrl).catch(() => {});
            }
        }
    });

    // 3. Bloquear creación de webview embebidos (otra vía de XSS)
    win.webContents.on('will-attach-webview', (event) => {
        event.preventDefault();
    });

    const isDev = !app.isPackaged;

    if (isDev) {
        win.loadURL('http://localhost:5173');
        win.webContents.openDevTools(); // Abre la consola para depurar
    } else {
        win.loadFile(path.join(__dirname, '../dist/index.html'));
        // Bloquear DevTools en producción de forma robusta:
        // 1. Atajos de teclado (F12, Ctrl+Shift+I/J/C)
        // 2. Cerrar DevTools si por algún camino se abren (menú contextual, etc.)
        // 3. Bloquear recargas no deseadas (Ctrl+R, Ctrl+Shift+R) que pueden
        //    confundirse con re-mount de la app después de mutaciones
        win.webContents.on('devtools-opened', () => win.webContents.closeDevTools());

        // Atajos de navegación: F1=POS, F2=Inventario, F4=Finanzas, F5=Clientes
        win.webContents.on('before-input-event', (event, input) => {
            if (input.key === 'F12') { event.preventDefault(); return; }
            if (input.control && input.shift && (input.key === 'I' || input.key === 'i')) { event.preventDefault(); return; }
            if (input.control && input.shift && (input.key === 'J' || input.key === 'j')) { event.preventDefault(); return; }
            if (input.control && input.shift && (input.key === 'C' || input.key === 'c')) { event.preventDefault(); return; }
            if (input.control && input.shift && (input.key === 'R' || input.key === 'r')) { event.preventDefault(); return; }
            // Navegación por teclado (solo cuando no hay ningún input de texto activo)
            if (input.type === 'keyDown' && !input.control && !input.alt && !input.meta) {
                const navMap = { F1: '/', F2: '/inventario', F4: '/finanzas', F5: '/clientes' };
                if (navMap[input.key]) {
                    win.webContents.send('navigate', navMap[input.key]);
                    event.preventDefault();
                }
            }
        });

        // Eliminar el menú nativo en producción (no hay "View → Reload",
        // "View → Toggle Developer Tools", etc.). Una capa más de defensa.
        Menu.setApplicationMenu(null);
    }

    win.setMenuBarVisibility(false);

    // ─── BLOQUEO DE PERMISOS NO SOLICITADOS ──────────────────────────────
    // Cualquier API que pida permiso (notifications, geolocation, mic, camera...)
    // se rechaza por defecto. La app POS no necesita ninguno de estos.
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => {
        callback(false);
    });
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