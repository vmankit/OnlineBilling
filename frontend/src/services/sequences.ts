import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type DocType =
  | 'SALES_INVOICE'
  | 'QUOTATION'
  | 'PURCHASE_INVOICE'
  | 'SALES_RETURN'
  | 'PAYMENT';

export interface NumberingSeries {
  doc_type: DocType;
  prefix: string;
  suffix: string;
  padding: number;
  next_number: number;
}

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  SALES_INVOICE: 'Sales invoice',
  QUOTATION: 'Quotation',
  PURCHASE_INVOICE: 'Purchase',
  SALES_RETURN: 'Sales return',
  PAYMENT: 'Payment receipt',
};

export function useSequences() {
  return useQuery({
    queryKey: ['sequences'],
    queryFn: () => api.get<{ data: NumberingSeries[] }>('/api/masters/sequences').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });
}

export function useSaveSequence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docType, payload }: { docType: DocType; payload: Omit<NumberingSeries, 'doc_type'> }) =>
      api
        .put<{ data: NumberingSeries }>(`/api/masters/sequences/${docType}`, payload)
        .then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sequences'] }),
  });
}

/**
 * Renders what the next document number will look like, expanding the same
 * date tokens the server does — so the preview cannot disagree with the
 * number that actually gets issued.
 */
export function previewNumber(series: Omit<NumberingSeries, 'doc_type'>): string {
  const now = new Date();
  const tokens: Record<string, string> = {
    '{YYYY}': String(now.getFullYear()),
    '{YY}': String(now.getFullYear()).slice(-2),
    '{MM}': String(now.getMonth() + 1).padStart(2, '0'),
  };
  const expand = (text: string): string =>
    Object.entries(tokens).reduce((acc, [k, v]) => acc.split(k).join(v), text);

  const padding = Math.min(Math.max(Number(series.padding) || 1, 1), 12);
  const body = String(Math.max(Number(series.next_number) || 1, 1)).padStart(padding, '0');
  return `${expand(series.prefix ?? '')}${body}${expand(series.suffix ?? '')}`;
}
