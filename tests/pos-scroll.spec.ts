import { test, expect, type Page } from '@playwright/test';

/**
 * E2E del SCROLL del punto de venta en pantalla de teléfono.
 *
 * Bug reportado en el APK: la rejilla de productos mostraba solo los primeros
 * y, al deslizar el dedo, no bajaba. La causa estaba en el layout (flex en
 * columna sin `min-h-0` + altura fija que no descontaba la barra de navegación
 * inferior), así que se reproduce con un viewport de móvil, sin necesitar un
 * teléfono.
 *
 * Igual que shift-count.spec.ts: se siembra un negocio en IndexedDB y se bloquea
 * toda salida a la nube.
 */

const BIZ = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const SHIFT = '44444444-4444-4444-8444-444444444444';
const TOTAL_PRODUCTOS = 60;

async function sembrarNegocioConMuchosProductos(page: Page) {
  await page.route('**/*.supabase.co/**', route => route.abort('failed'));
  await page.goto('/');
  await page.waitForFunction(async () => {
    const dbs = await indexedDB.databases?.();
    return !!dbs?.some(d => d.name === 'NexusPOS_DB');
  }, null, { timeout: 15000 });

  await page.evaluate(async ({ BIZ, STAFF, SHIFT, TOTAL }) => {
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
    const now = new Date().toISOString();

    await put('staff', { id: STAFF, business_id: BIZ, name: 'Dependiente Prueba', role: 'admin', pin: '', active: true, sync_status: 'synced' });
    await put('settings', {
      id: BIZ, name: 'Bar de Prueba', business_type: 'retail', master_pin: '1234',
      status: 'active', sync_status: 'synced', subscription_expires_at: '2099-01-01T00:00:00.000Z',
    });
    await put('cash_shifts', { id: SHIFT, business_id: BIZ, staff_id: STAFF, start_amount: 0, opened_at: now, status: 'open', sync_status: 'synced' });
    for (let i = 1; i <= TOTAL; i++) {
      await put('products', {
        id: `33333333-3333-4333-8333-${String(i).padStart(12, '0')}`,
        business_id: BIZ, name: `Producto ${String(i).padStart(2, '0')}`, price: 10 + i, cost: 0,
        stock: 50, sku: null, category: 'Bebidas', unit: 'un', sync_status: 'synced', deleted_at: null,
        created_at: now, updated_at: now,
      });
    }
    localStorage.setItem('nexus_business_id', BIZ);
    localStorage.setItem('nexus_staff_id', STAFF);
    localStorage.setItem(`nexus_guide_seen_${BIZ}`, '1');
  }, { BIZ, STAFF, SHIFT, TOTAL: TOTAL_PRODUCTOS });

  await page.reload();
}

test.describe('Punto de venta en pantalla de teléfono', () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test('la rejilla de productos baja y deja ver el último producto', async ({ page }) => {
    await sembrarNegocioConMuchosProductos(page);
    await page.goto('/#/venta');

    const rejilla = page.getByTestId('pos-product-grid');
    await expect(rejilla).toBeVisible({ timeout: 20000 });
    // La rejilla ordena de Z a A: el primero en pantalla es el 60 y el último el 01.
    await expect(page.getByText('Producto 60', { exact: true })).toBeVisible();

    // 1) La rejilla tiene contenido de sobra y ES desplazable.
    const medidas = await rejilla.evaluate(el => ({ alto: el.clientHeight, contenido: el.scrollHeight }));
    expect(medidas.contenido).toBeGreaterThan(medidas.alto);

    // 2) Deslizar sobre la rejilla la mueve de verdad (rueda = gesto de arrastre).
    const caja = (await rejilla.boundingBox())!;
    await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
    await page.mouse.wheel(0, 400);
    await expect.poll(() => rejilla.evaluate(el => el.scrollTop)).toBeGreaterThan(100);

    // 3) La rejilla pagina de 40 en 40: al llegar al final, "Mostrar más" tiene
    //    que verse ENTERO por encima de la barra de navegación (antes quedaba
    //    tapado y parecía que no había más productos).
    const barra = (await page.locator('nav.sticky').boundingBox())!;
    await rejilla.evaluate(el => { el.scrollTo({ top: el.scrollHeight, behavior: 'instant' }); }); // scroll-smooth animaría y mediríamos a mitad de camino
    const masBtn = page.getByRole('button', { name: /Mostrar más/ });
    await expect(masBtn).toBeVisible();
    const cajaMas = (await masBtn.boundingBox())!;
    expect(cajaMas.y + cajaMas.height).toBeLessThanOrEqual(barra.y + 1);
    await masBtn.click();

    // 4) Con todos cargados, el último producto queda entero sobre la barra.
    await rejilla.evaluate(el => { el.scrollTo({ top: el.scrollHeight, behavior: 'instant' }); }); // scroll-smooth animaría y mediríamos a mitad de camino
    const ultimo = page.getByText('Producto 01', { exact: true });
    await expect(ultimo).toBeVisible();
    const cajaUltimo = (await ultimo.boundingBox())!;
    expect(cajaUltimo.y + cajaUltimo.height).toBeLessThanOrEqual(barra.y + 1);
  });
});
