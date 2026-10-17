import { describe, it, expect } from 'vitest';
import { normalizeText, matchesSearch } from './textSearch';

describe('normalizeText', () => {
  it('quita tildes y diéresis y pasa a minúsculas', () => {
    expect(normalizeText('CAFÉ Ñandú Pingüino')).toBe('cafe nandu pinguino');
  });
  it('colapsa espacios y recorta', () => {
    expect(normalizeText('  Coca   Cola ')).toBe('coca cola');
  });
  it('tolera null, undefined y vacío', () => {
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(undefined)).toBe('');
    expect(normalizeText('')).toBe('');
  });
  it('trata igual el texto compuesto y el descompuesto (é vs e + ´)', () => {
    expect(normalizeText('café')).toBe(normalizeText('café'));
  });
});

describe('matchesSearch', () => {
  it('encuentra "Café" escribiendo "cafe" sin tilde', () => {
    expect(matchesSearch('cafe', 'Café Cubita')).toBe(true);
  });
  it('encuentra sin tilde lo que se escribió con tilde, y al revés', () => {
    expect(matchesSearch('café', 'Cafe molido')).toBe(true);
    expect(matchesSearch('jamón', 'Jamon de pavo')).toBe(true);
  });
  it('no distingue mayúsculas', () => {
    expect(matchesSearch('COCA', 'coca cola 600ml')).toBe(true);
    expect(matchesSearch('coca', 'COCA COLA')).toBe(true);
  });
  it('la ñ se encuentra escribiendo n', () => {
    expect(matchesSearch('nino', 'Zapatos de niño')).toBe(true);
  });
  it('palabras sueltas en cualquier orden', () => {
    expect(matchesSearch('600 coca', 'Coca Cola 600ml')).toBe(true);
    expect(matchesSearch('coca fanta', 'Coca Cola 600ml')).toBe(false);
  });
  it('busca en varios campos (nombre y sku)', () => {
    expect(matchesSearch('bev-001', 'Cerveza', 'BEV-001')).toBe(true);
    expect(matchesSearch('cerveza bev', 'Cerveza', 'BEV-001')).toBe(true);
  });
  it('un campo null o undefined no rompe', () => {
    expect(matchesSearch('cerveza', 'Cerveza', null)).toBe(true);
    expect(matchesSearch('x', undefined, null)).toBe(false);
  });
  it('búsqueda vacía o solo espacios coincide con todo', () => {
    expect(matchesSearch('', 'Lo que sea')).toBe(true);
    expect(matchesSearch('   ', 'Lo que sea')).toBe(true);
  });
  it('lo que no está no coincide', () => {
    expect(matchesSearch('pizza', 'Café Cubita', 'CAF-1')).toBe(false);
  });
});
