import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface WhatsAppBridgeStatus {
  state: 'CONNECTED' | 'QR' | 'CONNECTING' | 'LOGGED_OUT' | 'DISCONNECTED' | 'ERROR';
  qr?: string;
  phone?: string;
  error?: string;
  updated_at?: number;
}

export function useWhatsAppBridgeStatus(pollInterval = 4000) {
  return useQuery<WhatsAppBridgeStatus>({
    queryKey: ['whatsapp-bridge-status'],
    queryFn: async () => {
      const res = await api.get<{ data: WhatsAppBridgeStatus }>('/api/whatsapp/status');
      return res.data;
    },
    refetchInterval: (query) => {
      // Poll faster during QR or CONNECTING state to detect link immediately
      const st = query.state.data?.state;
      if (st === 'QR' || st === 'CONNECTING') return 2500;
      return pollInterval;
    },
    staleTime: 2000,
  });
}

export function useStartWhatsAppBridge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await api.post<{ data: WhatsAppBridgeStatus }>('/api/whatsapp/start', {});
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['whatsapp-bridge-status'] });
    },
  });
}

export function useLogoutWhatsAppBridge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await api.post<{ data: { ok: boolean; state: string } }>('/api/whatsapp/logout', {});
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['whatsapp-bridge-status'] });
    },
  });
}

export async function sendDirectWhatsAppMessage(phone: string, message: string) {
  const res = await api.post<{ data: { id: string } }>('/api/whatsapp/send', { phone, message });
  return res.data;
}

export async function sendDirectWhatsAppImage(phone: string, imageBase64: string, caption?: string) {
  const res = await api.post<{ data: { id: string } }>('/api/whatsapp/send-image', {
    phone,
    image: imageBase64,
    caption,
  });
  return res.data;
}

export async function sendDirectWhatsAppDocument(
  phone: string,
  documentBase64: string,
  filename = 'invoice.pdf',
  caption?: string,
) {
  const res = await api.post<{ data: { id: string } }>('/api/whatsapp/send-document', {
    phone,
    document: documentBase64,
    filename,
    caption,
  });
  return res.data;
}
