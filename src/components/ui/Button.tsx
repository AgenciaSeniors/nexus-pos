import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'navy' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-[#7AC142] text-white hover:bg-[#5a962e] focus-visible:ring-[#7AC142]',
  navy: 'bg-[#0B3B68] text-white hover:bg-[#0a3257] focus-visible:ring-[#0B3B68]',
  secondary: 'bg-white text-[#1F2937] border border-gray-200 hover:bg-gray-50 focus-visible:ring-[#0B3B68]',
  danger: 'bg-[#EF4444] text-white hover:bg-red-600 focus-visible:ring-[#EF4444]',
  ghost: 'bg-transparent text-[#0B3B68] hover:bg-[#0B3B68]/10 focus-visible:ring-[#0B3B68]',
};

// Alturas ≥44px en md/lg para área táctil cómoda (sm reservado para botones-icono inline).
const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5',
  md: 'h-11 px-4 text-sm gap-2',
  lg: 'h-12 px-5 text-base gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Icono lucide a la izquierda del texto (oculto mientras `loading`). */
  icon?: ReactNode;
  /** Muestra spinner y deshabilita el botón. */
  loading?: boolean;
  fullWidth?: boolean;
}

/**
 * Botón canónico de nexus. Encapsula los tokens de color/radio/foco de la app
 * para frenar la deriva de estilos inline. Accesible (foco visible, disabled).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon, loading = false, fullWidth = false, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center rounded-xl font-bold transition-all active:scale-95',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
        'disabled:opacity-50 disabled:pointer-events-none',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 size={size === 'lg' ? 20 : 18} className="animate-spin" /> : icon}
      {children}
    </button>
  );
});
