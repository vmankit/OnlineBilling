import {
  keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Paginated } from '@/types';

// ------------------------------------------------------------- suppliers

export interface Supplier {
  id: string;
  name: string;
  mobile: string | null;
  email: string | null;
  address: string | null;
  gstin: string | null;
  outstanding_balance: number;
  is_active: boolean;
  created_at: string;
}

export function useSuppliers(filters: { q?: string; page?: number; pageSize?: number }) {
  return useQuery({
    queryKey: ['suppliers', filters],
    queryFn: () =>
      api.get<Paginated<Supplier>>('/api/suppliers', {
        q: filters.q,
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 25,
      }),
    placeholderData: keepPreviousData,
  });
}

/** Same paging as the customer list, so Parties can show both together. */
export function useSuppliersInfinite(filters: { q?: string }) {
  return useInfiniteQuery({
    queryKey: ['suppliers', 'infinite', filters],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.get<Paginated<Supplier>>('/api/suppliers', {
        q: filters.q,
        page: pageParam,
        pageSize: 50,
      }),
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  });
}

export interface SupplierDetail extends Supplier {
  stats: { purchase_count: number; total_purchases: number };
  purchases: Array<{
    id: string;
    purchase_number: string;
    supplier_invoice_number: string | null;
    invoice_date: string;
    grand_total: number;
    paid_amount: number;
    due_amount: number;
    status: string;
  }>;
}

export function useSupplier(id: string | undefined) {
  return useQuery({
    queryKey: ['supplier', id],
    queryFn: () => api.get<{ data: SupplierDetail }>(`/api/suppliers/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

export function useSaveSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id?: string; payload: unknown }) =>
      id
        ? api.put<{ data: Supplier }>(`/api/suppliers/${id}`, payload).then((r) => r.data)
        : api.post<{ data: Supplier }>('/api/suppliers', payload).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['suppliers'] }),
  });
}

// ------------------------------------------------------------- purchases

export interface PurchaseSummary {
  id: string;
  purchase_number: string;
  supplier_invoice_number: string | null;
  supplier_name: string;
  invoice_date: string;
  grand_total: number;
  paid_amount: number;
  due_amount: number;
  status: string;
}

/** Money for the whole filter, counted by the server, cancelled bills out. */
export interface PurchaseTotals {
  total: number;
  paid: number;
  unpaid: number;
  /** What the shop owes all mahajan right now, whatever the date filter. */
  payable: number;
  payableParties: number;
}

export function usePurchases(filters: {
  q?: string; supplierId?: string; from?: string; to?: string; page?: number;
}) {
  return useQuery({
    queryKey: ['purchases', filters],
    queryFn: () =>
      api.get<Paginated<PurchaseSummary> & { summary: PurchaseTotals }>('/api/purchases', {
        q: filters.q,
        supplierId: filters.supplierId,
        from: filters.from,
        to: filters.to,
        page: filters.page ?? 1,
      }),
    placeholderData: keepPreviousData,
  });
}

export interface PurchaseDetail extends PurchaseSummary {
  supplier_id: string;
  supplier_mobile: string | null;
  subtotal: number;
  discount: number;
  notes: string | null;
  items: Array<{
    id: string;
    line_no: number;
    item_name: string;
    quantity: number;
    purchase_unit: string;
    rate: number;
    line_total: number;
  }>;
}

export function usePurchase(id: string | undefined) {
  return useQuery({
    queryKey: ['purchase', id],
    queryFn: () => api.get<{ data: PurchaseDetail }>(`/api/purchases/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

/** Paying a mahajan — settles the oldest unpaid bills first. */
export function usePaySupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      supplier_id: string;
      purchase_id?: string | null;
      amount: number;
      method: 'CASH' | 'UPI' | 'CARD' | 'BANK';
      reference?: string | null;
      notes?: string | null;
    }) => api.post('/api/payments/supplier', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['purchases'] });
      void qc.invalidateQueries({ queryKey: ['purchase'] });
      void qc.invalidateQueries({ queryKey: ['suppliers'] });
      void qc.invalidateQueries({ queryKey: ['supplier'] });
    },
  });
}

// -------------------------------------------------------------- expenses

export interface Expense {
  id: string;
  expense_number: string;
  expense_date: string;
  category: string;
  amount: number;
  method: 'CASH' | 'UPI' | 'CARD' | 'BANK';
  paid_to: string | null;
  notes: string | null;
  status: 'ACTIVE' | 'CANCELLED';
  cancel_reason: string | null;
}

export interface ExpenseTotals {
  total: number;
  byCategory: Array<{ category: string; total: number }>;
}

