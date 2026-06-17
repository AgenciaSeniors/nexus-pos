/**
 * Kit de UI canónico de nexus. Encapsula los tokens reales de la app (color,
 * radio, foco, animación) para que las pantallas sean consistentes y se frene la
 * deriva de Tailwind inline. Importar con:
 *   import { Button, Modal, SectionCard, ... } from '../components/ui';
 */
export { cn } from './cn';
export { Button } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';
export { Modal } from './Modal';
export type { ModalProps, ModalSize } from './Modal';
export { Card, SectionCard } from './Card';
export type { CardProps, SectionCardProps } from './Card';
export { Input } from './Input';
export type { InputProps } from './Input';
export { Select } from './Select';
export type { SelectProps } from './Select';
export { PageHeader } from './PageHeader';
export type { PageHeaderProps } from './PageHeader';
export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';
export { Badge } from './Badge';
export type { BadgeProps, BadgeColor } from './Badge';
export { Skeleton, SkeletonList } from './Skeleton';
export type { SkeletonProps, SkeletonListProps } from './Skeleton';
export { ConfirmDialog } from './ConfirmDialog';
export type { ConfirmDialogProps } from './ConfirmDialog';
