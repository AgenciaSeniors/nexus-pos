/**
 * Codificador ESC/POS (impresoras térmicas de ticket, p. ej. Rongta RP326).
 *
 * Todo son funciones/clases puras que producen bytes: así se pueden probar sin
 * impresora. El transporte (TCP 9100 en Android/Electron) vive aparte.
 */

/** Tablas de caracteres soportadas. El número es el que recibe `ESC t n`. */
export type Codepage = 'cp858' | 'cp437' | 'ascii';

export const CODEPAGE_ESC_T: Record<Exclude<Codepage, 'ascii'>, number> = {
  cp437: 0,
  cp858: 19,
};

// CP858 (Latin-1 + €): solo lo que nos hace falta en español, más algunos símbolos.
const CP858_MAP: Record<string, number> = {
  'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ä': 0x84, 'à': 0x85, 'å': 0x86, 'ç': 0x87,
  'ê': 0x88, 'ë': 0x89, 'è': 0x8a, 'ï': 0x8b, 'î': 0x8c, 'ì': 0x8d, 'Ä': 0x8e, 'Å': 0x8f,
  'É': 0x90, 'æ': 0x91, 'Æ': 0x92, 'ô': 0x93, 'ö': 0x94, 'ò': 0x95, 'û': 0x96, 'ù': 0x97,
  'ÿ': 0x98, 'Ö': 0x99, 'Ü': 0x9a, 'ø': 0x9b, '£': 0x9c, 'Ø': 0x9d, '×': 0x9e,
  'á': 0xa0, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5, 'ª': 0xa6, 'º': 0xa7,
  '¿': 0xa8, '®': 0xa9, '¬': 0xaa, '½': 0xab, '¼': 0xac, '¡': 0xad, '«': 0xae, '»': 0xaf,
  'Á': 0xb5, 'Â': 0xb6, 'À': 0xb7, '©': 0xb8, '¢': 0xbd, '¥': 0xbe,
  'Í': 0xd6, 'Î': 0xd7, 'Ï': 0xd8, '€': 0xd5,
  'Ó': 0xe0, 'Ô': 0xe2, 'Ò': 0xe3, 'Ú': 0xe9, 'Û': 0xea, 'Ù': 0xeb,
  '°': 0xf8, '·': 0xfa,
};

// CP437 no trae Á Í Ó Ú mayúsculas acentuadas ni €: se degradan a la letra base.
const CP437_MAP: Record<string, number> = {
  'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ä': 0x84, 'à': 0x85, 'å': 0x86, 'ç': 0x87,
  'ê': 0x88, 'ë': 0x89, 'è': 0x8a, 'ï': 0x8b, 'î': 0x8c, 'ì': 0x8d, 'Ä': 0x8e, 'Å': 0x8f,
  'É': 0x90, 'æ': 0x91, 'Æ': 0x92, 'ô': 0x93, 'ö': 0x94, 'ò': 0x95, 'û': 0x96, 'ù': 0x97,
  'ÿ': 0x98, 'Ö': 0x99, 'Ü': 0x9a, '¢': 0x9b, '£': 0x9c, '¥': 0x9d,
  'á': 0xa0, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5, 'ª': 0xa6, 'º': 0xa7,
  '¿': 0xa8, '¬': 0xaa, '½': 0xab, '¼': 0xac, '¡': 0xad, '«': 0xae, '»': 0xaf,
  '°': 0xf8, '·': 0xfa,
};

/** Sustituciones de símbolos fuera de las tablas (comillas, guiones, flechas…). */
const SYMBOL_FALLBACK: Record<string, string> = {
  '“': '"', '”': '"', '‘': "'", '’': "'", '–': '-', '−': '-', '—': '-', '…': '...',
  '↳': '>', '→': '>', '←': '<', '•': '*', '✓': 'v', '✔': 'v', '×': 'x', '€': 'EUR',
  ' ': ' ',
};

