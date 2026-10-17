/**
 * Corte Z completo: ventas + CUADRE DE CAJA del día.
 *
 * Antes el Reporte Z solo traía ventas (efectivo/tarjeta/transferencia, productos
 * y vendedores). El resultado del cuadre —cuánto debía haber en caja, cuánto se
 * contó y la diferencia— se guardaba en el turno pero solo se veía en un aviso al
 * cerrar: después nadie podía consultar "¿cuánto faltó el martes?".
 *
 * Todo aquí son funciones puras (sin Dexie ni React) para poder probarlas, y
 * `buildZReportText` produce el texto que se manda por WhatsApp, que además
 * resuelve la impresión en el APK (Android no ejecuta window.print()).
 */
import type { CashShift, CashMovement } from './db';
import type { ProductDayRow } from './dailyInventory';

export type DifferenceTone = 'ok' | 'over' | 'short' | 'pending';

export interface ZShiftRecap {
  id: string;
  opened_at: string;
  closed_at?: string;
  status: 'open' | 'closed';
  opened_by?: string;
  start_amount: number;
  cash_in: number;
  cash_out: number;
  /** Solo en turnos cerrados */
  expected_cash?: number;
  counted_cash?: number;
  cash_difference?: number;
  transfer_expected?: number;
  transfer_counted?: number;
  transfer_difference?: number;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return isNaN(n) ? 0 : n;
};

/** Interpreta una diferencia de caja: negativa = falta dinero, positiva = sobra. */
export function describeDifference(diff: number | undefined): { label: string; tone: DifferenceTone; amount: number } {
  if (diff === undefined || diff === null || isNaN(diff)) return { label: 'Sin cerrar', tone: 'pending', amount: 0 };
  const amount = round2(diff);
  if (Math.abs(amount) < 0.005) return { label: 'Cuadra', tone: 'ok', amount: 0 };
  return amount > 0
    ? { label: 'Sobra', tone: 'over', amount }
    : { label: 'Falta', tone: 'short', amount };
}

/**
 * Turnos que pertenecen a un día. Un turno cuenta en el día en que SE CERRÓ (si
 * sigue abierto, en el que se abrió): así un turno de noche que abre a las 20:00
 * y cierra a las 02:00 aparece una sola vez, en el día del cierre, en vez de
 * partirse en dos cortes.
 *
 * @param localDay convierte una fecha a YYYY-MM-DD en hora LOCAL (nunca UTC)
 */
export function buildShiftRecaps(args: {
  shifts: CashShift[];
  movements: CashMovement[];
  staffNames: Map<string, string>;
  day: string;
  localDay: (d: Date) => string;
}): ZShiftRecap[] {
  const { shifts, movements, staffNames, day, localDay } = args;

  const movementsByShift = new Map<string, CashMovement[]>();
  for (const m of movements) {
    const list = movementsByShift.get(m.shift_id) || [];
    list.push(m);
    movementsByShift.set(m.shift_id, list);
  }

  return shifts
    .filter(s => {
      const anchor = s.status === 'closed' && s.closed_at ? s.closed_at : s.opened_at;
      const d = new Date(anchor);
      return !isNaN(d.getTime()) && localDay(d) === day;
    })
    .sort((a, b) => (a.opened_at || '').localeCompare(b.opened_at || ''))
    .map(s => {
      const movs = movementsByShift.get(s.id) || [];
      const sum = (type: 'in' | 'out') =>
        round2(movs.filter(m => m.type === type).reduce((acc, m) => acc + num(m.amount), 0));
      const closed = s.status === 'closed';
      return {
        id: s.id,
        opened_at: s.opened_at,
        closed_at: s.closed_at,
        status: s.status,
        opened_by: staffNames.get(s.staff_id),
        start_amount: num(s.start_amount),
        cash_in: sum('in'),
        cash_out: sum('out'),
        ...(closed ? {
          expected_cash: s.expected_amount === undefined ? undefined : num(s.expected_amount),
          counted_cash: s.end_amount === undefined ? undefined : num(s.end_amount),
          cash_difference: s.difference === undefined ? undefined : num(s.difference),
          transfer_expected: s.transfer_expected === undefined ? undefined : num(s.transfer_expected),
          transfer_counted: s.transfer_count === undefined ? undefined : num(s.transfer_count),
          transfer_difference: s.transfer_difference === undefined ? undefined : num(s.transfer_difference),
        } : {}),
      } satisfies ZShiftRecap;
    });
}

export interface ZReportInput {
  businessName: string;
  dateLabel: string;
  ticketCount: number;
  cashTotal: number;
  cardTotal: number;
  transferTotal: number;
  netTotal: number;
  voided: { count: number; total: number };
  shifts: ZShiftRecap[];
  products: { name: string; quantity: number; total: number }[];
  staff: { name: string; count: number; total: number }[];
  /** Inventario del día (lib/dailyInventory). Opcional: sin él no hay sección. */
  inventory?: ProductDayRow[];
  fmt?: (n: number) => string;
}

const SEP = '------------------------------';
const MAX_PRODUCT_LINES = 15;

const signed = (n: number, fmt: (n: number) => string): string =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;

