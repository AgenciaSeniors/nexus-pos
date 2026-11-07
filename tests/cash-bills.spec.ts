import { test, expect, type Page } from '@playwright/test';

/**
 * E2E de dos pedidos de los administradores:
 *  1. En el teléfono, la lista de productos de la orden mostraba UN producto por pantalla
 *     (cada fila ocupaba media pantalla y el pie del carrito el resto): bajar uno por uno era
 *     engorroso. Ahora cada producto es una línea y el pie va plegado.
 *  2. Al cobrar en efectivo se pueden marcar los billetes con que paga el cliente: el monto se
 *     arma solo y queda registrado para saber cuántos billetes de cada tipo entraron en el turno.
 */

const BIZ = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const SHIFT = '44444444-4444-4444-8444-444444444444';

async function sembrar(page: Page, productos: { name: string; price: number }[]) {
  await page.route('**/*.supabase.co/**', route => route.abort('failed'));
  await page.goto('/');
  await page.waitForFunction(async () => {
    const d = (window as unknown as { dbDebug?: { db: { open: () => Promise<unknown> } } }).dbDebug;
    if (!d) return false;
    await d.db.open();
    return true;
  }, null, { timeout: 30000 });
  await page.evaluate(async ({ BIZ, STAFF, SHIFT, productos }) => {
    const { db } = (window as unknown as { dbDebug: { db: { open: () => Promise<unknown>; table: (n: string) => { put: (v: unknown) => Promise<unknown> } } } }).dbDebug;
    await db.open();
    const now = new Date().toISOString();
    await db.table('staff').put({ id: STAFF, business_id: BIZ, name: 'Ana Pérez', role: 'admin', pin: '', active: true, sync_status: 'synced' });
    await db.table('settings').put({ id: BIZ, name: 'Bodega Luz', business_type: 'retail', master_pin: '1234', status: 'active', sync_status: 'synced', subscription_expires_at: '2099-01-01T00:00:00.000Z' });
    await db.table('cash_shifts').put({ id: SHIFT, business_id: BIZ, staff_id: STAFF, start_amount: 0, opened_at: now, status: 'open', sync_status: 'synced' });
    for (let i = 0; i < productos.length; i++) {
      await db.table('products').put({
        id: `33333333-3333-4333-8333-${String(i + 1).padStart(12, '0')}`, business_id: BIZ, name: productos[i].name, price: productos[i].price, cost: 0,
        stock: 50, sku: null, category: 'General', unit: 'un', sync_status: 'synced', deleted_at: null, created_at: now, updated_at: now,
      });
    }
    localStorage.setItem('nexus_business_id', BIZ);
    localStorage.setItem('nexus_staff_id', STAFF);
    localStorage.setItem(`nexus_guide_seen_${BIZ}`, '1');
  }, { BIZ, STAFF, SHIFT, productos });
  await page.reload();
}

const ultimaVenta = (page: Page) => page.evaluate(async () => {
  const { db } = (window as unknown as { dbDebug: { db: { table: (n: string) => { toArray: () => Promise<unknown[]> } } } }).dbDebug;
  const ventas = await db.table('sales').toArray() as { cash_bills?: Record<string, number>; amount_tendered?: number; change?: number }[];
  return ventas[ventas.length - 1];
});

test.describe('Carrito en el teléfono', () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test('con varios productos en la orden se ven varios a la vez (no uno por pantalla)', async ({ page }) => {
    await sembrar(page, Array.from({ length: 6 }, (_, i) => ({ name: `Producto ${String(i + 1).padStart(2, '0')}`, price: 10 + i })));
    await page.goto('/#/venta');
    for (let i = 1; i <= 6; i++) await page.getByText(`Producto ${String(i).padStart(2, '0')}`, { exact: true }).click();
    await page.getByRole('button', { name: /Ver Carrito/ }).click();

    const filas = page.getByTestId('cart-item');
    await expect(filas).toHaveCount(6);
    // Visibles ENTERAS dentro de la lista (sin bajar): al menos 5 de las 6
    const lista = (await page.getByTestId('cart-list').boundingBox())!;
    let enteras = 0;
    for (let i = 0; i < 6; i++) {
      const b = await filas.nth(i).boundingBox();
      if (b && b.y >= lista.y - 1 && b.y + b.height <= lista.y + lista.height + 1) enteras++;
    }
    expect(enteras).toBeGreaterThanOrEqual(5);
    // Cada fila es compacta
    const b0 = (await filas.first().boundingBox())!;
    expect(b0.height).toBeLessThan(70);

    // Nota / guardar / descuento están plegados y se despliegan
    await expect(page.getByPlaceholder('Nombre o Mesa (Opcional)')).toBeHidden();
    await page.getByTestId('cart-extras-toggle').click();
    await expect(page.getByPlaceholder('Nombre o Mesa (Opcional)')).toBeVisible();
    await expect(page.getByRole('button', { name: /Agregar descuento/ })).toBeVisible();

    // Los controles siguen funcionando en la fila compacta
    await filas.first().getByRole('button', { name: 'Agregar una unidad' }).click();
    await expect(filas.first()).toContainText('2');
    await filas.nth(5).getByRole('button', { name: /Quitar .* del carrito/ }).click();
    await expect(filas).toHaveCount(5);
  });
});

