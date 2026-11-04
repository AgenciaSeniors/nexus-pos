// @vitest-environment happy-dom
/**
 * Conectividad real: el navegador puede decir "sin red" cuando sí la hay (y al revés).
 * Aquí se comprueba que el sondeo propio detecta la vuelta de la conexión aunque el navegador
 * nunca avise, y que se emite `nexus-reconnected` para despertar la cola.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  probeReachable, checkConnectivityNow, getConnectivity, isReachableRecently,
  subscribeConnectivity, __resetConnectivity,
} from './connectivity';

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value });
}

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://prueba.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'k');
  __resetConnectivity(true);
  setNavigatorOnline(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('probeReachable', () => {
  it('cualquier respuesta del servidor cuenta como "hay red"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ type: 'opaque' }));
    expect(await probeReachable()).toBe(true);
    expect(isReachableRecently()).toBe(true);
  });

  it('si la conexión falla, no hay red', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await probeReachable()).toBe(false);
    expect(isReachableRecently()).toBe(false);
  });

  it('llamadas simultáneas comparten un solo sondeo', async () => {
    const f = vi.fn().mockResolvedValue({});
    vi.stubGlobal('fetch', f);
    await Promise.all([probeReachable(), probeReachable(), probeReachable()]);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('checkConnectivityNow', () => {
  it('si el navegador dice que hay red, no gasta un sondeo', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await checkConnectivityNow()).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });

  it('el navegador dice "sin red" pero el servidor responde: HAY red', async () => {
    setNavigatorOnline(false);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({}));
    expect(await checkConnectivityNow()).toBe(true);
    expect(getConnectivity()).toBe(true);
  });

  it('sin red de verdad: false', async () => {
    setNavigatorOnline(false);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await checkConnectivityNow()).toBe(false);
    expect(getConnectivity()).toBe(false);
  });
});

describe('vuelta de la conexión sin que el navegador avise', () => {
  it('estaba sin red, el sondeo detecta que volvió y emite nexus-reconnected', async () => {
    vi.useFakeTimers();
    setNavigatorOnline(false);
    // Primero NO hay red (el sondeo falla)...
    const f = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', f);

    const cambios: boolean[] = [];
    const baja = subscribeConnectivity(v => cambios.push(v));
    let reconectado = 0;
    const alReconectar = () => { reconectado++; };
    window.addEventListener('nexus-reconnected', alReconectar);

    // El navegador avisa de que se cayó la red
    window.dispatchEvent(new Event('offline'));
    await vi.advanceTimersByTimeAsync(0);
    expect(getConnectivity()).toBe(false);

    // Pasa un rato sin red: el sondeo sigue fallando y nada se dispara
    await vi.advanceTimersByTimeAsync(25_000);
    expect(reconectado).toBe(0);

    // ...y vuelve el internet SIN que el navegador emita 'online'
    f.mockResolvedValue({});
    await vi.advanceTimersByTimeAsync(10_000);

    expect(getConnectivity()).toBe(true);
    expect(reconectado).toBe(1);
    expect(cambios.at(-1)).toBe(true);

    baja();
    window.removeEventListener('nexus-reconnected', alReconectar);
  });
});
