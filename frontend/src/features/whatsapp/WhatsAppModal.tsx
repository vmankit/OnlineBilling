import { useMemo, useState } from 'react';
import { Info, MessageSquare, Search, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Field';
import { useCustomers, useSettings } from '@/services/catalog';
import { useDebounced } from '@/hooks/useDebounced';
import { cn, formatMoney } from '@/lib/utils';
import {
  normalizeIndianMobile, openWhatsApp, reminderMessage, statementMessage, thankYouMessage,
  type ShopIdentity,
} from './whatsapp';
import type { Customer } from '@/types';

type Purpose = 'reminder' | 'statement' | 'thanks' | 'blank';

const PURPOSES: Array<{ key: Purpose; label: string }> = [
  { key: 'reminder', label: 'Payment reminder' },
  { key: 'statement', label: 'Khata statement' },
  { key: 'thanks', label: 'Thank you' },
  { key: 'blank', label: 'Blank' },
];

/**
 * Sends a WhatsApp message to a customer.
 *
 * Deliberately has no "connect" step. A wa.me link opens WhatsApp with the
 * chat and the message already filled in, and the shopkeeper presses send —
 * that needs no account linking and cannot get the shop's number banned.
 */
export function WhatsAppModal({
  onClose,
  initialCustomer,
}: {
  onClose: () => void;
  initialCustomer?: Customer | null;
}): JSX.Element {
  const { data: settings } = useSettings();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Customer | null>(initialCustomer ?? null);
  const [manualMobile, setManualMobile] = useState('');
  const [purpose, setPurpose] = useState<Purpose>('reminder');
  const [message, setMessage] = useState('');
  const [edited, setEdited] = useState(false);

  const debounced = useDebounced(search, 250);
  const { data: customers, isLoading } = useCustomers({ q: debounced });

  const shop: ShopIdentity = useMemo(
    () => ({
      name: settings?.business?.name ?? 'SANTU HARDWARE',
      phone: settings?.business?.phonePrimary ?? null,
      upiId: settings?.business?.upiId ?? null,
    }),
    [settings],
  );

  // Regenerate the draft whenever the customer or purpose changes, unless the
  // operator has started typing their own words.
  const draft = useMemo(() => {
    const name = selected?.name ?? 'Grahak';
    switch (purpose) {
      case 'reminder':
        return reminderMessage(shop, name, Number(selected?.outstanding_balance ?? 0));
      case 'statement':
        return statementMessage(shop, name, 0, Number(selected?.outstanding_balance ?? 0));
      case 'thanks':
        return thankYouMessage(shop, name);
      default:
        return '';
    }
  }, [purpose, selected, shop]);

  const body = edited ? message : draft;
  const mobile = selected?.mobile ?? manualMobile;
  const normalized = normalizeIndianMobile(mobile);

  const send = (): void => {
    openWhatsApp(mobile, body);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-2xl border border-slate-200 bg-white shadow-lift sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2 font-semibold text-slate-900">
            <MessageSquare className="h-5 w-5 text-[#25D366]" />
            <span>Send on WhatsApp</span>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="scroll-area flex-1 space-y-4 px-5 py-4">
          {/* ---------- who ---------- */}
          {selected ? (
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-900">{selected.name}</p>
                <p className="text-sm text-slate-500">
                  {selected.mobile || 'No mobile saved'}
                  {Number(selected.outstanding_balance) > 0 &&
                    ` · ${formatMoney(selected.outstanding_balance)} baki`}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                Change
              </Button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search a customer…"
                  className="h-12 pl-12"
                  autoFocus
                />
              </div>

              {isLoading && <p className="text-sm text-slate-400">Searching…</p>}

              <div className="max-h-44 space-y-1 overflow-y-auto">
                {customers?.data.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelected(c)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-slate-50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{c.name}</p>
                      <p className="text-xs text-slate-500">{c.mobile || 'No mobile'}</p>
                    </div>
                    {Number(c.outstanding_balance) > 0 && (
                      <span className="shrink-0 text-xs font-medium text-rose-600">
                        {formatMoney(c.outstanding_balance)}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              <div>
                <p className="mb-1.5 text-sm text-slate-500">Or type a number</p>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-400">
                    +91
                  </span>
                  <Input
                    value={manualMobile}
                    onChange={(e) => setManualMobile(e.target.value)}
                    placeholder="98350 12345"
                    className="h-12 pl-14"
                    inputMode="tel"
                    type="tel"
                  />
                </div>
              </div>
            </>
          )}

          {/* ---------- what ---------- */}
          <div className="flex flex-wrap gap-2">
            {PURPOSES.map((p) => (
              <button
                key={p.key}
                onClick={() => {
                  setPurpose(p.key);
                  setEdited(false);
                }}
                className={cn(
                  'touch-target rounded-xl border px-3.5 text-sm font-medium transition-colors',
                  purpose === p.key
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <Textarea
            value={body}
            rows={7}
            onChange={(e) => {
              setEdited(true);
              setMessage(e.target.value);
            }}
            placeholder="Type your message…"
          />

          {!normalized && (
            <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-100">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                No usable mobile number, so WhatsApp will open with the message ready and you pick
                the chat.
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-slate-100 bg-slate-50/60 px-5 py-4">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={send}
            disabled={!body.trim()}
            className="flex-1 bg-[#25D366] text-white hover:bg-[#1ebd59]"
          >
            <Send className="h-5 w-5" />
            Open WhatsApp
          </Button>
        </div>
      </div>
    </div>
  );
}
