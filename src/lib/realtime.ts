import { supabase } from './supabase';
import { applyRealtimeRow } from './sync';
import type { RealtimeChannel } from '@supabase/supabase-js';

// ─── KDS REALTIME ─────────────────────────────────────────────────────────────
// Suscripción Realtime para que la cocina (KDS) y el plano de mesas reciban
// cambios de comandas/ítems casi al instante, en vez de esperar el pull de 30s.
//
// Importante (offline-first): Realtime es SOLO LECTURA. Las escrituras siguen
// yendo exclusivamente por la cola offline (action_queue). Si el socket cae, no
// se rompe nada: el pull de 30s de syncLiveData converge igual. Por eso solo nos
// suscribimos a comandas + comanda_items (alta rotación), no a productos/ventas.

let channel: RealtimeChannel | null = null;
let currentBusinessId = '';
let onlineHandler: (() => void) | null = null;

function subscribe(businessId: string) {
  channel = supabase
    .channel(`kds-${businessId}`)
    // Solo payload.new (INSERT/UPDATE). En un DELETE, payload.old trae solo la
    // PK (replica identity por defecto): aplicarlo con bulkPut reemplazaría la
    // fila local completa por un esqueleto {id}. Los borrados físicos (que hoy
    // no ocurren en comandas) convergen por el pull de 30s / heavy sync.
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'comanda_items', filter: `business_id=eq.${businessId}` },
      payload => {
        const row = payload.new;
        if (row && (row as { id?: string }).id) applyRealtimeRow('comanda_items', row).catch(() => {});
      })
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'comandas', filter: `business_id=eq.${businessId}` },
      payload => {
        const row = payload.new;
        if (row && (row as { id?: string }).id) applyRealtimeRow('comandas', row).catch(() => {});
      })
    .subscribe();
}

/** Inicia la suscripción Realtime del negocio (idempotente). */
export function startKdsRealtime(businessId: string) {
  if (!businessId) return;
  if (channel && currentBusinessId === businessId) return;
  stopKdsRealtime();
  currentBusinessId = businessId;
  subscribe(businessId);

  // Al recuperar conexión, re-suscribir por si el canal quedó muerto.
  onlineHandler = () => {
    if (!currentBusinessId) return;
    try { if (channel) supabase.removeChannel(channel); } catch { /* noop */ }
    subscribe(currentBusinessId);
  };
  window.addEventListener('online', onlineHandler);
}

/** Detiene la suscripción y limpia listeners. */
export function stopKdsRealtime() {
  if (channel) {
    try { supabase.removeChannel(channel); } catch { /* noop */ }
    channel = null;
  }
  if (onlineHandler) {
    window.removeEventListener('online', onlineHandler);
    onlineHandler = null;
  }
  currentBusinessId = '';
}
