import { db, type AuditLog } from './db';
import { addToQueue } from './sync';

/**
 * Registra una acción de usuario en el log local y la encola para sincronización.
 * @param action Tipo de acción (SALE, DELETE_PRODUCT, etc.)
 * @param details Objeto JSON con detalles (ej: { total: 500, id_venta: ... })
 * @param staff Objeto del empleado actual
 */
export async function logAuditAction(
  action: AuditLog['action'], 
  details: Record<string, unknown>, 
  staff: { id: string, name: string, business_id: string }
) {
  const log: AuditLog = {
    id: crypto.randomUUID(),
    business_id: staff.business_id,
    staff_id: staff.id,
    staff_name: staff.name,
    action,
    details, // Se guarda tal cual
    created_at: new Date().toISOString(),
    sync_status: 'pending_create'
  };

  // 1. Guardar en BD Local (para historial offline inmediato)
  await db.audit_logs.add(log);

  // 2. Encolar para subir a Supabase (Auditoría Remota)
  await addToQueue('AUDIT', log);
}