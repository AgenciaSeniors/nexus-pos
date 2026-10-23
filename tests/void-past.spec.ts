import { test, expect, type Page } from '@playwright/test';

/**
 * E2E de ANULAR una venta de un día pasado (turno ya cerrado).
 *
 * Qué debe pasar: la venta vieja pasa a "anulada", el stock vuelve, y el dinero
 * sale de la caja del turno ABIERTO HOY (la venta de ayer no se toca: el reporte
 * de ayer es inmutable).
 */

const BIZ = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const SHIFT_AYER = '44444444-4444-4444-8444-4444444444a1';
const SHIFT_HOY = '44444444-4444-4444-8444-4444444444b2';
const PRODUCTO = '33333333-3333-4333-8333-3333333333f1';
const VENTA_EFECTIVO = 'aaaaaaaa-0000-4000-8000-0000000000f1';
const VENTA_TRANSFER = 'aaaaaaaa-0000-4000-8000-0000000000f2';

function hace(dias: number, hora: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  d.setHours(hora, 0, 0, 0);
  return d.toISOString();
}

const venta = (id: string, total: number, metodo: string, extra: Record<string, unknown> = {}) => ({
  id, business_id: BIZ, shift_id: SHIFT_AYER, date: hace(1, 12), total, payment_method: metodo,
  status: 'completed', sync_status: 'synced', staff_id: STAFF, staff_name: 'Dueño Prueba',
  amount_tendered: total, change: 0,
  items: [{ product_id: PRODUCTO, name: 'Café Cubita', price: total / 2, quantity: 2, cost: 0 }],
  ...extra,
});

async function sembrar(page: Page) {
  await page.route('**/*.supabase.co/**', route => route.abort('failed'));
  await page.goto('/');
  await page.waitForFunction(async () => {
    const dbs = await indexedDB.databases?.();
    return !!dbs?.some(d => d.name === 'NexusPOS_DB');
  }, null, { timeout: 15000 });

  await page.evaluate(async ({ BIZ, STAFF, SHIFT_AYER, SHIFT_HOY, PRODUCTO, ventas, ayerAbre, ayerCierra, hoyAbre }) => {
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
    await put('products', {
      id: PRODUCTO, business_id: BIZ, name: 'Café Cubita', price: 50, cost: 0, stock: 6, stock_warehouse: 0,
      sku: null, category: 'General', unit: 'un', sync_status: 'synced', deleted_at: null,
    });
    await put('cash_shifts', { id: SHIFT_AYER, business_id: BIZ, staff_id: STAFF, start_amount: 500, opened_at: ayerAbre, closed_at: ayerCierra, status: 'closed', end_amount: 600, expected_amount: 600, difference: 0, sync_status: 'synced' });
    await put('cash_shifts', { id: SHIFT_HOY, business_id: BIZ, staff_id: STAFF, start_amount: 500, opened_at: hoyAbre, status: 'open', sync_status: 'synced' });
    for (const v of ventas) await put('sales', v);
    localStorage.setItem('nexus_business_id', BIZ);
    localStorage.setItem('nexus_staff_id', STAFF);
    localStorage.setItem(`nexus_guide_seen_${BIZ}`, '1');
    localStorage.setItem(`nexus_sales_backfill_v1_${BIZ}`, '1');
  }, {
    BIZ, STAFF, SHIFT_AYER, SHIFT_HOY, PRODUCTO,
    ventas: [venta(VENTA_EFECTIVO, 100, 'efectivo'), venta(VENTA_TRANSFER, 80, 'transferencia')],
    ayerAbre: hace(1, 8), ayerCierra: hace(1, 20), hoyAbre: new Date(Date.now() - 3600_000).toISOString(),
  });
  await page.reload();
}

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

async function anular(page: Page, filaTexto: RegExp) {
  await page.goto('/#/finanzas');
  await page.getByRole('button', { name: 'Historial' }).click();
  const fila = page.locator('tr', { hasText: filaTexto }).first();
  await expect(fila).toBeVisible({ timeout: 20000 });
  await fila.getByRole('button', { name: /Anular/ }).click();
  await page.getByRole('button', { name: /Continuar/ }).click();
  await expect(page.getByText('Acceso Restringido')).toBeVisible({ timeout: 10000 });
  for (const d of ['1', '2', '3', '4']) await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: 'VERIFICAR' }).click();
  await expect(page.getByText('Venta anulada y stock restaurado')).toBeVisible({ timeout: 15000 });
}

