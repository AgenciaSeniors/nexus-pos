import { describe, it, expect, beforeAll } from 'vitest';
import { hashPin, verifyPin, isPinHashed, needsRehash } from './pin';

// Node 20+ trae `crypto.subtle` (Web Crypto API) nativamente en globalThis.
// Si por alguna razón está ausente en el entorno de test, los tests fallarán
// con un mensaje claro en hashPin().

describe('hashPin / verifyPin (PBKDF2)', () => {
  it('genera un hash con formato pbkdf2$<iters>$<salt>$<hash>', async () => {
    const h = await hashPin('1234', 'entity-1');
    expect(h.startsWith('pbkdf2$')).toBe(true);
    const parts = h.split('$');
    expect(parts.length).toBe(4);
    expect(parts[0]).toBe('pbkdf2');
    expect(parseInt(parts[1], 10)).toBeGreaterThanOrEqual(100_000);
    expect(parts[2]).toMatch(/^[0-9a-f]{32}$/); // 16 bytes salt = 32 hex
    expect(parts[3]).toMatch(/^[0-9a-f]{64}$/); // 32 bytes hash = 64 hex
  }, 10000);

  it('dos hashes del mismo PIN tienen salts DISTINTOS (random)', async () => {
    const h1 = await hashPin('1234', 'entity-1');
    const h2 = await hashPin('1234', 'entity-1');
    expect(h1).not.toBe(h2);
  }, 15000);

  it('verifyPin acepta el PIN correcto', async () => {
    const stored = await hashPin('1234', 'entity-1');
    expect(await verifyPin('1234', 'entity-1', stored)).toBe(true);
  }, 15000);

  it('verifyPin rechaza un PIN incorrecto', async () => {
    const stored = await hashPin('1234', 'entity-1');
    expect(await verifyPin('5678', 'entity-1', stored)).toBe(false);
    expect(await verifyPin('1235', 'entity-1', stored)).toBe(false);
  }, 15000);

  it('hashPin rechaza PINs muy cortos', async () => {
    await expect(hashPin('1', 'entity-1')).rejects.toThrow();
    await expect(hashPin('', 'entity-1')).rejects.toThrow();
  });
});

describe('verifyPin — formato legacy SHA-256', () => {
  // Hash generado con la implementación vieja: SHA-256 de "1234:entity-1:nexus-pos-v1"
  // (formato hexadecimal, 64 caracteres)
  const LEGACY_PIN = '1234';
  const LEGACY_ENTITY = 'entity-legacy';
  let legacyHash: string;

  beforeAll(async () => {
    // Recreamos un hash legacy manualmente
    const data = new TextEncoder().encode(`${LEGACY_PIN}:${LEGACY_ENTITY}:nexus-pos-v1`);
    const buf = await crypto.subtle.digest('SHA-256', data);
    legacyHash = Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0')).join('');
  });

  it('verifica un PIN contra un hash legacy correctamente', async () => {
    expect(await verifyPin(LEGACY_PIN, LEGACY_ENTITY, legacyHash)).toBe(true);
  });

  it('rechaza PIN incorrecto contra hash legacy', async () => {
    expect(await verifyPin('9999', LEGACY_ENTITY, legacyHash)).toBe(false);
  });

  it('rechaza si el entity cambia (el pepper depende del entity)', async () => {
    expect(await verifyPin(LEGACY_PIN, 'other-entity', legacyHash)).toBe(false);
  });
});

describe('verifyPin — rechaza texto plano (regresión)', () => {
  it('NO acepta un valor en texto plano como PIN aunque coincida', async () => {
    expect(await verifyPin('1234', 'entity-1', '1234')).toBe(false);
    expect(await verifyPin('5678', 'entity-1', '5678')).toBe(false);
  });

  it('rechaza cualquier formato no reconocido', async () => {
    expect(await verifyPin('1234', 'entity-1', 'foo')).toBe(false);
    expect(await verifyPin('1234', 'entity-1', 'pbkdf2$100$badformat')).toBe(false);
    expect(await verifyPin('1234', 'entity-1', '')).toBe(false);
  });

  it('rechaza con storedValue vacío o nulo', async () => {
    expect(await verifyPin('1234', 'entity-1', '')).toBe(false);
  });
});

describe('isPinHashed', () => {
  it('detecta el formato PBKDF2 nuevo', () => {
    expect(isPinHashed('pbkdf2$100000$abc123$def456')).toBe(true);
  });

  it('detecta el formato legacy SHA-256 (64 hex)', () => {
    const hex64 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    expect(isPinHashed(hex64)).toBe(true);
  });

  it('rechaza texto plano (PIN sin hashear)', () => {
    expect(isPinHashed('1234')).toBe(false);
    expect(isPinHashed('cualquier-texto')).toBe(false);
    expect(isPinHashed('')).toBe(false);
  });
});

describe('needsRehash', () => {
  it('retorna true para hashes legacy SHA-256', () => {
    const hex64 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    expect(needsRehash(hex64)).toBe(true);
  });

  it('retorna false para hashes PBKDF2 modernos', () => {
    expect(needsRehash('pbkdf2$100000$abc$def')).toBe(false);
  });

  it('retorna false para valores vacíos o texto plano', () => {
    expect(needsRehash('')).toBe(false);
    expect(needsRehash('1234')).toBe(false);
  });
});
