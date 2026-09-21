import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { BusinessSettings, Paginated } from '@/types';

export interface SaleSummary {
  id: string;
  invoice_number: string;
  customer_id: string | null;
  customer_name: string;
  customer_mobile: string | null;
  customer_address?: string | null;
  invoice_date: string;
  grand_total: number;
  paid_amount: number;
  due_amount: number;
  payment_status: 'PAID' | 'PARTIAL' | 'UNPAID';
  status: 'DRAFT' | 'HELD' | 'COMPLETED' | 'CANCELLED';
}

export interface SaleItem {
  id: string;
  variant_id?: string;
  line_no: number;
  item_name: string;
  item_code: string;
  hsn_code: string | null;
  variant_name: string | null;
  quantity: number;
  sold_unit: string;
  stock_qty: number;
  rate: number;
  mrp: number;
  discount_pct: number;
  discount_amt: number;
  tax_rate: number;
  tax_amount: number;
  line_total: number;
}

export interface SaleDetail extends SaleSummary {
  customer_address: string | null;
  customer_gstin: string | null;
  subtotal: number;
  item_discount: number;
  bill_discount: number;
  tax_amount: number;
  round_off: number;
  notes: string | null;
  cancel_reason: string | null;
  items: SaleItem[];
  payments: Array<{
    id: string;
    payment_number: string;
    amount: number;
    payment_date: string;
    methods: Array<{ method: string; amount: number; reference: string | null }>;
  }>;
  business: BusinessSettings | null;
}

export interface PriceDifference {
  variant_id: string;
  item_name: string;
  old_rate: number;
  new_rate: number;
  difference: number;
}

export interface SaleFilters {
  q?: string;
  customerId?: string;
  status?: SaleSummary['status'];
  paymentStatus?: SaleSummary['payment_status'];
  from?: string;
  to?: string;
  page?: number;
}

/** Money for the whole filter, counted in the database, cancelled bills out. */
export interface SalesTotals {
  sales: number;
  received: number;
  balance: number;
  /** Credit notes raised against these bills. */
  returns: number;
}

export function useSales(filters: SaleFilters) {
  return useQuery({
    queryKey: ['sales', filters],
    queryFn: () =>
      api.get<Paginated<SaleSummary> & { summary: SalesTotals }>('/api/sales', {
        q: filters.q,
        customerId: filters.customerId,
        status: filters.status,
        paymentStatus: filters.paymentStatus,
        from: filters.from,
        to: filters.to,
        page: filters.page ?? 1,
        pageSize: 25,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useSale(id: string | undefined) {
  return useQuery({
    queryKey: ['sale', id],
    queryFn: () => api.get<{ data: SaleDetail }>(`/api/sales/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

export function useCreateSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: unknown) =>
      api.post<{ data: SaleDetail }>('/api/sales', payload).then((r) => r.data),
    onSuccess: () => {
      // A completed sale moves stock, dues and the day's figures.
      void qc.invalidateQueries({ queryKey: ['sales'] });
      void qc.invalidateQueries({ queryKey: ['items'] });
      void qc.invalidateQueries({ queryKey: ['customers'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useCancelSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post<{ data: SaleDetail }>(`/api/sales/${id}/cancel`, { reason }).then((r) => r.data),
    onSuccess: (sale) => {
      void qc.invalidateQueries({ queryKey: ['sales'] });
      void qc.invalidateQueries({ queryKey: ['sale', sale.id] });
      void qc.invalidateQueries({ queryKey: ['items'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/** Asks the server which lines have drifted from the current master price. */
export function checkPrices(items: Array<{ variant_id: string; rate: number }>) {
  return api
    .post<{ data: PriceDifference[] }>('/api/sales/price-check', { items })
    .then((r) => r.data);
}

export function useReceivePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: unknown) => api.post('/api/payments', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['customers'] });
      void qc.invalidateQueries({ queryKey: ['customer'] });
      void qc.invalidateQueries({ queryKey: ['sales'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export interface DashboardData {
  today: { bills: number; sales: number; collected: number };
  receivables: { outstanding: number; customers: number };
  inventory: { value: number; units: number };
  lowStock: Array<{
    id: string; item_name: string; variant_name: string;
    stock_unit: string; stock: number; min_stock: number;
  }>;
  recentSales: SaleSummary[];
  recentPayments: Array<{
    id: string; payment_number: string; amount: number;
    payment_date: string; customer_name: string | null;
  }>;
  salesTrend: Array<{ day: string; total: number }>;
}

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<{ data: DashboardData }>('/api/dashboard').then((r) => r.data),
    refetchInterval: 60_000,
  });
}
