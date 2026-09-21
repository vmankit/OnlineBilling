import { describe, expect, it } from 'vitest';
import { calculateBill, derivePaymentStatus, statusFromDue } from './pricing.service.js';

const line = (over: Partial<Parameters<typeof calculateBill>[0][number]> = {}) => ({
  quantity: 1,
  rate: 100,
  discountPct: 0,
  discountAmt: 0,
  ...over,
});

describe('calculateBill', () => {
  it('charges exactly the rate on the shelf, with no tax step', () => {
    const bill = calculateBill([line({ quantity: 2, rate: 11400 })]);
    expect(bill.subtotal).toBe(22800);
    expect(bill.grandTotal).toBe(22800);
  });

  it('applies a percentage line discount', () => {
    const bill = calculateBill([line({ rate: 1000, discountPct: 10 })]);
    expect(bill.itemDiscount).toBe(100);
    expect(bill.grandTotal).toBe(900);
  });

  it('prefers an explicit discount amount over the percentage', () => {
    const bill = calculateBill([line({ rate: 1000, discountPct: 10, discountAmt: 250 })]);
    expect(bill.itemDiscount).toBe(250);
    expect(bill.grandTotal).toBe(750);
  });

  it('spreads a bill discount across lines in proportion to their value', () => {
    const bill = calculateBill([line({ rate: 3000 }), line({ rate: 1000 })], { billDiscount: 400 });
    expect(bill.grandTotal).toBe(3600);
    expect(bill.lines[0]!.lineTotal).toBe(2700); // 75% of the discount
    expect(bill.lines[1]!.lineTotal).toBe(900);
  });

  it('never discounts below zero', () => {
    const bill = calculateBill([line({ rate: 500 })], { billDiscount: 900 });
    expect(bill.grandTotal).toBe(0);
    expect(bill.billDiscount).toBe(500);
  });

  it('applies round-off to the grand total', () => {
    const bill = calculateBill([line({ rate: 999.6 })], { roundOff: 0.4 });
    expect(bill.grandTotal).toBe(1000);
  });
});

describe('derivePaymentStatus', () => {
  it('marks a fully settled bill PAID', () => {
    expect(derivePaymentStatus(10000, 10000)).toBe('PAID');
  });

  it('marks a split payment covering the total PAID', () => {
    expect(derivePaymentStatus(10000, 4000 + 6000)).toBe('PAID');
  });

  it('marks a short payment PARTIAL', () => {
    expect(derivePaymentStatus(50000, 30000)).toBe('PARTIAL');
  });

  it('marks a credit bill UNPAID', () => {
    expect(derivePaymentStatus(50000, 0)).toBe('UNPAID');
  });
});

describe('statusFromDue', () => {
  it('marks a bill PAID once a return has cleared the balance', () => {
    // 820 bill, 700 paid in cash+UPI, 120 settled by returning goods
    expect(statusFromDue(0, 700)).toBe('PAID');
  });

  it('still reports PARTIAL while money is owed', () => {
    expect(statusFromDue(120, 700)).toBe('PARTIAL');
  });

  it('reports UNPAID when nothing was ever received', () => {
    expect(statusFromDue(50000, 0)).toBe('UNPAID');
  });
});
