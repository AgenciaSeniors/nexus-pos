import { test, expect, Page } from '@playwright/test';

const URL = process.env.APP_URL || 'http://localhost:5173';

const NUM_CAJEROS = 4;
const VENTAS_POR_CAJERO = 8;
const PRODUCTOS = 10;
const PIN = '1234';

const ADMIN = {
  email: process.env.ADMIN_EMAIL!,
  pass: process.env.ADMIN_PASS!
};

test.describe.serial('NEXUS POS – STRESS v2', () => {

  test('SETUP: crear negocio e inventario', async ({ browser }) => {
    const page = await browser.newPage();

    // Limpieza real
    await page.goto(URL);
    await page.evaluate(async () => {
      localStorage.clear();
      const dbs = await indexedDB.databases();
      dbs.forEach(db => db?.name && indexedDB.deleteDatabase(db.name));
    });

    // Registro
    await page.goto('/register');
    await page.getByTestId('register-name').fill('Stress User');
    await page.getByTestId('register-business').fill('Stress POS');
    await page.getByTestId('register-email').fill(`stress_${Date.now()}@test.com`);
    await page.getByTestId('register-password').fill('123456');
    await page.getByTestId('register-submit').click();

    await expect(page.getByTestId('register-success')).toBeVisible();

    // Admin aprueba
    const admin = await browser.newPage();
    await admin.goto('/admin/login');
    await admin.getByTestId('admin-email').fill(ADMIN.email);
    await admin.getByTestId('admin-password').fill(ADMIN.pass);
    await admin.getByTestId('admin-login').click();

    await admin.getByTestId('pending-requests').click();
    await admin.getByTestId('approve-first').click();

    // Login usuario
    await page.goto('/login');
    await page.getByTestId('login-email').fill(`stress_${Date.now()}@test.com`);
    await page.getByTestId('login-password').fill('123456');
    await page.getByTestId('login-submit').click();

    await page.getByTestId('pinpad');
    for (const d of PIN) await page.getByTestId(`pin-${d}`).click();

    // Inventario
    await page.goto('/inventario');
    for (let i = 0; i < PRODUCTOS; i++) {
      await page.getByTestId('new-product').click();
      await page.getByTestId('product-name').fill(`Item-${i}`);
      await page.getByTestId('product-price').fill(`${10 + i}`);
      await page.getByTestId('product-stock').fill('1000');
      await page.getByTestId('product-save').click();
    }

    await expect(page.getByText('Item-9')).toBeVisible();
  });

  test('STRESS: ventas paralelas + offline', async ({ browser }) => {
    const pages: Page[] = [];

    for (let i = 0; i < NUM_CAJEROS; i++) {
      pages.push(await browser.newPage());
    }

    await Promise.all(pages.map(async (p) => {
      await p.goto('/pos');

      if (await p.getByTestId('open-shift').isVisible()) {
        await p.getByTestId('open-shift-amount').fill('500');
        await p.getByTestId('open-shift-confirm').click();
      }

      for (let i = 0; i < VENTAS_POR_CAJERO; i++) {
        if (i % 3 === 0) await p.context().setOffline(true);
        else await p.context().setOffline(false);

        await p.getByTestId('product-search').fill('Item-');
        await p.getByTestId('product-card').first().click();
        await p.getByTestId('checkout').click();
        await p.getByTestId('payment-cash').click();
        await p.getByTestId('confirm-payment').click();
      }
    }));
  });

  test('VERIFY: integridad del sistema', async ({ page }) => {
    await page.goto('/admin/dashboard');

    const pending = await page.getByTestId('sync-pending').innerText();
    expect(Number(pending)).toBe(0);

    const errors = await page.getByTestId('error-log').count();
    expect(errors).toBe(0);
  });

});
