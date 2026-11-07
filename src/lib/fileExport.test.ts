// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { exportFile, exportSuccessMessage, friendlyExportError, usesNativeShare, __setNativeFileShare, type ExportableFile } from './fileExport';
import { downloadCsv, toCsv } from './csv';

beforeEach(() => __setNativeFileShare(null));
afterEach(() => { __setNativeFileShare(null); vi.restoreAllMocks(); });

describe('exportFile', () => {
  it('en el navegador descarga con el nombre y el contenido', async () => {
    const clicks: { href: string; download: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ href: this.href, download: this.download });
    });
    const urls: Blob[] = [];
    vi.stubGlobal('URL', { ...URL, createObjectURL: (b: Blob) => { urls.push(b); return 'blob:x'; }, revokeObjectURL: () => {} });

    const r = await exportFile({ name: 'Inventario.csv', mimeType: 'text/csv', content: 'a;b' });

    expect(r).toBe('downloaded');
    expect(clicks).toEqual([{ href: 'blob:x', download: 'Inventario.csv' }]);
    expect(urls[0].type).toBe('text/csv');
    expect(await urls[0].text()).toBe('a;b');
    expect(usesNativeShare()).toBe(false);
  });

  it('en Android pasa por el menú de compartir del teléfono', async () => {
    const shared: ExportableFile[] = [];
    __setNativeFileShare(async f => { shared.push(f); });
    const r = await exportFile({ name: 'Respaldo.json', mimeType: 'application/json', content: '{"a":1}' });
    expect(r).toBe('shared');
    expect(shared).toHaveLength(1);
    expect(shared[0].name).toBe('Respaldo.json');
    expect(usesNativeShare()).toBe(true);
  });

  it('si compartir falla, lanza (para que la pantalla NO diga "éxito")', async () => {
    __setNativeFileShare(async () => { throw new Error('NO_APP'); });
    await expect(exportFile({ name: 'x.csv', mimeType: 'text/csv', content: 'x' })).rejects.toThrow('NO_APP');
  });

  it('downloadCsv arma el CSV (BOM + ;) y lo saca por el mismo camino', async () => {
    const shared: ExportableFile[] = [];
    __setNativeFileShare(async f => { shared.push(f); });
    const rows = [{ n: 'Café', p: 2.5 }];
    const cols = [{ label: 'Nombre', value: (r: { n: string }) => r.n }, { label: 'Precio', value: (r: { p: number }) => r.p }];
    expect(await downloadCsv('Inventario_Senio', rows, cols)).toBe('shared');
    expect(shared[0].name).toBe('Inventario_Senio.csv');
    expect(shared[0].content).toBe(toCsv(rows, cols));
    expect(String(shared[0].content)).toContain('Nombre;Precio');
  });

  it('mensajes', () => {
    expect(exportSuccessMessage('shared', 'Plantilla')).toContain('elige dónde');
    expect(exportSuccessMessage('downloaded', 'Plantilla')).toBe('Plantilla descargado');
    expect(friendlyExportError(new Error('NO_APP'))).toContain('Instala WhatsApp');
    expect(friendlyExportError(new Error('WRITE_FAILED'))).toContain('sin espacio');
    expect(friendlyExportError(new Error('raro'))).toContain('No se pudo exportar: raro');
  });
});