test.describe('Anular una venta de un día pasado', () => {
  test('en EFECTIVO: la venta se anula, el stock vuelve y el dinero sale de la caja de HOY', async ({ page }) => {
    await sembrar(page);
    await anular(page, /efectivo/i);

    const ventas = await leerTabla<{ id: string; status: string }>(page, 'sales');
    expect(ventas.find(v => v.id === VENTA_EFECTIVO)?.status).toBe('voided');
    expect(ventas.find(v => v.id === VENTA_TRANSFER)?.status).toBe('completed');

    // El dinero sale de la caja del turno ABIERTO (hoy), no del turno de ayer
    const salidas = (await leerTabla<{ shift_id: string; type: string; amount: number; reason: string }>(page, 'cash_movements'));
    expect(salidas).toHaveLength(1);
    expect(salidas[0]).toMatchObject({ shift_id: SHIFT_HOY, type: 'out', amount: 100 });
    expect(salidas[0].reason).toContain('Venta Anterior');

    // El stock vuelve (6 + 2) con su movimiento
    const prod = (await leerTabla<{ id: string; stock: number }>(page, 'products')).find(p => p.id === PRODUCTO)!;
    expect(prod.stock).toBe(8);
    const movs = await leerTabla<{ qty_change: number; reason: string }>(page, 'movements');
    expect(movs.some(m => m.qty_change === 2 && m.reason.startsWith('Anulación'))).toBe(true);
  });

  test('el Corte Z de AYER no cambia al anular hoy una venta de ayer', async ({ page }) => {
    await sembrar(page);
    await anular(page, /efectivo/i);

    const ayer = new Date(); ayer.setDate(ayer.getDate() - 1);
    const p = (n: number) => String(n).padStart(2, '0');
    await page.getByRole('button', { name: 'Cierre del día' }).click();
    await page.locator('input[type="date"]').fill(`${ayer.getFullYear()}-${p(ayer.getMonth() + 1)}-${p(ayer.getDate())}`);

    // Ayer se vendió 100 (efectivo) + 80 (transferencia) = 180, tal cual quedó ese día
    await expect(page.getByText('TOTAL NETO', { exact: true }).locator('..')).toContainText('180');
    // Y lo dice con claridad: esa anulación no se descontó de ayer, salió de la caja de hoy
    await expect(page.getByTestId('z-anuladas-despues')).toContainText('siguen incluidas en este reporte');
    await expect(page.getByText('no incluidas en el total neto')).toHaveCount(0);
  });

  test('el Corte Z de HOY descuenta la devolución de una venta de ayer (ajuste negativo, el día que ocurre)', async ({ page }) => {
    await sembrar(page);
    await anular(page, /efectivo/i);

    await page.getByRole('button', { name: 'Cierre del día' }).click();

    // Hoy no se vendió nada, pero se devolvieron 100 de ayer: el día lo refleja.
    await expect(page.getByTestId('z-devoluciones-anteriores')).toContainText('Devoluciones de ventas anteriores');
    await expect(page.getByTestId('z-devoluciones-anteriores')).toContainText('100');
    const total = page.getByText('TOTAL NETO', { exact: true }).locator('..');
    await expect(total).toContainText('100');
    await expect(total).toContainText(/[-−]/); // negativo
  });

  test('el ajuste también entra en los Reportes del día (ingresos)', async ({ page }) => {
    await sembrar(page);
    await anular(page, /efectivo/i);

    await page.getByRole('button', { name: 'Reportes' }).click();
    // Sin ventas hoy y 100 devueltos de ayer, los ingresos del día son negativos.
    await expect(page.getByText(/[-−]\$?\s?100/).first()).toBeVisible({ timeout: 10000 });
  });

  test('devolver por TRANSFERENCIA una venta anterior baja las transferencias esperadas del turno', async ({ page }) => {
    await sembrar(page);
    await anular(page, /transfer/i);

    await page.goto('/#/finanzas');
    await page.getByRole('button', { name: 'Control' }).click();
    await page.getByRole('button', { name: 'Cerrar Turno' }).click();
    await expect(page.getByText('Acceso Restringido')).toBeVisible({ timeout: 10000 });
    for (const d of ['1', '2', '3', '4']) await page.getByRole('button', { name: d, exact: true }).click();
    await page.getByRole('button', { name: 'VERIFICAR' }).click();

    await expect(page.getByText(/por devoluciones de ventas de turnos anteriores/)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Incluye [-−]\$?\s?80/)).toBeVisible();
  });

  test('en TRANSFERENCIA: la venta se anula pero NO sale dinero de la caja (hoy no se descuenta nada)', async ({ page }) => {
    await sembrar(page);
    await anular(page, /transfer/i);

    const ventas = await leerTabla<{ id: string; status: string }>(page, 'sales');
    expect(ventas.find(v => v.id === VENTA_TRANSFER)?.status).toBe('voided');
    expect(await leerTabla(page, 'cash_movements')).toHaveLength(0);
  });
});
