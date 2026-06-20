import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  /** Mensaje de error; pinta el borde de rojo y se asocia vía aria-describedby. */
  error?: string;
  /** Icono/adorno a la izquierda (ej. un "$"). */
  icon?: ReactNode;
}

const base =
  'w-full p-3 border rounded-xl outline-none transition-all focus:ring-4 disabled:bg-gray-50 disabled:text-gray-400';

/** Input de texto canónico de nexus, con label y estado de error accesibles. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, icon, className, id, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div className={cn('w-full', !label && className)}>
      {label && (
        <label htmlFor={inputId} className="block text-sm font-bold text-[#1F2937] mb-1.5">
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280] pointer-events-none">{icon}</span>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          className={cn(
            base,
            icon && 'pl-8',
            error
              ? 'border-[#EF4444] focus:ring-[#EF4444]/15'
              : 'border-gray-200 focus:border-[#0B3B68] focus:ring-[#0B3B68]/10',
            label ? className : undefined,
          )}
          {...rest}
        />
      </div>
      {error && (
        <p id={errorId} className="text-xs text-[#EF4444] mt-1 font-medium">{error}</p>
      )}
    </div>
  );
});
