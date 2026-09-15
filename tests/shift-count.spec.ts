import { test, expect, type Page } from '@playwright/test';

/**
 * E2E del CUADRE POR CONTEO y del STOCK DIRECTO A VITRINA.
 *
 * La app es offline-first: si hay staff en IndexedDB y `nexus_business_id` en
 * localStorage, arranca sin red ni login (ver App.tsx, "PRIMERO: Revisar datos
 * locales"). Estos tests se apoyan en esa ruta para sembrar un negocio de
 * prueba y manejar la interfaz de verdad, sin tocar Supabase: toda petición a
 * la nube se bloquea explícitamente.
 */

const BIZ = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';

interface SeedProduct { id: string; name: string; price: number; stock: number }

const PRODUCTS: SeedProduct[] = [
  { id: '33333333-3333-4333-8333-333333333001', name: 'Cerveza Cristal', price: 100, stock: 20 },
  { id: '33333333-3333-4333-8333-333333333002', name: 'Refresco Cola', price: 50, stock: 10 },
  { id: '33333333-3333-4333-8333-333333333003', name: 'Agua Mineral', price: 25, stock: 8 },
];

/** Bloquea TODA salida a la nube: ninguna prueba puede tocar datos reales. */
async function aislarDeLaNube(page: Page) {
  await page.route('**/*.supabase.co/**', route => route.abort('failed'));
}

/**
 * Siembra el negocio local. La app tiene que haber arrancado una vez para que
 * Dexie cree los almacenes; por eso se navega, se escribe por IndexedDB crudo
 * y se recarga.
 */
