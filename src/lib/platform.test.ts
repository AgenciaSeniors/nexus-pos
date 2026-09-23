import { describe, it, expect } from 'vitest';
import { downloadUrlForPlatform } from './platform';

/**
 * A dónde se manda al usuario a bajar la actualización.
 *
 * La app avisaba de la versión nueva y remataba con "Contacta a soporte para
 * recibir la actualización": el aviso llegaba, la actualización no. Estos
 * enlaces apuntan a los releases que el CI publica en cada build.
 */
describe('downloadUrlForPlatform', () => {
  it('en Android manda al prerelease del APK', () => {
    const r = downloadUrlForPlatform('android');
    expect(r.url).toBe('https://github.com/AgenciaSeniors/nexus-pos/releases/tag/android-latest');
    expect(r.label).toMatch(/APK/);
  });

  it('en Windows manda al último release publicado', () => {
    const r = downloadUrlForPlatform('windows');
    expect(r.url).toBe('https://github.com/AgenciaSeniors/nexus-pos/releases/latest');
    expect(r.label).toMatch(/Windows/);
  });

  it('en web no ofrece descarga: el PWA se actualiza solo', () => {
    // Devolver un enlace aquí mandaría al usuario de la web a instalarse un
    // APK que no necesita. La UI usa la url vacía para mostrar "recarga".
    expect(downloadUrlForPlatform('all').url).toBe('');
  });

  it('una plataforma desconocida se trata como web, no revienta', () => {
    expect(downloadUrlForPlatform('loquesea').url).toBe('');
  });
});
