/**
 * Rate limit genérico del lado cliente.
 *
 * Bloquea por identidad (email/teléfono/IP) tras N intentos fallidos en M minutos.
 * Persistido en localStorage para sobrevivir reinicios de la app/navegador.
 *
 * Nota: esto es defensa en profundidad. La protección real contra fuerza bruta
 * está en Supabase Auth (que tiene su propio rate limit). Pero esto evita
 * que un atacante local desde la misma máquina/navegador agote intentos.
 *
 * Las funciones exportadas mantienen la API de login original (`checkLockout`,
 * `recordFailure`, `recordSuccess`) para retro-compatibilidad. Para otras
 * operaciones usa `createRateLimit('namespace', {...})`.
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

// =============================================================================
// Rate limit genérico — para otras operaciones que login
// =============================================================================

interface RateLimitOptions {
  /** Máximo de intentos antes de bloquear. Default: 5 */
  maxAttempts?: number;
  /** Ventana rodante en ms para contar intentos. Default: 15 min */
  windowMs?: number;
  /** Duración del bloqueo en ms. Default: 15 min */
  lockoutMs?: number;
}

export interface RateLimiter {
  check(identifier: string): LockoutStatus;
  recordFailure(identifier: string): LockoutStatus;
  recordSuccess(identifier: string): void;
}

/**
 * Crea un rate limiter aislado para una operación específica.
 *
 * @param namespace Prefijo único en localStorage (ej: "register", "passwordReset", "voidSale")
 * @param options Configuración de límites
 *
 * @example
 *   const limiter = createRateLimit('register', { maxAttempts: 3, lockoutMs: 30*60*1000 });
 *   const status = limiter.check(email);
 *   if (status.isLocked) toast.error(`Espera ${formatLockoutTime(status.secondsLeft)}`);
 */
export function createRateLimit(namespace: string, options: RateLimitOptions = {}): RateLimiter {
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const windowMs = options.windowMs ?? WINDOW_MS;
  const lockoutMs = options.lockoutMs ?? LOCKOUT_MS;
  const storagePrefix = `nexus_${namespace}_attempts_`;

  const localKey = (id: string) => `${storagePrefix}${id.trim().toLowerCase()}`;

  const readNs = (id: string): AttemptRecord => {
    try {
      const raw = localStorage.getItem(localKey(id));
      if (!raw) return { failures: [], lockedUntil: 0 };
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || !parsed) return { failures: [], lockedUntil: 0 };
      return {
        failures: Array.isArray(parsed.failures) ? parsed.failures.filter((n: unknown) => typeof n === 'number') : [],
        lockedUntil: typeof parsed.lockedUntil === 'number' ? parsed.lockedUntil : 0,
      };
    } catch { return { failures: [], lockedUntil: 0 }; }
  };

  const writeNs = (id: string, record: AttemptRecord): void => {
    try { localStorage.setItem(localKey(id), JSON.stringify(record)); } catch { /* nada */ }
  };

  const pruneNs = (failures: number[]) => {
    const cutoff = Date.now() - windowMs;
    return failures.filter(ts => ts >= cutoff);
  };

  return {
    check(identifier: string): LockoutStatus {
      if (!identifier) return { isLocked: false, secondsLeft: 0, attemptsLeft: maxAttempts };
      const record = readNs(identifier);
      const now = Date.now();
      if (record.lockedUntil > now) {
        return { isLocked: true, secondsLeft: Math.ceil((record.lockedUntil - now) / 1000), attemptsLeft: 0 };
      }
      if (record.lockedUntil > 0 && record.lockedUntil <= now) {
        writeNs(identifier, { failures: [], lockedUntil: 0 });
        return { isLocked: false, secondsLeft: 0, attemptsLeft: maxAttempts };
      }
      const validFailures = pruneNs(record.failures);
      return {
        isLocked: false, secondsLeft: 0,
        attemptsLeft: Math.max(0, maxAttempts - validFailures.length),
      };
    },

    recordFailure(identifier: string): LockoutStatus {
      if (!identifier) return { isLocked: false, secondsLeft: 0, attemptsLeft: maxAttempts };
      const record = readNs(identifier);
      const now = Date.now();
      const validFailures = pruneNs(record.failures);
      validFailures.push(now);

      if (validFailures.length >= maxAttempts) {
        const lockedUntil = now + lockoutMs;
        writeNs(identifier, { failures: validFailures, lockedUntil });
        return { isLocked: true, secondsLeft: Math.ceil(lockoutMs / 1000), attemptsLeft: 0 };
      }
      writeNs(identifier, { failures: validFailures, lockedUntil: 0 });
      return { isLocked: false, secondsLeft: 0, attemptsLeft: maxAttempts - validFailures.length };
    },

    recordSuccess(identifier: string): void {
      if (!identifier) return;
      try { localStorage.removeItem(localKey(identifier)); } catch { /* nada */ }
    },
  };
}

// Limiters pre-configurados para operaciones comunes
/** Registro: 3 intentos / 30 min (más estricto — crear cuentas falsas masivas es costoso) */
export const registerRateLimit = createRateLimit('register', { maxAttempts: 3, lockoutMs: 30 * 60 * 1000 });

/** Anulación de ventas: 5 intentos / 5 min (más permisivo — operación legítima frecuente) */
export const voidSaleRateLimit = createRateLimit('voidSale', { maxAttempts: 5, lockoutMs: 5 * 60 * 1000, windowMs: 5 * 60 * 1000 });
