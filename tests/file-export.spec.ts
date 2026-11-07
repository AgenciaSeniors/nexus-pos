import { test, expect, type Page } from '@playwright/test';

/**
 * E2E de EXPORTAR archivos (inventario, plantilla, respaldo).
 *
 * Bug: en el APK "Exportar" y "Descargar Respaldo" decían "éxito" pero no salía ningún archivo:
 * el WebView de Android no sabe descargar lo que se genera dentro de la app. Ahora en Android
 * el archivo sale por el menú de compartir del teléfono (plugin nativo FileExport) y en el
 * navegador/Windows se descarga como siempre.
 *
 * El teléfono Android se simula igual que en thermal-printer.spec.ts (puente de Capacitor).
 */

const BIZ = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';

type Compartido = { name: string; mimeType: string; data: string; title?: string };

async function sembrar(page: Page, android: boolean, shareError?: string) {
  await page.route('**/*.supabase.co/**', route => route.abort('failed'));
  if (android) {
    await page.addInitScript((shareError) => {
      const w = window as unknown as { __shared: unknown[]; androidBridge: unknown; Capacitor: unknown };
      w.__shared = [];
      w.androidBridge = {};
      w.Capacitor = {
        PluginHeaders: [{ name: 'FileExport', methods: [{ name: 'share', rtype: 'promise' }] }],
        nativePromise: async (plugin: string, method: string, options: Record<string, unknown>) => {
          if (plugin !== 'FileExport' || method !== 'share') throw new Error('not implemented');
          (w.__shared as unknown[]).push(options);
          if (shareError) throw new Error(shareError);
          return { path: '/cache/exports/' + options.name };
        },
      };
    }, shareError ?? '');
  }

  await page.goto('/');
  await page.waitForFunction(async () => {
    const d = (window as unknown as { dbDebug?: { db: { open: () => Promise<unknown> } } }).dbDebug;
    if (!d) return false;
    await d.db.open();
    return true;
  }, null, { timeout: 30000 });

  await page.evaluate(async ({ BIZ, STAFF }) => {
    const { db } = (window as unknown as { dbDebug: { db: { open: () => Promise<unknown>; table: (n: string) => { put: (v: unknown) => Promise<unknown> } } } }).dbDebug;
    await db.open();
    const now = new Date().toISOString();
    await db.table('staff').put({ id: STAFF, business_id: BIZ, name: 'Dueño Prueba', role: 'admin', pin: '', active: true, sync_status: 'synced' });
    await db.table('settings').put({
      id: BIZ, name: 'Bodega Luz', business_type: 'retail', master_pin: '1234',
      status: 'active', sync_status: 'synced', subscription_expires_at: '2099-01-01T00:00:00.000Z',
    });
    await db.table('products').put({
      id: '33333333-3333-4333-8333-333333333001', business_id: BIZ, name: 'Café Cubita', price: 25, cost: 10,
      stock: 8, stock_warehouse: 2, sku: 'CAF-001', category: 'Bebidas', unit: 'un', sync_status: 'synced', deleted_at: null, created_at: now, updated_at: now,
    });
    localStorage.setItem('nexus_business_id', BIZ);
    localStorage.setItem('nexus_staff_id', STAFF);
    localStorage.setItem(`nexus_guide_seen_${BIZ}`, '1');
  }, { BIZ, STAFF });
  await page.reload();
}

const compartidos = (page: Page) => page.evaluate(() => (window as unknown as { __shared: Compartido[] }).__shared);
const texto = (c: Compartido) => Buffer.from(c.data, 'base64').toString('utf8');

test.describe('Exportar archivos', () => {
  test.describe('en el teléfono (Android): salen por el menú de compartir', () => {
    test('exportar el inventario comparte un CSV con los productos', async ({ page }) => {
      await sembrar(page, true);
      await page.goto('/#/inventario');
      await page.getByTitle('Exportar a Excel').click();

      await expect.poll(async () => (await compartidos(page)).length).toBe(1);
      const [c] = await compartidos(page);
      expect(c.name).toMatch(/^Inventario_Senio_\d{4}-\d{2}-\d{2}\.csv$/);
      expect(c.mimeType).toContain('text/csv');
      const t = texto(c);
      expect(t).toContain('Nombre del Producto;SKU;');
      expect(t).toContain('Café Cubita;CAF-001;Bebidas;25.00;10.00;8;2;10');
      await expect(page.getByText(/elige dónde guardarlo o a quién enviarlo/)).toBeVisible();
    });

    test('la plantilla de importación también se comparte', async ({ page }) => {
      await sembrar(page, true);
      await page.goto('/#/inventario');
      await page.getByTitle('Importar desde CSV o Excel').click();
      await page.getByRole('button', { name: /Descargar plantilla CSV/ }).click();

      await expect.poll(async () => (await compartidos(page)).length).toBe(1);
      const [c] = await compartidos(page);
      expect(c.name).toBe('Plantilla_Inventario_Senio.csv');
      expect(texto(c)).toContain('Nombre del Producto,SKU,Categoría,Precio Venta');
    });

    test('el respaldo completo se comparte como JSON con los datos del negocio', async ({ page }) => {
      await sembrar(page, true);
      await page.goto('/#/configuracion');
      await page.getByRole('button', { name: /Datos y Respaldo/ }).click();
      await page.getByRole('button', { name: /Descargar Respaldo/ }).click();

      await expect.poll(async () => (await compartidos(page)).length, { timeout: 15000 }).toBe(1);
      const [c] = await compartidos(page);
      expect(c.name).toMatch(/^Respaldo_Senio_\d{4}-\d{2}-\d{2}\.json$/);
      expect(c.mimeType).toBe('application/json');
      const respaldo = JSON.parse(texto(c));
      expect(respaldo.products).toHaveLength(1);
      expect(respaldo.products[0].name).toBe('Café Cubita');
      expect(respaldo.settings[0].name).toBe('Bodega Luz');
      await expect(page.getByText(/Copia de seguridad lista/)).toBeVisible();
    });

    test('si el teléfono no puede compartir, lo dice (y no dice "éxito")', async ({ page }) => {
      await sembrar(page, true, 'NO_APP');
      await page.goto('/#/inventario');
      await page.getByTitle('Exportar a Excel').click();
      await expect(page.getByText(/No hay ninguna app para recibir el archivo/)).toBeVisible();
      await expect(page.getByText(/elige dónde guardarlo/)).toHaveCount(0);
    });
  });

  test('en el navegador / Windows sigue siendo una descarga', async ({ page }) => {
    await sembrar(page, false);
    await page.goto('/#/inventario');
    const descarga = page.waitForEvent('download');
    await page.getByTitle('Exportar a Excel').click();
    const d = await descarga;
    expect(d.suggestedFilename()).toMatch(/^Inventario_Senio_\d{4}-\d{2}-\d{2}\.csv$/);
    await expect(page.getByText(/descargado/)).toBeVisible();
  });
});
