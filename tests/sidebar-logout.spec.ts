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
  await page.waitForFunction(
    async () => !!(await indexedDB.databases?.())?.some(d => d.name === 'NexusPOS_DB'),
    null,
    { timeout: 15000 },
  );

  await page.evaluate(async ({ BIZ, STAFF }) => {
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
