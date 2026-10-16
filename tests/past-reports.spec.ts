import { test, expect, type Page } from '@playwright/test';

/**
 * E2E de los REPORTES DE DÍAS ANTERIORES (Corte Z de ayer, fechas lejanas).
 *
 * Bug reportado: "ayer trabajé y hoy, al abrir el corte Z de ayer, ya no
 * muestra nada". Dos causas posibles que se cubren aquí:
 *  1. El teléfono no tenía guardadas esas ventas (las hizo otro dispositivo y la
 *     app solo bajaba las del turno abierto).
 *  2. La fecha consultada es más vieja que lo que el dispositivo descarga solo:
 *     tiene que pedirla a la nube al elegirla.
 *
 * Igual que los demás E2E: negocio sembrado en IndexedDB y TODA salida a la nube
 * bloqueada, salvo la respuesta simulada de ventas del segundo caso.
 */

const BIZ = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';

/** Fecha local YYYY-MM-DD de hace `n` días. */
function diaLocal(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** ISO de las 12:00 hora local de hace `n` días (lejos de cualquier borde de huso). */
function mediodiaISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

function venta(id: string, total: number, dateIso: string) {
  return {
    id, business_id: BIZ, shift_id: '44444444-4444-4444-8444-444444444444', date: dateIso,
    total, payment_method: 'efectivo', status: 'completed', sync_status: 'synced',
    staff_id: STAFF, staff_name: 'Dependiente Prueba',
    items: [{ product_id: '33333333-3333-4333-8333-333333333001', name: 'Cerveza Cristal', price: total, quantity: 1, cost: 0 }],
  };
}

async function sembrar(
  page: Page,
  ventasLocales: ReturnType<typeof venta>[],
  caja: { turnos: Record<string, unknown>[]; movimientos: Record<string, unknown>[] } = { turnos: [], movimientos: [] },
) {
  await page.goto('/');
  await page.waitForFunction(async () => {
    const dbs = await indexedDB.databases?.();
    return !!dbs?.some(d => d.name === 'NexusPOS_DB');
  }, null, { timeout: 15000 });

  await page.evaluate(async ({ BIZ, STAFF, ventasLocales, caja }) => {
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
    await put('staff', { id: STAFF, business_id: BIZ, name: 'Dependiente Prueba', role: 'admin', pin: '', active: true, sync_status: 'synced' });
    await put('settings', {
      id: BIZ, name: 'Bar de Prueba', business_type: 'retail', master_pin: '1234',
      status: 'active', sync_status: 'synced', subscription_expires_at: '2099-01-01T00:00:00.000Z',
    });
    for (const v of ventasLocales) await put('sales', v);
    for (const t of caja.turnos) await put('cash_shifts', t);
    for (const m of caja.movimientos) await put('cash_movements', m);
    localStorage.setItem('nexus_business_id', BIZ);
    localStorage.setItem('nexus_staff_id', STAFF);
    localStorage.setItem(`nexus_guide_seen_${BIZ}`, '1');
    // El relleno automático ya se hizo: aquí se prueba solo la consulta a demanda.
    localStorage.setItem(`nexus_sales_backfill_v1_${BIZ}`, '1');
  }, { BIZ, STAFF, ventasLocales, caja });
  await page.reload();
}

async function abrirCorteZ(page: Page, fecha: string) {
  await page.goto('/#/finanzas');
  await page.getByRole('button', { name: 'Cierre del día' }).click();
  await page.locator('input[type="date"]').fill(fecha);
}

/** Turno cerrado ayer con el cuadre ya calculado: esperaba 1500, contó 1465 → falta 35. */
const turnoCerradoAyer = {
  id: '44444444-4444-4444-8444-4444444444aa', business_id: BIZ, staff_id: STAFF, start_amount: 500,
  opened_at: mediodiaISO(1).replace('T12', 'T08'), closed_at: mediodiaISO(1).replace('T12', 'T20'),
  status: 'closed', end_amount: 1465, expected_amount: 1500, difference: -35,
  transfer_expected: 300, transfer_count: 300, transfer_difference: 0, sync_status: 'synced',
};
const salidaDeCaja = {
  id: '66666666-6666-4666-8666-666666666601', shift_id: turnoCerradoAyer.id, business_id: BIZ,
  type: 'out', amount: 40, reason: 'Gasto', staff_id: STAFF, created_at: mediodiaISO(1), sync_status: 'synced',
};

const totalNeto = (page: Page) => page.getByText('TOTAL NETO').locator('..');

test.describe('Reportes de días anteriores (admin sin turno abierto)', () => {
  test('el Corte Z de AYER muestra lo vendido ayer, sin abrir turno', async ({ page }) => {
    await page.route('**/*.supabase.co/**', route => route.abort('failed'));
    await sembrar(page, [
      venta('aaaaaaaa-0000-4000-8000-000000000001', 100, mediodiaISO(1)),
      venta('aaaaaaaa-0000-4000-8000-000000000002', 50, mediodiaISO(1)),
      venta('aaaaaaaa-0000-4000-8000-000000000003', 999, mediodiaISO(0)), // hoy: no debe sumarse
      venta('aaaaaaaa-0000-4000-8000-000000000004', 777, mediodiaISO(10)), // otro día: tampoco
    ]);

    await abrirCorteZ(page, diaLocal(1));

    await expect(page.getByText('REPORTE Z')).toBeVisible();
    await expect(totalNeto(page)).toContainText('150');
    await expect(totalNeto(page)).not.toContainText('999');
  });

  test('una fecha lejana que el teléfono no tiene se pide a la nube', async ({ page }) => {
    const hace150 = 150;
    let pedidoALaNube = false;

    await page.route('**/*.supabase.co/**', async route => {
      const req = route.request();
      const cors = {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': '*',
        'access-control-expose-headers': 'content-range',
      };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (req.url().includes('/rest/v1/sales') && req.method() === 'GET') {
        pedidoALaNube = true;
        return route.fulfill({
          status: 200,
          headers: { ...cors, 'content-type': 'application/json', 'content-range': '0-0/1' },
          body: JSON.stringify([venta('bbbbbbbb-0000-4000-8000-000000000001', 77, mediodiaISO(hace150))]),
        });
      }
      return route.abort('failed');
    });

    // El teléfono NO tiene esa venta guardada.
    await sembrar(page, [venta('aaaaaaaa-0000-4000-8000-000000000009', 5, mediodiaISO(0))]);

    await abrirCorteZ(page, diaLocal(hace150));

    await expect(totalNeto(page)).toContainText('77', { timeout: 20000 });
    expect(pedidoALaNube).toBe(true);
  });

  test('el Corte Z de ayer incluye el CUADRE DE CAJA del turno (esperado, contado, diferencia)', async ({ page }) => {
    await page.route('**/*.supabase.co/**', route => route.abort('failed'));
    await sembrar(page, [venta('aaaaaaaa-0000-4000-8000-0000000000c1', 100, mediodiaISO(1))],
      { turnos: [turnoCerradoAyer], movimientos: [salidaDeCaja] });

    await abrirCorteZ(page, diaLocal(1));

    const cuadre = page.getByTestId('z-cuadre');
    await expect(cuadre).toContainText('Cuadre de Caja');
    await expect(cuadre).toContainText('Efectivo esperado');
    await expect(cuadre).toContainText('1,500');
    await expect(cuadre).toContainText('Efectivo contado');
    await expect(cuadre).toContainText('1,465');
    await expect(cuadre).toContainText('Falta');
    await expect(cuadre).toContainText('35');
    await expect(cuadre).toContainText('Transferencias');
  });

  test('un día sin turnos lo dice en vez de dejar el cuadre en blanco', async ({ page }) => {
    await page.route('**/*.supabase.co/**', route => route.abort('failed'));
    await sembrar(page, [venta('aaaaaaaa-0000-4000-8000-0000000000c2', 100, mediodiaISO(1))]);

    await abrirCorteZ(page, diaLocal(1));

    await expect(page.getByTestId('z-cuadre')).toContainText('Sin turnos registrados este día.');
  });

  test('"WhatsApp" arma el Corte Z completo como texto (el APK no puede imprimir)', async ({ page }) => {
    await page.route('**/*.supabase.co/**', route => route.abort('failed'));
    // window.open se intercepta: lo que importa es la URL que se intenta abrir.
    await page.addInitScript(() => {
      (window as unknown as { __abiertas: string[] }).__abiertas = [];
      window.open = (u?: string | URL) => { (window as unknown as { __abiertas: string[] }).__abiertas.push(String(u)); return null; };
    });
    await sembrar(page, [venta('aaaaaaaa-0000-4000-8000-0000000000c3', 100, mediodiaISO(1))],
      { turnos: [turnoCerradoAyer], movimientos: [salidaDeCaja] });

    await abrirCorteZ(page, diaLocal(1));
    await expect(page.getByTestId('z-cuadre')).toContainText('Falta');
    await page.getByRole('button', { name: 'WhatsApp' }).click();

    const abiertas = await page.evaluate(() => (window as unknown as { __abiertas: string[] }).__abiertas);
    expect(abiertas).toHaveLength(1);
    expect(abiertas[0].startsWith('https://wa.me/?text=')).toBe(true);
    const texto = decodeURIComponent(abiertas[0].split('text=')[1]);
    expect(texto).toContain('REPORTE Z');
    expect(texto).toContain('CUADRE DE CAJA');
    expect(texto).toContain('Diferencia efectivo: Falta');
    expect(texto).toContain('TOTAL NETO');
  });
});
