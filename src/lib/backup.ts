import { db } from './db';

const BACKUP_DB_NAME = 'NexusPOS_Backups';
const BACKUP_DB_VERSION = 1;
const BACKUP_STORE = 'snapshots';
const MAX_BACKUPS = 4; // Mantener máx. 4 backups (1h de protección con intervalo de 15min)
const BACKUP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutos

let intervalId: ReturnType<typeof setInterval> | null = null;

// Abre la base de datos de backups (separada de la principal para proteger contra corrupción)
function openBackupDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BACKUP_DB_NAME, BACKUP_DB_VERSION);
    req.onupgradeneeded = () => {
      const bdb = req.result;
      if (!bdb.objectStoreNames.contains(BACKUP_STORE)) {
        bdb.createObjectStore(BACKUP_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Serializa todas las tablas relevantes a JSON
async function serializeTables(): Promise<Record<string, unknown[]>> {
  const tableNames = [
    'products', 'sales', 'movements', 'settings', 'customers',
    'parked_orders', 'staff', 'audit_logs', 'cash_registers',
    'cash_shifts', 'cash_movements', 'action_queue'
  ] as const;

  const data: Record<string, unknown[]> = {};
  for (const name of tableNames) {
    try {
      const table = db.table(name);
      data[name] = await table.toArray();
    } catch {
      // Tabla puede no existir si la versión es anterior
      data[name] = [];
    }
  }
  return data;
}

// Crea un backup y lo almacena en la DB separada
export async function createBackup(): Promise<{ id: string; size: number }> {
  const data = await serializeTables();
  const json = JSON.stringify(data);
  const id = `backup_${Date.now()}`;

  const bdb = await openBackupDB();
  const entry = {
    id,
    timestamp: Date.now(),
    data: json,
    size: json.length,
    business_id: localStorage.getItem('nexus_business_id') || 'unknown',
  };

  await new Promise<void>((resolve, reject) => {
    const tx = bdb.transaction(BACKUP_STORE, 'readwrite');
    tx.objectStore(BACKUP_STORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  // Rotar: eliminar backups viejos si hay más del máximo
  await rotateBackups(bdb);
  bdb.close();

  console.log(`✅ Backup creado: ${id} (${(json.length / 1024).toFixed(0)} KB)`);
  return { id, size: json.length };
}

async function rotateBackups(bdb: IDBDatabase) {
  const all = await new Promise<{ id: string; timestamp: number }[]>((resolve, reject) => {
    const tx = bdb.transaction(BACKUP_STORE, 'readonly');
    const req = tx.objectStore(BACKUP_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  if (all.length <= MAX_BACKUPS) return;

  // Ordenar por timestamp descendente, eliminar los más viejos
  all.sort((a, b) => b.timestamp - a.timestamp);
  const toDelete = all.slice(MAX_BACKUPS);

  const tx = bdb.transaction(BACKUP_STORE, 'readwrite');
  const store = tx.objectStore(BACKUP_STORE);
  for (const item of toDelete) {
    store.delete(item.id);
  }
  await new Promise<void>((resolve) => { tx.oncomplete = () => resolve(); });
}

// Restaurar backup: devuelve los datos parseados para importación manual
export async function listBackups(): Promise<{ id: string; timestamp: number; size: number; business_id: string }[]> {
  const bdb = await openBackupDB();
  const all = await new Promise<{ id: string; timestamp: number; size: number; business_id: string }[]>((resolve, reject) => {
    const tx = bdb.transaction(BACKUP_STORE, 'readonly');
    const req = tx.objectStore(BACKUP_STORE).getAll();
    req.onsuccess = () => resolve(req.result.map(r => ({ id: r.id, timestamp: r.timestamp, size: r.size, business_id: r.business_id })));
    req.onerror = () => reject(req.error);
  });
  bdb.close();
  return all.sort((a, b) => b.timestamp - a.timestamp);
}

export async function restoreBackup(backupId: string): Promise<void> {
  const bdb = await openBackupDB();
  const entry = await new Promise<{ data: string } | undefined>((resolve, reject) => {
    const tx = bdb.transaction(BACKUP_STORE, 'readonly');
    const req = tx.objectStore(BACKUP_STORE).get(backupId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  bdb.close();

  if (!entry) throw new Error('Backup no encontrado');

  const data = JSON.parse(entry.data) as Record<string, unknown[]>;

  // Importar datos tabla por tabla dentro de una transacción
  await db.transaction('rw',
    [db.products, db.sales, db.movements, db.settings, db.customers,
     db.parked_orders, db.staff, db.audit_logs, db.cash_registers,
     db.cash_shifts, db.cash_movements, db.action_queue],
    async () => {
      for (const [tableName, rows] of Object.entries(data)) {
        if (!rows.length) continue;
        try {
          const table = db.table(tableName);
          await table.clear();
          await table.bulkPut(rows);
        } catch (err) {
          console.warn(`⚠ Error restaurando tabla ${tableName}:`, err);
        }
      }
    }
  );
  console.log('✅ Backup restaurado exitosamente');
}

// Inicia el backup automático periódico
export function startAutoBackup() {
  if (intervalId !== null) return; // Ya está corriendo

  // Hacer un backup inicial después de 2 minutos (da tiempo a que la app cargue)
  setTimeout(() => {
    createBackup().catch(err => console.warn('⚠ Error en backup inicial:', err));
  }, 2 * 60 * 1000);

  // Programar cada 15 minutos
  intervalId = setInterval(() => {
    createBackup().catch(err => console.warn('⚠ Error en backup automático:', err));
  }, BACKUP_INTERVAL_MS);

  console.log('🔄 Backup automático activado (cada 15 min)');
}

export function stopAutoBackup() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('⏹ Backup automático detenido');
  }
}
