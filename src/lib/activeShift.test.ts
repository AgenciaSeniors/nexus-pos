import { describe, it, expect } from 'vitest';
import { pickActiveShift, sortOpenShifts } from './activeShift';

const shift = (id: string, opened_at: string, status: 'open' | 'closed' = 'open') =>
  ({ id, opened_at, status });

describe('pickActiveShift', () => {
  it('sin turnos devuelve null', () => {
    expect(pickActiveShift([])).toBeNull();
  });

  it('ignora los turnos cerrados', () => {
    expect(pickActiveShift([shift('a', '2026-10-01T10:00:00Z', 'closed')])).toBeNull();
  });

  it('con varios abiertos elige el más reciente, sin importar el orden de entrada', () => {
    const viejo = shift('zzz', '2026-02-02T20:17:17Z');
    const medio = shift('mmm', '2026-09-08T18:13:08Z');
    const nuevo = shift('aaa', '2026-10-11T04:08:04Z');
    // El id del más nuevo es el MENOR alfabéticamente: el orden por id (lo que
    // daba `.first()` sobre el índice) elegiría el viejo.
    expect(pickActiveShift([viejo, medio, nuevo])?.id).toBe('aaa');
    expect(pickActiveShift([nuevo, viejo, medio])?.id).toBe('aaa');
    expect(pickActiveShift([medio, nuevo, viejo])?.id).toBe('aaa');
  });

  it('un turno cerrado más reciente no gana a uno abierto', () => {
    const abierto = shift('a', '2026-10-01T10:00:00Z');
    const cerrado = shift('b', '2026-10-05T10:00:00Z', 'closed');
    expect(pickActiveShift([cerrado, abierto])?.id).toBe('a');
  });

  it('empate de fecha: desempata por id de forma estable', () => {
    const x = shift('a', '2026-10-01T10:00:00Z');
    const y = shift('b', '2026-10-01T10:00:00Z');
    expect(pickActiveShift([x, y])?.id).toBe('b');
    expect(pickActiveShift([y, x])?.id).toBe('b');
  });

  it('no muta el array recibido', () => {
    const input = [shift('a', '2026-01-01T00:00:00Z'), shift('b', '2026-02-01T00:00:00Z')];
    const copia = [...input];
    sortOpenShifts(input);
    expect(input).toEqual(copia);
  });
});
