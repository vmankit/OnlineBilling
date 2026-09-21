import {
  keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  BusinessSettings, Customer, CustomerDetail, Item, NamedRecord, Paginated, Unit, Warehouse,
} from '@/types';

// ----------------------------------------------------------------- masters

export function useUnits() {
  return useQuery({
    queryKey: ['units'],
    queryFn: () => api.get<{ data: Unit[] }>('/api/masters/units').then((r) => r.data),
    staleTime: 60 * 60 * 1000, // units effectively never change
  });
}

export function useWarehouses() {
  return useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.get<{ data: Warehouse[] }>('/api/masters/warehouses').then((r) => r.data),
    staleTime: 30 * 60 * 1000,
  });
}

function namedMaster(key: string, path: string) {
  return function useNamed() {
    return useQuery({
      queryKey: [key],
      queryFn: () => api.get<{ data: NamedRecord[] }>(path).then((r) => r.data),
      staleTime: 15 * 60 * 1000,
    });
  };
}

export const useBrands = namedMaster('brands', '/api/masters/brands');
export const useCategories = namedMaster('categories', '/api/masters/categories');
export const useItemGroups = namedMaster('item-groups', '/api/masters/item-groups');

export function useCreateNamed(kind: 'brands' | 'categories' | 'item-groups') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api.post<{ data: NamedRecord }>(`/api/masters/${kind}`, { name }).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [kind] }),
  });
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () =>
      api.get<{ data: { business?: BusinessSettings } }>('/api/masters/settings').then((r) => r.data),
    staleTime: 10 * 60 * 1000,
  });
}

export function useUpdateSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) =>
      api.put(`/api/masters/settings/${key}`, { value }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['settings'] }),
  });
}

// ------------------------------------------------------------------- items

export interface ItemFilters {
  q?: string;
  brandId?: string;
  categoryId?: string;
  groupId?: string;
  lowStockOnly?: boolean;
  pricedOnly?: boolean;
  activeOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export function useItems(filters: ItemFilters) {
  return useQuery({
    queryKey: ['items', filters],
    queryFn: () =>
      api.get<Paginated<Item>>('/api/items', {
        q: filters.q,
        brandId: filters.brandId,
        categoryId: filters.categoryId,
        groupId: filters.groupId,
        lowStockOnly: String(filters.lowStockOnly ?? false),
        pricedOnly: String(filters.pricedOnly ?? false),
        activeOnly: String(filters.activeOnly ?? true),
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 30,
      }),
    // Keeps the grid populated while a new search round-trips — no flicker
    // between keystrokes at the counter.
    placeholderData: keepPreviousData,
  });
}

export interface StockSummary {
  items: number;
  total_qty: number;
  stock_value: number;
  sale_value: number;
  low_count: number;
  critical_count: number;
}

/**
 * Shop-wide stock totals, counted in the database over every item — not over
 * the page of rows a screen happens to be showing.
 */
export function useStockSummary() {
  return useQuery({
    queryKey: ['items', 'summary'],
    queryFn: () => api.get<{ data: StockSummary }>('/api/items/summary').then((r) => r.data),
    staleTime: 60_000,
  });
}

export function useItem(id: string | undefined) {
  return useQuery({
    queryKey: ['item', id],
    queryFn: () => api.get<{ data: Item }>(`/api/items/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

export type ItemPayload = Omit<Item, 'id' | 'created_at' | 'brand_name' | 'category_name' | 'item_group_name' | 'variants'> & {
  variants: Array<Partial<ItemVariantPayload>>;
};

export interface ItemVariantPayload {
  id?: string;
  name: string;
  sku: string;
  barcode: string | null;
  pack_size: number;
  pack_unit: string;
  purchase_price: number;
  selling_price: number;
  mrp: number;
  min_stock: number;
  is_default: boolean;
  is_active: boolean;
}

export function useSaveItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id?: string; payload: unknown }) =>
      id
        ? api.put<{ data: Item }>(`/api/items/${id}`, payload).then((r) => r.data)
        : api.post<{ data: Item }>('/api/items', payload).then((r) => r.data),
    onSuccess: (item) => {
      void qc.invalidateQueries({ queryKey: ['items'] });
      void qc.invalidateQueries({ queryKey: ['item', item.id] });
    },
  });
}

// --------------------------------------------------------------- customers

export function useCustomers(filters: {
  q?: string; withDuesOnly?: boolean; page?: number; pageSize?: number;
}) {
  return useQuery({
    queryKey: ['customers', filters],
    queryFn: () =>
      api.get<Paginated<Customer>>('/api/customers', {
        q: filters.q,
        withDuesOnly: String(filters.withDuesOnly ?? false),
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 25,
      }),
    placeholderData: keepPreviousData,
  });
}

/**
 * The Parties list, walked a page at a time.
 *
 * The list used to widen one page instead, which broke the moment it asked
 * for more than the 100 rows the endpoint allows: the request came back 400
 * and the screen said "No Party found" for a shop with 105 customers.
 */
export function useCustomersInfinite(filters: { q?: string }) {
  return useInfiniteQuery({
    queryKey: ['customers', 'infinite', filters],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.get<Paginated<Customer>>('/api/customers', {
        q: filters.q,
        withDuesOnly: 'false',
        page: pageParam,
        pageSize: 50,
      }),
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  });
}

export function useCustomer(id: string | undefined) {
  return useQuery({
    queryKey: ['customer', id],
    queryFn: () => api.get<{ data: CustomerDetail }>(`/api/customers/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

export function useSaveCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id?: string; payload: unknown }) =>
      id
        ? api.put<{ data: Customer }>(`/api/customers/${id}`, payload).then((r) => r.data)
        : api.post<{ data: Customer }>('/api/customers', payload).then((r) => r.data),
    onSuccess: (customer) => {
      void qc.invalidateQueries({ queryKey: ['customers'] });
      void qc.invalidateQueries({ queryKey: ['customer', customer.id] });
    },
  });
}
