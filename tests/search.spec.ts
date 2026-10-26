import { test, expect, type Page } from '@playwright/test';

/**
 * E2E de la BÚSQUEDA de productos: sin distinguir mayúsculas ni tildes.
 *
 * Reportado: la dependienta buscaba "cafe" y no le salía "Café"; había que
 * acertar la ortografía exacta. Se prueba en el punto de venta y en Inventario.
 */

const BIZ = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const SHIFT = '44444444-4444-4444-8444-444444444444';

const NOMBRES = ['Café Cubita', 'Jamón de Pavo', 'Zapatos de Niño', 'Coca Cola 600ml', 'Agua Mineral'];

async function sembrar(page: Page) {
  await page.route('**/*.supabase.co/**', route => route.abort('failed'));
  await page.goto('/');
  // Se espera a que la propia Dexie de la app esté abierta (con su esquema completo): abrir IndexedDB
  // a mano apenas aparece la base fallaba al azar con "almacén no encontrado".
  await page.waitForFunction(async () => {
    const d = (window as unknown as { dbDebug?: { db: { open: () => Promise<unknown> } } }).dbDebug;
    if (!d) return false;
    await d.db.open();
    return true;
  }, null, { timeout: 30000 });

  await page.evaluate(async ({ BIZ, STAFF, SHIFT, NOMBRES }) => {
    // Siembra con la propia Dexie de la app: el esquema está garantizado (abrir IndexedDB a mano
    // fallaba al azar con "almacén no encontrado" mientras la app creaba las tablas).
    const { db } = (window as unknown as { dbDebug: { db: { open: () => Promise<unknown>; table: (n: string) => { put: (v: unknown) => Promise<unknown> } } } }).dbDebug;
    await db.open();
    const put = (store: string, value: unknown) => db.table(store).put(value).then(() => undefined);
    const now = new Date().toISOString();
    await put('staff', { id: STAFF, business_id: BIZ, name: 'Dueño Prueba', role: 'admin', pin: '', active: true, sync_status: 'synced' });
    await put('settings', {
      id: BIZ, name: 'Bar de Prueba', business_type: 'retail', master_pin: '1234',
      status: 'active', sync_status: 'synced', subscription_expires_at: '2099-01-01T00:00:00.000Z',
    });
    await put('cash_shifts', { id: SHIFT, business_id: BIZ, staff_id: STAFF, start_amount: 0, opened_at: now, status: 'open', sync_status: 'synced' });
    for (let i = 0; i < NOMBRES.length; i++) {
      await put('products', {
        id: `33333333-3333-4333-8333-${String(i + 1).padStart(12, '0')}`,
        business_id: BIZ, name: NOMBRES[i], price: 10 + i, cost: 0, stock: 20, sku: i === 0 ? 'CAF-001' : null,
        category: 'General', unit: 'un', sync_status: 'synced', deleted_at: null, created_at: now, updated_at: now,
      });
    }
    localStorage.setItem('nexus_business_id', BIZ);
    localStorage.setItem('nexus_staff_id', STAFF);
    localStorage.setItem(`nexus_guide_seen_${BIZ}`, '1');
  }, { BIZ, STAFF, SHIFT, NOMBRES });
  await page.reload();
}

const casos: { busqueda: string; encuentra: string }[] = [
  { busqueda: 'cafe', encuentra: 'Café Cubita' },
  { busqueda: 'CAFÉ', encuentra: 'Café Cubita' },
  { busqueda: 'jamon', encuentra: 'Jamón de Pavo' },
  { busqueda: 'nino', encuentra: 'Zapatos de Niño' },
  { busqueda: 'coca 600', encuentra: 'Coca Cola 600ml' },
  { busqueda: 'caf-001', encuentra: 'Café Cubita' },
];

test.describe('Búsqueda sin tildes ni mayúsculas', () => {
  for (const { busqueda, encuentra } of casos) {
    test(`punto de venta: "${busqueda}" encuentra "${encuentra}"`, async ({ page }) => {
      await sembrar(page);
      await page.goto('/#/venta');
      const buscador = page.getByPlaceholder('Buscar o escanear código...');
      await expect(buscador).toBeVisible({ timeout: 20000 });
      await expect(page.getByRole('heading', { name: 'Agua Mineral' })).toBeVisible();

      await buscador.fill(busqueda);

      await expect(page.getByRole('heading', { name: encuentra })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Agua Mineral' })).toBeHidden();
    });
  }

  test('inventario: "JAMON" encuentra "Jamón de Pavo"', async ({ page }) => {
    await sembrar(page);
    await page.goto('/#/inventario');
    const buscador = page.getByPlaceholder('Buscar...');
    await expect(buscador).toBeVisible({ timeout: 20000 });

    await buscador.fill('JAMON');

    await expect(page.locator('tr', { hasText: 'Jamón de Pavo' }).first()).toBeVisible();
    await expect(page.locator('tr', { hasText: 'Agua Mineral' })).toHaveCount(0);
  });
});
