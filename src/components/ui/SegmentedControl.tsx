import type { ReactNode } from 'react';
import { cn } from './cn';

export interface SegmentOption<T> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
}

export interface SegmentedControlProps<T extends string | number> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  /** Ocupa todo el ancho repartiendo los segmentos por igual. */
  fullWidth?: boolean;
  className?: string;
  'aria-label'?: string;
}

/** Selector de modos/pestañas: pista gris con el activo elevado en blanco. */
export function SegmentedControl<T extends string | number>({
  options, value, onChange, size = 'md', fullWidth = false, className, ...rest
}: SegmentedControlProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={rest['aria-label']}
      className={cn('inline-flex p-1 rounded-xl bg-gray-100 gap-1', fullWidth && 'flex w-full', className)}
    >
      {options.map(o => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-lg font-bold transition-all duration-200',
              fullWidth && 'flex-1',
              size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-4 py-2',
              active ? 'bg-white text-[#0B3B68] shadow-card' : 'text-[#6B7280] hover:text-[#1F2937]',
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
