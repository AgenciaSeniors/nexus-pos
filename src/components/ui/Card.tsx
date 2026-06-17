import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Añade elevación e interacción al pasar el cursor. */
  hover?: boolean;
  children: ReactNode;
}

/** Contenedor base: blanco, borde sutil, radio y sombra tintada de nexus. */
export function Card({ className, hover = false, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'bg-white border border-gray-200 rounded-xl p-4 shadow-card',
        hover && 'transition-all duration-200 hover:shadow-card-hover hover:-translate-y-0.5',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export type SectionAccent = 'navy' | 'green' | 'amber';

const CHIP: Record<SectionAccent, string> = {
  navy: 'bg-[#0B3B68]/10',
  green: 'bg-[#7AC142]/15',
  amber: 'bg-amber-100',
};

export interface SectionCardProps {
  title: ReactNode;
  /** Icono lucide (con su propio color); se monta dentro de un chip. */
  icon?: ReactNode;
  /** Color del chip del icono. */
  accent?: SectionAccent;
  /** Subtítulo/ayuda bajo el título. */
  subtitle?: ReactNode;
  /** Acción a la derecha del header (botón, etc.). */
  action?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

/**
 * Card con header (icono en chip + título + subtítulo + acción) y cuerpo. Base
 * para los paneles de configuración, hermanos de Inventario/Clientes.
 */
export function SectionCard({ title, icon, accent = 'navy', subtitle, action, className, bodyClassName, children }: SectionCardProps) {
  return (
    <section className={cn('bg-white border border-gray-200 rounded-2xl shadow-card overflow-hidden', className)}>
      <header className="flex items-start justify-between gap-3 px-4 sm:px-5 py-4 border-b border-gray-100">
        <div className="flex items-start gap-3 min-w-0">
          {icon && (
            <span className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', CHIP[accent])}>
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h3 className="font-black text-[#1F2937] truncate">{title}</h3>
            {subtitle && <p className="text-xs text-[#6B7280] mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className={cn('p-4 sm:p-5', bodyClassName)}>{children}</div>
    </section>
  );
}
