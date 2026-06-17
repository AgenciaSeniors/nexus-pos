import { forwardRef, useId, type SelectHTMLAttributes, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from './cn';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode;
  error?: string;
  children: ReactNode;
}

const base =
  'w-full p-3 pr-9 border rounded-xl bg-white outline-none transition-colors focus:ring-2 appearance-none disabled:bg-gray-50 disabled:text-gray-400';

/** Select canónico de nexus (con chevron propio y label/error accesibles). */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, className, id, children, ...rest },
  ref,
) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const errorId = error ? `${selectId}-error` : undefined;

  return (
    <div className={cn('w-full', !label && className)}>
      {label && (
        <label htmlFor={selectId} className="block text-sm font-bold text-[#1F2937] mb-1.5">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          ref={ref}
          id={selectId}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          className={cn(
            base,
            error ? 'border-[#EF4444] focus:ring-[#EF4444]' : 'border-gray-200 focus:ring-[#0B3B68]',
            label ? className : undefined,
          )}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown
          size={18}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6B7280] pointer-events-none"
        />
      </div>
      {error && (
        <p id={errorId} className="text-xs text-[#EF4444] mt-1 font-medium">{error}</p>
      )}
    </div>
  );
});
