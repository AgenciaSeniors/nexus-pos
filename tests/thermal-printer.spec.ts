import { test, expect, type Page } from '@playwright/test';

/**
 * E2E de la IMPRESORA TÉRMICA (Rongta RP326 por red, ESC/POS).
 *
 * El navegador no puede abrir sockets, así que se simula el puente de Electron
 * (`window.electronAPI.printRaw`) y se comprueba lo que la app le manda: IP, puerto
 * y bytes ESC/POS correctos. El envío TCP real se prueba aparte (rawPrint.test.ts y
 * en el emulador de Android contra un servidor falso).
 */

const BIZ = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const SHIFT = '44444444-4444-4444-8444-444444444444';

type Printed = { host: string; port: number; bytes: number[] };

async function sembrar(page: Page, impresora: Record<string, unknown> | null, respuesta: { ok: boolean; error?: string } = { ok: true }) {
  await page.route('**/*.supabase.co/**', route => route.abort('failed'));
  // Puente de Electron simulado ANTES de que cargue la app.
  await page.addInitScript((resp) => {
    const w = window as unknown as { __printed: unknown[]; electronAPI: unknown };
    w.__printed = [];
    w.electronAPI = {
      getVersion: async () => '0.0.0-test',
      printTicket: () => { (w.__printed as unknown[]).push({ driver: true }); },
      onPrintResult: () => {},
      onNavigate: () => () => {},
      printRaw: async (host: string, port: number, bytes: number[]) => {
        (w.__printed as unknown[]).push({ host, port, bytes });
        return resp;
      },
    };
  }, respuesta);

  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as { dbDebug?: unknown }).dbDebug, null, { timeout: 30000 });
  await page.evaluate(async ({ BIZ, STAFF, SHIFT, impresora }) => {
    const { db } = (window as unknown as { dbDebug: { db: { open: () => Promise<unknown>; table: (n: string) => { put: (v: unknown) => Promise<unknown> } } } }).dbDebug;
    await db.open();
    const now = new Date().toISOString();
    await db.table('staff').put({ id: STAFF, business_id: BIZ, name: 'Ana Pérez', role: 'admin', pin: '', active: true, sync_status: 'synced' });
    await db.table('settings').put({
      id: BIZ, name: 'Bodega Luz', address: 'Calle 1 #23', business_type: 'retail', master_pin: '1234',
      status: 'active', sync_status: 'synced', subscription_expires_at: '2099-01-01T00:00:00.000Z',
    });
    await db.table('cash_shifts').put({ id: SHIFT, business_id: BIZ, staff_id: STAFF, start_amount: 0, opened_at: now, status: 'open', sync_status: 'synced' });
    await db.table('products').put({
      id: '33333333-3333-4333-8333-000000000001', business_id: BIZ, name: 'Café con leche', price: 5, cost: 0,
      stock: 50, sku: null, category: 'Bebidas', unit: 'un', sync_status: 'synced', deleted_at: null, created_at: now, updated_at: now,
    });
    localStorage.setItem('nexus_business_id', BIZ);
    localStorage.setItem('nexus_staff_id', STAFF);
    localStorage.setItem(`nexus_guide_seen_${BIZ}`, '1');
    if (impresora) localStorage.setItem('nexus_printer_config', JSON.stringify(impresora));
    else localStorage.removeItem('nexus_printer_config');
  }, { BIZ, STAFF, SHIFT, impresora });
  await page.reload();
}

const impresion = (page: Page) => page.evaluate(() => (window as unknown as { __printed: unknown[] }).__printed) as Promise<Array<Printed & { driver?: boolean }>>;
const texto = (bytes: number[]) => Buffer.from(bytes).toString('latin1');

async function cobrar(page: Page) {
  await page.goto('/#/venta');
  await page.getByText('Café con leche').first().click();
  await page.getByRole('button', { name: /COBRAR AHORA/ }).click();
  await page.getByRole('button', { name: /Monto Exacto/ }).click();
  await page.getByRole('button', { name: /Confirmar Cobro/ }).click();
}

const CONFIG = { enabled: true, ip: '192.168.1.50', port: 9100, width: '80mm', codepage: 'ascii', autoPrint: true, openDrawer: false };

