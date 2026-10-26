/**
 * Prueba el envío TCP real de Electron (electron/rawPrint.js) contra una "impresora" falsa:
 * un servidor en localhost que guarda lo que recibe.
 */
import { describe, it, expect, afterEach } from 'vitest';
import net from 'net';
// @ts-expect-error — módulo JS del proceso principal de Electron, sin tipos
import { sendRaw } from '../../../electron/rawPrint.js';

type Result = { ok: boolean; error?: string };
const send = sendRaw as (host: string, port: number, bytes: number[] | Uint8Array, timeoutMs?: number) => Promise<Result>;

let server: net.Server | null = null;
afterEach(() => new Promise<void>(res => (server ? server.close(() => res()) : res())).then(() => { server = null; }));

function fakePrinter(): Promise<{ port: number; received: Promise<Buffer> }> {
  return new Promise(resolve => {
    let resolveData!: (b: Buffer) => void;
    const received = new Promise<Buffer>(r => { resolveData = r; });
    server = net.createServer(sock => {
      const chunks: Buffer[] = [];
      sock.on('data', c => chunks.push(c));
      sock.on('end', () => resolveData(Buffer.concat(chunks)));
    });
    server.listen(0, '127.0.0.1', () => resolve({ port: (server!.address() as net.AddressInfo).port, received }));
  });
}

describe('sendRaw (Electron → impresora de red)', () => {
  it('entrega los bytes completos, incluidos los de control', async () => {
    const { port, received } = await fakePrinter();
    const payload = [0x1b, 0x40, 0x1b, 0x74, 0x13, ...Buffer.from('Hola\n'), 0xa0, 0x1d, 0x56, 0x42, 0x00];
    const r = await send('127.0.0.1', port, payload);
    expect(r).toEqual({ ok: true });
    expect(Array.from(await received)).toEqual(payload);
  });
  it('un ticket grande (200 KB) llega entero', async () => {
    const { port, received } = await fakePrinter();
    const payload = Array.from({ length: 200_000 }, (_, i) => i % 256);
    expect((await send('127.0.0.1', port, payload)).ok).toBe(true);
    expect((await received).length).toBe(200_000);
  });
  it('puerto cerrado → REFUSED', async () => {
    const probe = net.createServer();
    await new Promise<void>(r => probe.listen(0, '127.0.0.1', () => r()));
    const port = (probe.address() as net.AddressInfo).port;
    await new Promise<void>(r => probe.close(() => r()));
    expect(await send('127.0.0.1', port, [1])).toEqual({ ok: false, error: 'REFUSED' });
  });
  it('host o puerto inválidos → INVALID sin abrir sockets', async () => {
    expect(await send('no-es-ip', 9100, [1])).toEqual({ ok: false, error: 'INVALID' });
    expect(await send('999.1.1.1', 9100, [1])).toEqual({ ok: false, error: 'INVALID' });
    expect(await send('127.0.0.1', 70000, [1])).toEqual({ ok: false, error: 'INVALID' });
  });
});
