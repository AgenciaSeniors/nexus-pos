import { describe, it, expect, beforeEach } from 'vitest';
import type { Sale } from '../db';
import { buildTicketEscpos, buildPlainEscpos } from './ticketEscpos';
import { sendToPrinter, printTicket, __setPrinterTransport, friendlyPrintError, toBase64 } from './service';
import { normalizePrinterConfig } from './config';

/** Decodifica los bytes a texto legible quitando los comandos ESC/GS (para comprobar contenido y anchos). */
function render(bytes: Uint8Array): string {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x1b) { i += (bytes[i + 1] === 0x70 ? 4 : bytes[i + 1] === 0x40 ? 1 : 2); continue; }
    if (b === 0x1d) { i += bytes[i + 1] === 0x56 ? 3 : 2; continue; }
    out.push(b);
  }
  return Buffer.from(out).toString('latin1');
}

const sale = (over: Partial<Sale> = {}): Sale => ({
  id: 'abcdef12-0000-0000-0000-000000000000',
  business_id: 'b1',
  date: '2026-10-26T15:30:00.000Z',
  total: 25.5,
  payment_method: 'efectivo',
  amount_tendered: 30,
  change: 4.5,
  staff_name: 'Ana Pérez',
  items: [
    { product_id: 'p1', name: 'Pan', price: 2, quantity: 3 },
    { product_id: 'p2', name: 'Aceite de oliva extra virgen botella grande de un litro', price: 19.5, quantity: 1 },
  ],
  sync_status: 'synced',
  ...over,
} as unknown as Sale);

const OPTS = { columns: 48, codepage: 'ascii' as const };

describe('buildTicketEscpos', () => {
  it('contiene negocio, ítems, total y pago', () => {
    const txt = render(buildTicketEscpos(sale(), { name: 'Bodega Luz', address: 'Calle 1', phone: '555', receipt_message: 'Vuelva pronto' }, false, OPTS));
    expect(txt).toContain('BODEGA LUZ');
    expect(txt).toContain('TICKET #ABCDEF12');
    expect(txt).toContain('3 x Pan');
    expect(txt).toContain('$6.00');
    expect(txt).toContain('TOTAL');
    expect(txt).toContain('$25.50');
    expect(txt).toContain('Recibido:');
    expect(txt).toContain('$30.00');
    expect(txt).toContain('Cambio:');
    expect(txt).toContain('Vendedor: Ana');
    expect(txt).toContain('"Vuelva pronto"');
  });
  it('ninguna línea de letra normal pasa de 48 columnas', () => {
    const txt = render(buildTicketEscpos(sale(), null, false, OPTS));
    // El TOTAL va en letra doble (cada carácter ocupa 2 columnas), por eso se excluye.
    for (const l of txt.split('\n')) if (!l.startsWith('TOTAL')) expect(l.length).toBeLessThanOrEqual(48);
  });
  it('termina con el comando de corte', () => {
    const b = buildTicketEscpos(sale(), null, false, OPTS);
    expect(Array.from(b.slice(-4))).toEqual([0x1d, 0x56, 0x42, 0x00]);
  });
  it('gaveta solo si se pide y el cobro tiene efectivo', () => {
    const has = (b: Uint8Array) => Array.from(b).join(',').includes('27,112,0,50,250');
    expect(has(buildTicketEscpos(sale(), null, false, { ...OPTS, openDrawer: true }))).toBe(true);
    expect(has(buildTicketEscpos(sale(), null, false, OPTS))).toBe(false);
    expect(has(buildTicketEscpos(sale({ payment_method: 'transferencia' } as Partial<Sale>), null, false, { ...OPTS, openDrawer: true }))).toBe(false);
  });
  it('descuento y devoluciones', () => {
    const txt = render(buildTicketEscpos(sale({ discount_amount: 5, discount_type: 'percentage', discount_input: 10, refunded_items: [{ product_id: 'p1', name: 'Pan', quantity: 1, amount: 2 }] } as unknown as Partial<Sale>), null, false, OPTS));
    expect(txt).toContain('Subtotal:');
    expect(txt).toContain('Descuento (10%):');
    expect(txt).toContain('-$5.00');
    expect(txt).toContain('DEVOLUCIONES:');
  });
  it('58 mm: 32 columnas', () => {
    const txt = render(buildTicketEscpos(sale(), null, false, { columns: 32, codepage: 'ascii' }));
    for (const l of txt.split('\n')) if (!l.startsWith('TOTAL')) expect(l.length).toBeLessThanOrEqual(32);
  });
  it('pre-cuenta no trae forma de pago y avisa que no es factura', () => {
    const order = { ...sale(), note: 'mesa 4' } as unknown as Parameters<typeof buildTicketEscpos>[0];
    const txt = render(buildTicketEscpos(order, null, true, OPTS));
    expect(txt).toContain('PRE-CUENTA');
    expect(txt).toContain('MESA 4');
    expect(txt).toContain('NO VALIDO COMO FACTURA');
    expect(txt).not.toContain('Recibido:');
  });
});

