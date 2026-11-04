import { test, expect } from '@playwright/test';

/**
 * E2E del inicio de sesión: el correo de la última cuenta queda escrito y los campos llevan
 * los atributos que el gestor de contraseñas del teléfono necesita para guardar/rellenar la
 * contraseña (la contraseña NUNCA se guarda dentro de la app).
 */

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
};

test.describe('Inicio de sesión — recordar la cuenta', () => {
  test('los campos tienen los atributos del gestor de contraseñas', async ({ page }) => {
    await page.route('**/*.supabase.co/**', route => route.abort('failed'));
    await page.goto('/');

    const correo = page.getByPlaceholder('correo@ejemplo.com');
    const clave = page.getByPlaceholder('••••••••');
    await expect(correo).toBeVisible({ timeout: 20000 });
    await expect(correo).toHaveAttribute('autocomplete', 'username');
    await expect(correo).toHaveAttribute('name', 'email');
    await expect(clave).toHaveAttribute('autocomplete', 'current-password');
    await expect(clave).toHaveAttribute('name', 'password');
  });

  test('si ya había entrado antes, el correo aparece escrito', async ({ page }) => {
    await page.route('**/*.supabase.co/**', route => route.abort('failed'));
    await page.addInitScript(() => localStorage.setItem('senio_last_email', 'dueno@negocio.test'));
    await page.goto('/');
    await expect(page.getByPlaceholder('correo@ejemplo.com')).toHaveValue('dueno@negocio.test', { timeout: 20000 });
    // y la contraseña nunca viene guardada por la app
    await expect(page.getByPlaceholder('••••••••')).toHaveValue('');
  });

  test('al entrar bien se recuerda el correo (y la contraseña no se guarda en ningún sitio)', async ({ page }) => {
    await page.route('**/*.supabase.co/**', route => {
      const url = route.request().url();
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      if (url.includes('/auth/v1/token')) {
        const exp = Math.floor(Date.now() / 1000) + 3600;
        return route.fulfill({
          status: 200, headers: { ...CORS, 'content-type': 'application/json' },
          body: JSON.stringify({
            access_token: 'a.b.c', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp,
            user: { id: '22222222-2222-4222-8222-222222222222', email: 'dueno@negocio.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
          }),
        });
      }
      return route.abort('failed');
    });
    await page.goto('/');

    await page.getByPlaceholder('correo@ejemplo.com').fill('dueno@negocio.test');
    await page.getByPlaceholder('••••••••').fill('ClaveSecreta123');
    await page.getByRole('button', { name: /Iniciar Sesi[oó]n|Entrar|Ingresar/i }).first().click();

    // Sin datos locales y sin red la app recarga la página tras entrar: se tolera esa navegación.
    const leer = () => page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })).catch(() => '');
    await expect.poll(async () => (await leer()).includes('"senio_last_email":"dueno@negocio.test"'), { timeout: 15000 }).toBe(true);

    // La contraseña no aparece en ningún almacenamiento de la app
    expect(await leer()).not.toContain('ClaveSecreta123');
  });
});