test.describe('Impresora térmica', () => {
  test('al cobrar, el ticket sale solo por la IP configurada, con el contenido de la venta y el corte', async ({ page }) => {
    await sembrar(page, CONFIG);
    await cobrar(page);
    await expect.poll(async () => (await impresion(page)).length, { timeout: 10000 }).toBe(1);

    const [job] = await impresion(page);
    expect(job.host).toBe('192.168.1.50');
    expect(job.port).toBe(9100);
    const t = texto(job.bytes);
    expect(t).toContain('BODEGA LUZ');
    expect(t).toContain('Calle 1 #23');
    expect(t).toContain('1 x Caf');
    expect(t).toContain('$5.00');
    expect(t).toContain('Vendedor: Ana');
    expect(job.bytes.slice(0, 2)).toEqual([0x1b, 0x40]);                 // ESC @
    expect(job.bytes.slice(-4)).toEqual([0x1d, 0x56, 0x42, 0x00]);        // GS V 66 0 (corte)
    // El ticket en pantalla sigue ahí y NO se disparó el diálogo del sistema
    await expect(page.getByRole('button', { name: /^Imprimir$/ })).toBeVisible();
    expect((await impresion(page)).some(j => j.driver)).toBe(false);
  });

  test('el botón "Imprimir" del ticket reimprime por la térmica', async ({ page }) => {
    await sembrar(page, { ...CONFIG, autoPrint: false });
    await cobrar(page);
    await page.getByRole('button', { name: /^Imprimir$/ }).click();
    await expect.poll(async () => (await impresion(page)).length, { timeout: 10000 }).toBe(1);
    await expect(page.getByText('Ticket enviado a la impresora')).toBeVisible();
  });

  test('con la gaveta activada, un cobro en efectivo manda ESC p', async ({ page }) => {
    await sembrar(page, { ...CONFIG, openDrawer: true });
    await cobrar(page);
    await expect.poll(async () => (await impresion(page)).length, { timeout: 10000 }).toBe(1);
    const [job] = await impresion(page);
    expect(job.bytes.join(',')).toContain('27,112,0,50,250');
  });

  test('si la impresora falla, la venta queda guardada y se avisa con un mensaje claro', async ({ page }) => {
    await sembrar(page, CONFIG, { ok: false, error: 'TIMEOUT' });
    await cobrar(page);
    await expect(page.getByText(/Venta guardada, pero el ticket no salió/)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/no responde/)).toBeVisible();
    // La venta existe igual
    const ventas = await page.evaluate(async () => {
      const { db } = (window as unknown as { dbDebug: { db: { table: (n: string) => { count: () => Promise<number> } } } }).dbDebug;
      return db.table('sales').count();
    });
    expect(ventas).toBe(1);
  });

  test('sin impresora configurada todo sigue como antes (no se imprime nada por red)', async ({ page }) => {
    await sembrar(page, null);
    await cobrar(page);
    await expect(page.getByRole('button', { name: /Imprimir \/ PDF/ })).toBeVisible({ timeout: 10000 });
    expect(await impresion(page)).toHaveLength(0);
  });

  test('la configuración vieja (IP de ejemplo, sin activar) no imprime nada', async ({ page }) => {
    await sembrar(page, { name: 'Impresora Térmica', ip: '192.168.1.200', width: '80mm', autoPrint: true });
    await cobrar(page);
    await expect(page.getByRole('button', { name: /Imprimir \/ PDF/ })).toBeVisible({ timeout: 10000 });
    expect(await impresion(page)).toHaveLength(0);
  });

  test('Ajustes → Hardware: guardar la IP y "Imprimir página de prueba" manda la página de prueba', async ({ page }) => {
    await sembrar(page, null);
    await page.goto('/#/configuracion');
    await page.getByRole('button', { name: /Hardware/ }).click();

    // Sin IP no deja probar
    await page.getByRole('button', { name: /Imprimir página de prueba/ }).click();
    await expect(page.getByText(/Escribe la IP de la impresora/)).toBeVisible();
    expect(await impresion(page)).toHaveLength(0);

    await page.getByLabel(/Usar impresora térmica/).check();
    await page.getByPlaceholder('192.168.1.50').fill('192.168.1.77');
    await page.getByRole('button', { name: /Imprimir página de prueba/ }).click();
    await expect.poll(async () => (await impresion(page)).length).toBe(1);
    const [job] = await impresion(page);
    expect(job.host).toBe('192.168.1.77');
    expect(texto(job.bytes)).toContain('Prueba de impresion');
    expect(texto(job.bytes)).toContain('Ancho: 48 columnas');

    await page.getByRole('button', { name: /Guardar Configuración/ }).click();
    const guardado = await page.evaluate(() => JSON.parse(localStorage.getItem('nexus_printer_config') || '{}'));
    expect(guardado).toMatchObject({ enabled: true, ip: '192.168.1.77', port: 9100, width: '80mm', codepage: 'cp858' });
  });

  test('no deja activar la impresora con una IP inválida', async ({ page }) => {
    await sembrar(page, null);
    await page.goto('/#/configuracion');
    await page.getByRole('button', { name: /Hardware/ }).click();
    await page.getByLabel(/Usar impresora térmica/).check();
    await page.getByPlaceholder('192.168.1.50').fill('300.1.1.1');
    await page.getByRole('button', { name: /Guardar Configuración/ }).click();
    await expect(page.getByText(/escribe una IP válida/)).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('nexus_printer_config'))).toBeNull();
  });
});
