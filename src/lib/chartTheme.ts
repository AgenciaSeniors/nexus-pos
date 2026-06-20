/**
 * Tema unificado para los gráficos (Recharts) — colores de marca y estilos
 * compartidos. Centraliza lo que antes se repetía inline en cada gráfico para
 * que todos se vean consistentes y "premium".
 */
import type { CSSProperties } from 'react';

export const NAVY = '#0B3B68';
export const GREEN = '#7AC142';

/** Paleta de marca para series categóricas (pie, barras múltiples). */
export const BRAND_CHART_COLORS = [
  '#0B3B68', // navy
  '#7AC142', // verde
  '#F59E0B', // ámbar
  '#EF4444', // rojo
  '#6366F1', // índigo
  '#06B6D4', // cian
  '#6B7280', // gris
];

/** Tarjeta del tooltip: redondeada, con sombra tintada de navy (consistente con `shadow-card`). */
export const CHART_TOOLTIP_STYLE: CSSProperties = {
  borderRadius: 12,
  border: '1px solid #eef2f7',
  boxShadow: '0 10px 28px rgba(11,59,104,0.12)',
  fontSize: 12,
  fontWeight: 600,
  color: '#1F2937',
  padding: '8px 12px',
};

/** Trazo de las líneas de cuadrícula. */
export const CHART_GRID_STROKE = '#f1f5f9';
