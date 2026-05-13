import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  checkLockout,
  recordFailure,
  recordSuccess,
  formatLockoutTime,
  RATE_LIMIT_CONFIG,
} from './loginRateLimit';

// Mock de localStorage para tests en Node
const storage: Record<string, string> = {};
beforeEach(() => {
  for (const k of Object.keys(storage)) delete storage[k];
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage[k] ?? null,
    setItem: (k: string, v: string) => { storage[k] = v; },
    removeItem: (k: string) => { delete storage[k]; },
    clear: () => { for (const k of Object.keys(storage)) delete storage[k]; },
  });
});

describe('checkLockout — estado inicial', () => {
  it('sin email no está bloqueado', () => {
    const r = checkLockout('');
    expect(r.isLocked).toBe(false);
    expect(r.attemptsLeft).toBe(RATE_LIMIT_CONFIG.MAX_ATTEMPTS);
  });

  it('email nuevo tiene MAX_ATTEMPTS disponibles', () => {
    const r = checkLockout('user@test.com');
    expect(r.isLocked).toBe(false);
    expect(r.attemptsLeft).toBe(RATE_LIMIT_CONFIG.MAX_ATTEMPTS);
    expect(r.secondsLeft).toBe(0);
  });
});

describe('recordFailure', () => {
  it('un fallo reduce attemptsLeft en 1', () => {
    const r = recordFailure('a@test.com');
    expect(r.attemptsLeft).toBe(RATE_LIMIT_CONFIG.MAX_ATTEMPTS - 1);
    expect(r.isLocked).toBe(false);
  });

  it('bloquea al llegar a MAX_ATTEMPTS', () => {
    let last;
    for (let i = 0; i < RATE_LIMIT_CONFIG.MAX_ATTEMPTS; i++) {
      last = recordFailure('b@test.com');
    }
    expect(last!.isLocked).toBe(true);
    expect(last!.attemptsLeft).toBe(0);
    expect(last!.secondsLeft).toBeGreaterThan(0);
  });

  it('fallos en diferentes emails no se mezclan', () => {
    recordFailure('user1@test.com');
    recordFailure('user1@test.com');
    const r2 = checkLockout('user2@test.com');
    expect(r2.attemptsLeft).toBe(RATE_LIMIT_CONFIG.MAX_ATTEMPTS);
    expect(r2.isLocked).toBe(false);
  });

  it('email case-insensitive (User@Test.com == user@test.com)', () => {
    recordFailure('User@Test.com');
    recordFailure('User@Test.com');
    const r = checkLockout('user@test.com');
    expect(r.attemptsLeft).toBe(RATE_LIMIT_CONFIG.MAX_ATTEMPTS - 2);
  });
});

describe('recordSuccess', () => {
  it('limpia el contador tras login exitoso', () => {
    recordFailure('c@test.com');
    recordFailure('c@test.com');
    recordSuccess('c@test.com');
    const r = checkLockout('c@test.com');
    expect(r.attemptsLeft).toBe(RATE_LIMIT_CONFIG.MAX_ATTEMPTS);
  });
});

describe('lockout expira tras LOCKOUT_MS', () => {
  it('después del bloqueo se permite intentar de nuevo', () => {
    // Simulamos llegar al límite manipulando el tiempo
    vi.useFakeTimers();
    const now = new Date('2024-01-01T12:00:00Z').getTime();
    vi.setSystemTime(now);

    for (let i = 0; i < RATE_LIMIT_CONFIG.MAX_ATTEMPTS; i++) {
      recordFailure('d@test.com');
    }
    expect(checkLockout('d@test.com').isLocked).toBe(true);

    // Avanzar tiempo más allá del bloqueo
    vi.setSystemTime(now + RATE_LIMIT_CONFIG.LOCKOUT_MS + 1000);
    const r = checkLockout('d@test.com');
    expect(r.isLocked).toBe(false);
    expect(r.attemptsLeft).toBe(RATE_LIMIT_CONFIG.MAX_ATTEMPTS);

    vi.useRealTimers();
  });
});

describe('formatLockoutTime', () => {
  it('formatea solo segundos', () => {
    expect(formatLockoutTime(30)).toBe('30 segundos');
    expect(formatLockoutTime(1)).toBe('1 segundo');
  });

  it('formatea minutos exactos', () => {
    expect(formatLockoutTime(60)).toBe('1 minuto');
    expect(formatLockoutTime(120)).toBe('2 minutos');
  });

  it('formatea minutos + segundos', () => {
    expect(formatLockoutTime(90)).toBe('1 min 30 s');
    expect(formatLockoutTime(125)).toBe('2 min 5 s');
  });

  it('retorna cadena vacía para 0 o negativo', () => {
    expect(formatLockoutTime(0)).toBe('');
    expect(formatLockoutTime(-5)).toBe('');
  });
});
