import { z } from 'zod';

export const PAYMENT_METHODS = ['CASH', 'UPI', 'CARD', 'BANK', 'CREDIT'] as const;

export const saleLineSchema = z.object({
  variant_id: z.string().uuid(),
  quantity: z.coerce.number().positive('Quantity must be greater than zero.'),
  /** Unit the customer is being charged in — may differ from the stock unit. */
  sold_unit: z.string().min(1),
  rate: z.coerce.number().min(0),
  discount_pct: z.coerce.number().min(0).max(100).default(0),
  discount_amt: z.coerce.number().min(0).default(0),
});

export const tenderSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amount: z.coerce.number().min(0),
  reference: z.string().max(80).nullish(),
});

export const createSaleSchema = z
  .object({
    customer_id: z.string().uuid().nullish(),
    /** Used when billing a walk-in with no customer record. */
    customer_name: z.string().max(160).nullish(),
    customer_mobile: z.string().max(30).nullish(),
    customer_address: z.string().max(500).nullish(),
    customer_gstin: z.string().max(20).nullish(),
    warehouse_id: z.string().uuid().nullish(),
    /** Set when this bill is being raised from a quotation. */
    quotation_id: z.string().uuid().nullish(),
    status: z.enum(['COMPLETED', 'HELD', 'DRAFT']).default('COMPLETED'),
    bill_discount: z.coerce.number().min(0).default(0),
    round_off: z.coerce.number().default(0),
    notes: z.string().max(1000).nullish(),
    items: z.array(saleLineSchema).min(1, 'Add at least one item to the bill.'),
    payments: z.array(tenderSchema).default([]),
  })
  .refine((v) => !!v.customer_id || !!v.customer_name?.trim(), {
    message: 'Choose a customer or enter a name for the walk-in bill.',
    path: ['customer_id'],
  });

/** Either a calendar date (yyyy-mm-dd) or a full ISO timestamp. */
const dateOrDateTime = z
  .string()
  .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isNaN(Date.parse(v)), {
    message: 'Use a date (yyyy-mm-dd) or an ISO timestamp.',
  });

export const listSalesSchema = z.object({
  q: z.string().max(120).optional(),
  customerId: z.string().uuid().optional(),
  status: z.enum(['DRAFT', 'HELD', 'COMPLETED', 'CANCELLED']).optional(),
  paymentStatus: z.enum(['PAID', 'PARTIAL', 'UNPAID']).optional(),
  // The screens send a plain yyyy-mm-dd; a full timestamp is still accepted.
  from: dateOrDateTime.optional(),
  to: dateOrDateTime.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const cancelSaleSchema = z.object({
  reason: z.string().min(3, 'Give a reason for cancelling this invoice.').max(300),
});

export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type SaleLineInput = z.infer<typeof saleLineSchema>;
export type TenderInput = z.infer<typeof tenderSchema>;
export type ListSalesQuery = z.infer<typeof listSalesSchema>;
