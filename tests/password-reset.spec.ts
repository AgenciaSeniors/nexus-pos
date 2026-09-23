import { test, expect, type Page } from '@playwright/test';

/**
 * E2E del flujo "¿Olvidaste tu contraseña?".
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
  // El camino por correo quedó detrás de un enlace: lo primero que se ofrece
  // es escribir a soporte, porque el correo de Supabase no llega a clientes
  // reales. Estas pruebas cubren el camino por correo, que sigue existiendo
  // para cuando haya SMTP propio.
  await page.getByRole('button', { name: /Prefiero recibir un código por correo/ }).click();
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

    // El mensaje ya no promete una cantidad de digitos: la longitud del OTP la
    // fija el proyecto en Supabase y no siempre es 6 (en julio se vio de 8).
    await expect(page.getByText(/Te enviamos un código a tu correo/)).toBeVisible();
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

test.describe('Recuperar contraseña — camino por soporte', () => {
  test('lo primero que se ofrece es escribir a soporte, no el correo', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '¿Olvidaste tu contraseña?' }).click();

    await expect(page.getByRole('link', { name: /Escribir por WhatsApp/ })).toBeVisible();
    // La frase completa vive solo en el <p>; un regex suelto casaria tambien
    // con el <strong> anidado y Playwright falla en modo estricto.
    await expect(page.getByText(/Dinos el nombre de tu negocio/)).toBeVisible();
    // El formulario de correo NO debe aparecer solo: lleva a un correo que
    // hoy no le llega a un cliente real.
    await expect(page.getByRole('button', { name: /Enviar código/ })).toHaveCount(0);
  });

  test('el enlace de WhatsApp ya trae escrito lo que hay que pedir', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '¿Olvidaste tu contraseña?' }).click();

    const href = await page.getByRole('link', { name: /Escribir por WhatsApp/ }).getAttribute('href');
    expect(href).toContain('wa.me');
    // El mensaje pide el nombre del negocio, que es lo que se busca en el panel.
    expect(decodeURIComponent(href || '')).toMatch(/negocio se llama/i);
  });

  test('quien prefiera el correo puede llegar al formulario', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '¿Olvidaste tu contraseña?' }).click();
    await page.getByRole('button', { name: /Prefiero recibir un código por correo/ }).click();

    await expect(page.getByPlaceholder('correo@ejemplo.com')).toBeVisible();
    await expect(page.getByRole('button', { name: /Enviar código/ })).toBeVisible();
  });
});
