import type { ReactNode } from 'react';
import { cn } from './cn';

export interface EmptyStateProps {
  /** Icono lucide mostrado en el círculo. */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Acción (botón) bajo el texto. */
  action?: ReactNode;
  /** `sm` para huecos dentro de cards; `md` (default) para vistas completas. */
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Estado vacío consistente: icono en círculo + título + descripción + acción.
 * Reemplaza los `<p class="text-[#9CA3AF]">` sueltos por algo de calidad.
 */
export function EmptyState({ icon, title, description, action, size = 'md', className }: EmptyStateProps) {
  const sm = size === 'sm';
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', sm ? 'py-8 px-4' : 'py-14 px-6', className)}>
      {icon && (
        <div
          className={cn(
            'rounded-2xl bg-[#0B3B68]/5 text-[#0B3B68] flex items-center justify-center mb-3',
            sm ? 'w-12 h-12' : 'w-16 h-16',
          )}
        >
          {icon}
        </div>
      )}
      <p className={cn('font-bold text-[#1F2937]', sm ? 'text-sm' : 'text-lg')}>{title}</p>
      {description && (
        <p className={cn('text-[#6B7280] max-w-sm mt-1', sm ? 'text-xs' : 'text-sm')}>{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