const timeOf = (iso?: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

/** Texto plano del Corte Z, listo para WhatsApp. Función pura. */
export function buildZReportText(input: ZReportInput): string {
  const fmt = input.fmt ?? ((n: number) => `$${(isNaN(n) ? 0 : n).toFixed(2)}`);
  const lines: string[] = [];

  lines.push(`*REPORTE Z — ${(input.businessName || 'BISNE CON TALLA').toUpperCase()}*`);
  lines.push(`Fecha: ${input.dateLabel}`);
  lines.push(SEP);
  lines.push(`Tickets: ${input.ticketCount}`);
  lines.push(`Efectivo: ${fmt(input.cashTotal)}`);
  lines.push(`Tarjeta: ${fmt(input.cardTotal)}`);
  lines.push(`Transferencia: ${fmt(input.transferTotal)}`);
  lines.push(`*TOTAL NETO: ${fmt(input.netTotal)}*`);
  if (input.voided.count > 0) {
    lines.push(`Anuladas: ${input.voided.count} (${fmt(input.voided.total)}) — no incluidas en el total`);
  }

  lines.push(SEP);
  lines.push('*CUADRE DE CAJA*');
  if (input.shifts.length === 0) {
    lines.push('Sin turnos registrados este día.');
  }
  input.shifts.forEach((s, i) => {
    const n = input.shifts.length > 1 ? ` ${i + 1}` : '';
    const horario = s.status === 'closed'
      ? `${timeOf(s.opened_at)}–${timeOf(s.closed_at)}`
      : `desde ${timeOf(s.opened_at)}`;
    lines.push(`Turno${n}${s.opened_by ? ` (${s.opened_by.split(' ')[0]})` : ''} ${horario}`.trim());
    lines.push(`  Fondo inicial: ${fmt(s.start_amount)}`);
    if (s.cash_in > 0 || s.cash_out > 0) {
      lines.push(`  Entradas: ${fmt(s.cash_in)} · Salidas: ${fmt(s.cash_out)}`);
    }
    if (s.status === 'open') {
      lines.push('  ⚠ Turno sin cerrar: aún no hay cuadre.');
      return;
    }
    if (s.expected_cash !== undefined) lines.push(`  Efectivo esperado: ${fmt(s.expected_cash)}`);
    if (s.counted_cash !== undefined) lines.push(`  Efectivo contado: ${fmt(s.counted_cash)}`);
    if (s.cash_difference !== undefined) {
      const d = describeDifference(s.cash_difference);
      lines.push(`  Diferencia efectivo: ${d.tone === 'ok' ? 'Cuadra ✓' : `${d.label} ${signed(d.amount, fmt)}`}`);
    }
    if (s.transfer_expected !== undefined) {
      lines.push(`  Transferencias esperadas: ${fmt(s.transfer_expected)}`);
      if (s.transfer_counted !== undefined) lines.push(`  Transferencias verificadas: ${fmt(s.transfer_counted)}`);
      if (s.transfer_difference !== undefined) {
        const d = describeDifference(s.transfer_difference);
        lines.push(`  Diferencia transferencias: ${d.tone === 'ok' ? 'Cuadra ✓' : `${d.label} ${signed(d.amount, fmt)}`}`);
      }
    }
  });

  if (input.products.length > 0) {
    lines.push(SEP);
    lines.push('*PRODUCTOS VENDIDOS*');
    const shown = input.products.slice(0, MAX_PRODUCT_LINES);
    for (const p of shown) lines.push(`${p.quantity} x ${p.name}  ${fmt(p.total)}`);
    const rest = input.products.length - shown.length;
    if (rest > 0) lines.push(`… y ${rest} producto${rest !== 1 ? 's' : ''} más`);
  }

  // Inventario esperado: solo lo vendido, lo más importante primero. Es lo que se
  // compara con el conteo físico cuando la caja no cuadra.
  const vendidos = (input.inventory || []).filter(r => r.sold > 0);
  if (vendidos.length > 0) {
    lines.push(SEP);
    lines.push('*INVENTARIO DEL DÍA (esperado)*');
    const q = (n: number) => String(Math.round(n * 1000) / 1000);
    for (const r of vendidos.slice(0, MAX_PRODUCT_LINES)) {
      const parts = [`inicial ${q(r.start_display + r.start_warehouse)}`];
      if (r.entries > 0) parts.push(`+${q(r.entries)} entró`);
      parts.push(`−${q(r.sold)} vendió`);
      const otros = Math.round((r.other + r.returned) * 1000) / 1000;
      if (otros !== 0) parts.push(`${otros > 0 ? '+' : '−'}${q(Math.abs(otros))} otros`);
      const split = r.end_warehouse !== 0 || r.start_warehouse !== 0
        ? ` (vitrina ${q(r.end_display)} · almacén ${q(r.end_warehouse)})` : '';
      lines.push(`${r.name}: ${parts.join(', ')} → final ${q(r.end_display + r.end_warehouse)}${split}`);
    }
    const resto = vendidos.length - MAX_PRODUCT_LINES;
    if (resto > 0) lines.push(`… y ${resto} producto${resto !== 1 ? 's' : ''} más`);
  }

  if (input.staff.length > 1) {
    lines.push(SEP);
    lines.push('*POR VENDEDOR*');
    for (const s of input.staff) lines.push(`${s.name}: ${s.count} venta${s.count !== 1 ? 's' : ''} · ${fmt(s.total)}`);
  }

  return lines.join('\n');
}