describe('buildPlainEscpos', () => {
  it('respeta sangrías y líneas en blanco, y quita los asteriscos de las líneas en negrita', () => {
    const txt = render(buildPlainEscpos('*TOTAL: $5*\n\n  Efectivo: $5', 'CORTE Z', OPTS));
    expect(txt).toContain('TOTAL: $5');
    expect(txt).not.toContain('*');
    expect(txt).toContain('  Efectivo: $5');
  });
});

describe('servicio de impresión', () => {
  const cfg = normalizePrinterConfig({ enabled: true, ip: '192.168.1.50', codepage: 'ascii' });
  beforeEach(() => __setPrinterTransport(null));

  it('manda los bytes a la IP y puerto configurados', async () => {
    const calls: Array<[string, number, number]> = [];
    __setPrinterTransport(async (h, p, b) => { calls.push([h, p, b.length]); });
    const r = await printTicket(sale(), null, false, cfg);
    expect(r).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].slice(0, 2)).toEqual(['192.168.1.50', 9100]);
    expect(calls[0][2]).toBeGreaterThan(50);
  });
  it('un fallo del transporte devuelve un mensaje legible, no lanza', async () => {
    __setPrinterTransport(async () => { throw new Error('TIMEOUT'); });
    const r = await sendToPrinter(cfg, new Uint8Array([1]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('no responde');
  });
  it('sin IP no intenta conectar', async () => {
    let called = false;
    __setPrinterTransport(async () => { called = true; });
    const r = await sendToPrinter({ ...cfg, ip: '' }, new Uint8Array([1]));
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
  });
  it('dos trabajos seguidos no se solapan', async () => {
    let active = 0, maxActive = 0;
    __setPrinterTransport(async () => { active++; maxActive = Math.max(maxActive, active); await new Promise(r => setTimeout(r, 20)); active--; });
    await Promise.all([sendToPrinter(cfg, new Uint8Array([1])), sendToPrinter(cfg, new Uint8Array([2])), sendToPrinter(cfg, new Uint8Array([3]))]);
    expect(maxActive).toBe(1);
  });
  it('un trabajo fallido no bloquea los siguientes', async () => {
    let n = 0;
    __setPrinterTransport(async () => { if (n++ === 0) throw new Error('REFUSED'); });
    const a = await sendToPrinter(cfg, new Uint8Array([1]));
    const b = await sendToPrinter(cfg, new Uint8Array([2]));
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(true);
  });
  it('mensajes de error', () => {
    expect(friendlyPrintError(new Error('REFUSED'), cfg)).toContain('rechazó');
    expect(friendlyPrintError(new Error('UNREACHABLE'), cfg)).toContain('No se encuentra');
    expect(friendlyPrintError(new Error('NO_TRANSPORT'))).toContain('no puede imprimir directo');
  });
  it('toBase64 round-trip', () => {
    const b = Uint8Array.from({ length: 70000 }, (_, i) => i % 256);
    expect(Uint8Array.from(Buffer.from(toBase64(b), 'base64'))).toEqual(b);
  });
});
