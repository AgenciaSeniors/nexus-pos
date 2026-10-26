/**
 * Contenido de los tickets en ESC/POS. Espeja `buildTicketText` (mismo contenido y
 * mismas cifras) pero con el formato de una térmica: cabecera centrada y grande,
 * importes alineados a la derecha, TOTAL destacado y corte al final.
 */
import type { Sale, ParkedOrder, BusinessConfig } from '../db';
import { currency } from '../currency';
import { EscPos, centerText, wrapText, type Codepage } from './escpos';

type TicketConfig = Pick<BusinessConfig, 'name' | 'address' | 'phone' | 'receipt_message'> | null | undefined;

export interface BuildOptions {
  columns: number;
  codepage: Codepage;
  openDrawer?: boolean;
}

const money = (n: number): string => `$${(isNaN(n) ? 0 : n).toFixed(2)}`;

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()} ${hh}:${mi}`;
}

/** Ticket de venta o pre-cuenta. */
export function buildTicketEscpos(
  doc: Sale | ParkedOrder,
  config: TicketConfig,
  isPreBill: boolean,
  opts: BuildOptions,
): Uint8Array {
  const sale = isPreBill ? null : (doc as Sale);
  const order = isPreBill ? (doc as ParkedOrder) : null;
  const p = new EscPos({ columns: opts.columns, codepage: opts.codepage });
  const W = p.columns;

  // Gaveta primero: se abre mientras imprime, no al final.
  if (opts.openDrawer && (sale?.payment_method === 'efectivo' || sale?.payment_method === 'mixto')) p.drawer();

  // --- Encabezado ---
  p.align('center').bold(true).size(2);
  for (const l of wrapText((config?.name || 'SENIO').toUpperCase(), EscPos.usable(W, 2))) p.line(l);
  p.size(1).bold(false);
  if (config?.address) for (const l of wrapText(config.address, W)) p.line(l);
  if (config?.phone) p.line(`Tel: ${config.phone}`);
  p.align('left').rule();

  p.line(`${isPreBill ? 'PRE-CUENTA' : 'TICKET'} #${doc.id.slice(0, 8).toUpperCase()}`);
  const when = formatDate(doc.date);
  if (when) p.line(when);
  if (isPreBill && order?.note) p.line(`Mesa / Ref: ${order.note.toUpperCase()}`);
  if (doc.customer_name) p.line(`Cliente: ${doc.customer_name}`);
  if (sale?.staff_name) p.line(`Vendedor: ${sale.staff_name.split(' ')[0] || 'Cajero'}`);
  p.rule();

  // --- Ítems ---
  for (const item of doc.items || []) {
    const qty = Number(item.quantity) || 0;
    const lineTotal = currency.multiply(Number(item.price) || 0, qty);
    p.row(`${qty} x ${item.name}`, money(lineTotal));
    if (item.modifiers && item.modifiers.length > 0) {
      for (const l of wrapText(item.modifiers.map(m => m.modifier_name).join(', '), W - 3)) p.line(`   ${l}`);
    }
    if (item.note) for (const l of wrapText(item.note, W - 3)) p.line(`   ${l}`);
  }
  p.rule();

  // --- Totales ---
  const itemsSubtotal = (doc.items || []).reduce(
    (s, i) => currency.add(s, currency.multiply(Number(i.price) || 0, Number(i.quantity) || 0)),
    0,
  );
  if (sale && (sale.discount_amount || sale.redeemed_points)) p.row('Subtotal:', money(itemsSubtotal));
  if (sale?.discount_amount && sale.discount_amount > 0) {
    const pct = sale.discount_type === 'percentage' && sale.discount_input ? ` (${sale.discount_input}%)` : '';
    p.row(`Descuento${pct}:`, `-${money(sale.discount_amount)}`);
  }
  if (sale?.redeemed_points && sale.redeemed_points > 0) {
    p.row(`Puntos canjeados (${sale.redeemed_points}):`, `-${money(sale.redeemed_points * 0.1)}`);
  }

  // TOTAL en letra doble: cada carácter ocupa 2 columnas.
  const totalStr = money(doc.total);
  const wide = EscPos.usable(W, 2);
  p.bold(true).size(2).row('TOTAL', totalStr, wide).size(1).bold(false);

  // --- Forma de pago (solo recibo final) ---
  if (sale) {
    if (sale.payment_method === 'mixto') {
      p.line('Pago: Mixto');
      p.row('  Efectivo:', money(sale.cash_amount || 0));
      p.row('  Transferencia:', money(sale.transfer_amount || 0));
    } else if (sale.payment_method) {
      p.line(`Pago: ${sale.payment_method.charAt(0).toUpperCase()}${sale.payment_method.slice(1)}`);
      if (sale.payment_method === 'efectivo') {
        p.row('  Recibido:', money(sale.amount_tendered ?? sale.total));
        p.row('  Cambio:', money(sale.change ?? 0));
      }
    }

    const pointsEarned = doc.customer_id ? Math.floor(doc.total / 10) : 0;
    if (pointsEarned > 0) p.line(`Ganaste +${pointsEarned} puntos`);

    if (sale.refunded_items && sale.refunded_items.length > 0) {
      p.rule().line('DEVOLUCIONES:');
      for (const ri of sale.refunded_items) p.row(`  ${ri.quantity}x ${ri.name}`, `-${money(ri.amount)}`);
    }
  }

  if (isPreBill) {
    p.rule().align('center').bold(true).line('*** NO VALIDO COMO FACTURA ***').bold(false);
    p.line('Solicite su recibo al pagar').align('left');
  }

  // --- Pie ---
  p.rule();
  p.align('center');
  for (const l of wrapText(`"${config?.receipt_message || '¡Gracias por su compra!'}"`, W)) p.line(l);
  p.align('left');
  return p.cut().build();
}

