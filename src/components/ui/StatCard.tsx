import type { ReactNode } from 'react';
import { cn } from './cn';

export type StatTone = 'default' | 'navy' | 'green';

export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  /** Icono lucide (esquina superior derecha). */
  icon?: ReactNode;
  /** `navy`/`green` pintan la tarjeta en gradiente de marca (destacada). */
  tone?: StatTone;
  className?: string;
}

/** Tarjeta de métrica (KPI) al estilo del dashboard de Finanzas: número grande,
 *  label, icono y blob decorativo en las variantes destacadas. */
export function StatCard({ label, value, icon, tone = 'default', className }: StatCardProps) {
  const featured = tone !== 'default';
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl p-4',
        tone === 'default' && 'bg-white border border-gray-200 shadow-card',
        tone === 'navy' && 'bg-grad-navy text-white shadow-glow-navy',
        tone === 'green' && 'bg-grad-green text-white shadow-glow-green',
        className,
      )}
    >
      {featured && (
        <span aria-hidden="true" className="absolute -top-6 -right-6 w-20 h-20 rounded-full bg-white/10 blur-xl" />
      )}
      <div className="relative flex items-center justify-between gap-2">
        <p className={cn('text-[10px] font-bold uppercase tracking-wider', featured ? 'text-white/70' : 'text-[#6B7280]')}>
          {label}
        </p>
        {icon && <span className={cn(featured ? 'text-white/80' : 'text-[#0B3B68]')}>{icon}</span>}
      </div>
      <p className={cn('relative font-black mt-1 text-2xl', !featured && 'text-[#1F2937]')}>{value}</p>
    </div>
  );
}
