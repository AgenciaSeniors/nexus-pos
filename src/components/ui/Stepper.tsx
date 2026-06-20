import { Minus, Plus } from 'lucide-react';
import { cn } from './cn';

export interface StepperProps {
  value: number;
  onDecrement: () => void;
  onIncrement: () => void;
  min?: number;
  max?: number;
  size?: 'sm' | 'md';
  /** Etiqueta accesible (ej. "Cantidad de Mojito"). */
  label?: string;
  className?: string;
}

/** Control de cantidad −/N/+ táctil y accesible. Reemplaza los steppers inline. */
export function Stepper({ value, onDecrement, onIncrement, min, max, size = 'md', label, className }: StepperProps) {
  const btn = size === 'sm' ? 'w-8 h-8' : 'w-9 h-9';
  const canDec = min === undefined || value > min;
  const canInc = max === undefined || value < max;
  return (
    <div className={cn('inline-flex items-center gap-1', className)} role="group" aria-label={label}>
      <button
        type="button"
        onClick={onDecrement}
        disabled={!canDec}
        aria-label="Disminuir"
        className={cn(btn, 'flex items-center justify-center rounded-lg bg-white border border-gray-200 text-[#0B3B68] transition-colors hover:bg-gray-50 active:scale-95 disabled:opacity-40 disabled:pointer-events-none')}
      >
        <Minus size={size === 'sm' ? 14 : 16} />
      </button>
      <span className={cn('text-center font-black tabular-nums', size === 'sm' ? 'w-6 text-sm' : 'w-8')} aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        onClick={onIncrement}
        disabled={!canInc}
        aria-label="Aumentar"
        className={cn(btn, 'flex items-center justify-center rounded-lg bg-white border border-gray-200 text-[#0B3B68] transition-colors hover:bg-gray-50 active:scale-95 disabled:opacity-40 disabled:pointer-events-none')}
      >
        <Plus size={size === 'sm' ? 14 : 16} />
      </button>
    </div>
  );
}
