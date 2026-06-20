import { describe, it, expect } from 'vitest';
import { minutesSince, formatElapsed } from './time';

describe('minutesSince', () => {
  const now = Date.parse('2026-06-17T12:00:00.000Z');

  it('devuelve 0 para entradas vacías o inválidas', () => {
    expect(minutesSince(undefined, now)).toBe(0);
    expect(minutesSince(null, now)).toBe(0);
    expect(minutesSince('no-es-fecha', now)).toBe(0);
  });

  it('calcula minutos transcurridos', () => {
    expect(minutesSince('2026-06-17T11:30:00.000Z', now)).toBe(30);
    expect(minutesSince('2026-06-17T10:00:00.000Z', now)).toBe(120);
  });

  it('nunca es negativo (fechas futuras → 0)', () => {
    expect(minutesSince('2026-06-17T12:30:00.000Z', now)).toBe(0);
  });
});

describe('formatElapsed', () => {
  it('formatea minutos por debajo de una hora', () => {
    expect(formatElapsed(0)).toBe('0m');
    expect(formatElapsed(45)).toBe('45m');
  });

  it('formatea horas y minutos', () => {
    expect(formatElapsed(60)).toBe('1h');
    expect(formatElapsed(80)).toBe('1h 20m');
    expect(formatElapsed(125)).toBe('2h 5m');
  });
});
