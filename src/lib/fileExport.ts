/**
 * Sacar un archivo generado en la app (respaldo JSON, Excel/CSV de inventario, ventas,
 * clientes, plantilla…).
 *
 * PROBLEMA: en el APK el enlace de descarga (`<a download>` con un Blob) NO hace nada: el
 * WebView de Android no sabe descargar archivos generados dentro de la app. "Exportar" y
 * "Exportar respaldo" parecían funcionar (salía el aviso de éxito) pero no salía ningún archivo.
 *
 * Aquí se elige el camino según dónde corra la app:
 *  - Android (APK): plugin nativo `FileExport` → el archivo se escribe en la caché y se abre el
 *    menú de compartir del teléfono (WhatsApp, Drive, Archivos, correo…).
 *  - Navegador / Windows: descarga normal.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface ExportableFile {
  /** Nombre con extensión, p. ej. "Inventario_Senio_2026-11-07.csv". */
  name: string;
  mimeType: string;
  content: string | Uint8Array;
}

export type ExportOutcome = 'shared' | 'downloaded';

interface FileExportPlugin {
  share(opts: { name: string; mimeType: string; data: string; title?: string }): Promise<{ path: string }>;
}

let plugin: FileExportPlugin | null = null;
const getPlugin = (): FileExportPlugin => (plugin ??= registerPlugin<FileExportPlugin>('FileExport'));

/** Para pruebas: reemplaza el camino nativo. */
type NativeShare = (file: ExportableFile) => Promise<void>;
let nativeOverride: NativeShare | null = null;
export function __setNativeFileShare(fn: NativeShare | null): void { nativeOverride = fn; }

/** ¿Aquí los archivos salen por el menú de compartir del teléfono? */
export function usesNativeShare(): boolean {
  if (nativeOverride) return true;
  try { return Capacitor.getPlatform() === 'android'; } catch { return false; }
}

function toBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === 'string' ? new TextEncoder().encode(content) : content;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Descarga clásica del navegador (también sirve en Windows). */
function downloadInBrowser(file: ExportableFile): void {
  const blob = new Blob([toBytes(file.content) as BlobPart], { type: file.mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Mensajes en lenguaje de persona para lo que puede fallar en el teléfono. */
export function friendlyExportError(e: unknown): string {
  const raw = String((e as { message?: string })?.message ?? e ?? '');
  if (raw.includes('NO_APP')) return 'No hay ninguna app para recibir el archivo. Instala WhatsApp, Drive o un gestor de archivos.';
  if (raw.includes('WRITE_FAILED')) return 'No se pudo preparar el archivo en el teléfono (¿sin espacio?).';
  return `No se pudo exportar: ${raw || 'error desconocido'}`;
}

/**
 * Saca el archivo por el camino que toque. En Android resuelve cuando se abre el menú de
 * compartir (no se puede saber a dónde lo mandó el usuario). Lanza si falla.
 */
export async function exportFile(file: ExportableFile): Promise<ExportOutcome> {
  if (nativeOverride) { await nativeOverride(file); return 'shared'; }
  if (usesNativeShare()) {
    await getPlugin().share({ name: file.name, mimeType: file.mimeType, data: toBase64(toBytes(file.content)), title: 'Guardar o enviar' });
    return 'shared';
  }
  downloadInBrowser(file);
  return 'downloaded';
}

/** Lo que se le dice al usuario según por dónde salió el archivo. */
export function exportSuccessMessage(outcome: ExportOutcome, what: string): string {
  return outcome === 'shared'
    ? `${what}: elige dónde guardarlo o a quién enviarlo`
    : `${what} descargado`;
}
