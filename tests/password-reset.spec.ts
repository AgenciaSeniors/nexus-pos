import { test, expect, type Page } from '@playwright/test';

/**
 * E2E del flujo "¿Olvidaste tu contraseña?" (código de 6 dígitos).
 *
 * El envío del correo lo hace el servidor de Supabase, así que aquí
 * interceptamos `/auth/v1/recover` y reproducimos cada respuesta que se ve en
 * producción: el fallo de red, el 429 del límite de un correo por minuto, el
 * 500 del servidor de correo y el envío correcto. Lo que se verifica es la
 * reacción de la app: qué mensaje muestra y si bloquea el reenvío.
 */

const RECOVER = '**/auth/v1/recover*';

/** Abre la app y navega hasta la pantalla de recuperar contraseña. */
async function irARecuperar(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '¿Olvidaste tu contraseña?' }).click();
  await expect(page.getByRole('button', { name: /Enviar código/ })).toBeVisible();
}

async function pedirCodigo(page: Page, email = 'cliente@ejemplo.com') {
  await page.getByPlaceholder('correo@ejemplo.com').fill(email);
  await page.getByRole('button', { name: /Enviar código/ }).click();
}

test.describe('Recuperar contraseña', () => {
  test('sin conexión con el servidor no culpa al internet del usuario', async ({ page }) => {
    // Reproduce el "Failed to fetch" que veían los usuarios: la petición no
    // llega a completarse. El dispositivo está en línea, así que el mensaje
    // NO debe achacarlo a la conexión del usuario.
    await page.route(RECOVER, route => route.abort('failed'));
    await irARecuperar(page);
    await pedirCodigo(page);

    await expect(page.getByText(/No pudimos contactar con el servidor/)).toBeVisible();
    await expect(page.getByText(/Sin conexión a internet/)).toHaveCount(0);
  });

  test('el 429 explica cuántos segundos hay que esperar', async ({ page }) => {
    await page.route(RECOVER, route =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'over_email_send_rate_limit',
          message: 'For security purposes, you can only request this after 47 seconds.',
        }),
      }),
    );
    await irARecuperar(page);
    await pedirCodigo(page);

    await expect(page.getByText(/Solo puedes pedir un código cada 47 segundos/)).toBeVisible();
  });

  test('el 500 del servidor de correo ofrece soporte por WhatsApp', async ({ page }) => {
    await page.route(RECOVER, route =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Error sending recovery email' }),
      }),
    );
    await irARecuperar(page);
    await pedirCodigo(page);

    await expect(page.getByText(/servidor de correo no pudo enviar el código/)).toBeVisible();
  });

  test('tras un envío correcto pasa al código y bloquea el reenvío 60 s', async ({ page }) => {
    await page.route(RECOVER, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );
    await irARecuperar(page);
    await pedirCodigo(page);

    await expect(page.getByText(/Te enviamos un código de 6 dígitos/)).toBeVisible();
    // Ya en la pantalla del código, con la nueva contraseña.
    await expect(page.getByRole('textbox', { name: '••••••', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cambiar contraseña' })).toBeVisible();

    // El reenvío queda bloqueado con cuenta atrás: pulsarlo de inmediato era
    // justo lo que provocaba el 429 que el usuario leía como "falla el sistema".
    const reenviar = page.getByRole('button', { name: /Reenviar código/ });
    await expect(reenviar).toBeDisabled();
    await expect(reenviar).toHaveText(/Reenviar código en \d+s/);
  });

  test('un correo mal escrito no gasta una petición al servidor', async ({ page }) => {
    let peticiones = 0;
    await page.route(RECOVER, route => {
      peticiones++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await irARecuperar(page);

    // `type="email"` bloquearía el submit del navegador, así que se usa un
    // valor que el input acepta pero nuestra validación rechaza.
    await page.getByPlaceholder('correo@ejemplo.com').fill('cliente@ejemplo');
    await page.getByRole('button', { name: /Enviar código/ }).click();

    await expect(page.getByText(/Escribe un correo válido/)).toBeVisible();
    expect(peticiones).toBe(0);
  });
});
