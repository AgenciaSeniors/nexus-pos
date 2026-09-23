import { test, expect, type Page } from '@playwright/test';

/**
 * E2E del aviso "Nueva versión disponible".
 *
 * POR QUÉ ESTE TEST: el mecanismo estuvo roto en silencio desde mayo. La app
 * consulta `app_versions` en Supabase y solo avisa si la versión remota es
 * MAYOR que la instalada; como nadie insertó la fila al publicar la 1.4.0,
 * la 1.4.1 ni la 1.5.0, la tabla siguió anunciando la 1.3.0 y el banner no
 * apareció nunca. No fallaba nada: simplemente no pasaba nada.
 *
 * Aquí se intercepta `app_versions` para no depender de lo que haya hoy en
 * producción, y se comprueba lo que de verdad importa: que una versión mayor
 * enciende el aviso, que una igual o menor NO lo enciende, y que un fallo de
 * la consulta no rompe la app.
 */

const BIZ = '44444444-4444-4444-8444-444444444444';
const STAFF = '55555555-5555-4555-8555-555555555555';
const APP_VERSIONS = '**/rest/v1/app_versions*';

/** Responde a la consulta de versiones con la versión indicada. */
async function versionRemota(page: Page, version: string) {
  await page.route(APP_VERSIONS, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      // `.single()` de supabase-js espera un objeto, no un arreglo.
      body: JSON.stringify({
        version,
        release_notes: 'Notas de prueba',
        min_version: null,
        platform: 'all',
        created_at: new Date().toISOString(),
      }),
    }),
  );
}

/** Arranca la app con un negocio local, sin login (ruta offline-first). */
async function abrirApp(page: Page) {
  // Todo lo demás de la nube se bloquea: el test no puede tocar datos reales.
  await page.route('**/*.supabase.co/**', route => {
    if (route.request().url().includes('/app_versions')) return route.fallback();
    return route.abort('failed');
  });

  await page.goto('/');
  await page.waitForFunction(async () => {
    const dbs = await indexedDB.databases?.();
    return !!dbs?.some(d => d.name === 'NexusPOS_DB');
  }, null, { timeout: 15000 });

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
    await put('staff', { id: STAFF, business_id: BIZ, name: 'Dueño', role: 'admin', pin: '', active: true, sync_status: 'synced' });
    await put('settings', {
      id: BIZ, name: 'Negocio Prueba', business_type: 'retail', status: 'active',
      sync_status: 'synced', subscription_expires_at: '2099-01-01T00:00:00.000Z',
    });
    localStorage.setItem('nexus_business_id', BIZ);
    localStorage.setItem('nexus_staff_id', STAFF);
    localStorage.setItem(`nexus_guide_seen_${BIZ}`, '1');
  }, { BIZ, STAFF });

  await page.reload();
}

test.describe('Aviso de nueva versión', () => {
  test('una versión remota MAYOR enciende el aviso', async ({ page }) => {
    await versionRemota(page, '9.9.9');
    await abrirApp(page);

    // La frase completa solo vive en el <span> del banner; un regex suelto como
    // /v9\.9\.9/ casaria tambien con el <strong> anidado y Playwright falla en
    // modo estricto al resolver dos elementos.
    await expect(page.getByText(/Nueva versión v9\.9\.9 disponible/)).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('link', { name: /Ver en Configuración/ })).toBeVisible();
  });

  test('una versión remota IGUAL no molesta al usuario', async ({ page }) => {
    // Este es el caso real de hoy: quien ya está al día no debe ver nada.
    await versionRemota(page, '1.6.0');
    await abrirApp(page);

    await expect(page.getByText(/Buenos días|Buenas tardes|Buenas noches/)).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/Nueva versión/)).toHaveCount(0);
  });

  test('una versión remota MENOR tampoco avisa', async ({ page }) => {
    // El bug que tuvimos meses: la tabla anunciaba la 1.3.0 con la app en 1.5.0.
    await versionRemota(page, '1.3.0');
    await abrirApp(page);

    await expect(page.getByText(/Buenos días|Buenas tardes|Buenas noches/)).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/Nueva versión/)).toHaveCount(0);
  });

  test('si la consulta falla, la app sigue funcionando sin avisar', async ({ page }) => {
    await page.route(APP_VERSIONS, route => route.abort('failed'));
    await abrirApp(page);

    await expect(page.getByText(/Buenos días|Buenas tardes|Buenas noches/)).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/Nueva versión/)).toHaveCount(0);
  });

  test('en web, Ajustes ya no remata con "contacta a soporte"', async ({ page }) => {
    // En un navegador de escritorio getPlatform() es 'all': no hay APK que
    // bajar, el PWA se actualiza solo al recargar. Lo que NO debe seguir
    // apareciendo es el "contacta a soporte", que dejaba la actualizacion en
    // manos de una llamada. Los enlaces por plataforma se cubren en
    // src/lib/version.test.ts, que no depende del navegador.
    await versionRemota(page, '9.9.9');
    await abrirApp(page);
    await page.goto('/#/configuracion');
    // El bloque de version vive en la pestaña "Datos y Respaldo".
    await page.getByRole('button', { name: /Datos y Respaldo/ }).click();

    await expect(page.getByText(/Nueva versión disponible: v9\.9\.9/)).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/Recarga la página para aplicar la actualización/)).toBeVisible();
    await expect(page.getByText(/Contacta a soporte para recibir la actualización/)).toHaveCount(0);
  });
});
