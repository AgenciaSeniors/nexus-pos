/**
 * Utilidades para exportar datos a CSV.
 * Compatible con Excel (UTF-8 BOM + delimitador `;` por defecto en es-CU).
 */

import { exportFile, type ExportOutcome } from './fileExport';

type CsvValue = string | number | boolean | null | undefined | Date;

/**
 * Escapa un valor para CSV: envuelve en comillas si contiene separador,
 * comillas o saltos de línea. Duplica comillas internas.
 */
function escapeCsv(value: CsvValue, separator: string): string {
  if (value === null || value === undefined) return '';
  let str: string;
  if (value instanceof Date) {
    str = value.toISOString();
  } else {
    str = String(value);
  }
  // Si contiene separador, comillas o saltos → envolver y escapar
  if (str.includes(separator) || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export interface CsvColumn<T> {
  /** Etiqueta visible en el encabezado del CSV */
  label: string;
  /** Función que extrae el valor de cada fila */
  value: (row: T) => CsvValue;
}

interface ExportOptions {
  /** Separador de columnas. Default: `;` (mejor compatibilidad con Excel en es) */
  separator?: string;
  /** Si incluir encabezado. Default: true */
  includeHeader?: boolean;
  /** Si incluir BOM UTF-8 (para que Excel detecte el encoding). Default: true */
  bom?: boolean;
}

/**
 * Genera el contenido CSV como string.
 */
export function toCsv<T>(
  rows: T[],
  columns: CsvColumn<T>[],
  opts: ExportOptions = {}
): string {
  const separator = opts.separator ?? ';';
  const includeHeader = opts.includeHeader ?? true;
  const bom = opts.bom ?? true;

  const lines: string[] = [];
  if (includeHeader) {
    lines.push(columns.map(c => escapeCsv(c.label, separator)).join(separator));
  }
  for (const row of rows) {
    lines.push(columns.map(c => escapeCsv(c.value(row), separator)).join(separator));
  }
  const content = lines.join('\r\n');
  return bom ? '﻿' + content : content;
}

/**
 * Saca el CSV del dispositivo: descarga en navegador/Windows, menú de compartir en Android
 * (ver lib/fileExport). Lanza si falla.
 */
export function downloadCsv<T>(
  filename: string,
  rows: T[],
  columns: CsvColumn<T>[],
  opts: ExportOptions = {}
): Promise<ExportOutcome> {
  const content = toCsv(rows, columns, opts);
  return exportFile({
    name: filename.endsWith('.csv') ? filename : `${filename}.csv`,
    mimeType: 'text/csv;charset=utf-8;',
    content,
  });
}

/**
 * Formatea una fecha ISO a YYYY-MM-DD HH:mm en hora local.
 */
export function formatLocalDateTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
