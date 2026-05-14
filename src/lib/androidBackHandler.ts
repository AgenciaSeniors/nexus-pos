/**
 * Manejo del botón Back hardware de Android.
 *
 * Sin este handler, el back nativo cierra la app inmediatamente — perdiendo
 * ventas en curso, parked orders no guardadas, modales abiertos, etc.
 *
 * Política:
 * - Si hay un modal abierto (overlay con z-50/60/70), cierra el modal
 * - Si estamos en una ruta secundaria (/inventario, /finanzas, ...), navega a "/"
 * - Si estamos en "/" (POS), pide confirmación antes de cerrar:
 *   - Primer back: muestra toast "Toca atrás otra vez para salir"
 *   - Segundo back en 2s: cierra la app
 *
 * Importado dinámicamente solo cuando Capacitor está disponible para no
 * afectar el bundle de web/desktop.
 */

import { toast } from 'sonner';

let cleanupFn: (() => void) | null = null;
let lastBackTs = 0;
const DOUBLE_TAP_MS = 2000;

interface NavigateFn {
  (to: string): void;
}

/**
 * Detecta si estamos corriendo dentro de Capacitor (Android nativo).
 */
export function isCapacitorAndroid(): boolean {
  if (typeof window === 'undefined') return false;
  // Capacitor.isNativePlatform existe en la versión global del Capacitor JS bridge
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cap = (window as any).Capacitor;
  return !!cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform();
}

/**
 * Detecta si hay un modal/overlay visible (usa z-50 o superior).
 * Heurística simple pero efectiva con nuestro patrón actual de modales.
 */
function findOpenModal(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  // Buscar elementos fijed con z-index >= 50 que ocupen toda la pantalla
  const candidates = document.querySelectorAll<HTMLElement>(
    '.fixed.inset-0[class*="z-"]'
  );
  // Retornar el de mayor z-index visible
  let best: HTMLElement | null = null;
  let bestZ = -1;
  candidates.forEach(el => {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return;
    const z = parseInt(style.zIndex || '0', 10);
    if (z > bestZ) {
      bestZ = z;
      best = el;
    }
  });
  return best;
}

/**
 * Intenta cerrar el modal abierto disparando click en su botón de cierre.
 * Busca botones con aria-label="Cerrar", aria-label="Close", o el icono X de lucide.
 */
function tryCloseModal(modal: HTMLElement): boolean {
  // Estrategia 1: botón con aria-label conocido
  const closeBtn = modal.querySelector<HTMLButtonElement>(
    'button[aria-label="Cerrar"], button[aria-label="Close"]'
  );
  if (closeBtn) {
    closeBtn.click();
    return true;
  }
  // Estrategia 2: botón con un SVG que se llame "X" (lucide X icon)
  const buttons = modal.querySelectorAll<HTMLButtonElement>('button');
  for (const btn of buttons) {
    const svg = btn.querySelector('svg.lucide-x');
    if (svg) {
      btn.click();
      return true;
    }
  }
  return false;
}

/**
 * Activa los handlers de Android: back button + lifecycle pause/resume.
 * Debe llamarse después de que la app montó y solo en Android.
 *
 * @param navigate función de react-router para navegar (típicamente useNavigate())
 * @param onResume callback opcional que se invoca cuando la app vuelve del background
 */
export async function registerBackHandler(
  navigate: NavigateFn,
  onResume?: () => void,
): Promise<void> {
  if (!isCapacitorAndroid()) return;
  // Si ya está registrado, no duplicar
  if (cleanupFn) return;

  try {
    const { App } = await import('@capacitor/app');

    // 1. Back button hardware
    const backListener = await App.addListener('backButton', () => {
      // a) ¿Hay modal abierto?
      const modal = findOpenModal();
      if (modal && tryCloseModal(modal)) return;

      // b) ¿Estamos en ruta secundaria?
      const hash = window.location.hash.replace(/^#/, '') || '/';
      if (hash !== '/' && hash !== '') {
        navigate('/');
        return;
      }

      // c) Estamos en POS — confirmar salida con doble-tap
      const now = Date.now();
      if (now - lastBackTs < DOUBLE_TAP_MS) {
        App.exitApp();
        return;
      }
      lastBackTs = now;
      toast('Toca atrás otra vez para salir', { duration: DOUBLE_TAP_MS, icon: '↩️' });
    });

    // 2. App lifecycle: cuando vuelve del background, intentar sincronizar
    // (el sync periódico puede haber sido pausado por Android al ocultar la WebView)
    const stateListener = await App.addListener('appStateChange', (state) => {
      if (state.isActive && onResume) {
        // Pequeño debounce: a veces appStateChange dispara antes de que la red
        // esté lista cuando el usuario reconecta WiFi al volver del background
        setTimeout(onResume, 300);
      }
    });

    cleanupFn = () => {
      backListener.remove();
      stateListener.remove();
    };
  } catch (err) {
    console.warn('No se pudo registrar back handler de Android:', err);
  }
}

/**
 * Desregistra todos los handlers (útil en logout o tests).
 */
export function unregisterBackHandler(): void {
  if (cleanupFn) {
    cleanupFn();
    cleanupFn = null;
  }
}
