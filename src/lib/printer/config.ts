/**
 * Configuración de la impresora térmica. Se guarda en localStorage POR DISPOSITIVO
 * (cada caja/teléfono tiene su propia impresora), con la misma clave que ya usaba la
 * pantalla de Ajustes.
 */
import type { Codepage } from './escpos';

export const PRINTER_STORAGE_KEY = 'nexus_printer_config';

/** Cómo llega el ticket a la impresora. */
export type PrinterConnection = 'network' | 'usb';

/** Impresora USB elegida en Ajustes (se identifica por fabricante + modelo). */
export interface UsbPrinterChoice {
  vendorId: number;
  productId: number;
  name: string;
}

export interface PrinterConfig {
  /** Interruptor general. Apagado = todo sigue como antes (WhatsApp / impresión del sistema). */
  enabled: boolean;
  name: string;
  /** 'network': por IP (Wi-Fi/cable de red). 'usb': cable USB del teléfono a la impresora (OTG). */
  connection: PrinterConnection;
  /** Solo USB: la impresora elegida. Sin elegir = la primera impresora USB conectada. */
  usb: UsbPrinterChoice | null;
  ip: string;
  /** Puerto raw de la impresora: 9100 en casi todas (Rongta incluida). */
  port: number;
  width: '80mm' | '58mm';
  codepage: Codepage;
  /** Imprime solo el ticket de cada venta al cobrar. */
  autoPrint: boolean;
  /** Abre la gaveta de dinero (si hay una conectada a la impresora) al cobrar en efectivo. */
  openDrawer: boolean;
}

export const DEFAULT_PRINTER_CONFIG: PrinterConfig = {
  enabled: false,
  name: 'Impresora Térmica',
  connection: 'network',
  usb: null,
  ip: '',
  port: 9100,
  width: '80mm',
  codepage: 'cp858',
  autoPrint: true,
  openDrawer: false,
};

export const columnsFor = (width: PrinterConfig['width']): number => (width === '58mm' ? 32 : 48);

/** Direcciones IPv4 válidas: cuatro números 0-255. */
export function isValidIPv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec((ip || '').trim());
  return !!m && m.slice(1).every(p => Number(p) <= 255);
}

export function normalizePrinterConfig(raw: unknown): PrinterConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const port = Number(r.port);
  const codepage = r.codepage === 'cp437' || r.codepage === 'ascii' || r.codepage === 'cp858' ? r.codepage : DEFAULT_PRINTER_CONFIG.codepage;
  // El valor viejo era una IP de ejemplo que nadie configuró de verdad: no se arrastra.
  const ip = typeof r.ip === 'string' && r.ip !== '192.168.1.200' ? r.ip.trim() : '';
  const u = (r.usb && typeof r.usb === 'object' ? r.usb : null) as Record<string, unknown> | null;
  const usb = u && Number.isInteger(u.vendorId) && Number.isInteger(u.productId)
    ? { vendorId: u.vendorId as number, productId: u.productId as number, name: typeof u.name === 'string' ? u.name : 'Impresora USB' }
    : null;
  return {
    enabled: r.enabled === true,
    name: typeof r.name === 'string' && r.name.trim() ? r.name : DEFAULT_PRINTER_CONFIG.name,
    connection: r.connection === 'usb' ? 'usb' : 'network',
    usb,
    ip,
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PRINTER_CONFIG.port,
    width: r.width === '58mm' ? '58mm' : '80mm',
    codepage,
    autoPrint: r.autoPrint !== false,
    openDrawer: r.openDrawer === true,
  };
}

export function loadPrinterConfig(): PrinterConfig {
  try {
    const saved = localStorage.getItem(PRINTER_STORAGE_KEY);
    return normalizePrinterConfig(saved ? JSON.parse(saved) : null);
  } catch {
    return { ...DEFAULT_PRINTER_CONFIG };
  }
}

export function savePrinterConfig(cfg: PrinterConfig): void {
  try { localStorage.setItem(PRINTER_STORAGE_KEY, JSON.stringify(cfg)); } catch { /* sin almacenamiento */ }
}

/** ¿Hay impresora lista para usarse? (activada y, si es de red, con IP válida) */
export function isPrinterReady(cfg: PrinterConfig): boolean {
  return cfg.enabled && (cfg.connection === 'usb' || isValidIPv4(cfg.ip));
}
