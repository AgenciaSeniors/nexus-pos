import { test, expect } from '@playwright/test';

/**
 * El botón "Cerrar Sesión" tiene que quedar dentro de la pantalla.
 *
 * La barra lateral apila el menú y, debajo, el bloque con Cerrar Sesión. Sin
 * scroll propio en el `<nav>`, en una pantalla baja (portátil de 768px, o
 * cualquiera con la ventana a media altura) ese bloque se empuja fuera del
 * viewport y el usuario NO PUEDE cerrar sesión.
 *
 * Medido en `main` antes del arreglo con la ventana a 480px de alto: el botón
 * caía en y=668..712, o sea 232px fuera. Con el arreglo queda en y=412..456.
 *
 * El arreglo existía desde julio en la rama `claude/reset-fix-v1.5.0` y nunca
 * se mergeó. Este test es lo que impide que se vuelva a perder.
 */

const BIZ = '66666666-6666-4666-8666-666666666666';
const STAFF = '77777777-7777-4777-8777-777777777777';

test('el botón Cerrar Sesión queda dentro de la pantalla en ventanas bajas', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 480 });
  await page.route('**/*.supabase.co/**', route => route.abort('failed'));

  await page.goto('/');
  await page.waitForFunction(async () => {
    const d = (window as unknown as { dbDebug?: { db: { open: () => Promise<unknown> } } }).dbDebug;
    if (!d) return false;
    await d.db.open();
    return true;
  }, null, { timeout: 30000 });

  await page.evaluate(async ({ BIZ, STAFF }) => {
    // Siembra con la propia Dexie de la app: el esquema está garantizado (abrir IndexedDB a mano
    // fallaba al azar con "almacén no encontrado" mientras la app creaba las tablas).
    const { db } = (window as unknown as { dbDebug: { db: { open: () => Promise<unknown>; table: (n: string) => { put: (v: unknown) => Promise<unknown> } } } }).dbDebug;
    await db.open();
    const put = (store: string, value: unknown) => db.table(store).put(value).then(() => undefined);
    await put('staff', { id: STAFF, business_id: BIZ, name: 'Dueña', role: 'admin', pin: '', active: true, sync_status: 'synced' });
    await put('settings', {
      id: BIZ, name: 'Negocio Prueba', business_type: 'retail', status: 'active',
      sync_status: 'synced', subscription_expires_at: '2099-01-01T00:00:00.000Z',
    });
    localStorage.setItem('nexus_business_id', BIZ);
    localStorage.setItem('nexus_staff_id', STAFF);
    localStorage.setItem(`nexus_guide_seen_${BIZ}`, '1');
  }, { BIZ, STAFF });

  await page.reload();

  const boton = page.getByRole('button', { name: /Cerrar Sesión/i });
  await expect(boton).toBeVisible({ timeout: 20000 });

  // `toBeVisible` no basta: un elemento empujado fuera del viewport sigue
  // considerandose visible. Lo que importa es que su borde inferior entre.
  const caja = await boton.boundingBox();
  expect(caja).not.toBeNull();
  expect(caja!.y + caja!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
});
