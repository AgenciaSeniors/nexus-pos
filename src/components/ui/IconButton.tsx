import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

export type IconButtonVariant = 'plain' | 'ghost' | 'navy' | 'danger';
export type IconButtonSize = 'sm' | 'md';

const VARIANTS: Record<IconButtonVariant, string> = {
  plain: 'bg-white border border-gray-200 text-[#0B3B68] hover:bg-gray-50',
  ghost: 'bg-transparent text-[#0B3B68] hover:bg-[#0B3B68]/10',
  navy: 'bg-grad-navy text-white shadow-glow-navy hover:-translate-y-px',
  danger: 'bg-transparent text-[#EF4444] hover:bg-red-50',
};

const SIZES: Record<IconButtonSize, string> = {
  sm: 'w-8 h-8',
  md: 'w-10 h-10',
};

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Obligatorio: descripción accesible de la acción. */
  label: string;
  icon: ReactNode;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
}

/** Botón de solo icono, accesible por defecto (aria-label obligatorio). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'plain', size = 'md', className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex items-center justify-center rounded-xl transition-all active:scale-95',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0B3B68] focus-visible:ring-offset-1',
        'disabled:opacity-40 disabled:pointer-events-none',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
});
