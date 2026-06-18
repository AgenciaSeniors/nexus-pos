import { describe, it, expect } from 'vitest';
import { buildTicketText } from './ticketText';
import type { Sale, ParkedOrder } from './db';

function makeSale(partial: Partial<Sale> = {}): Sale {
  return {
    id: 'abcdef1234567890',
    business_id: 'biz',
    date: '2026-03-10T15:30:00Z',
    shift_id: 'shift',
    total: 100,
    items: [{ product_id: 'p1', name: 'Pizza', quantity: 2, price: 50 }],
    payment_method: 'efectivo',
    sync_status: 'synced',
    ...partial,
  } as Sale;
}

const config = { name: 'Mi Negocio', address: 'Calle 1', phone: '5555', receipt_message: 'Vuelva pronto' };

describe('buildTicketText — recibo final', () => {
  it('incluye negocio, ítems y total', () => {
    const text = buildTicketText(makeSale(), config);
    expect(text).toContain('*MI NEGOCIO*');
    expect(text).toContain('Calle 1');
    expect(text).toContain('Tel: 5555');
    expect(text).toContain('2 x Pizza');
    expect(text).toContain('$100.00');
    expect(text).toContain('Vuelva pronto');
    expect(text).toContain('TICKET #ABCDEF12');
  });

  it('muestra efectivo recibido y cambio', () => {
    const text = buildTicketText(makeSale({ payment_method: 'efectivo', amount_tendered: 150, change: 50 }), config);
    expect(text).toContain('Pago: Efectivo');
    expect(text).toContain('Recibido: $150.00');
    expect(text).toContain('Cambio: $50.00');
  });

  it('desglosa el pago mixto', () => {
    const text = buildTicketText(
      makeSale({ payment_method: 'mixto', cash_amount: 60, transfer_amount: 40 }),
      config,
    );
    expect(text).toContain('Pago: Mixto');
    expect(text).toContain('Efectivo: $60.00');
    expect(text).toContain('Transferencia: $40.00');
  });

  it('muestra descuento y puntos canjeados con subtotal', () => {
    const text = buildTicketText(
      makeSale({ total: 80, discount_amount: 20, discount_type: 'fixed', customer_id: 'c1', redeemed_points: 0 }),
      config,
    );
    expect(text).toContain('Subtotal: $100.00');
    expect(text).toContain('Descuento: -$20.00');
  });

  it('suma puntos ganados cuando hay cliente', () => {
    const text = buildTicketText(makeSale({ total: 100, customer_id: 'c1', customer_name: 'Ana' }), config);
    expect(text).toContain('Cliente: Ana');
    expect(text).toContain('Ganaste +10 puntos');
  });

  it('usa nombre por defecto si no hay config', () => {
    const text = buildTicketText(makeSale(), null);
    expect(text).toContain('*BISNE CON TALLA*');
    expect(text).toContain('¡Gracias por su compra!');
  });
});

describe('buildTicketText — pre-cuenta', () => {
  it('marca la pre-cuenta y la referencia de mesa, sin forma de pago', () => {
    const order: ParkedOrder = {
      id: 'order123456',
      business_id: 'biz',
      date: '2026-03-10T15:30:00Z',
      items: [{ product_id: 'p1', name: 'Café', quantity: 1, price: 25 }],
      total: 25,
      note: 'Mesa 4',
    };
    const text = buildTicketText(order, config, true);
    expect(text).toContain('PRE-CUENTA #ORDER123');
    expect(text).toContain('Mesa / Ref: MESA 4');
    expect(text).toContain('NO VÁLIDO COMO FACTURA');
    expect(text).not.toContain('Pago:');
  });
});
