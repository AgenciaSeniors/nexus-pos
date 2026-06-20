import type { ReactNode } from 'react';
import { cn } from './cn';

export interface PageHeaderProps {
  title: ReactNode;
  /** Icono lucide junto al título. */
  icon?: ReactNode;
  subtitle?: ReactNode;
  /** Acciones a la derecha (botones, enlaces). */
  action?: ReactNode;
  className?: string;
}

/** Encabezado de página estándar de nexus (título navy + acción opcional). */
export function PageHeader({ title, icon, subtitle, action, className }: PageHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h1 className="text-2xl md:text-3xl font-black text-[#0B3B68] flex items-center gap-2">
          {icon}
          <span className="truncate">{title}</span>
        </h1>
        {subtitle && <p className="text-sm text-[#6B7280] mt-1">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
