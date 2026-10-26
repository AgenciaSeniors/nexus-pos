/**
 * Servicio de impresión térmica por red (TCP "raw" al puerto 9100 de la impresora).
 *
 * Transportes, por orden:
 *  1. Electron (Windows): `window.electronAPI.printRaw` → socket TCP en el proceso principal.
 *  2. Android (Capacitor): plugin nativo `LanPrinter` → java.net.Socket.
 *  3. Navegador/PWA: no puede abrir sockets, así que no hay impresión directa.
 *
 * Los trabajos se encolan de uno en uno: las impresoras de red aceptan una sola
 * conexión a la vez y dos ventas seguidas no deben pisarse.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Sale, ParkedOrder, BusinessConfig } from '../db';
import { columnsFor, isPrinterReady, loadPrinterConfig, isValidIPv4, type PrinterConfig } from './config';
import { buildPlainEscpos, buildTestPageEscpos, buildTicketEscpos } from './ticketEscpos';

export type PrintResult = { ok: true } | { ok: false; error: string };

interface LanPrinterPlugin {
  print(opts: { host: string; port: number; data: string; timeoutMs?: number }): Promise<void>;
}

let lanPrinter: LanPrinterPlugin | null = null;
const getLanPrinter = (): LanPrinterPlugin => (lanPrinter ??= registerPlugin<LanPrinterPlugin>('LanPrinter'));

/** Para pruebas: reemplaza el transporte real. */
type Transport = (host: string, port: number, bytes: Uint8Array) => Promise<void>;
let transportOverride: Transport | null = null;
export function __setPrinterTransport(t: Transport | null): void { transportOverride = t; }

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** ¿Este dispositivo puede mandar bytes a una impresora de red? */
export function canPrintToNetwork(): boolean {
  if (transportOverride) return true;
  if (typeof window !== 'undefined' && window.electronAPI?.printRaw) return true;
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

const send: Transport = async (host, port, bytes) => {
  if (transportOverride) return transportOverride(host, port, bytes);
  if (typeof window !== 'undefined' && window.electronAPI?.printRaw) {
    const r = await window.electronAPI.printRaw(host, port, Array.from(bytes));
    if (!r.ok) throw new Error(r.error || 'ERROR');
    return;
  }
  if (Capacitor.isNativePlatform()) {
    await getLanPrinter().print({ host, port, data: toBase64(bytes), timeoutMs: 5000 });
    return;
  }
  throw new Error('NO_TRANSPORT');
};

/** Mensajes en cristiano para lo que puede salir mal. */
export function friendlyPrintError(e: unknown, cfg?: Pick<PrinterConfig, 'ip' | 'port'>): string {
  const raw = String((e as { message?: string })?.message ?? e ?? '');
  const where = cfg ? `${cfg.ip}:${cfg.port}` : 'la impresora';
  if (raw.includes('NO_TRANSPORT')) return 'Este dispositivo no puede imprimir directo a la red (usa la app de Android o la de Windows).';
  if (/TIMEOUT|timed out|ETIMEDOUT/i.test(raw)) return `La impresora (${where}) no responde. Revisa que esté encendida y en la misma red Wi-Fi.`;
  if (/REFUSED|ECONNREFUSED/i.test(raw)) return `La impresora (${where}) rechazó la conexión. Verifica el puerto (normalmente 9100).`;
  if (/UNREACHABLE|EHOSTUNREACH|ENETUNREACH|NoRouteToHost/i.test(raw)) return `No se encuentra la impresora (${where}). ¿Está en la misma red que este dispositivo?`;
  if (/INVALID/i.test(raw)) return 'La IP de la impresora no es válida.';
  return `No se pudo imprimir: ${raw || 'error desconocido'}`;
}

let chain: Promise<unknown> = Promise.resolve();

/** Manda bytes a la impresora configurada, de uno en uno. Nunca lanza: devuelve el resultado. */
export function sendToPrinter(cfg: PrinterConfig, bytes: Uint8Array): Promise<PrintResult> {
  const job = chain.then(async (): Promise<PrintResult> => {
    if (!isValidIPv4(cfg.ip)) return { ok: false, error: 'Falta la IP de la impresora (Ajustes → Dispositivos).' };
    try {
      await send(cfg.ip.trim(), cfg.port, bytes);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: friendlyPrintError(e, cfg) };
    }
  });
  chain = job.catch(() => undefined);
  return job;
}

type TicketConfig = Pick<BusinessConfig, 'name' | 'address' | 'phone' | 'receipt_message'> | null | undefined;

export function printTicket(
  doc: Sale | ParkedOrder,
  business: TicketConfig,
  isPreBill = false,
  cfg: PrinterConfig = loadPrinterConfig(),
): Promise<PrintResult> {
  const bytes = buildTicketEscpos(doc, business, isPreBill, {
    columns: columnsFor(cfg.width), codepage: cfg.codepage, openDrawer: cfg.openDrawer,
  });
  return sendToPrinter(cfg, bytes);
}

export function printPlainText(text: string, title: string | null, cfg: PrinterConfig = loadPrinterConfig()): Promise<PrintResult> {
  return sendToPrinter(cfg, buildPlainEscpos(text, title, { columns: columnsFor(cfg.width), codepage: cfg.codepage }));
}

export function printTestPage(cfg: PrinterConfig): Promise<PrintResult> {
  return sendToPrinter(cfg, buildTestPageEscpos(cfg.name, { columns: columnsFor(cfg.width), codepage: cfg.codepage }));
}

/** Impresión automática al cobrar: no hace nada si no hay impresora lista o está apagada. */
export async function autoPrintSale(sale: Sale, business: TicketConfig): Promise<PrintResult | null> {
  const cfg = loadPrinterConfig();
  if (!isPrinterReady(cfg) || !cfg.autoPrint) return null;
  return printTicket(sale, business, false, cfg);
}
