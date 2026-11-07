import { test, expect, type Page } from '@playwright/test';

/**
 * E2E de IMPORTAR inventario desde CSV.
 *
 * Lo que se cubre (cada punto era un fallo real):
 *  - Precios con coma decimal ("30,50") se leían como 30.
 *  - Fechas "31/12/2026" se ignoraban en silencio.
 *  - Un producto que ya existía solo podía saltarse: ahora se puede actualizar (precio, costo,
 *    datos) y, si se pide, también el stock, que queda registrado como corrección.
 */

const BIZ = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const CAFE = '33333333-3333-4333-8333-333333333001';

const CSV = [
  'Nombre;SKU;Precio;Costo;Stock Vitrina;Vencimiento',
  'Café Cubita;CAF-001;30,50;12;20;31/12/2026',   // ya existe
  'Pan;PAN-1;5,25;3;12;',                          // nuevo
  'Leche;LEC-1;gratis;;;',                         // precio inválido
].join('\r\n');

async function sembrar(page: Page) {
  await page.route('**/*.supabase.co/**', route => route.abort('failed'));
  await page.goto('/');
  await page.waitForFunction(async () => {
    const d = (window as unknown as { dbDebug?: { db: { open: () => Promise<unknown> } } }).dbDebug;
    if (!d) return false;
    await d.db.open();
    return true;
  }, null, { timeout: 30000 });
  await page.evaluate(async ({ BIZ, STAFF, CAFE }) => {
    const { db } = (window as unknown as { dbDebug: { db: { open: () => Promise<unknown>; table: (n: string) => { put: (v: unknown) => Promise<unknown> } } } }).dbDebug;
    await db.open();
    const now = new Date().toISOString();
    await db.table('staff').put({ id: STAFF, business_id: BIZ, name: 'Dueño Prueba', role: 'admin', pin: '', active: true, sync_status: 'synced' });
    await db.table('settings').put({ id: BIZ, name: 'Bodega Luz', business_type: 'retail', master_pin: '1234', status: 'active', sync_status: 'synced', subscription_expires_at: '2099-01-01T00:00:00.000Z' });
    await db.table('products').put({ id: CAFE, business_id: BIZ, name: 'Café Cubita', price: 25, cost: 10, stock: 8, stock_warehouse: 0, sku: 'CAF-001', category: 'Bebidas', unit: 'un', sync_status: 'synced', deleted_at: null, created_at: now, updated_at: now });
    localStorage.setItem('nexus_business_id', BIZ);
    localStorage.setItem('nexus_staff_id', STAFF);
    localStorage.setItem(`nexus_guide_seen_${BIZ}`, '1');
  }, { BIZ, STAFF, CAFE });
  await page.reload();
}

async function subirCsv(page: Page) {
  await page.goto('/#/inventario');
  await page.getByTitle('Importar desde CSV o Excel').click();
  await page.locator('input[type="file"]').setInputFiles({ name: 'inventario.csv', mimeType: 'text/csv', buffer: Buffer.from('﻿' + CSV, 'utf8') });
  await expect(page.getByTestId('import-count-new')).toBeVisible({ timeout: 15000 });
}

const producto = (page: Page, sku: string) => page.evaluate(async (sku) => {
  const { db } = (window as unknown as { dbDebug: { db: { table: (n: string) => { filter: (f: (p: { sku: string }) => boolean) => { first: () => Promise<unknown> } } } } }).dbDebug;
  return db.table('products').filter(p => p.sku === sku).first();
}, sku) as Promise<{ name: string; price: number; cost: number; stock: number; expiration_date?: string; sync_status: string } | undefined>;

const movimientos = (page: Page, productId: string) => page.evaluate(async (id) => {
  const { db } = (window as unknown as { dbDebug: { db: { table: (n: string) => { filter: (f: (m: { product_id: string }) => boolean) => { toArray: () => Promise<unknown[]> } } } } }).dbDebug;
  return db.table('movements').filter(m => m.product_id === id).toArray();
}, productId) as Promise<{ qty_change: number; reason: string }[]>;

test.describe('Importar inventario', () => {
  test('vista previa: coma decimal, fecha DD/MM/AAAA, existente saltado por defecto y error claro', async ({ page }) => {
    await sembrar(page);
    await subirCsv(page);

    await expect(page.getByTestId('import-count-new')).toHaveText('1');
    await expect(page.getByTestId('import-count-update')).toHaveText('0');
    await expect(page.getByTestId('import-count-skipped')).toHaveText('1');
    await expect(page.getByTestId('import-count-error')).toHaveText('1');
    await expect(page.getByText(/Precio inválido: "gratis"/)).toBeVisible();
    // El precio nuevo se leyó con la coma decimal
    await expect(page.getByText('$5.25')).toBeVisible();
  });

  test('modo "actualizar": cambia precio, costo y vencimiento del existente SIN tocar el stock, y crea el nuevo', async ({ page }) => {
    await sembrar(page);
    await subirCsv(page);

    await page.getByLabel('Productos que ya existen').selectOption('update');
    await expect(page.getByTestId('import-count-update')).toHaveText('1');
    await expect(page.getByTestId('import-count-skipped')).toHaveText('0');
    const fila = page.getByTestId('import-update-row');
    await expect(fila).toContainText('Café Cubita');
    await expect(fila).toContainText('precio: 25 → 30.5');
    await expect(fila).toContainText('vencimiento');

    await page.getByRole('button', { name: /Importar 1 y actualizar 1/ }).click();
    await expect(page.getByTestId('import-done')).toHaveText('1 producto(s) nuevo(s) · 1 actualizado(s)', { timeout: 20000 });

    const cafe = await producto(page, 'CAF-001');
    expect(cafe).toMatchObject({ price: 30.5, cost: 12, stock: 8, expiration_date: '2026-12-31', sync_status: 'pending_update' });
    const pan = await producto(page, 'PAN-1');
    expect(pan).toMatchObject({ name: 'Pan', price: 5.25, cost: 3, stock: 12 });
    expect(await movimientos(page, CAFE)).toEqual([]); // el stock no se tocó
  });

  test('modo "actualizar con stock": el stock queda como el archivo y la diferencia va al historial', async ({ page }) => {
    await sembrar(page);
    await subirCsv(page);

    await page.getByLabel('Productos que ya existen').selectOption('update_stock');
    await expect(page.getByTestId('import-update-row')).toContainText('stock: 8 → 20');
    await page.getByRole('button', { name: /Importar 1 y actualizar 1/ }).click();
    await expect(page.getByTestId('import-done')).toBeVisible({ timeout: 20000 });

    const cafe = await producto(page, 'CAF-001');
    expect(cafe?.stock).toBe(20);
    const movs = await movimientos(page, CAFE);
    expect(movs).toHaveLength(1);
    expect(movs[0]).toMatchObject({ qty_change: 12, reason: 'correction' });
  });
});
