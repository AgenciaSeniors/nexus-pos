/**
 * Une clases condicionales (mini-`clsx`). Filtra falsy y une con espacio.
 * El kit no añade dependencias externas, así que vive aquí.
 */
export type ClassValue = string | number | false | null | undefined;

export function cn(...parts: ClassValue[]): string {
  return parts.filter(Boolean).join(' ');
}
