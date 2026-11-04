import { test, expect, type Page } from '@playwright/test';

/**
 * E2E de la RECONEXIÓN.
 *
 * Reportado: "hago movimientos sin internet, me conecto y no sincroniza, ni con el botón de
 * arriba a la derecha; tengo que cerrar sesión y volver a entrar". Causa: la app se fiaba de
 * `navigator.onLine`, que en el WebView de Android a veces no avisa de que volvió la conexión
 * (sobre todo con la app en segundo plano). La interfaz se quedaba creyendo que no había red,
 * con el botón desactivado, y la cola ni se intentaba.
 *
 * Aquí el navegador MIENTE: dice "sin red" todo el tiempo y no emite jamás el evento `online`,
 * mientras que el "internet" (las rutas de Supabase) se enciende y se apaga a voluntad.
 */

const BIZ = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
};

/** "Internet" simulado: mientras `up` sea false todo falla como sin red. */
function internet(page: Page) {
  const estado = { up: false };
  return page.route('**/*.supabase.co/**', route => {
    if (!estado.up) return route.abort('failed');
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: '[]' });
  }).then(() => estado);
}

async function sembrar(page: Page) {
  // El navegador dice "sin red" SIEMPRE y nunca avisa de que vuelve.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    // Sesión de Supabase válida (para que la cola no la dé por perdida). Solo DESPUÉS de sembrar los datos
    // locales: con sesión y sin datos, la app (sin internet) fuerza el cierre de sesión y recarga.
    if (!localStorage.getItem('e2e_listo')) return;
    const ref = 'e2e-nunca-existe';
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
      access_token: 'a.b.c', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp,
      user: { id: '22222222-2222-4222-8222-222222222222', email: 'dueno@prueba.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
    }));
  });
  const red = await internet(page);

  // El servidor de desarrollo a veces recarga la página justo al arrancar; se reintenta la siembra.
  let ultimoError: unknown;
  for (let intento = 0; intento < 4; intento++) {
    try {
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
      await db.table('staff').put({ id: STAFF, business_id: BIZ, name: 'Dueño Prueba', role: 'admin', pin: '', active: true, sync_status: 'synced' });
      await db.table('settings').put({
        id: BIZ, name: 'Bar de Prueba', business_type: 'retail', master_pin: '1234',
        status: 'active', sync_status: 'synced', subscription_expires_at: '2099-01-01T00:00:00.000Z',
      });
      // Un cambio hecho SIN internet, esperando para subir
      await db.table('action_queue').put({
        id: '88888888-8888-4888-8888-888888888801', type: 'AUDIT', status: 'pending', retries: 0,
        timestamp: Date.now(), enqueued_at: Date.now(),
        payload: { id: '99999999-9999-4999-8999-999999999901', business_id: BIZ, staff_id: STAFF, staff_name: 'x', action: 'SALE', details: {}, created_at: new Date().toISOString(), sync_status: 'pending_create' },
      });
      localStorage.setItem('e2e_listo', '1');
      localStorage.setItem('nexus_business_id', BIZ);
      localStorage.setItem('nexus_staff_id', STAFF);
      localStorage.setItem(`nexus_guide_seen_${BIZ}`, '1');
    }, { BIZ, STAFF });
      ultimoError = undefined;
      break;
    } catch (e) {
      ultimoError = e;
    }
  }
  if (ultimoError) throw ultimoError;
  await page.reload();
  return red;
}

const enCola = (page: Page) => page.evaluate(async () => {
  const { db } = (window as unknown as { dbDebug: { db: { table: (n: string) => { count: () => Promise<number> } } } }).dbDebug;
  return db.table('action_queue').count();
});

test.describe('Reconexión sin que el navegador avise', () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test('vuelve el internet pero NO el evento "online": la app lo detecta sola y sube lo pendiente', async ({ page }) => {
    const red = await sembrar(page);
    await page.goto('/#/venta');

    // Sin internet: aviso de sin conexión y el cambio sigue guardado
    await expect(page.getByText(/sin conexi[oó]n/i).first()).toBeVisible({ timeout: 20000 });
    expect(await enCola(page)).toBe(1);

    // Vuelve el internet. El navegador sigue diciendo "sin red" y no emite ningún evento.
    red.up = true;

    // La app lo detecta sola (sondeo cada 10 s) y sube lo pendiente sin tocar nada
    await expect.poll(() => enCola(page), { timeout: 40000, intervals: [1000] }).toBe(0);
    await expect(page.getByText('Conexión restaurada')).toBeVisible({ timeout: 10000 });
  });

  test('el botón de sincronizar NO está bloqueado aunque la app crea que no hay red, y sube al tocarlo', async ({ page }) => {
    const red = await sembrar(page);
    await page.goto('/#/venta');
    await expect(page.getByText(/sin conexi[oó]n/i).first()).toBeVisible({ timeout: 20000 });

    red.up = true; // ya hay internet, pero la app aún no se ha enterado
    const boton = page.locator('header button').last();
    await expect(boton).toBeEnabled();
    await boton.click();

    await expect.poll(() => enCola(page), { timeout: 30000, intervals: [500] }).toBe(0);
  });

  test('sin internet de verdad, tocar el botón lo explica y no pierde nada', async ({ page }) => {
    await sembrar(page); // internet apagado
    await page.goto('/#/venta');
    await expect(page.getByText(/sin conexi[oó]n/i).first()).toBeVisible({ timeout: 20000 });

    await page.locator('header button').last().click();
    await expect(page.getByText(/Sin conexión real a internet/)).toBeVisible({ timeout: 15000 });
    expect(await enCola(page)).toBe(1);
  });
});
