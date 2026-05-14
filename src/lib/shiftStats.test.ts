import { describe, it, expect } from 'vitest';
import { isSaleValidAtTime, filterSalesValidAtTime, endOfLocalDay } from './shiftStats';

// =============================================================================
// isSaleValidAtTime — la lógica crítica de reportes inmutables
// =============================================================================

describe('isSaleValidAtTime — ventas NO anuladas', () => {
  it('venta completed siempre es válida', () => {
    const sale = { status: 'completed', date: '2026-01-01T10:00:00Z' };
    expect(isSaleValidAtTime(sale, '2026-01-01T22:00:00Z')).toBe(true);
    expect(isSaleValidAtTime(sale, '2099-01-01T00:00:00Z')).toBe(true);
  });

  it('venta sin status (default) se trata como completed', () => {
    const sale = { date: '2026-01-01T10:00:00Z' };
    expect(isSaleValidAtTime(sale, '2026-01-01T22:00:00Z')).toBe(true);
  });

  it('venta con stock_conflict sigue contando (no es voided)', () => {
    const sale = { status: 'stock_conflict', date: '2026-01-01T10:00:00Z' };
    expect(isSaleValidAtTime(sale, '2026-01-01T22:00:00Z')).toBe(true);
  });

  it('venta partial_refund sigue contando (es válida con el monto restante)', () => {
    const sale = { status: 'partial_refund', date: '2026-01-01T10:00:00Z' };
    expect(isSaleValidAtTime(sale, '2026-01-01T22:00:00Z')).toBe(true);
  });
});

describe('isSaleValidAtTime — ventas VOIDED (el caso crítico)', () => {
  it('voided ANTES del cierre del periodo → NO válida', () => {
    // Turno cierra a las 22:00. Venta anulada a las 21:00 (dentro del turno).
    const sale = {
      status: 'voided',
      voided_at: '2026-01-01T21:00:00Z',
      date: '2026-01-01T18:00:00Z',
    };
    expect(isSaleValidAtTime(sale, '2026-01-01T22:00:00Z')).toBe(false);
  });

  it('voided DESPUÉS del cierre del periodo → SÍ válida (inmutabilidad)', () => {
    // EL CASO BUG: turno cerrado ayer a las 22:00. Hoy se anula la venta.
    // En el reporte histórico del turno de ayer, la venta debe seguir contando
    // (al cierre era válida; la anulación de hoy va al turno actual).
    const sale = {
      status: 'voided',
      voided_at: '2026-01-02T10:00:00Z', // anulada hoy
      date: '2026-01-01T18:00:00Z',      // venta de ayer
    };
    expect(isSaleValidAtTime(sale, '2026-01-01T22:00:00Z')).toBe(true);
  });

  it('voided EXACTAMENTE en el cierre → NO válida (empate va al periodo)', () => {
    const sale = {
      status: 'voided',
      voided_at: '2026-01-01T22:00:00Z',
      date: '2026-01-01T18:00:00Z',
    };
    expect(isSaleValidAtTime(sale, '2026-01-01T22:00:00Z')).toBe(false);
  });

  it('voided sin timestamp (legacy) → NO válida (comportamiento conservador)', () => {
    const sale = {
      status: 'voided',
      date: '2026-01-01T18:00:00Z',
    };
    expect(isSaleValidAtTime(sale, '2026-01-01T22:00:00Z')).toBe(false);
    expect(isSaleValidAtTime(sale, '2099-12-31T23:59:59Z')).toBe(false);
  });
});

describe('isSaleValidAtTime — formatos de periodEnd', () => {
  const sale = {
    status: 'voided',
    voided_at: '2026-01-02T10:00:00Z',
    date: '2026-01-01T18:00:00Z',
  };

  it('acepta string ISO', () => {
    expect(isSaleValidAtTime(sale, '2026-01-01T22:00:00Z')).toBe(true);
  });

  it('acepta Date', () => {
    expect(isSaleValidAtTime(sale, new Date('2026-01-01T22:00:00Z'))).toBe(true);
  });

  it('acepta number (epoch ms)', () => {
    expect(isSaleValidAtTime(sale, new Date('2026-01-01T22:00:00Z').getTime())).toBe(true);
  });

  it('rechaza datos corruptos', () => {
    expect(isSaleValidAtTime(sale, 'not a date')).toBe(false);
    expect(isSaleValidAtTime({ status: 'voided', voided_at: 'bad', date: 'x' }, '2026-01-01T22:00:00Z')).toBe(false);
  });
});

