import { db, type Staff } from './db';
import { addToQueue, syncPush } from './sync';

/**
 * Guarda el PIN recién creado de un empleado o del admin Y lo encola para subirlo.
 *
 * Antes el PIN se escribía solo en la base local, sin marcarlo pendiente ni
 * encolarlo: la nube nunca lo recibía, así que otro teléfono pedía crearlo de
 * nuevo, y la siguiente sincronización pisaba el PIN local con el vacío de la nube.
 *
 * `hashedPin` ya viene hasheado (PBKDF2): el PIN en claro nunca sale del teléfono.
 */
export async function persistStaffPin(staffId: string, hashedPin: string): Promise<Staff> {
  let updated: Staff | undefined;
  await db.transaction('rw', [db.staff, db.action_queue], async () => {
    const current = await db.staff.get(staffId);
    if (!current) throw new Error(`Empleado ${staffId} no existe localmente`);
    updated = { ...current, pin: hashedPin, sync_status: 'pending_update' };
    await db.staff.put(updated);
    await addToQueue('STAFF_SYNC', updated);
  });
  syncPush().catch(() => { /* sin red: la cola lo sube cuando vuelva */ });
  return updated as Staff;
}
