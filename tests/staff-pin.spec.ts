import { test, expect, type Page } from '@playwright/test';

/**
 * E2E de la CREACIÓN DEL PIN.
 *
 * Bug reportado: "creas el PIN en un teléfono y al entrar desde otro te vuelve a
 * pedir crearlo". El PIN se guardaba solo en la base local, sin encolarlo para
 * subirlo, así que la nube nunca lo recibía. Aquí se comprueba, con la interfaz
 * real, que al crearlo queda pendiente de subir (cola STAFF_SYNC) con el HASH, no
 * con el PIN en claro. La parte de bajarlo en el otro teléfono está en
 * sync.integration.test.ts.
 */

const BIZ = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const VENDEDORA = '55555555-5555-4555-8555-555555555555';

async function sembrar(page: Page) {
  await page.route('**/*.supabase.co/**', route => route.abort('failed'));
  await page.goto('/');
  // Se espera a que la propia Dexie de la app esté abierta (con su esquema completo): abrir IndexedDB
  // a mano apenas aparece la base fallaba al azar con "almacén no encontrado".
  await page.waitForFunction(async () => {
    const d = (window as unknown as { dbDebug?: { db: { open: () => Promise<unknown> } } }).dbDebug;
    if (!d) return false;
    await d.db.open();
    return true;
  }, null, { timeout: 30000 });

  await page.evaluate(async ({ BIZ, ADMIN, VENDEDORA }) => {
    // Siembra con la propia Dexie de la app: el esquema está garantizado (abrir IndexedDB a mano
    // fallaba al azar con "almacén no encontrado" mientras la app creaba las tablas).
    const { db } = (window as unknown as { dbDebug: { db: { open: () => Promise<unknown>; table: (n: string) => { put: (v: unknown) => Promise<unknown> } } } }).dbDebug;
    await db.open();
    const put = (store: string, value: unknown) => db.table(store).put(value).then(() => undefined);
    await put('staff', { id: ADMIN, business_id: BIZ, name: 'Dueño Prueba', role: 'admin', pin: '', active: true });
    await put('staff', { id: VENDEDORA, business_id: BIZ, name: 'Vendedora Prueba', role: 'vendedor', pin: '', active: true, sync_status: 'synced' });
    await put('settings', {
      id: BIZ, name: 'Bar de Prueba', business_type: 'retail', master_pin: '1234',
      status: 'active', sync_status: 'synced', subscription_expires_at: '2099-01-01T00:00:00.000Z',
    });
    localStorage.setItem('nexus_business_id', BIZ);
    // Se entra como el admin (sin sesión de red no se puede forzar el selector de
    // arranque) y luego se abre el selector con "Cambiar vendedor".
    localStorage.setItem('nexus_staff_id', ADMIN);
    localStorage.setItem(`nexus_guide_seen_${BIZ}`, '1');
  }, { BIZ, ADMIN, VENDEDORA });
  await page.reload();
}

async function leerTabla<T = Record<string, unknown>>(page: Page, store: string): Promise<T[]> {
  return page.evaluate(async (storeName) => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('NexusPOS_DB');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return new Promise((res, rej) => {
      const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }, store);
}

async function teclear(page: Page, pin: string) {
  for (const d of pin) await page.getByRole('button', { name: d, exact: true }).click();
}

test.describe('Creación del PIN', () => {
  for (const { nombre, id } of [
    { nombre: 'Dueño Prueba', id: ADMIN },
    { nombre: 'Vendedora Prueba', id: VENDEDORA },
  ]) {
    test(`el PIN de "${nombre}" queda pendiente de subir (hasheado)`, async ({ page }) => {
      await sembrar(page);

      await page.getByTitle('Cambiar vendedor').click();
      await page.getByRole('button', { name: new RegExp(nombre) }).click();
      await expect(page.getByText('Crea un PIN de 4 dígitos')).toBeVisible({ timeout: 15000 });
      await teclear(page, '4821');
      await expect(page.getByText('Confirma tu PIN')).toBeVisible();
      await teclear(page, '4821');

      await expect(page.getByText('PIN configurado exitosamente')).toBeVisible({ timeout: 10000 });

      const staff = (await leerTabla<{ id: string; pin: string; sync_status?: string }>(page, 'staff')).find(s => s.id === id)!;
      expect(staff.pin.startsWith('pbkdf2$')).toBe(true); // hash, no "4821"
      expect(staff.pin).not.toContain('4821');

      // Sin red (la nube está bloqueada en el test) la subida queda en la cola.
      const cola = await leerTabla<{ type: string; payload: { id: string; pin: string } }>(page, 'action_queue');
      const subida = cola.find(i => i.type === 'STAFF_SYNC' && i.payload.id === id);
      expect(subida).toBeDefined();
      expect(subida!.payload.pin).toBe(staff.pin);
    });
  }
});
