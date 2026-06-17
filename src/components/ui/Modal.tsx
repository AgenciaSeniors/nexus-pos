import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from './cn';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZES: Record<ModalSize, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-2xl',
};

export interface ModalProps {
  /** Título del header navy. Si se omite, no se renderiza el header. */
  title?: ReactNode;
  /** Icono lucide junto al título. */
  icon?: ReactNode;
  onClose: () => void;
  size?: ModalSize;
  /** Barra inferior fija (acciones). */
  footer?: ReactNode;
  children: ReactNode;
  /** z-index del overlay; subir para modales anidados (default 50). */
  zIndex?: number;
  /** Cerrar al hacer click en el backdrop (default true). */
  closeOnBackdrop?: boolean;
  /** Clases extra para el panel. */
  className?: string;
  'aria-label'?: string;
}

/**
 * Modal canónico de nexus: backdrop navy con blur + fade, panel redondeado con
 * header navy, bottom-sheet en móvil y centrado en desktop. Cierra con `Esc` y
 * con click en el backdrop; bloquea el scroll del fondo. Reemplaza los overlays
 * inline (y arregla los `bg-black/40` sin blur del modo restaurante).
 */
export function Modal({
  title, icon, onClose, size = 'md', footer, children,
  zIndex = 50, closeOnBackdrop = true, className, ...rest
}: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const labelledByTitle = typeof title === 'string' ? title : undefined;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={rest['aria-label'] ?? labelledByTitle}
      onMouseDown={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 bg-[#0B3B68]/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 nx-fade-in"
      style={{ zIndex }}
    >
      <div
        className={cn(
          'bg-white w-full rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] nx-sheet-up sm:nx-pop-in',
          SIZES[size],
          className,
        )}
      >
        {title !== undefined && (
          <div className="bg-[#0B3B68] px-5 py-4 text-white flex items-center justify-between gap-3 shrink-0">
            <h2 className="text-lg font-black flex items-center gap-2 min-w-0">
              {icon}
              <span className="truncate">{title}</span>
            </h2>
            <button
              onClick={onClose}
              aria-label="Cerrar"
              className="bg-white/10 p-2 rounded-full hover:bg-white/20 transition-colors shrink-0"
            >
              <X size={20} />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">{children}</div>

        {footer && <div className="border-t border-gray-100 p-4 shrink-0">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
