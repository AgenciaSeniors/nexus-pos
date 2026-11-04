import { describe, it, expect } from 'vitest';
import { describeSyncSummary } from './syncReport';

const base = { pending: 0, failed: 0, authLost: false };

describe('describeSyncSummary — qué se le dice al usuario tras sincronizar', () => {
  it('todo subido → éxito', () => {
    expect(describeSyncSummary(base)).toEqual({ level: 'success', message: '¡Todo sincronizado!' });
  });

  it('quedan cambios pendientes → NO es éxito, y dice cuántos', () => {
    const r = describeSyncSummary({ ...base, pending: 3, lastError: 'Red: Failed to fetch' });
    expect(r.level).toBe('warning');
    expect(r.message).toContain('Quedan 3 cambios sin enviar');
    expect(r.message).toContain('conexión');
  });

  it('singular', () => {
    expect(describeSyncSummary({ ...base, pending: 1 }).message).toContain('Quedan 1 cambio sin enviar');
  });

  it('sesión perdida con cosas pendientes → error con la salida clara', () => {
    const r = describeSyncSummary({ ...base, pending: 2, authLost: true });
    expect(r.level).toBe('error');
    expect(r.message).toContain('vuelve a entrar');
  });

  it('sesión perdida pero sin nada pendiente no asusta', () => {
    expect(describeSyncSummary({ ...base, authLost: true }).level).toBe('success');
  });

  it('rechazados por el servidor → aviso con a dónde ir', () => {
    const r = describeSyncSummary({ ...base, failed: 2 });
    expect(r.level).toBe('warning');
    expect(r.message).toContain('no se pudieron enviar');
    expect(r.message).toContain('Ajustes');
  });
});
