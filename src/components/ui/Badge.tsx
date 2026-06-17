import type { ReactNode } from 'react';
import { cn } from './cn';

export type BadgeColor = 'navy' | 'green' | 'amber' | 'red' | 'blue' | 'gray';

const COLORS: Record<BadgeColor, string> = {
  navy: 'bg-[#0B3B68]/10 text-[#0B3B68]',
  green: 'bg-[#7AC142]/15 text-[#4f7d24]',
  amber: 'bg-amber-100 text-amber-700',
  red: 'bg-red-100 text-red-600',
  blue: 'bg-blue-100 text-blue-700',
  gray: 'bg-gray-100 text-[#1F2937]',
};

export interface BadgeProps {
  color?: BadgeColor;
  /** Icono lucide pequeño a la izquierda. */
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Pill de estado/etiqueta. Para chips de áreas, mesas, estados de cocina, etc. */
export function Badge({ color = 'gray', icon, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold',
        COLORS[color],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
