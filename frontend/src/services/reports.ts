import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api, tokenStore } from '@/lib/api';

export type ReportKey =
  | 'daily-sales'
  | 'monthly-sales'
  | 'item-sales'
  | 'customer-sales'
  | 'purchases'
  | 'stock'
  | 'receivables'
  | 'payments'
  | 'profit';

export interface ReportColumn {
  key: string;
  label: string;
  type: 'text' | 'money' | 'number' | 'date' | 'datetime';
  align?: 'left' | 'right';
}

export interface ReportResult {
  name: string;
  columns: ReportColumn[];
  rows: Array<Record<string, string | number | null>>;
  totals: Record<string, number> | null;
}

export interface ReportFilters {
  from?: string;
  to?: string;
  customerId?: string;
  supplierId?: string;
  itemId?: string;
  brandId?: string;
}

export function useReport(key: ReportKey, filters: ReportFilters) {
  return useQuery({
    queryKey: ['report', key, filters],
    queryFn: () =>
      api
        .get<{ data: ReportResult }>(`/api/reports/${key}`, {
          from: filters.from,
          to: filters.to,
          customerId: filters.customerId,
          supplierId: filters.supplierId,
          itemId: filters.itemId,
          brandId: filters.brandId,
        })
        .then((r) => r.data),
    placeholderData: keepPreviousData,
  });
}

const BASE_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

/**
 * Downloads the same report as CSV.
 *
 * A plain <a download> cannot carry the bearer token, so the file is fetched
 * with auth and handed to the browser as a blob — which also keeps the token
 * out of the URL and out of any server log.
 */
export async function downloadReportCsv(key: ReportKey, filters: ReportFilters): Promise<void> {
  const url = new URL(`${BASE_URL}/api/reports/${key}`);
  url.searchParams.set('format', 'csv');
  for (const [k, v] of Object.entries(filters)) {
    if (v) url.searchParams.set(k, String(v));
  }

  const token = tokenStore.get();
  const response = await fetch(url.toString(), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error('Could not export this report.');

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = `${key}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}
