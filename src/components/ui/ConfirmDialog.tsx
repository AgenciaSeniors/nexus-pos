import { type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { Button, type ButtonVariant } from './Button';

export interface ConfirmDialogProps {
  title: ReactNode;
  /** Mensaje/descripción de la acción a confirmar. */
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Variante del botón de confirmación (default `danger`). */
  confirmVariant?: ButtonVariant;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** z-index del overlay; subir si se abre sobre otro modal. */
  zIndex?: number;
}

/**
 * Diálogo de confirmación para acciones destructivas (borrar área/mesa/grupo/
 * receta). Evita borrados silenciosos — estándar de producción.
 */
export function ConfirmDialog({
  title, message, confirmLabel = 'Eliminar', cancelLabel = 'Cancelar',
  confirmVariant = 'danger', loading = false, onConfirm, onCancel, zIndex = 60,
}: ConfirmDialogProps) {
  return (
    <Modal onClose={onCancel} size="sm" zIndex={zIndex} aria-label={typeof title === 'string' ? title : 'Confirmar'}>
      <div className="p-5 text-center">
        <div className="w-14 h-14 rounded-2xl bg-red-50 text-[#EF4444] flex items-center justify-center mx-auto mb-3">
          <AlertTriangle size={28} />
        </div>
        <h2 className="text-lg font-black text-[#1F2937]">{title}</h2>
        <p className="text-sm text-[#6B7280] mt-1.5">{message}</p>
        <div className="flex gap-2 mt-5">
          <Button variant="secondary" fullWidth onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={confirmVariant} fullWidth onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
