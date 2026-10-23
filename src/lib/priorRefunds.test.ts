import { describe, it, expect } from 'vitest';
import type { Sale } from './db';
import { refundEventsOf, summarizePriorRefunds } from './priorRefunds';

const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00`).toISOString();
const ms = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00`).getTime();

const sale = (over: Partial<Sale> = {}): Sale => ({
  id: 's1', business_id: 'b1', shift_id: 'sh1', date: at('2026-10-14', '12:00'), total: 100,
  payment_method: 'efectivo', status: 'completed', sync_status: 'synced',
  items: [{ product_id: 'p1', name: 'Café', price: 50, quantity: 2, cost: 20 }],
  ...over,
} as Sale);

const AYER = '2026-10-14';
const HOY = '2026-10-15';

describe('refundEventsOf', () => {
  it('una venta sin devoluciones no tiene eventos', () => {
    expect(refundEventsOf(sale())).toEqual([]);
  });

  it('una anulación completa es UN evento por el total, con el costo recuperado', () => {
    const [e] = refundEventsOf(sale({ status: 'voided', voided_at: at(HOY, '10:00') }));
    expect(e).toMatchObject({ amount: 100, cash: 100, transfer: 0, card: 0, cost_recovered: 40 });
    expect(e.date).toBe(at(HOY, '10:00'));
  });

  it('una devolución parcial es un evento con su fecha', () => {
    const [e] = refundEventsOf(sale({
      status: 'partial_refund',
      refunded_items: [{ product_id: 'p1', name: 'Café', quantity: 1, amount: 50, date: at(HOY, '11:00') }],
    }));
    expect(e).toMatchObject({ amount: 50, cash: 50, cost_recovered: 20 });
  });

  it('parcial y luego anulación: el resto es solo lo que faltaba devolver', () => {
    const events = refundEventsOf(sale({
      status: 'voided', voided_at: at(HOY, '15:00'),
      refunded_items: [{ product_id: 'p1', name: 'Café', quantity: 1, amount: 50, date: at(HOY, '11:00') }],
    }));
    expect(events.map(e => e.amount)).toEqual([50, 50]);
    expect(events[1].cost_recovered).toBe(20); // solo queda 1 café por devolver
  });

  it('una venta cerrada por devolución parcial COMPLETA no deja resto (no se cuenta dos veces)', () => {
    const events = refundEventsOf(sale({
      status: 'voided', voided_at: at(HOY, '11:00'),
      refunded_items: [{ product_id: 'p1', name: 'Café', quantity: 2, amount: 100, date: at(HOY, '11:00') }],
    }));
    expect(events).toHaveLength(1);
    expect(events[0].amount).toBe(100);
  });

  it('transferencia y tarjeta no salen de la caja', () => {
    expect(refundEventsOf(sale({ payment_method: 'transferencia', status: 'voided', voided_at: at(HOY, '10:00') }))[0])
      .toMatchObject({ cash: 0, transfer: 100, card: 0 });
    expect(refundEventsOf(sale({ payment_method: 'tarjeta', status: 'voided', voided_at: at(HOY, '10:00') }))[0])
      .toMatchObject({ cash: 0, transfer: 0, card: 100 });
  });

  it('venta mixta: el reembolso consume primero lo pagado en efectivo, el resto es transferencia', () => {
    const [e] = refundEventsOf(sale({
      payment_method: 'mixto', cash_amount: 30, transfer_amount: 70, status: 'voided', voided_at: at(HOY, '10:00'),
    }));
    expect(e).toMatchObject({ cash: 30, transfer: 70 });
  });

  it('una devolución sin fecha (datos viejos) no se puede ubicar en un día y se ignora', () => {
    const events = refundEventsOf(sale({
      status: 'partial_refund',
      refunded_items: [{ product_id: 'p1', name: 'Café', quantity: 1, amount: 50, date: '' }],
    }));
    expect(events).toEqual([]);
  });
});

describe('summarizePriorRefunds', () => {
  const periodoHoy = { fromMs: ms(HOY, '00:00'), toMs: ms(HOY, '23:59'), isPrior: (s: Sale) => new Date(s.date).getTime() < ms(HOY, '00:00') };

  it('una venta de AYER anulada HOY cuenta como devolución anterior de hoy', () => {
    const r = summarizePriorRefunds([sale({ status: 'voided', voided_at: at(HOY, '10:00') })], periodoHoy);
    expect(r).toMatchObject({ count: 1, total: 100, cash: 100, transfer: 0, cost_recovered: 40 });
  });

  it('una venta de HOY anulada hoy NO es anterior (ya sale de los totales de hoy)', () => {
    const deHoy = sale({ date: at(HOY, '09:00'), status: 'voided', voided_at: at(HOY, '10:00') });
    expect(summarizePriorRefunds([deHoy], periodoHoy).count).toBe(0);
  });

  it('una anulación posterior al periodo no entra (reportes inmutables)', () => {
    const periodoAyer = { fromMs: ms(AYER, '00:00'), toMs: ms(AYER, '23:59'), isPrior: (s: Sale) => new Date(s.date).getTime() < ms(AYER, '00:00') };
    const r = summarizePriorRefunds([sale({ date: at('2026-10-10', '12:00'), status: 'voided', voided_at: at(HOY, '10:00') })], periodoAyer);
    expect(r.count).toBe(0);
  });

  it('varias devoluciones se suman por forma de pago', () => {
    const r = summarizePriorRefunds([
      sale({ id: 'a', status: 'voided', voided_at: at(HOY, '10:00') }),
      sale({ id: 'b', total: 80, payment_method: 'transferencia', items: [{ product_id: 'p2', name: 'Agua', price: 80, quantity: 1, cost: 30 }], status: 'voided', voided_at: at(HOY, '12:00') }),
    ], periodoHoy);
    expect(r).toMatchObject({ count: 2, total: 180, cash: 100, transfer: 80, card: 0, cost_recovered: 70 });
    expect(r.events.map(e => e.sale_id)).toEqual(['a', 'b']);
  });

  it('el criterio de "anterior" lo decide quien llama (p. ej. otro turno)', () => {
    const r = summarizePriorRefunds([sale({ shift_id: 'turnoViejo', status: 'voided', voided_at: at(HOY, '10:00') })], {
      fromMs: ms(HOY, '08:00'), toMs: ms(HOY, '23:59'), isPrior: s => s.shift_id !== 'turnoActual',
    });
    expect(r.count).toBe(1);
  });
});