// =============================================================================
// filterSalesValidAtTime
// =============================================================================
describe('filterSalesValidAtTime', () => {
  it('mezcla típica de un reporte histórico de turno cerrado', () => {
    const periodEnd = '2026-01-01T22:00:00Z'; // turno cerró ayer 22:00
    const sales = [
      // ✓ Válida: completada
      { id: 'A', status: 'completed', date: '2026-01-01T10:00:00Z' },
      // ✗ Inválida: anulada DENTRO del turno
      { id: 'B', status: 'voided', voided_at: '2026-01-01T15:00:00Z', date: '2026-01-01T11:00:00Z' },
      // ✓ Válida: anulada DESPUÉS del cierre (hoy)
      { id: 'C', status: 'voided', voided_at: '2026-01-02T09:00:00Z', date: '2026-01-01T12:00:00Z' },
      // ✗ Inválida: voided legacy sin timestamp
      { id: 'D', status: 'voided', date: '2026-01-01T13:00:00Z' },
      // ✓ Válida: partial_refund (cuenta con monto restante)
      { id: 'E', status: 'partial_refund', date: '2026-01-01T14:00:00Z' },
    ];
    const filtered = filterSalesValidAtTime(sales, periodEnd);
    const ids = filtered.map(s => s.id).sort();
    expect(ids).toEqual(['A', 'C', 'E']);
  });

  it('lista vacía retorna lista vacía', () => {
    expect(filterSalesValidAtTime([], '2026-01-01T22:00:00Z')).toEqual([]);
  });

  it('preserva el orden original', () => {
    const sales = [
      { id: 'A', status: 'completed', date: '2026-01-01T10:00:00Z' },
      { id: 'B', status: 'completed', date: '2026-01-01T11:00:00Z' },
      { id: 'C', status: 'completed', date: '2026-01-01T12:00:00Z' },
    ];
    const filtered = filterSalesValidAtTime(sales, '2026-01-01T22:00:00Z');
    expect(filtered.map(s => s.id)).toEqual(['A', 'B', 'C']);
  });
});

// =============================================================================
// endOfLocalDay
// =============================================================================
describe('endOfLocalDay', () => {
  it('retorna 23:59:59.999 del día local', () => {
    const d = endOfLocalDay('2026-01-15');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(0); // enero = 0
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
    expect(d.getSeconds()).toBe(59);
    expect(d.getMilliseconds()).toBe(999);
  });

  it('maneja diciembre correctamente', () => {
    const d = endOfLocalDay('2026-12-31');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(11);
    expect(d.getDate()).toBe(31);
  });
});

// =============================================================================
// Escenario integrado: el bug original
// =============================================================================
describe('Escenario integrado — bug del cuadre mutante', () => {
  it('reporte histórico de ayer NO cambia al anular venta hoy', () => {
    // Turno T1 cerró ayer a las 22:00 con 3 ventas (total $300).
    // Hoy se anula la venta de $100. El reporte de T1 debe seguir mostrando $300.
    const ayerCierre = '2026-05-13T22:00:00-04:00'; // Cuba UTC-4
    const sales = [
      { id: '1', status: 'completed', date: '2026-05-13T10:00:00-04:00' },        // $100
      { id: '2', status: 'completed', date: '2026-05-13T15:00:00-04:00' },        // $100
      { id: '3', status: 'voided', voided_at: '2026-05-14T09:00:00-04:00', date: '2026-05-13T18:00:00-04:00' }, // anulada hoy
    ];
    const validAtClose = filterSalesValidAtTime(sales, ayerCierre);
    expect(validAtClose.length).toBe(3); // ¡las 3 cuentan en el cierre de ayer!
  });

  it('reporte del turno ACTUAL sí refleja la anulación inmediata', () => {
    // Turno actual abierto desde las 8:00 hoy. Acabo de anular una venta.
    // El reporte en vivo (ahora=10:00) NO debe contar la anulada.
    const ahora = '2026-05-14T10:00:00-04:00';
    const sales = [
      { id: '1', status: 'completed', date: '2026-05-14T08:30:00-04:00' },
      { id: '2', status: 'voided', voided_at: '2026-05-14T09:55:00-04:00', date: '2026-05-14T09:00:00-04:00' },
    ];
    const validNow = filterSalesValidAtTime(sales, ahora);
    expect(validNow.length).toBe(1); // solo la completed
    expect(validNow[0].id).toBe('1');
  });
});
