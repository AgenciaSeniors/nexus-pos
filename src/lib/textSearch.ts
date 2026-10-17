/**
 * Búsqueda de texto tolerante: sin distinguir mayúsculas, tildes ni diéresis,
 * y por palabras sueltas.
 *
 * Antes cada pantalla hacía `name.toLowerCase().includes(q)`: buscar "cafe" no
 * encontraba "Café", ni "nino" a "Niño", ni "COCA" a "coca-cola" si el nombre
 * llevaba mayúsculas distintas. Una dependienta no debería tener que acertar la
 * ortografía exacta para encontrar un producto.
 *
 * Funciones puras.
 */

/**
 * Minúsculas, sin tildes ni diéresis (á→a, ü→u, ñ→n) y con los espacios
 * colapsados. "Ñandú  Café" → "nandu cafe".
 */
export function normalizeText(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ¿Coincide la búsqueda con alguno de los campos? Cada palabra de la búsqueda
 * tiene que aparecer (en cualquier orden) en el texto de los campos: "coca 600"
 * encuentra "Coca Cola 600ml". Una búsqueda vacía coincide con todo.
 */
export function matchesSearch(query: string, ...fields: (string | null | undefined)[]): boolean {
  const tokens = normalizeText(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = normalizeText(fields.filter(Boolean).join(' '));
  return tokens.every(token => haystack.includes(token));
}
