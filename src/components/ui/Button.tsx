import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'navy' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-grad-green text-white shadow-glow-green hover:shadow-[0_10px_26px_rgba(122,193,66,0.42)] hover:-translate-y-px focus-visible:ring-[#7AC142]',
  navy: 'bg-grad-navy text-white shadow-glow-navy hover:shadow-[0_10px_26px_rgba(11,59,104,0.38)] hover:-translate-y-px focus-visible:ring-[#0B3B68]',
  secondary: 'bg-white text-[#1F2937] border border-gray-200 shadow-sm hover:shadow-card hover:border-gray-300 focus-visible:ring-[#0B3B68]',
  danger: 'bg-[#EF4444] text-white shadow-[0_6px_20px_rgba(239,68,68,0.28)] hover:bg-red-600 hover:-translate-y-px focus-visible:ring-[#EF4444]',
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
        'inline-flex items-center justify-center rounded-xl font-bold transition-all duration-200 active:scale-95 active:translate-y-0',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
        'disabled:opacity-50 disabled:pointer-events-none disabled:shadow-none disabled:translate-y-0',
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
