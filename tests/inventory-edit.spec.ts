import { test, expect, type Page } from '@playwright/test';

/**
 * E2E del lápiz de EDITAR producto en Inventario.
 *
 * Bug reportado en el APK: al tocar el lápiz no pasaba nada y no se podía editar.
 * Se prueba en pantalla de escritorio y de teléfono, y con productos "raros"
 * (sin precio, con precio como texto) como los que pueden llegar de la nube.
 */

const BIZ = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';

type Fila = Record<string, unknown>;

const base = (id: string, name: string, extra: Fila = {}): Fila => ({
  id, business_id: BIZ, name, price: 25, cost: 10, stock: 8, stock_warehouse: 0, sku: null,
  category: 'Bebidas', unit: 'un', sync_status: 'synced', deleted_at: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...extra,
});

const PRODUCTOS: Fila[] = [
  base('33333333-3333-4333-8333-333333333001', 'Cerveza Cristal'),
  base('33333333-3333-4333-8333-333333333002', 'Producto sin precio', { price: null, cost: null }),
  base('33333333-3333-4333-8333-333333333003', 'Precio como texto', { price: '45.50', cost: '30' }),
  base('33333333-3333-4333-8333-333333333004', 'Producto sin categoria', { category: null, unit: null }),
];

async function sembrar(page: Page) {
  await page.route('**/*.supabase.co/**', route => route.abort('failed'));
  await page.goto('/');
  await page.waitForFunction(async () => {
    const dbs = await indexedDB.databases?.();
    return !!dbs?.some(d => d.name === 'NexusPOS_DB');
  }, null, { timeout: 15000 });

  await page.evaluate(async ({ BIZ, STAFF, PRODUCTOS }) => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('NexusPOS_DB');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const put = (store: string, value: unknown) => new Promise<void>((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    await put('staff', { id: STAFF, business_id: BIZ, name: 'Dueño Prueba', role: 'admin', pin: '', active: true, sync_status: 'synced' });
    await put('settings', {
      id: BIZ, name: 'Bar de Prueba', business_type: 'retail', master_pin: '1234',
      status: 'active', sync_status: 'synced', subscription_expires_at: '2099-01-01T00:00:00.000Z',
    });
    for (const p of PRODUCTOS) await put('products', p);
    localStorage.setItem('nexus_business_id', BIZ);
    localStorage.setItem('nexus_staff_id', STAFF);
    localStorage.setItem(`nexus_guide_seen_${BIZ}`, '1');
  }, { BIZ, STAFF, PRODUCTOS });
  await page.reload();
}

for (const vista of [
  { nombre: 'escritorio', viewport: { width: 1280, height: 800 } },
  { nombre: 'teléfono', viewport: { width: 390, height: 800 } },
]) {
  test.describe(`Editar producto (${vista.nombre})`, () => {
    test.use({ viewport: vista.viewport });

    for (const nombre of ['Cerveza Cristal', 'Producto sin precio', 'Precio como texto', 'Producto sin categoria']) {
      test(`el lápiz abre el formulario de "${nombre}"`, async ({ page }) => {
        const errores: string[] = [];
        page.on('pageerror', e => errores.push(e.message));

        await sembrar(page);
        await page.goto('/#/inventario');

        const fila = page.locator('tr', { hasText: nombre }).first();
        await expect(fila).toBeVisible({ timeout: 20000 });
        await fila.getByTitle('Editar Info').click();

        await expect(page.getByText('Editar Detalles')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#product-form input').first()).toHaveValue(nombre);
        expect(errores).toEqual([]);
      });
    }
  });
}
