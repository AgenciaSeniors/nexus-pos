import { chromium, type FullConfig } from '@playwright/test';

/**
 * Precalienta el servidor de desarrollo antes de las pruebas.
 *
 * Recién arrancado, Vite compila cada módulo la primera vez que se pide. Con 8 pruebas
 * abriendo la app a la vez sobre un servidor frío, la página se recargaba a mitad de la
 * siembra de datos y las pruebas fallaban al azar ("window.dbDebug is undefined"), sobre
 * todo las primeras de cada corrida. Aquí se abre la app UNA vez, se recorren las pantallas
 * (para que también se compilen las que se cargan bajo demanda) y solo entonces empiezan.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL || 'http://localhost:5173';
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );
  try {
    const page = await browser.newPage();
    await page.route('**/*.supabase.co/**', route => route.abort('failed'));
    const listo = () => page.waitForFunction(
      () => !!(window as unknown as { dbDebug?: unknown }).dbDebug, null, { timeout: 60000 },
    );

    await page.goto(baseURL);
    await listo();
    // Negocio mínimo para poder entrar a las pantallas internas y que se compilen.
    await page.evaluate(async () => {
      const { db } = (window as unknown as { dbDebug: { db: { open: () => Promise<unknown>; table: (n: string) => { put: (v: unknown) => Promise<unknown> } } } }).dbDebug;
      await db.open();
      const BIZ = '11111111-1111-4111-8111-111111111111';
      const STAFF = '22222222-2222-4222-8222-222222222222';
      await db.table('staff').put({ id: STAFF, business_id: BIZ, name: 'Calentamiento', role: 'admin', pin: '', active: true, sync_status: 'synced' });
      await db.table('settings').put({ id: BIZ, name: 'Calentamiento', business_type: 'retail', master_pin: '1234', status: 'active', sync_status: 'synced', subscription_expires_at: '2099-01-01T00:00:00.000Z' });
      localStorage.setItem('nexus_business_id', BIZ);
      localStorage.setItem('nexus_staff_id', STAFF);
      localStorage.setItem(`nexus_guide_seen_${BIZ}`, '1');
    });
    await page.reload();
    await listo();
    for (const ruta of ['/#/venta', '/#/finanzas', '/#/inventario', '/#/clientes', '/#/configuracion', '/#/inicio']) {
      await page.goto(baseURL + ruta);
      await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    }
  } finally {
    await browser.close();
  }
}
