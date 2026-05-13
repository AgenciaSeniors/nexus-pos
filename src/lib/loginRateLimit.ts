/**
 * Rate limit del lado cliente para login.
 *
 * Bloquea por email/teléfono tras N intentos fallidos en M minutos.
 * Persistido en localStorage para sobrevivir reinicios de la app/navegador.
 *
 * Nota: esto es defensa en profundidad. La protección real contra fuerza bruta
 * está en Supabase Auth (que tiene su propio rate limit). Pero esto evita
 * que un atacante local desde la misma máquina/navegador agote intentos.
 */

const STORAGE_PREFIX = 'nexus_login_attempts_';
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;     // 15 min de ventana rodante para acumular intentos
const LOCKOUT_MS = 15 * 60 * 1000;    // 15 min de bloqueo tras superar el máximo

interface AttemptRecord {
  /** Timestamps de intentos fallidos (ms epoch), dentro de WINDOW_MS */
  failures: number[];
  /** Hasta cuándo está bloqueada esta identidad (ms epoch). 0 = no bloqueada */
  lockedUntil: number;
}

function keyFor(identifier: string): string {
  // Lowercase + trim para evitar bypass simple (Email vs email)
  return `${STORAGE_PREFIX}${identifier.trim().toLowerCase()}`;
}

function read(identifier: string): AttemptRecord {
  try {
    const raw = localStorage.getItem(keyFor(identifier));
    if (!raw) return { failures: [], lockedUntil: 0 };
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || !parsed) return { failures: [], lockedUntil: 0 };
    return {
      failures: Array.isArray(parsed.failures) ? parsed.failures.filter((n: unknown) => typeof n === 'number') : [],
      lockedUntil: typeof parsed.lockedUntil === 'number' ? parsed.lockedUntil : 0,
    };
  } catch {
    return { failures: [], lockedUntil: 0 };
  }
}

function write(identifier: string, record: AttemptRecord): void {
  try {
    localStorage.setItem(keyFor(identifier), JSON.stringify(record));
  } catch {
    /* localStorage lleno o no disponible */
  }
}

function pruneOldFailures(failures: number[]): number[] {
  const cutoff = Date.now() - WINDOW_MS;
  return failures.filter(ts => ts >= cutoff);
}

export interface LockoutStatus {
  isLocked: boolean;
  /** Segundos restantes hasta que se desbloquee (0 si no está bloqueado) */
  secondsLeft: number;
  /** Intentos fallidos restantes antes del bloqueo (0 si ya está bloqueado) */
  attemptsLeft: number;
}

/**
 * Consulta si una identidad está bloqueada actualmente.
 */
export function checkLockout(identifier: string): LockoutStatus {
  if (!identifier) return { isLocked: false, secondsLeft: 0, attemptsLeft: MAX_ATTEMPTS };
  const record = read(identifier);
  const now = Date.now();

  // ¿Aún en período de bloqueo?
  if (record.lockedUntil > now) {
    return {
      isLocked: true,
      secondsLeft: Math.ceil((record.lockedUntil - now) / 1000),
      attemptsLeft: 0,
    };
  }

  // Si pasó el bloqueo, limpiar registro
  if (record.lockedUntil > 0 && record.lockedUntil <= now) {
    write(identifier, { failures: [], lockedUntil: 0 });
    return { isLocked: false, secondsLeft: 0, attemptsLeft: MAX_ATTEMPTS };
  }

  const validFailures = pruneOldFailures(record.failures);
  return {
    isLocked: false,
    secondsLeft: 0,
    attemptsLeft: Math.max(0, MAX_ATTEMPTS - validFailures.length),
  };
}

/**
 * Registra un intento fallido. Devuelve el estado actualizado.
 * Si supera el máximo, activa el bloqueo.
 */
export function recordFailure(identifier: string): LockoutStatus {
  if (!identifier) return { isLocked: false, secondsLeft: 0, attemptsLeft: MAX_ATTEMPTS };
  const record = read(identifier);
  const now = Date.now();
  const validFailures = pruneOldFailures(record.failures);
  validFailures.push(now);

  if (validFailures.length >= MAX_ATTEMPTS) {
    const lockedUntil = now + LOCKOUT_MS;
    write(identifier, { failures: validFailures, lockedUntil });
    return {
      isLocked: true,
      secondsLeft: Math.ceil(LOCKOUT_MS / 1000),
      attemptsLeft: 0,
    };
  }

  write(identifier, { failures: validFailures, lockedUntil: 0 });
  return {
    isLocked: false,
    secondsLeft: 0,
    attemptsLeft: MAX_ATTEMPTS - validFailures.length,
  };
}

/**
 * Limpia el registro tras un login exitoso.
 */
export function recordSuccess(identifier: string): void {
  if (!identifier) return;
  try {
    localStorage.removeItem(keyFor(identifier));
  } catch {
    /* nada */
  }
}

/**
 * Formatea segundos restantes a "Xm Ys" o "Ys" para mostrar al usuario.
 */
export function formatLockoutTime(seconds: number): string {
  if (seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s} segundo${s !== 1 ? 's' : ''}`;
  if (s === 0) return `${m} minuto${m !== 1 ? 's' : ''}`;
  return `${m} min ${s} s`;
}

// Constantes exportadas para tests / UI
export const RATE_LIMIT_CONFIG = {
  MAX_ATTEMPTS,
  WINDOW_MS,
  LOCKOUT_MS,
};
