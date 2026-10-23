import { test, expect, type Page } from '@playwright/test';

/**
 * E2E de la SESIÓN PERDIDA.
 *
 * Reportado: avisos rojos "Sincronización fallida: Producto. new row violates
 * row-level security policy..." que desaparecían al cerrar sesión y volver a entrar.
 * Sin sesión válida el servidor rechaza todo con errores de permisos; la app debe
 * decirlo UNA vez, con claridad y con un botón para volver a entrar, en vez de
 * gastar los reintentos de cada operación y soltar mensajes crudos.
 */

const BIZ = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';

async function sembrar(page: Page, conCola: boolean) {
  await page.route('**/*.supabase.co/**', route => route.abort('failed'));
  await page.goto('/');
  // Se siembra con la propia Dexie de la app (expuesta en desarrollo como window.dbDebug) en vez de
  // abrir IndexedDB a mano: así el esquema está garantizado y no hay carrera con su creación
  // (con la máquina cargada, sembrar a mano fallaba al azar con "almacén no encontrado").
  await page.waitForFunction(() => !!(window as unknown as { dbDebug?: unknown }).dbDebug, null, { timeout: 30000 });

  await page.evaluate(async ({ BIZ, STAFF, conCola }) => {
    const { db } = (window as unknown as { dbDebug: { db: { open: () => Promise<unknown>; table: (n: string) => { put: (v: unknown) => Promise<unknown> } } } }).dbDebug;
    await db.open();
    await db.table('staff').put({ id: STAFF, business_id: BIZ, name: 'Dueño Prueba', role: 'admin', pin: '', active: true, sync_status: 'synced' });
    await db.table('settings').put({
      id: BIZ, name: 'Bar de Prueba', business_type: 'retail', master_pin: '1234',
      status: 'active', sync_status: 'synced', subscription_expires_at: '2099-01-01T00:00:00.000Z',
    });
    if (conCola) {
      await db.table('action_queue').put({
        id: '88888888-8888-4888-8888-888888888801', type: 'AUDIT', status: 'pending', retries: 0,
        timestamp: Date.now(), enqueued_at: Date.now(),
        payload: { id: '99999999-9999-4999-8999-999999999901', business_id: BIZ, staff_id: STAFF, staff_name: 'x', action: 'SALE', details: {}, created_at: new Date().toISOString(), sync_status: 'pending_create' },
      });
    }
    localStorage.setItem('nexus_business_id', BIZ);
    localStorage.setItem('nexus_staff_id', STAFF);
    localStorage.setItem(`nexus_guide_seen_${BIZ}`, '1');
  }, { BIZ, STAFF, conCola });
  await page.reload();
}

test.describe('Sesión perdida', () => {
  test('sin sesión y con cosas por enviar: UN aviso fijo con botón para volver a entrar, sin dar nada por fallido', async ({ page }) => {
    await sembrar(page, true);
    // Arranca el envío (en la app lo hace el reloj de 30 s o al recuperar la red)
    await page.evaluate(() => window.dispatchEvent(new Event('online')));

    const aviso = page.getByText(/Se perdió la sesión/);
    await expect(aviso).toBeVisible({ timeout: 20000 });
    await expect(aviso).toContainText('NO se está enviando');
    await expect(aviso).toContainText('no pierdes datos');
    await expect(page.getByRole('button', { name: 'Volver a entrar' })).toBeVisible();

    // Nada se dio por fallido: la operación sigue pendiente y sin gastar reintentos
    const cola = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open('NexusPOS_DB');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      return new Promise<{ status: string; retries: number }[]>((res, rej) => {
        const req = db.transaction('action_queue', 'readonly').objectStore('action_queue').getAll();
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
    });
    expect(cola).toHaveLength(1);
    expect(cola[0]).toMatchObject({ status: 'pending', retries: 0 });
  });

  test('"Volver a entrar" lleva al inicio de sesión', async ({ page }) => {
    await sembrar(page, true);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));

    await page.getByRole('button', { name: 'Volver a entrar' }).click({ timeout: 20000 });

    await expect(page.getByRole('heading', { name: 'Iniciar Sesión' })).toBeVisible({ timeout: 15000 });
    // El inicio de sesión muestra qué compilación está corriendo (versión · commit): así se sabe
    // con certeza si la app está al día o enseñando una versión vieja.
    await expect(page.getByTestId('build-id')).toContainText(/^v\d+\.\d+\.\d+ · \S+$/);
  });

  test('el aviso rojo de "sincronización fallida" ya no enseña el error crudo del servidor', async ({ page }) => {
    await sembrar(page, false);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('nexus-sync-failed', {
      detail: { type: 'Producto', error: 'Error producto: new row violates row-level security policy for table "products"' },
    })));

    const aviso = page.getByText(/No se pudo enviar \(Producto\)/);
    await expect(aviso).toBeVisible({ timeout: 10000 });
    await expect(aviso).toContainText('Cierra sesión y vuelve a entrar');
    await expect(page.getByText(/row-level security/)).toHaveCount(0);
  });
});
