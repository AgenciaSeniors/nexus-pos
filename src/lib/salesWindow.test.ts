import { describe, it, expect } from 'vitest';
import { salesWindow, isWindowCoveredByBackfill } from './salesWindow';

const NOW = new Date('2026-10-15T15:00:00');
const base = { reportMode: 'day' as const, selectedDate: '2026-10-14', dateFrom: '', now: NOW };
const dia = (d: Date) => d.toISOString().slice(0, 10);

describe('salesWindow', () => {
  it('Cierre del día: ±2 días alrededor de la fecha elegida, no de hoy', () => {
    const w = salesWindow({ ...base, viewMode: 'closing', selectedDate: '2026-09-01' });
    expect(dia(w.from)).toBe('2026-08-30');
    expect(dia(w.to!)).toBe('2026-09-03');
  });

  it('Reportes en modo día usa la misma ventana que el cierre', () => {
    const a = salesWindow({ ...base, viewMode: 'daily', reportMode: 'day' });
    const b = salesWindow({ ...base, viewMode: 'closing' });
    expect(a).toEqual(b);
  });

  it('Reportes en modo rango empieza en la fecha inicial y no tiene tope', () => {
    const w = salesWindow({ ...base, viewMode: 'daily', reportMode: 'range', dateFrom: '2026-06-10' });
    expect(w.from.getTime()).toBe(new Date('2026-06-10T00:00').getTime());
    expect(w.to).toBeNull();
  });

  it('rango sin fecha inicial cae en los últimos 30 días', () => {
    const w = salesWindow({ ...base, viewMode: 'daily', reportMode: 'range', dateFrom: '' });
    expect(dia(w.from)).toBe('2026-09-15');
    expect(w.to).toBeNull();
  });

  it('Historial y Tendencias: últimos 30 días', () => {
    for (const viewMode of ['history', 'trends'] as const) {
      const w = salesWindow({ ...base, viewMode });
      expect(dia(w.from)).toBe('2026-09-15');
      expect(w.to).toBeNull();
    }
  });

  it('una fecha inválida no rompe: usa hoy como ancla', () => {
    const w = salesWindow({ ...base, viewMode: 'closing', selectedDate: 'no-es-fecha' });
    expect(dia(w.from)).toBe('2026-10-13');
  });
});

describe('isWindowCoveredByBackfill', () => {
  it('ayer está cubierto por el relleno de 90 días', () => {
    expect(isWindowCoveredByBackfill(new Date('2026-10-12T00:00'), 90, NOW)).toBe(true);
  });

  it('hace 5 meses NO está cubierto: hay que pedirlo a la nube', () => {
    expect(isWindowCoveredByBackfill(new Date('2026-05-10T00:00'), 90, NOW)).toBe(false);
  });

  it('el borde de la ventana no se da por cubierto', () => {
    expect(isWindowCoveredByBackfill(new Date(NOW.getTime() - 90 * 86400000), 90, NOW)).toBe(false);
  });
});
