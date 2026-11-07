import { describe, it, expect } from 'vitest';
import type { Sale } from './db';
import { CUP_BILLS, addBill, removeBill, billsTotal, billsCount, normalizeBills, summarizeBills, formatBills } from './cashBills';

const sale = (over: Partial<Sale>): Sale => ({
  id: crypto.randomUUID(), business_id: 'b1', date: new Date().toISOString(), shift_id: 's1',
  total: 100, items: [], payment_method: 'efectivo', sync_status: 'synced', ...over,
});

describe('billetes', () => {
  it('las denominaciones incluyen los billetes nuevos de 10 000 y 20 000', () => {
    expect(CUP_BILLS.slice(0, 3)).toEqual([20000, 10000, 5000]);
  });

  it('agregar y quitar billetes', () => {
    let b = addBill(null, 1000);
    b = addBill(b, 1000);
    b = addBill(b, 500);
    expect(b).toEqual({ '1000': 2, '500': 1 });
    expect(billsTotal(b)).toBe(2500);
    expect(billsCount(b)).toBe(3);
    b = removeBill(b, 500);
    b = removeBill(b, 1000);
    expect(b).toEqual({ '1000': 1 });
    expect(removeBill(b, 20)).toEqual({ '1000': 1 }); // quitar lo que no hay no rompe nada
  });

  it('normaliza basura', () => {
    expect(normalizeBills({ '1000': 2, '500': 0, x: 3, '20': '1' })).toEqual({ '1000': 2, '20': 1 });
    expect(normalizeBills({})).toBeNull();
    expect(normalizeBills('nada')).toBeNull();
  });

  it('resume los billetes del turno y cuenta las ventas sin desglose', () => {
    const r = summarizeBills([
      sale({ cash_bills: { '1000': 2, '500': 1 } }),
      sale({ cash_bills: { '1000': 1, '20': 3 } }),
      sale({ amount_tendered: 100 }),                                  // escrito a mano: sin desglose
      sale({ payment_method: 'transferencia' }),                       // no es efectivo: no cuenta
      sale({ status: 'voided', cash_bills: { '20000': 1 } }),          // anulada: no cuenta
      sale({ payment_method: 'mixto', cash_amount: 50, cash_bills: { '50': 1 } }),
    ]);
    expect(r.rows).toEqual([
      { denomination: 1000, count: 3, total: 3000 },
      { denomination: 500, count: 1, total: 500 },
      { denomination: 50, count: 1, total: 50 },
      { denomination: 20, count: 3, total: 60 },
    ]);
    expect(r.count).toBe(8);
    expect(r.total).toBe(3610);
    expect(r.salesWithBills).toBe(3);
    expect(r.cashSalesWithoutBills).toBe(1);
  });

  it('formato corto', () => {
    expect(formatBills({ '500': 1, '1000': 2 })).toBe('2 × $1000 · 1 × $500');
    expect(formatBills(null)).toBe('');
  });
});