test.describe('Billetes con que paga el cliente', () => {
  test('tocar los billetes arma el monto, calcula el cambio y queda guardado en la venta', async ({ page }) => {
    await sembrar(page, [{ name: 'Pollo entero', price: 1200 }]);
    await page.goto('/#/venta');
    await page.getByText('Pollo entero', { exact: true }).click();
    await page.getByRole('button', { name: /COBRAR AHORA/ }).click();

    await page.getByTestId('bill-1000').click();
    await page.getByTestId('bill-1000').click();
    await page.getByTestId('bill-500').click();
    await expect(page.getByPlaceholder('0.00').first()).toHaveValue('2500');
    await expect(page.getByTestId('bills-chosen')).toContainText('2 × $1000');
    await expect(page.getByTestId('bills-chosen')).toContainText('1 × $500');
    await expect(page.getByText('$1300.00')).toBeVisible(); // cambio

    // Quitar un billete desde la lista de elegidos
    await page.getByTestId('bills-chosen').getByRole('button', { name: /1 × \$500/ }).click();
    await expect(page.getByPlaceholder('0.00').first()).toHaveValue('2000');
    await page.getByTestId('bill-500').click();

    await page.getByRole('button', { name: /Confirmar Cobro/ }).click();
    await expect(page.getByText('Venta completada')).toBeVisible({ timeout: 15000 });
    const venta = await ultimaVenta(page);
    expect(venta.cash_bills).toEqual({ '1000': 2, '500': 1 });
    expect(venta.amount_tendered).toBe(2500);
    expect(venta.change).toBe(1300);

    // Finanzas → Control: billetes recibidos en el turno
    await page.goto('/#/finanzas');
    await page.getByRole('button', { name: 'Control' }).click();
    const tarjeta = page.getByTestId('shift-bills');
    await expect(tarjeta).toBeVisible({ timeout: 15000 });
    await expect(tarjeta).toContainText('2 × $1000');
    await expect(tarjeta).toContainText('1 × $500');
    await expect(tarjeta).toContainText('3 billetes');

    // Cierre del día: también sale, y en el texto de WhatsApp
    // Un aviso (toast) de sincronización puede quedar encima de las pestañas: se pulsa igual.
    await page.getByRole('button', { name: 'Cierre del día' }).dispatchEvent('click');
    await expect(page.getByTestId('z-bills')).toContainText('2 × $1000');
  });

  test('si el cajero escribe el monto a mano, no se inventa un desglose', async ({ page }) => {
    await sembrar(page, [{ name: 'Pollo entero', price: 1200 }]);
    await page.goto('/#/venta');
    await page.getByText('Pollo entero', { exact: true }).click();
    await page.getByRole('button', { name: /COBRAR AHORA/ }).click();

    await page.getByTestId('bill-1000').click();
    await page.getByPlaceholder('0.00').first().fill('1300');
    await expect(page.getByTestId('bills-chosen')).toHaveCount(0);
    await page.getByRole('button', { name: /Confirmar Cobro/ }).click();
    await expect(page.getByText('Venta completada')).toBeVisible({ timeout: 15000 });
    const venta = await ultimaVenta(page);
    expect(venta.cash_bills).toBeUndefined();
    expect(venta.amount_tendered).toBe(1300);
  });

  test('el contador de efectivo tiene los billetes de 10 000 y 20 000', async ({ page }) => {
    await sembrar(page, []);
    await page.goto('/#/venta');
    await page.getByTitle('Contador de Efectivo').click();
    await expect(page.getByText(/\$20[,.\s]?000/).first()).toBeVisible();
    await expect(page.getByText(/\$10[,.\s]?000/).first()).toBeVisible();
  });
});