async function sembrarNegocio(page: Page, opts: { countMode: boolean }) {
  await aislarDeLaNube(page);
  await page.goto('/');
  // Espera a que Dexie haya creado la base con el esquema actual.
  await page.waitForFunction(async () => {
    const dbs = await indexedDB.databases?.();
    return !!dbs?.some(d => d.name === 'NexusPOS_DB');
  }, null, { timeout: 15000 });

  await page.evaluate(async ({ BIZ, STAFF, PRODUCTS, countMode }) => {
    const open = () => new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('NexusPOS_DB');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const db = await open();
    const put = (store: string, value: unknown) => new Promise<void>((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });

    await put('staff', {
      id: STAFF, business_id: BIZ, name: 'Dependiente Prueba',
      role: 'admin', pin: '', active: true, sync_status: 'synced',
    });
    await put('settings', {
      id: BIZ, name: 'Bar de Prueba', business_type: 'retail', master_pin: '1234',
      count_reconciliation: countMode, status: 'active', sync_status: 'synced',
      subscription_expires_at: '2099-01-01T00:00:00.000Z',
    });
    for (const p of PRODUCTS) {
      await put('products', {
        id: p.id, business_id: BIZ, name: p.name, price: p.price, cost: 0,
        stock: p.stock, sku: null, category: 'Bebidas', unit: 'un',
        sync_status: 'synced', deleted_at: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
    }
    localStorage.setItem('nexus_business_id', BIZ);
    localStorage.setItem('nexus_staff_id', STAFF);
    // El banner "Ver guía" se superpone a los botones y roba los clics.
    // Se marca como visto, igual que hace la app tras cerrarlo (Layout.tsx).
    localStorage.setItem(`nexus_guide_seen_${BIZ}`, '1');
  }, { BIZ, STAFF, PRODUCTS, countMode: opts.countMode });

  await page.reload();
}

/** Lee una tabla local; así se comprueba lo que quedó GUARDADO, no solo pintado. */
async function leerTabla<T = Record<string, unknown>>(page: Page, store: string): Promise<T[]> {
  return page.evaluate(async (storeName) => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('NexusPOS_DB');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return new Promise((res, rej) => {
      const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }, store);
}

/** Entra a la pantalla de cierre: botón "Cerrar Turno" + PIN maestro. */
async function abrirCierre(page: Page) {
  await page.getByRole('button', { name: 'Cerrar Turno' }).click();
  await expect(page.getByText('Acceso Restringido')).toBeVisible({ timeout: 10000 });
  for (const d of ['1', '2', '3', '4']) {
    await page.getByRole('button', { name: d, exact: true }).click();
  }
  await page.getByRole('button', { name: 'VERIFICAR' }).click();
}

async function irAFinanzas(page: Page) {
  await page.goto('/#/finanzas');
  await expect(page.getByText('Apertura de Caja')).toBeVisible({ timeout: 20000 });
}

test.describe('Cuadre por conteo', () => {
  test('la apertura pide contar los productos y guarda el conteo inicial', async ({ page }) => {
    await sembrarNegocio(page, { countMode: true });
    await irAFinanzas(page);

    // El panel de conteo aparece con todos los productos activos.
    await expect(page.getByText(/Conteo inicial \(3 productos\)/)).toBeVisible();
    await expect(page.getByText('Cerveza Cristal')).toBeVisible();
    await expect(page.getByText('Agua Mineral')).toBeVisible();

    // Abrir con el conteo tal cual lo propone el sistema.
    await page.getByPlaceholder('0.00').fill('500');
    await page.getByRole('button', { name: 'ABRIR TURNO' }).click();
    await expect(page.getByText(/productos contados/)).toBeVisible({ timeout: 15000 });

    const counts = await leerTabla<{ product_id: string; opening_qty: number; unit_price: number; closing_qty?: number }>(page, 'shift_counts');
    expect(counts).toHaveLength(3);
    const cerveza = counts.find(c => c.product_id === PRODUCTS[0].id)!;
    expect(cerveza.opening_qty).toBe(20);
    expect(cerveza.unit_price).toBe(100);      // foto del precio al abrir
    expect(cerveza.closing_qty).toBeUndefined(); // turno abierto: nada que cuadrar
  });

  test('corregir el conteo inicial ajusta el stock real del producto', async ({ page }) => {
    await sembrarNegocio(page, { countMode: true });
    await irAFinanzas(page);

    // El sistema dice 20 cervezas pero físicamente hay 18.
    await page.getByLabel('Conteo de Cerveza Cristal').fill('18');

    await page.getByPlaceholder('0.00').fill('500');
    await page.getByRole('button', { name: 'ABRIR TURNO' }).click();
    await expect(page.getByText(/productos contados/)).toBeVisible({ timeout: 15000 });

    const counts = await leerTabla<{ product_id: string; opening_qty: number }>(page, 'shift_counts');
    expect(counts.find(c => c.product_id === PRODUCTS[0].id)!.opening_qty).toBe(18);

    // El stock del producto quedó alineado con lo contado...
    const products = await leerTabla<{ id: string; stock: number }>(page, 'products');
    expect(products.find(p => p.id === PRODUCTS[0].id)!.stock).toBe(18);

    // ...y el ajuste dejó rastro en el historial.
    const movs = await leerTabla<{ product_id: string; qty_change: number; reason: string }>(page, 'movements');
    const fix = movs.find(m => m.product_id === PRODUCTS[0].id && m.reason === 'correction');
    expect(fix).toBeTruthy();
    expect(fix!.qty_change).toBe(-2);
  });

  test('el cierre cobra lo que falta y NO cobra la merma declarada', async ({ page }) => {
    await sembrarNegocio(page, { countMode: true });
    await irAFinanzas(page);
    await page.getByPlaceholder('0.00').fill('500');
    await page.getByRole('button', { name: 'ABRIR TURNO' }).click();
    await expect(page.getByText(/productos contados/)).toBeVisible({ timeout: 15000 });

    await abrirCierre(page);
    await expect(page.getByText('Vendido según conteo')).toBeVisible({ timeout: 15000 });

    // Cerveza: abrió 20, quedan 8 → faltan 12; 2 fueron rotura → se cobran 10.
    await page.getByLabel('Conteo de Cerveza Cristal').fill('8');
    await page.getByLabel('Merma de Cerveza Cristal').fill('2');

    // 10 × $100 = $1000 esperados por conteo.
    await expect(page.getByText('Vendido según conteo').locator('..').getByText('$1,000.00')).toBeVisible();
    await expect(page.getByText(/Mermas: .*no se cobran/)).toBeVisible();
  });

  test('un sobrante se avisa y no se cobra en negativo', async ({ page }) => {
    await sembrarNegocio(page, { countMode: true });
    await irAFinanzas(page);
    await page.getByPlaceholder('0.00').fill('500');
    await page.getByRole('button', { name: 'ABRIR TURNO' }).click();
    await expect(page.getByText(/productos contados/)).toBeVisible({ timeout: 15000 });

    await abrirCierre(page);
    await expect(page.getByText('Vendido según conteo')).toBeVisible({ timeout: 15000 });

    // Aparecen MÁS cervezas de las que se esperaban (20 → 25).
    await page.getByLabel('Conteo de Cerveza Cristal').fill('25');

    await expect(page.getByText(/1 producto con sobrante/)).toBeVisible();
    // Nadie devuelve dinero por un sobrante: el esperado no baja de cero.
    await expect(page.getByText('Vendido según conteo').locator('..').getByText('$0.00')).toBeVisible();
  });

  test('sin el ajuste activo la apertura no cambia en nada', async ({ page }) => {
    await sembrarNegocio(page, { countMode: false });
    await irAFinanzas(page);

    await expect(page.getByText(/Conteo inicial/)).toHaveCount(0);
    await expect(page.getByText('Cerveza Cristal')).toHaveCount(0);

    await page.getByPlaceholder('0.00').fill('500');
    await page.getByRole('button', { name: 'ABRIR TURNO' }).click();
    await expect(page.getByText('¡Caja Abierta!')).toBeVisible({ timeout: 15000 });

    expect(await leerTabla(page, 'shift_counts')).toHaveLength(0);
  });
});

test.describe('Stock directo a vitrina', () => {
  test('un producto nuevo puede nacer con existencia en la vitrina', async ({ page }) => {
    await sembrarNegocio(page, { countMode: false });
    await page.goto('/#/inventario');

    await page.getByRole('button', { name: /Nuevo|Agregar/i }).first().click();
    await expect(page.getByText(/Cantidad Inicial/)).toBeVisible({ timeout: 15000 });

    const form = page.locator('form');
    await form.locator('input[type="text"]').first().fill('Ron Havana');
    await form.locator('input[type="number"]').first().fill('250'); // precio
    // Vitrina viene seleccionada por defecto: no hay que tocar nada más.
    await page.getByLabel('Cantidad inicial').fill('12');

    await page.getByRole('button', { name: 'Guardar Datos' }).click();
    await expect(page.getByText(/creado con 12 en vitrina/)).toBeVisible({ timeout: 15000 });

    const products = await leerTabla<{ name: string; stock: number; stock_warehouse?: number }>(page, 'products');
    const ron = products.find(p => p.name === 'Ron Havana')!;
    expect(ron.stock).toBe(12);            // entró a la VITRINA
    expect(ron.stock_warehouse ?? 0).toBe(0); // sin pasar por almacén

    const movs = await leerTabla<{ reason: string; qty_change: number }>(page, 'movements');
    expect(movs.some(m => m.reason === 'initial' && m.qty_change === 12)).toBe(true);
  });
});