export function useExpenses(filters: { from?: string; to?: string; category?: string; page?: number }) {
  return useQuery({
    queryKey: ['expenses', filters],
    queryFn: () =>
      api.get<Paginated<Expense> & { summary: ExpenseTotals }>('/api/expenses', {
        from: filters.from,
        to: filters.to,
        category: filters.category,
        page: filters.page ?? 1,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useExpenseCategories() {
  return useQuery({
    queryKey: ['expense-categories'],
    queryFn: () => api.get<{ data: string[] }>('/api/expenses/categories').then((r) => r.data),
    staleTime: Infinity,
  });
}

export function useSaveExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      category: string; amount: number; method: string;
      expense_date?: string; paid_to?: string | null; notes?: string | null;
    }) => api.post<{ data: Expense }>('/api/expenses', payload).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['expenses'] }),
  });
}

export function useCancelExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/api/expenses/${id}/cancel`, { reason }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['expenses'] }),
  });
}

export function useCreatePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: unknown) =>
      api.post<{ data: PurchaseSummary }>('/api/purchases', payload).then((r) => r.data),
    onSuccess: () => {
      // A purchase raises stock and may move supplier dues and item prices.
      void qc.invalidateQueries({ queryKey: ['purchases'] });
      void qc.invalidateQueries({ queryKey: ['stock'] });
      void qc.invalidateQueries({ queryKey: ['items'] });
      void qc.invalidateQueries({ queryKey: ['suppliers'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

// ----------------------------------------------------------------- stock

export interface StockRow {
  variant_id: string;
  item_id: string;
  item_name: string;
  item_code: string;
  variant_name: string;
  sku: string;
  barcode: string | null;
  stock_unit: string;
  min_stock: number;
  purchase_price: number;
  selling_price: number;
  stock: number;
  stock_value: number;
}

export interface LedgerRow {
  id: string;
  txn_type: string;
  quantity: number;
  entered_qty: number | null;
  entered_unit: string | null;
  balance_after: number;
  rate: number | null;
  reference_type: string | null;
  reference_id: string | null;
  notes: string | null;
  created_at: string;
  item_name: string;
  variant_name: string;
  stock_unit: string;
  user_name: string | null;
}

export function useStock(filters: { q?: string; lowStockOnly?: boolean; page?: number }) {
  return useQuery({
    queryKey: ['stock', filters],
    queryFn: () =>
      api.get<Paginated<StockRow>>('/api/stock', {
        q: filters.q,
        lowStockOnly: String(filters.lowStockOnly ?? false),
        page: filters.page ?? 1,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useStockLedger(filters: { variantId?: string; itemId?: string; page?: number }) {
  return useQuery({
    queryKey: ['stock-ledger', filters],
    queryFn: () =>
      api.get<Paginated<LedgerRow>>('/api/stock/ledger', {
        variantId: filters.variantId,
        itemId: filters.itemId,
        page: filters.page ?? 1,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useAdjustStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: unknown) =>
      api
        .post<{ data: { balance: number; stockUnit: string; applied: number } }>(
          '/api/stock/adjustments',
          payload,
        )
        .then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['stock'] });
      void qc.invalidateQueries({ queryKey: ['stock-ledger'] });
      void qc.invalidateQueries({ queryKey: ['items'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

// --------------------------------------------------------------- returns

export interface ReturnableLine {
  invoice_item_id: string;
  item_name: string;
  variant_name: string | null;
  quantity: number;
  sold_unit: string;
  rate: number;
  returned_qty: number;
  returnable: number;
}

export function useReturnableLines(invoiceId: string | undefined) {
  return useQuery({
    queryKey: ['returnable', invoiceId],
    queryFn: () =>
      api
        .get<{
          data: {
            invoice: { id: string; invoice_number: string; status: string; customer_name: string };
            items: ReturnableLine[];
          };
        }>(`/api/sales-returns/eligible/${invoiceId}`)
        .then((r) => r.data),
    enabled: !!invoiceId,
  });
}

export function useCreateReturn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: unknown) => api.post('/api/sales-returns', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sale'] });
      void qc.invalidateQueries({ queryKey: ['sales'] });
      void qc.invalidateQueries({ queryKey: ['sales-returns'] });
      void qc.invalidateQueries({ queryKey: ['returnable'] });
      void qc.invalidateQueries({ queryKey: ['stock'] });
      void qc.invalidateQueries({ queryKey: ['customers'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export interface SalesReturnRow {
  id: string;
  return_number: string;
  return_date: string;
  total_amount: number;
  refund_mode: 'CREDIT_NOTE' | 'CASH' | 'UPI' | 'BANK';
  invoice_number: string;
  customer_name: string;
}

export function useSalesReturns(filters?: { page?: number; pageSize?: number }) {
  return useQuery({
    queryKey: ['sales-returns', filters],
    queryFn: () =>
      api.get<Paginated<SalesReturnRow>>('/api/sales-returns', {
        page: filters?.page ?? 1,
        pageSize: filters?.pageSize ?? 25,
      }),
  });
}

