/**
 * Genera una versión en TEXTO PLANO de un ticket/recibo, lista para compartir
 * por WhatsApp (o cualquier app de mensajería). Función pura y testeable.
 *
 * Espeja el contenido visual de `TicketModal` (negocio, ítems, totales, forma
 * de pago, mensaje de pie) sin depender de React ni del DOM.
 */
import type { Sale, ParkedOrder, BusinessConfig } from './db';

type TicketConfig = Pick<BusinessConfig, 'name' | 'address' | 'phone' | 'receipt_message'> | null | undefined;

const money = (n: number): string => `$${(isNaN(n) ? 0 : n).toFixed(2)}`;

const SEP = '------------------------------';

/**
 * @param doc        Venta final o pre-cuenta (orden en espera).
 * @param config     Datos del negocio (nombre, dirección, teléfono, mensaje).
 * @param isPreBill  `true` si es pre-cuenta (orden en espera), no recibo final.
 */
export function buildTicketText(
  doc: Sale | ParkedOrder,
  config?: TicketConfig,
  isPreBill = false,
): string {
  const sale = isPreBill ? null : (doc as Sale);
  const order = isPreBill ? (doc as ParkedOrder) : null;
  const lines: string[] = [];

  // --- Encabezado ---
  lines.push(`*${(config?.name || 'BISNE CON TALLA').toUpperCase()}*`);
  if (config?.address) lines.push(config.address);
  if (config?.phone) lines.push(`Tel: ${config.phone}`);
  lines.push(SEP);

  const d = new Date(doc.date);
  const dateStr = isNaN(d.getTime()) ? '' : d.toLocaleDateString();
  const timeStr = isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  lines.push(`${isPreBill ? 'PRE-CUENTA' : 'TICKET'} #${doc.id.slice(0, 8).toUpperCase()}`);
  if (dateStr) lines.push(`${dateStr} ${timeStr}`.trim());
  if (isPreBill && order?.note) lines.push(`Mesa / Ref: ${order.note.toUpperCase()}`);
  if (doc.customer_name) lines.push(`Cliente: ${doc.customer_name}`);
  if (sale?.staff_name) lines.push(`Vendedor: ${sale.staff_name.split(' ')[0]}`);
  lines.push(SEP);

  // --- Ítems ---
  for (const item of doc.items || []) {
    const qty = Number(item.quantity) || 0;
    const lineTotal = (Number(item.price) || 0) * qty;
    let line = `${qty} x ${item.name}  ${money(lineTotal)}`;
    if (item.modifiers && item.modifiers.length > 0) {
      line += `\n   ↳ ${item.modifiers.map(m => m.modifier_name).join(', ')}`;
    }
    if (item.note) line += `\n   ↳ ${item.note}`;
    lines.push(line);
  }
  lines.push(SEP);

  // --- Totales ---
  const itemsSubtotal = (doc.items || []).reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0);
  if (sale && (sale.discount_amount || sale.redeemed_points)) {
    lines.push(`Subtotal: ${money(itemsSubtotal)}`);
  }
  if (sale?.discount_amount && sale.discount_amount > 0) {
    const pct = sale.discount_type === 'percentage' && sale.discount_input ? ` (${sale.discount_input}%)` : '';
    lines.push(`Descuento${pct}: -${money(sale.discount_amount)}`);
  }
  if (sale?.redeemed_points && sale.redeemed_points > 0) {
    lines.push(`Puntos canjeados (${sale.redeemed_points}): -${money(sale.redeemed_points * 0.1)}`);
  }
  lines.push(`*TOTAL: ${money(doc.total)}*`);

  // --- Forma de pago (solo recibo final) ---
  if (sale) {
    if (sale.payment_method === 'mixto') {
      lines.push('Pago: Mixto');
      lines.push(`  Efectivo: ${money(sale.cash_amount || 0)}`);
      lines.push(`  Transferencia: ${money(sale.transfer_amount || 0)}`);
    } else if (sale.payment_method) {
      lines.push(`Pago: ${sale.payment_method.charAt(0).toUpperCase()}${sale.payment_method.slice(1)}`);
      if (sale.payment_method === 'efectivo') {
        lines.push(`  Recibido: ${money(sale.amount_tendered ?? sale.total)}`);
        lines.push(`  Cambio: ${money(sale.change ?? 0)}`);
      }
    }

    const pointsEarned = doc.customer_id ? Math.floor(doc.total / 10) : 0;
    if (pointsEarned > 0) lines.push(`Ganaste +${pointsEarned} puntos`);

    if (sale.refunded_items && sale.refunded_items.length > 0) {
      lines.push(SEP);
      lines.push('DEVOLUCIONES:');
      for (const ri of sale.refunded_items) {
        lines.push(`  ${ri.quantity}x ${ri.name}  -${money(ri.amount)}`);
      }
    }
  }

  if (isPreBill) {
    lines.push(SEP);
    lines.push('*** DOCUMENTO NO VÁLIDO COMO FACTURA ***');
    lines.push('Solicite su recibo al pagar');
  }

  // --- Pie ---
  lines.push(SEP);
  lines.push(`"${config?.receipt_message || '¡Gracias por su compra!'}"`);

  return lines.join('\n');
}
