import { useState, useEffect } from 'react';

/** Reloj reactivo: re-renderiza cada `intervalMs` para timers en vivo (mesas, KDS). */
export function useNow(intervalMs = 30000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Minutos transcurridos desde una fecha ISO hasta `now` (en ms). */
export function minutesSince(iso: string | undefined | null, now: number): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 60000));
}

/** Formatea minutos como "Xm" o "Hh Mm" (compacto, para chips de tiempo). */
export function formatElapsed(totalMinutes: number): string {
  const m = Math.max(0, Math.floor(totalMinutes));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}
