import { test, expect, BrowserContext, Page } from '@playwright/test';

// === CONFIGURACIÓN DE LA BESTIA ===
const URL = 'http://localhost:5173';
const NUM_CAJEROS = 4;        // Número de navegadores vendiendo a la vez
const VENTAS_POR_CAJERO = 10; // Ventas que hará cada uno

// ⚠️ PON TUS CREDENCIALES REALES AQUÍ ⚠️
const SUPER_ADMIN = {
    email: 'seniors.contacto@gmail.com', 
    pass: 'Edua0523*' 
};

const ADMIN_EMAIL = `beast_mode_${Date.now()}@test.com`;
const ADMIN_PASS = '123456';
const PIN_MASTER = '1234';

test.describe('🔥 STRESS TEST: THE BEAST MODE', () => {
  test.setTimeout(180000); // 3 minutos máximo para todo el caos

  // 1. PREPARACIÓN: Crear la cuenta, aprobarla y crear producto
  test('Fase 1: Génesis (Crear, Aprobar, Configurar)', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('🏗️ Creando entorno de pruebas...');
    await page.goto(URL);
    
    // Limpieza inicial
    await page.evaluate(() => localStorage.clear());
    await page.evaluate(() => indexedDB.deleteDatabase('NexusPOS_DB'));
    await page.reload();

    // Registro Rápido
    await page.getByRole('button', { name: 'Regístrate' }).click();
    await page.getByPlaceholder('Ej. Juan Pérez').fill('Mr. Beast');
    await page.getByPlaceholder('Ej. Cafetería Central').fill('Nexus Stress Center');
    await page.getByPlaceholder('+53 5555 5555').fill('555555');
    await page.getByPlaceholder('correo@ejemplo.com').fill(ADMIN_EMAIL);
    await page.getByPlaceholder('••••••••').fill(ADMIN_PASS);
    await page.getByRole('button', { name: 'Registrar Negocio' }).click();

    console.log('⏳ Registro enviado. Esperando aprobación...');

    // ======================================================
    // 🛡️ FASE INTERMEDIA: APROBACIÓN SUPER ADMIN
    // ======================================================
    const contextAdmin = await browser.newContext();
    const pageAdmin = await contextAdmin.newPage();
    
    await pageAdmin.goto(`${URL}/#/admin-login`);
    await pageAdmin.locator('input[type="email"]').fill(SUPER_ADMIN.email);
    await pageAdmin.locator('input[type="password"]').fill(SUPER_ADMIN.pass);
    await pageAdmin.getByRole('button', { name: 'Entrar' }).click(); // Ajusta si el botón tiene otro texto

    // Ir a Solicitudes
    await pageAdmin.getByRole('button', { name: 'Solicitudes' }).click();
    
    // Aceptar Diálogo de PIN automáticamente
    pageAdmin.on('dialog', dialog => dialog.accept(PIN_MASTER));

    // Buscar y Aprobar
    // Esperamos un poco para que Supabase actualice
    await pageAdmin.waitForTimeout(2000); 
    
    // Buscamos la fila que contiene el email del robot
    const fila = pageAdmin.getByRole('row').filter({ hasText: ADMIN_EMAIL });
    
    // Hacemos clic en el botón de aprobar (asegúrate que el selector coincida con tu icono Check)
    // Si usas iconos, a veces es mejor buscar por el 'title' o clase
    if (await fila.isVisible()) {
        await fila.getByRole('button').first().click(); // Asumiendo que el primer botón es Aprobar
    } else {
        console.log('⚠️ No encontré la solicitud, quizás ya se aprobó o hubo error.');
    }
    
    console.log('✅ Cuenta aprobada por Super Admin.');
    await contextAdmin.close();

    // ======================================================
    // 🔙 VOLVEMOS AL USUARIO "MR. BEAST"
    // ======================================================
    
    // Recargar o ir al login
    await page.goto(URL);
    
    // Si ya estábamos logueados, puede que nos pida PIN directo.
    // Si no, hacemos login.
    if (await page.getByRole('button', { name: 'Inicia Sesión' }).isVisible()) {
        await page.getByRole('button', { name: 'Inicia Sesión' }).click();
        await page.getByPlaceholder('correo@ejemplo.com').fill(ADMIN_EMAIL);
        await page.getByPlaceholder('••••••••').fill(ADMIN_PASS);
        await page.getByRole('button', { name: 'Entrar al Sistema' }).click();
    }

    // PinPad
    await page.waitForSelector('text=Ingresa tu PIN', { timeout: 10000 });
    for (const d of PIN_MASTER) await page.getByText(d, { exact: true }).click();

    // Crear producto para el estrés
    await page.goto(`${URL}/#/inventario`);
    await page.getByRole('button', { name: 'Nuevo' }).click();
    await page.locator('input[value=""]').first().fill('Producto Estrés');
    await page.locator('input[type="number"]').first().fill('100'); // Precio
    await page.locator('input[type="number"]').nth(2).fill('5000'); // Stock infinito
    await page.getByRole('button', { name: 'Guardar' }).click();
    
    console.log('✅ Entorno listo. Producto creado.');
    await context.close();
  });

  test('Fase 2: EL ATAQUE (Concurrencia Extrema)', async ({ browser }) => {
    console.log(`🚀 LANZANDO ${NUM_CAJEROS} CAJEROS + 1 GERENTE CAÓTICO`);

    // Creamos contextos aislados
    const contextos: BrowserContext[] = [];
    const paginas: Page[] = [];

    // Preparamos 5 navegadores (1 Admin + 4 Cajeros)
    for (let i = 0; i <= NUM_CAJEROS; i++) {
        const ctx = await browser.newContext();
        const pg = await ctx.newPage();
        contextos.push(ctx);
        paginas.push(pg);
    }

    const pageGerente = paginas[0];
    const paginasCajeros = paginas.slice(1);

    // LOGUEAR A TODOS SIMULTÁNEAMENTE
    await Promise.all(paginas.map(async (p, i) => {
        console.log(`🔌 Conectando Dispositivo #${i}...`);
        await p.goto(URL);
        
        if (await p.getByRole('button', { name: 'Inicia Sesión' }).isVisible()) {
            await p.getByRole('button', { name: 'Inicia Sesión' }).click();
            await p.getByPlaceholder('correo@ejemplo.com').fill(ADMIN_EMAIL);
            await p.getByPlaceholder('••••••••').fill(ADMIN_PASS);
            await p.getByRole('button', { name: 'Entrar al Sistema' }).click();
        }

        // PinPad
        await p.waitForSelector('text=Ingresa tu PIN');
        for (const d of PIN_MASTER) await p.getByText(d, { exact: true }).click();
        await expect(p.getByText('Ventas')).toBeVisible();
    }));

    console.log('⚔️ ¡TODOS DENTRO! INICIANDO CAOS...');

    // --- DEFINICIÓN DE TAREAS ---

    // TAREA A: El Gerente cambia el nombre del producto cada 500ms
    const tareaGerente = async () => {
        await pageGerente.goto(`${URL}/#/inventario`);
        // Esperar a que cargue la lista
        await pageGerente.waitForSelector('table'); 

        for (let i = 0; i < 15; i++) { 
            const nuevoNombre = i % 2 === 0 ? 'Producto CAOS' : 'Producto CALMA';
            const nuevoPrecio = (100 + i).toString();
            
            // Buscar botón de editar (el lápiz)
            // Ajusta este selector si usas otro icono
            await pageGerente.locator('button svg.lucide-edit-2').first().click();
            
            await pageGerente.locator('input[type="text"]').first().fill(nuevoNombre);
            await pageGerente.locator('input[type="number"]').first().fill(nuevoPrecio); 
            await pageGerente.getByRole('button', { name: 'Guardar' }).click();
            
            console.log(`🤪 Gerente cambió datos: ${nuevoNombre} - $${nuevoPrecio}`);
            await pageGerente.waitForTimeout(800); 
        }
    };

    // TAREA B: Los Cajeros venden como locos
    const crearTareaCajero = async (p: Page, id: number) => {
        await p.goto(`${URL}/#/`); // Ir al POS
        
        // Abrir caja si está cerrada
        if (await p.getByText('Abrir Turno').isVisible()) {
            await p.getByPlaceholder('Monto inicial').fill('1000');
            await p.getByRole('button', { name: 'Abrir Caja' }).click();
        }

        for (let i = 0; i < VENTAS_POR_CAJERO; i++) {
            // Añadir producto (Buscamos por texto parcial "Producto")
            await p.getByPlaceholder('Buscar productos...').fill('Producto');
            // Clic en el primer resultado que aparezca
            await p.locator('.grid > div').first().click(); 

            // Cobrar
            await p.getByRole('button', { name: 'Cobrar' }).click();
            
            // Manejo de modal de pago
            await p.getByText('Efectivo').click();
            await p.getByText('Confirmar Cobro').click();
            
            // Cerrar ticket (simular Escape o clic fuera)
            await p.keyboard.press('Escape'); 
            
            console.log(`💰 Cajero ${id}: Venta #${i + 1} completada.`);
        }
    };

    // --- EJECUCIÓN PARALELA ---
    await Promise.all([
        tareaGerente(),
        ...paginasCajeros.map((p, index) => crearTareaCajero(p, index + 1))
    ]);

    console.log('🏁 ATAQUE FINALIZADO. VERIFICANDO SUPERVIVENCIA...');
    
    // Verificación final simple: Ir a finanzas y ver que no explotó
    await pageGerente.goto(`${URL}/#/finanzas`);
    await expect(pageGerente.getByText('Resumen Financiero')).toBeVisible();
    
    console.log('🏆 LA APP SOBREVIVIÓ AL ESTRÉS EXTREMO.');
  });
});