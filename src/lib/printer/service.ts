/**
 * Servicio de impresión térmica por red (TCP "raw" al puerto 9100 de la impresora).
 *
 * Transportes, por orden:
 *  1. Electron (Windows): `window.electronAPI.printRaw` → socket TCP en el proceso principal.
 *  2. Android (Capacitor): plugin nativo `LanPrinter` → java.net.Socket.
 *  3. Navegador/PWA: no puede abrir sockets, así que no hay impresión directa.
 *
 * Además, en Android se puede imprimir por cable USB (OTG) con el plugin nativo `UsbPrinter`,
 * sin red de por medio (`connection: 'usb'` en la configuración).
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

/** Un dispositivo USB conectado al teléfono al que se le puede imprimir. */
export interface UsbPrinterDevice {
  vendorId: number;
  productId: number;
  name: string;
  /** true si el dispositivo se declara como impresora (clase USB 7). */
  isPrinter: boolean;
  hasPermission: boolean;
}

interface UsbPrinterPlugin {
  list(): Promise<{ devices: UsbPrinterDevice[] }>;
  print(opts: { data: string; vendorId?: number; productId?: number; timeoutMs?: number }): Promise<void>;
}

let usbPrinter: UsbPrinterPlugin | null = null;
const getUsbPrinter = (): UsbPrinterPlugin => (usbPrinter ??= registerPlugin<UsbPrinterPlugin>('UsbPrinter'));

/** ¿Este dispositivo puede imprimir por cable USB? (solo la app de Android) */
export function canPrintUsb(): boolean {
  try { return Capacitor.getPlatform() === 'android'; } catch { return false; }
}

/** Impresoras USB conectadas ahora mismo al teléfono (las que se declaran impresora, primero). */
export async function listUsbPrinters(): Promise<UsbPrinterDevice[]> {
  if (!canPrintUsb()) return [];
  const r = await getUsbPrinter().list();
  return Array.isArray(r?.devices) ? r.devices : [];
}

/** Para pruebas: reemplaza el transporte real. */
type Transport = (cfg: PrinterConfig, bytes: Uint8Array) => Promise<void>;
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

const send: Transport = async (cfg, bytes) => {
  if (transportOverride) return transportOverride(cfg, bytes);
  if (cfg.connection === 'usb') {
    if (!canPrintUsb()) throw new Error('NO_USB');
    await getUsbPrinter().print({
      data: toBase64(bytes), timeoutMs: 5000,
      ...(cfg.usb ? { vendorId: cfg.usb.vendorId, productId: cfg.usb.productId } : {}),
    });
    return;
  }
  const host = cfg.ip.trim();
  const port = cfg.port;
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
export function friendlyPrintError(e: unknown, cfg?: Pick<PrinterConfig, 'ip' | 'port'> & { connection?: PrinterConfig['connection'] }): string {
  const raw = String((e as { message?: string })?.message ?? e ?? '');
  // USB primero: sus códigos no deben confundirse con los de red (PERMISSION_TIMEOUT contiene "TIMEOUT").
  if (raw.includes('NO_USB')) return 'La impresión por cable USB solo funciona en la app de Android.';
  if (raw.includes('NO_DEVICE')) return 'No hay ninguna impresora conectada por USB. Revisa el cable y el adaptador OTG, y que la impresora esté encendida.';
  if (raw.includes('PERMISSION_DENIED')) return 'Senio no tiene permiso para usar la impresora USB. Vuelve a intentarlo y pulsa "Aceptar" cuando el teléfono lo pregunte.';
  if (raw.includes('PERMISSION_TIMEOUT')) return 'No se respondió al permiso de la impresora USB. Vuelve a intentarlo y pulsa "Aceptar".';
  if (raw.includes('OPEN_FAILED')) return 'No se pudo abrir la impresora USB. Desconecta y vuelve a conectar el cable.';
  if (raw.includes('WRITE_FAILED')) return 'La impresora USB no recibe los datos. Revisa que tenga papel, la tapa cerrada y el cable bien puesto.';
  if (raw.includes('BUSY')) return 'Hay una impresión esperando el permiso del USB. Acéptalo en el teléfono y vuelve a intentarlo.';
  if (cfg?.connection === 'usb') return `No se pudo imprimir por USB: ${raw || 'error desconocido'}`;
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
    if (cfg.connection !== 'usb' && !isValidIPv4(cfg.ip)) return { ok: false, error: 'Falta la IP de la impresora (Ajustes → Hardware).' };
    try {
      await send(cfg, bytes);
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