/** Texto plano multilínea (p. ej. el Corte Z) en la térmica. Las líneas con `*…*` salen en negrita. */
export function buildPlainEscpos(text: string, title: string | null, opts: BuildOptions): Uint8Array {
  const p = new EscPos({ columns: opts.columns, codepage: opts.codepage });
  if (title) {
    p.align('center').bold(true).size(2);
    for (const l of wrapText(title, EscPos.usable(p.columns, 2))) p.line(l);
    p.size(1).bold(false).align('left').rule();
  }
  for (const raw of text.split('\n')) {
    const bold = /^\*[^*].*\*$/.test(raw.trim());
    const line = bold ? raw.trim().slice(1, -1) : raw;
    if (line.trim() === '') { p.feed(1); continue; } // conserva las líneas en blanco
    // Si cabe, tal cual (respeta sangrías); si no, se parte en palabras con la misma sangría.
    const indent = (/^\s*/.exec(line) ?? [''])[0];
    const pieces = line.length <= p.columns
      ? [line]
      : wrapText(line.trim(), p.columns - indent.length).map(l => indent + l);
    p.bold(bold);
    for (const l of pieces) p.line(l);
    p.bold(false);
  }
  return p.cut().build();
}

/** Página de prueba: sirve para ver el ancho real, las tildes y que el corte funciona. */
export function buildTestPageEscpos(printerName: string, opts: BuildOptions): Uint8Array {
  const p = new EscPos({ columns: opts.columns, codepage: opts.codepage });
  const W = p.columns;
  p.align('center').bold(true).size(2).line('SENIO').size(1).bold(false);
  p.line('Prueba de impresion').line(printerName || 'Impresora');
  p.align('left').rule();
  p.line('Ancho: ' + W + ' columnas');
  p.line('Tabla: ' + opts.codepage.toUpperCase());
  p.line('0123456789'.repeat(Math.ceil(W / 10)).slice(0, W));
  p.rule();
  p.line('Tildes: áéíóú ÁÉÍÓÚ ñÑ üÜ');
  p.line('Signos: ¿Qué tal? ¡Hola! ° $ % & /');
  p.row('1 x Producto de ejemplo', '$10.00');
  p.bold(true).size(2).row('TOTAL', '$10.00', EscPos.usable(W, 2)).size(1).bold(false);
  p.rule().line(centerText('Si lees esto bien, todo listo', W));
  return p.cut().build();
}
