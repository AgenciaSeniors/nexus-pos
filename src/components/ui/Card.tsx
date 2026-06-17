import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/** Contenedor base: blanco, borde sutil, radio y sombra estándar de nexus. */
export function Card({ className, children, ...rest }: CardProps) {
  return (
    <div className={cn('bg-white border border-gray-200 rounded-xl p-4 shadow-sm', className)} {...rest}>
      {children}
    </div>
  );
}

export interface SectionCardProps {
  title: ReactNode;
  /** Icono lucide a la izquierda del título. */
  icon?: ReactNode;
  /** Subtítulo/ayuda bajo el título. */
  subtitle?: ReactNode;
  /** Acción a la derecha del header (botón, etc.). */
  action?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

/**
 * Card con header (icono + título + subtítulo + acción) y cuerpo. Base para los
 * paneles de configuración, para que se vean hermanos de Inventario/Clientes.
 */
export function SectionCard({ title, icon, subtitle, action, className, bodyClassName, children }: SectionCardProps) {
  return (
    <section className={cn('bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden', className)}>
      <header className="flex items-start justify-between gap-3 px-4 sm:px-5 py-4 border-b border-gray-100">
        <div className="min-w-0">
          <h3 className="font-black text-[#1F2937] flex items-center gap-2">
            {icon}
            <span className="truncate">{title}</span>
          </h3>
          {subtitle && <p className="text-xs text-[#6B7280] mt-1">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className={cn('p-4 sm:p-5', bodyClassName)}>{children}</div>
    </section>
  );
}
