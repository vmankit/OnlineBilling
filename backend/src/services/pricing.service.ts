import { money } from '../utils/number.js';

export interface PricingLineInput {
  quantity: number;
  rate: number;
  discountPct: number;
  discountAmt: number;
}

export interface PricingLine {
  gross: number;
  discount: number;
  net: number;
  lineTotal: number;
}

export interface PricingTotals {
  lines: PricingLine[];
  subtotal: number;
  itemDiscount: number;
  billDiscount: number;
  roundOff: number;
  grandTotal: number;
}

/**
 * Bill arithmetic, computed server-side. The client's rate is honoured (an
 * operator may legitimately override a price at the counter) but never its
 * totals.
 *
 * There is no tax step: the shop bills at the price on the shelf. A rate is
 * simply what the customer pays, so a line is quantity x rate less its
 * discount, and a bill-level discount is spread across the lines in proportion
 * to their value.
 */
export function calculateBill(
  inputs: PricingLineInput[],
  options: { billDiscount?: number; roundOff?: number } = {},
): PricingTotals {
  const { billDiscount = 0, roundOff = 0 } = options;

  const base = inputs.map((line) => {
    const gross = money(line.quantity * line.rate);
    const discount = money(
      line.discountAmt > 0 ? line.discountAmt : (gross * line.discountPct) / 100,
    );
    const net = money(Math.max(0, gross - discount));
    return { gross, discount, net };
  });

  const netTotal = money(base.reduce((sum, l) => sum + l.net, 0));
  const effectiveBillDiscount = money(Math.min(billDiscount, netTotal));

  const lines: PricingLine[] = base.map((l) => {
    const share = netTotal > 0 ? l.net / netTotal : 0;
    return {
      gross: l.gross,
      discount: l.discount,
      net: l.net,
      lineTotal: money(l.net - effectiveBillDiscount * share),
    };
  });

  const subtotal = money(base.reduce((sum, l) => sum + l.gross, 0));
  const itemDiscount = money(base.reduce((sum, l) => sum + l.discount, 0));
  const grandTotal = money(lines.reduce((sum, l) => sum + l.lineTotal, 0) + roundOff);

  return {
    lines,
    subtotal,
    itemDiscount,
    billDiscount: effectiveBillDiscount,
    roundOff: money(roundOff),
    grandTotal,
  };
}

export function derivePaymentStatus(grandTotal: number, paid: number): 'PAID' | 'PARTIAL' | 'UNPAID' {
  if (paid <= 0.004) return 'UNPAID';
  if (paid >= grandTotal - 0.004) return 'PAID';
  return 'PARTIAL';
}

/**
 * Payment status when part of a bill was settled by returned goods rather than
 * money. Derived from what is still owed, not from paid-vs-total: after a
 * return clears the balance, nothing is outstanding, so the bill must not keep
 * showing PARTIAL. The invoice's own totals stay untouched — history is fixed,
 * and the return lives in its own document.
 */
export function statusFromDue(due: number, paid: number): 'PAID' | 'PARTIAL' | 'UNPAID' {
  if (due <= 0.004) return 'PAID';
  if (paid > 0.004) return 'PARTIAL';
  return 'UNPAID';
}
