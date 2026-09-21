import { formatDate } from '@/lib/utils';
import type { ThermalDocument } from './InvoiceThermal';
import type { SaleDetail } from '@/services/sales';
import type { QuotationDetail } from '@/services/quotations';

/**
 * Maps a sale or a quotation onto the one receipt layout, so both print the
 * same way and only the title and the money rows differ. A quotation is
 * explicitly labelled as not a tax invoice.
 */
export function saleToThermal(sale: SaleDetail): ThermalDocument {
  return {
    title: 'INVOICE',
    number: sale.invoice_number,
    date: sale.invoice_date,
    customerName: sale.customer_name,
    customerMobile: sale.customer_mobile,
    customerAddress: sale.customer_address,
    items: sale.items.map((i) => ({
      id: i.id,
      line_no: i.line_no,
      item_name: i.item_name,
      variant_name: i.variant_name,
      quantity: Number(i.quantity),
      sold_unit: i.sold_unit,
      rate: Number(i.rate),
      discount_amt: Number(i.discount_amt),
      line_total: Number(i.line_total),
    })),
    subtotal: Number(sale.subtotal),
    itemDiscount: Number(sale.item_discount),
    billDiscount: Number(sale.bill_discount),
    roundOff: Number(sale.round_off),
    grandTotal: Number(sale.grand_total),
    paidAmount: Number(sale.paid_amount),
    dueAmount: Number(sale.due_amount),
    paymentModes: [
      ...new Set(sale.payments.flatMap((p) => p.methods.map((m) => titleCase(m.method)))),
    ],
    cancelled: sale.status === 'CANCELLED',
    business: sale.business,
  };
}

export function quotationToThermal(quotation: QuotationDetail): ThermalDocument {
  return {
    title: 'QUOTATION (Not a Tax Invoice)',
    number: quotation.quotation_number,
    date: quotation.quotation_date,
    customerName: quotation.customer_name,
    customerMobile: quotation.customer_mobile,
    customerAddress: quotation.customer_address,
    items: quotation.items.map((i) => ({
      id: i.id,
      line_no: i.line_no,
      item_name: i.item_name,
      variant_name: i.variant_name,
      quantity: Number(i.quantity),
      sold_unit: i.sold_unit,
      rate: Number(i.rate),
      discount_amt: Number(i.discount_amt),
      line_total: Number(i.line_total),
    })),
    subtotal: Number(quotation.subtotal),
    itemDiscount: Number(quotation.item_discount),
    billDiscount: Number(quotation.bill_discount),
    roundOff: Number(quotation.round_off),
    grandTotal: Number(quotation.grand_total),
    // A quotation collects nothing, so there is no PAID row to print.
    paidAmount: null,
    dueAmount: null,
    paymentModes: [],
    cancelled: quotation.status === 'CANCELLED',
    validity: quotation.valid_until ? formatDate(quotation.valid_until) : null,
    business: quotation.business,
  };
}

function titleCase(value: string): string {
  if (value === 'UPI') return 'UPI';
  return value.charAt(0) + value.slice(1).toLowerCase();
}
