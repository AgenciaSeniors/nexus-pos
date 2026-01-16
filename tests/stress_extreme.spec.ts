import { test, expect, Page } from '@playwright/test';

// ==========================================
// ⚙️ CONFIGURACIÓN DEL CAOS
// ==========================================
const URL = 'http://localhost:5173';
const TIMEOUT_GLOBAL = 300_000; // 5 minutos totales
const NUM_CAJEROS = 4;          // Cajeros simultáneos
const VENTAS_POR_CAJERO = 10;   // Ventas por cada cajero
const PRODUCTOS_A_CREAR = 10;   // Productos base

// 🔐 CREDENCIALES
const SUPER_ADMIN = {
    email: 'seniors.contacto@gmail.com', 
    pass: 'Edua0523*' 
};

// Credenciales únicas para esta ejecución
const NEW_BIZ_EMAIL = `chaos_${Date.now()}@bomb.com`;
const NEW_BIZ_PASS = '123456';
const PIN = '1234';

// Ejecución Serial Obligatoria (Génesis -> Ataque)
test.describe.serial('💣 NEXUS POS: BOMB MODE STRESS TEST', () => {
  test.setTimeout(TIMEOUT_GLOBAL);

  // ==========================================
  // FASE 1: PREPARACIÓN DEL TERRENO
  // ==========================================
  test('GÉNESIS: Creación de Negocio y Datos Masivos', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log(`\n🔥 INICIANDO MODO BOMBA: ${NEW_BIZ_EMAIL}`);
    
    // 1. Limpieza y Registro
    await page.goto(URL);
    await page.evaluate(() => localStorage.clear());
    await page.evaluate(() => { if(window.indexedDB) window.indexedDB.deleteDatabase('NexusPOS_DB'); });
    await page.reload();

    console.log('📝 Registrando nuevo negocio...');
    await page.getByRole('button', { name: 'Regístrate' }).click();
    await page.getByPlaceholder('Ej. Juan Pérez').fill('Chaos Master');
    await page.getByPlaceholder('Ej. Cafetería Central').fill('Bar La Resistencia');
    await page.getByPlaceholder('+53 5555 5555').fill('666666');
    await page.getByPlaceholder('correo@ejemplo.com').fill(NEW_BIZ_EMAIL);
    await page.getByPlaceholder('••••••••').fill(NEW_BIZ_PASS);
    await page.getByRole('button', { name: 'Enviar Solicitud' }).click(); // O 'Registrar' según tu texto actual

    // Esperar confirmación visual
    // Aceptamos cualquier variante de texto de éxito
    await expect(page.locator('text=Solicitud')).toBeVisible({ timeout: 15000 });
    console.log('✅ Solicitud enviada. Esperando propagación DB...');
    
    await page.waitForTimeout(3000); 

    // 2. Aprobación por Super Admin
    console.log('👮 Solicitando aprobación del Super Admin...');
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    
    await adminPage.goto(`${URL}/#/admin-login`);
    await adminPage.locator('input[type="email"]').fill(SUPER_ADMIN.email);
    await adminPage.locator('input[type="password"]').fill(SUPER_ADMIN.pass);
    await adminPage.getByRole('button', { name: 'Entrar' }).click();
    
    await adminPage.getByRole('button', { name: 'Solicitudes' }).click();
    
    // Auto-aceptar alertas
    adminPage.on('dialog', d => d.accept(PIN));

    // Bucle de búsqueda resiliente
    let aprobado = false;
    for(let i=0; i<10; i++) {
        console.log(`🔎 Buscando solicitud (Intento ${i+1}/10)...`);
        await adminPage.waitForTimeout(2000);
        
        const row = adminPage.getByRole('row').filter({ hasText: NEW_BIZ_EMAIL });
        
        if (await row.count() > 0 && await row.isVisible()) {
            console.log('✅ Usuario encontrado. Aprobando...');
            await row.getByRole('button').first().click();
            aprobado = true;
            break;
        } else {
            console.log('⚠️ No aparece. Recargando panel...');
            await adminPage.reload();
            await adminPage.waitForTimeout(1000);
            if (await adminPage.getByRole('button', { name: 'Solicitudes' }).isVisible()) {
                 await adminPage.getByRole('button', { name: 'Solicitudes' }).click();
            }
        }
    }
    
    expect(aprobado, '❌ El Admin no encontró la solicitud.').toBeTruthy();
    await adminContext.close();

    // 3. Login y Creación de Inventario (CORREGIDO)
    console.log('📦 Iniciando sesión como cliente aprobado...');
    await page.bringToFront();
    
    // FORZAR RECARGA para asegurar estado limpio
    await page.reload();
    await page.waitForTimeout(1000);

    // Lógica explícita de Login (Sin depender de botones toggle)
    // Si vemos el campo de password, es que estamos en login o registro.
    // Llenamos los datos directamente.
    await page.getByPlaceholder('correo@ejemplo.com').fill(NEW_BIZ_EMAIL);
    await page.getByPlaceholder('••••••••').fill(NEW_BIZ_PASS);
    
    // Buscamos el botón "Entrar" explícitamente
    const botonEntrar = page.getByRole('button', { name: 'Entrar' });
    
    if (await botonEntrar.isVisible()) {
        await botonEntrar.click();
    } else {
        // Si no está visible, quizás estamos en modo registro?
        // Intentamos cambiar a login solo si es necesario
        if (await page.getByRole('button', { name: 'Inicia Sesión' }).isVisible()) {
            await page.getByRole('button', { name: 'Inicia Sesión' }).click();
            await page.getByPlaceholder('correo@ejemplo.com').fill(NEW_BIZ_EMAIL);
            await page.getByPlaceholder('••••••••').fill(NEW_BIZ_PASS);
            await page.getByRole('button', { name: 'Entrar' }).click();
        }
    }

    // Esperar PinPad
    console.log('🔢 Esperando PinPad...');
    await page.waitForSelector('text=Ingresa tu PIN', { timeout: 60000 });
    for (const d of PIN) await page.getByText(d, { exact: true }).click();

    // Crear Productos
    console.log(`🏭 Creando ${PRODUCTOS_A_CREAR} productos...`);
    await page.goto(`${URL}/#/inventario`);
    
    for (let i = 0; i < PRODUCTOS_A_CREAR; i++) {
        const prodName = `Item-${i}`;
        const prodPrice = 10 + i;
        const prodStock = 1000;

        await page.getByRole('button', { name: 'Nuevo' }).click();
        const textInputs = page.locator('input[type="text"]');
        const numberInputs = page.locator('input[type="number"]');
        
        await textInputs.first().fill(prodName); 
        await numberInputs.nth(0).fill(prodPrice.toString()); 
        await numberInputs.nth(1).fill('5'); 
        await numberInputs.nth(2).fill(prodStock.toString()); 
        
        await page.getByRole('button', { name: 'Guardar' }).click();
        await page.waitForTimeout(50); 
    }
    
    console.log(`✅ Inventario listo.`);
    await context.close();
  });

  // ==========================================
  // FASE 2: EL APOCALIPSIS (VENTAS CONCURRENTES)
  // ==========================================
  test('ATAQUE: Ventas Concurrentes + Caos de Red + Edición Admin', async ({ browser }) => {
    console.log('\n⚔️ INICIANDO FASE DE ATAQUE...');
    
    const paginas: Page[] = [];

    for (let i = 0; i <= NUM_CAJEROS; i++) { 
        const ctx = await browser.newContext();
        const p = await ctx.newPage();
        paginas.push(p);
    }

    const gerentePage = paginas[0];
    const cajerosPages = paginas.slice(1);

    // Login Masivo Paralelo
    console.log('🔌 Logueando escuadrón...');
    await Promise.all(paginas.map(async (p) => {
        await p.goto(URL);
        // Aseguramos modo login
        const btnLoginMode = p.getByRole('button', { name: 'Inicia Sesión' });
        if (await btnLoginMode.isVisible()) {
            await btnLoginMode.click();
        }
        
        await p.getByPlaceholder('correo@ejemplo.com').fill(NEW_BIZ_EMAIL);
        await p.getByPlaceholder('••••••••').fill(NEW_BIZ_PASS);
        
        // Clic seguro en Entrar
        const btnEntrar = p.getByRole('button', { name: 'Entrar' });
        if (await btnEntrar.isVisible()) {
             await btnEntrar.click();
        }

        await p.waitForSelector('text=Ingresa tu PIN', { timeout: 60000 });
        for (const d of PIN) await p.getByText(d, { exact: true }).click();
    }));

    console.log('🔥 ¡SISTEMA ONLINE! EJECUTANDO OPERACIONES...');

    // ROL: GERENTE
    const comportamientoGerente = async () => {
        await gerentePage.goto(`${URL}/#/inventario`);
        await gerentePage.waitForTimeout(2000);

        for (let i = 0; i < 5; i++) { 
            const offline = i % 2 === 0;
            console.log(`📡 GERENTE: Red ${offline ? 'OFFLINE' : 'ONLINE'}`);
            await gerentePage.context().setOffline(offline);

            if (!offline) { 
                try {
                    await gerentePage.locator('button').filter({ has: gerentePage.locator('svg') }).nth(1).click();
                    await gerentePage.locator('input[type="number"]').first().fill((50 + i).toString());
                    await gerentePage.getByRole('button', { name: 'Guardar' }).click();
                } catch (e) {console.error(e) }
            }
            await gerentePage.waitForTimeout(3000);
        }
        await gerentePage.context().setOffline(false);
    };

    // ROL: CAJEROS
    const comportamientoCajero = async (p: Page, id: number) => {
        await p.goto(`${URL}/#/`);
        if (await p.getByText('Abrir Turno').isVisible()) {
            await p.getByPlaceholder('Monto inicial').fill('500');
            await p.getByRole('button', { name: 'Abrir Caja' }).click();
        }

        for (let i = 0; i < VENTAS_POR_CAJERO; i++) {
            try {
                await p.getByPlaceholder('Buscar productos...').fill('Item-');
                await p.waitForTimeout(200);
                await p.locator('.grid > div').first().click();
                await p.getByRole('button', { name: 'Cobrar' }).click();
                await p.getByText('Efectivo').click();
                await p.getByText('Confirmar Cobro').click();
                await p.keyboard.press('Escape'); 
                console.log(`💰 Cajero ${id}: Venta ${i+1} OK`);
            } catch (e) {
                console.error(e)
                console.log(`❌ Cajero ${id}: Retry venta ${i+1}`);
                await p.reload();
                await p.waitForTimeout(1000);
                if (await p.getByText('Ingresa tu PIN').isVisible()) {
                    for (const d of PIN) await p.getByText(d, { exact: true }).click();
                }
            }
        }
    };

    await Promise.all([
        comportamientoGerente(),
        ...cajerosPages.map((p, i) => comportamientoCajero(p, i + 1))
    ]);

    console.log('🏆 PRUEBA FINALIZADA CON ÉXITO.');
  });
});