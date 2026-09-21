import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { BusinessSettings, Paginated } from '@/types';
import type { PriceDifference } from '@/services/sales';

export type QuotationStatus = 'OPEN' | 'CONVERTED' | 'EXPIRED' | 'CANCELLED';

export interface QuotationSummary {
  id: string;
  quotation_number: string;
  customer_id: string | null;
  customer_name: string;
  customer_mobile: string | null;
  customer_address?: string | null;
  quotation_date: string;
  valid_until: string | null;
  grand_total: number;
  status: QuotationStatus;
  converted_invoice_id: string | null;
  is_expired: boolean;
}

export interface QuotationItem {
  id: string;
  variant_id: string | null;
  line_no: number;
  item_name: string;
  item_code: string;
  hsn_code: string | null;
  variant_name: string | null;
  quantity: number;
  sold_unit: string;
  rate: number;
  mrp: number;
  discount_pct: number;
  discount_amt: number;
  tax_rate: number;
  tax_amount: number;
  line_total: number;
}

export interface QuotationDetail extends QuotationSummary {
  customer_address: string | null;
  customer_gstin: string | null;
  subtotal: number;
  item_discount: number;
  bill_discount: number;
  tax_amount: number;
  round_off: number;
  notes: string | null;
  converted_invoice_number: string | null;
  items: QuotationItem[];
  business: BusinessSettings | null;
}

/** A quoted line, alongside what the item master charges today. */
export interface BillingLine {
  id: string;
  variant_id: string | null;
  item_name: string;
  item_code: string;
  variant_name: string | null;
  quantity: number;
  sold_unit: string;
  quoted_rate: number;
  current_rate: number | null;
  discount_pct: number;
  discount_amt: number;
  pack_unit: string;
  pack_size: number;
  mrp: number;
  stock_unit: string;
  tax_rate: number;
  sellable: boolean;
  stock: number;
}

export function useQuotations(filters: { q?: string; status?: QuotationStatus; page?: number }) {
  return useQuery({
    queryKey: ['quotations', filters],
    queryFn: () =>
      api.get<Paginated<QuotationSummary>>('/api/quotations', {
        q: filters.q,
        status: filters.status,
        page: filters.page ?? 1,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useQuotation(id: string | undefined) {
  return useQuery({
    queryKey: ['quotation', id],
    queryFn: () => api.get<{ data: QuotationDetail }>(`/api/quotations/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

export function useCreateQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: unknown) =>
      api.post<{ data: QuotationSummary }>('/api/quotations', payload).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['quotations'] }),
  });
}

export function useCancelQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/api/quotations/${id}/cancel`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['quotations'] });
      void qc.invalidateQueries({ queryKey: ['quotation'] });
    },
  });
}

/**
 * Everything the POS needs to turn a quotation into a bill, including which
 * lines have drifted from the current master price.
 */
export function fetchForBilling(id: string) {
  return api
    .get<{
      data: {
        quotation: QuotationSummary & { bill_discount: number; notes: string | null };
        items: BillingLine[];
        differences: PriceDifference[];
      };
    }>(`/api/quotations/${id}/for-billing`)
    .then((r) => r.data);
}