/** Quita tildes/diéresis (y la ñ pasa a n): "Canción" → "Cancion". */
export function stripAccents(s: string): string {
  // NFD separa la letra de su marca (ñ = n + ~): al quitar las marcas queda la letra base.
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Convierte texto a bytes de la tabla indicada. Lo que no exista se aproxima o pasa a '?'. */
export function encodeText(text: string, codepage: Codepage): number[] {
  const out: number[] = [];
  const table = codepage === 'cp858' ? CP858_MAP : codepage === 'cp437' ? CP437_MAP : null;
  for (const ch of text.normalize('NFC')) {
    const code = ch.codePointAt(0)!;
    if (code === 0x0a || (code >= 0x20 && code < 0x7f)) { out.push(code); continue; }
    if (table && table[ch] !== undefined) { out.push(table[ch]); continue; }
    const sym = SYMBOL_FALLBACK[ch];
    if (sym !== undefined) { out.push(...encodeText(sym, codepage)); continue; }
    // Letra acentuada que la tabla no tiene (o modo ASCII): letra base.
    const base = stripAccents(ch);
    if (base !== ch && /^[\x20-\x7e]*$/.test(base)) { out.push(...Array.from(base).map(c => c.charCodeAt(0))); continue; }
    out.push(0x3f); // '?'
  }
  return out;
}

export type Align = 'left' | 'center' | 'right';

export interface EscPosOptions {
  /** Columnas con la fuente A: 48 en 80 mm, 32 en 58 mm. */
  columns: number;
  codepage: Codepage;
}

/** Constructor encadenable de un trabajo de impresión. */
export class EscPos {
  private bytes: number[] = [];
  readonly columns: number;
  private codepage: Codepage;

  constructor(opts: EscPosOptions) {
    this.columns = Math.max(16, Math.floor(opts.columns) || 48);
    this.codepage = opts.codepage;
    this.bytes.push(0x1b, 0x40); // ESC @ — reset
    if (this.codepage !== 'ascii') this.bytes.push(0x1b, 0x74, CODEPAGE_ESC_T[this.codepage]); // ESC t n
  }

  /** Texto crudo (sin salto de línea). */
  text(s: string): this { this.bytes.push(...encodeText(s, this.codepage)); return this; }

  /** Una línea de texto + LF. */
  line(s = ''): this { return this.text(s).feed(1); }

  feed(n = 1): this { for (let i = 0; i < n; i++) this.bytes.push(0x0a); return this; }

  align(a: Align): this { this.bytes.push(0x1b, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2); return this; }

  bold(on: boolean): this { this.bytes.push(0x1b, 0x45, on ? 1 : 0); return this; }

  /** Tamaño de caracteres: 1 = normal, 2 = doble ancho y alto (las columnas útiles se dividen). */
  size(mult: 1 | 2): this {
    this.bytes.push(0x1d, 0x21, mult === 2 ? 0x11 : 0x00);
    return this;
  }

  /** Columnas útiles según el tamaño de letra activo. */
  static usable(columns: number, mult: 1 | 2): number { return mult === 2 ? Math.floor(columns / 2) : columns; }

  /** Línea de separación a todo el ancho. */
  rule(ch = '-'): this { return this.line(ch.repeat(this.columns)); }

  /** "izquierda ........ derecha" a todo el ancho; si no cabe, la izquierda se parte en varias líneas. */
  row(left: string, right: string, width = this.columns): this {
    for (const l of rowLines(left, right, width)) this.line(l);
    return this;
  }

  /** Corta el papel (con avance previo, para que el ticket salga entero). */
  cut(feedLines = 4): this {
    this.feed(feedLines);
    this.bytes.push(0x1d, 0x56, 0x42, 0x00); // GS V 66 0 — corte parcial con avance
    return this;
  }

  /** Abre la gaveta de dinero conectada a la impresora (pin 2). */
  drawer(): this { this.bytes.push(0x1b, 0x70, 0x00, 0x32, 0xfa); return this; }

  build(): Uint8Array { return Uint8Array.from(this.bytes); }
}

/** Parte un texto en líneas de máximo `width` caracteres, sin cortar palabras salvo que no quepan. */
export function wrapText(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of String(text ?? '').split('\n')) {
    let cur = '';
    for (let word of para.split(/\s+/).filter(Boolean)) {
      while (word.length > width) {
        if (cur) { out.push(cur); cur = ''; }
        out.push(word.slice(0, width));
        word = word.slice(width);
      }
      if (!cur) cur = word;
      else if (cur.length + 1 + word.length <= width) cur += ' ' + word;
      else { out.push(cur); cur = word; }
    }
    out.push(cur);
  }
  return out;
}

/** Líneas "izq … der": la derecha va siempre alineada al borde; la izquierda se envuelve si es larga. */
export function rowLines(left: string, right: string, width: number): string[] {
  const r = right ?? '';
  const room = Math.max(1, width - r.length - 1);
  const parts = wrapText(left ?? '', room);
  if (parts.length === 0) parts.push('');
  const last = parts.length - 1;
  return parts.map((p, i) =>
    i === last ? p + ' '.repeat(Math.max(1, width - p.length - r.length)) + r : p,
  );
}

/** Centra texto en `width` columnas (para cabeceras en tamaño normal). */
export function centerText(s: string, width: number): string {
  const t = s.length >= width ? s : ' '.repeat(Math.floor((width - s.length) / 2)) + s;
  return t;
}
