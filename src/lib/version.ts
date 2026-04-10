import { supabase } from './supabase';

export interface AppVersionInfo {
  version: string;
  release_notes: string | null;
  min_version: string | null;
  platform: string;
  created_at: string;
}

/**
 * Consulta Supabase para ver si hay una versión más reciente disponible.
 * Retorna null si no hay actualización o si falla la consulta (offline, tabla no existe, etc.)
 */
export async function checkForUpdate(currentVersion: string): Promise<AppVersionInfo | null> {
  try {
    const { data, error } = await supabase
      .from('app_versions')
      .select('version, release_notes, min_version, platform, created_at')
      .in('platform', ['all', getPlatform()])
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) return null;

    // Comparar versiones semver simplificado
    if (compareVersions(data.version, currentVersion) > 0) {
      return data as AppVersionInfo;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Verifica si la versión actual está por debajo del mínimo requerido.
 */
export async function isVersionBlocked(currentVersion: string): Promise<AppVersionInfo | null> {
  try {
    const { data, error } = await supabase
      .from('app_versions')
      .select('version, release_notes, min_version, platform, created_at')
      .in('platform', ['all', getPlatform()])
      .not('min_version', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data || !data.min_version) return null;

    if (compareVersions(data.min_version, currentVersion) > 0) {
      return data as AppVersionInfo;
    }

    return null;
  } catch {
    return null;
  }
}

function getPlatform(): string {
  if (typeof window !== 'undefined' && (window as any).electronAPI) return 'windows';
  if (/Android/i.test(navigator.userAgent)) return 'android';
  return 'all';
}

/**
 * Comparación semver simplificada: retorna >0 si a > b, <0 si a < b, 0 si iguales
 */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}
