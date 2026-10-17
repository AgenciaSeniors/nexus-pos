import { describe, it, expect } from 'vitest';
import type { CashShift, CashMovement } from './db';
import { describeDifference, buildShiftRecaps, buildZReportText, type ZReportInput } from './zReport';
import type { ProductDayRow } from './dailyInventory';

const localDay = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
/** ISO de una hora LOCAL concreta de un día */
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00`).toISOString();

const shift = (over: Partial<CashShift>): CashShift => ({
  id: 's1', business_id: 'b1', staff_id: 'u1', start_amount: 500,
  opened_at: at('2026-10-14', '08:00'), status: 'open', sync_status: 'synced', ...over,
} as CashShift);

const mov = (shift_id: string, type: 'in' | 'out', amount: number): CashMovement => ({
  id: crypto.randomUUID(), shift_id, business_id: 'b1', type, amount, reason: 'x',
  staff_id: 'u1', created_at: at('2026-10-14', '12:00'), sync_status: 'synced',
});

describe('describeDifference', () => {
  it('cero (o ruido de centavos) = cuadra', () => {
    expect(describeDifference(0).tone).toBe('ok');
    expect(describeDifference(0.001).tone).toBe('ok');
  });
  it('negativa = falta, positiva = sobra', () => {
    expect(describeDifference(-35)).toEqual({ label: 'Falta', tone: 'short', amount: -35 });
    expect(describeDifference(12.5)).toEqual({ label: 'Sobra', tone: 'over', amount: 12.5 });
  });
  it('sin dato = turno sin cerrar', () => {
    expect(describeDifference(undefined).tone).toBe('pending');
  });
});

describe('buildShiftRecaps', () => {
  const staffNames = new Map([['u1', 'Ana Pérez']]);
  const cerrado = shift({
    id: 'c1', status: 'closed', closed_at: at('2026-10-14', '18:30'),
    end_amount: 1465, expected_amount: 1500, difference: -35,
    transfer_expected: 300, transfer_count: 300, transfer_difference: 0,
  });

  it('un turno cerrado aporta esperado, contado y diferencia', () => {
    const [r] = buildShiftRecaps({ shifts: [cerrado], movements: [], staffNames, day: '2026-10-14', localDay });
    expect(r).toMatchObject({ expected_cash: 1500, counted_cash: 1465, cash_difference: -35, opened_by: 'Ana Pérez', start_amount: 500 });
  });

  it('suma entradas y salidas de caja de CADA turno por separado', () => {
    const otro = shift({ id: 'c2', status: 'closed', closed_at: at('2026-10-14', '23:00'), opened_at: at('2026-10-14', '19:00') });
    const recaps = buildShiftRecaps({
      shifts: [otro, cerrado],
      movements: [mov('c1', 'in', 100), mov('c1', 'out', 40), mov('c1', 'out', 10), mov('c2', 'out', 7)],
      staffNames, day: '2026-10-14', localDay,
    });
    expect(recaps.map(r => r.id)).toEqual(['c1', 'c2']); // ordenados por apertura
    expect(recaps[0]).toMatchObject({ cash_in: 100, cash_out: 50 });
    expect(recaps[1]).toMatchObject({ cash_in: 0, cash_out: 7 });
  });

  it('un turno de noche cuenta una sola vez, en el día en que se CERRÓ', () => {
    const noche = shift({ id: 'n1', status: 'closed', opened_at: at('2026-10-14', '20:00'), closed_at: at('2026-10-15', '02:00') });
    expect(buildShiftRecaps({ shifts: [noche], movements: [], staffNames, day: '2026-10-14', localDay })).toHaveLength(0);
    expect(buildShiftRecaps({ shifts: [noche], movements: [], staffNames, day: '2026-10-15', localDay })).toHaveLength(1);
  });

  it('un turno abierto cuenta en el día que se abrió y no trae cuadre', () => {
    const [r] = buildShiftRecaps({ shifts: [shift({ id: 'o1' })], movements: [], staffNames, day: '2026-10-14', localDay });
    expect(r.status).toBe('open');
    expect(r.cash_difference).toBeUndefined();
  });

  it('ignora turnos de otros días', () => {
    expect(buildShiftRecaps({ shifts: [cerrado], movements: [], staffNames, day: '2026-10-13', localDay })).toHaveLength(0);
  });
});

describe('buildZReportText', () => {
  const base: ZReportInput = {
    businessName: 'El Pinto', dateLabel: '14/10/2026', ticketCount: 12,
    cashTotal: 1000, cardTotal: 0, transferTotal: 300, netTotal: 1300,
    voided: { count: 0, total: 0 }, shifts: [], products: [], staff: [],
  };
  const cierre = buildShiftRecaps({
    shifts: [shift({ id: 'c1', status: 'closed', closed_at: at('2026-10-14', '18:30'), end_amount: 1465, expected_amount: 1500, difference: -35, transfer_expected: 300, transfer_count: 300, transfer_difference: 0 })],
    movements: [], staffNames: new Map([['u1', 'Ana Pérez']]), day: '2026-10-14', localDay,
  });

  it('incluye ventas, total neto y el cuadre con la diferencia', () => {
    const t = buildZReportText({ ...base, shifts: cierre });
    expect(t).toContain('*REPORTE Z — EL PINTO*');
    expect(t).toContain('Tickets: 12');
    expect(t).toContain('*TOTAL NETO: $1300.00*');
    expect(t).toContain('Efectivo esperado: $1500.00');
    expect(t).toContain('Efectivo contado: $1465.00');
    expect(t).toContain('Diferencia efectivo: Falta −$35.00');
    expect(t).toContain('Diferencia transferencias: Cuadra ✓');
    expect(t).toContain('(Ana)');
  });

  it('cuando cuadra lo dice, y cuando sobra marca el signo', () => {
    const cuadra = buildShiftRecaps({ shifts: [shift({ id: 'k', status: 'closed', closed_at: at('2026-10-14', '18:00'), expected_amount: 100, end_amount: 100, difference: 0 })], movements: [], staffNames: new Map(), day: '2026-10-14', localDay });
    expect(buildZReportText({ ...base, shifts: cuadra })).toContain('Diferencia efectivo: Cuadra ✓');
    const sobra = buildShiftRecaps({ shifts: [shift({ id: 'k', status: 'closed', closed_at: at('2026-10-14', '18:00'), expected_amount: 100, end_amount: 112.5, difference: 12.5 })], movements: [], staffNames: new Map(), day: '2026-10-14', localDay });
    expect(buildZReportText({ ...base, shifts: sobra })).toContain('Sobra +$12.50');
  });

  it('avisa si un turno quedó sin cerrar', () => {
    const abierto = buildShiftRecaps({ shifts: [shift({ id: 'o1' })], movements: [], staffNames: new Map(), day: '2026-10-14', localDay });
    expect(buildZReportText({ ...base, shifts: abierto })).toContain('Turno sin cerrar');
  });

  it('sin turnos lo dice en vez de dejar la sección vacía', () => {
    expect(buildZReportText(base)).toContain('Sin turnos registrados este día.');
  });

  it('las anuladas se informan aparte del total', () => {
    const t = buildZReportText({ ...base, voided: { count: 2, total: 80 } });
    expect(t).toContain('Anuladas: 2 ($80.00) — no incluidas en el total');
  });

  it('recorta la lista de productos y dice cuántos faltan', () => {
    const products = Array.from({ length: 18 }, (_, i) => ({ name: `P${i + 1}`, quantity: 1, total: 10 }));
    const t = buildZReportText({ ...base, products });
    expect(t).toContain('P15');
    expect(t).not.toContain('P16');
    expect(t).toContain('… y 3 productos más');
  });

  it('incluye el inventario esperado de lo vendido, con entradas y reparto vitrina/almacén', () => {
    const fila = (over: Partial<ProductDayRow>): ProductDayRow => ({
      product_id: 'p', name: 'Café', price: 10, start_display: 20, start_warehouse: 0, entries: 0, sold: 5,
      returned: 0, other: 0, transfer_to_display: 0, end_display: 15, end_warehouse: 0, ...over,
    });
    const t = buildZReportText({
      ...base,
      inventory: [
        fila({}),
        fila({ product_id: 'q', name: 'Agua', start_display: 5, start_warehouse: 30, entries: 10, sold: 4, end_display: 11, end_warehouse: 30 }),
        fila({ product_id: 'r', name: 'No vendido', sold: 0 }),
      ],
    });
    expect(t).toContain('*INVENTARIO DEL DÍA (esperado)*');
    expect(t).toContain('Café: inicial 20, −5 vendió → final 15');
    expect(t).toContain('Agua: inicial 35, +10 entró, −4 vendió → final 41 (vitrina 11 · almacén 30)');
    expect(t).not.toContain('No vendido');
  });

  it('sin inventario no añade la sección', () => {
    expect(buildZReportText(base)).not.toContain('INVENTARIO DEL DÍA');
  });

  it('el desglose por vendedor solo sale si hay más de uno', () => {
    expect(buildZReportText({ ...base, staff: [{ name: 'Ana', count: 3, total: 90 }] })).not.toContain('POR VENDEDOR');
    const dos = buildZReportText({ ...base, staff: [{ name: 'Ana', count: 3, total: 90 }, { name: 'Luis', count: 1, total: 20 }] });
    expect(dos).toContain('Ana: 3 ventas · $90.00');
    expect(dos).toContain('Luis: 1 venta · $20.00');
  });
});
