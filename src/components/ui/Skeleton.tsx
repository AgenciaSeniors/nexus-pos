import { cn } from './cn';

export interface SkeletonProps {
  className?: string;
}

/** Bloque de carga (shimmer) para usar mientras `useLiveQuery` resuelve. */
export function Skeleton({ className }: SkeletonProps) {
  return <div className={cn('animate-pulse rounded-xl bg-gray-200/70', className)} aria-hidden="true" />;
}

export interface SkeletonListProps {
  /** Número de filas a mostrar. */
  rows?: number;
  className?: string;
  rowClassName?: string;
}

/** Lista de placeholders para grids/listas en carga. */
export function SkeletonList({ rows = 4, className, rowClassName }: SkeletonListProps) {
  return (
    <div className={cn('space-y-2', className)} role="status" aria-label="Cargando…">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={cn('h-12 w-full', rowClassName)} />
      ))}
    </div>
  );
}
