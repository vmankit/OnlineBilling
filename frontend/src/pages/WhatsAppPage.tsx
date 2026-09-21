import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCustomer, useCustomersInfinite, useSettings } from '@/services/catalog';
import { useSuppliersInfinite } from '@/services/operations';
import { useDebounced } from '@/hooks/useDebounced';
import { useToast } from '@/components/ui/Toast';
import {
  normalizeIndianMobile,
  openWhatsApp,
  reminderMessage,
  statementMessage,
  thankYouMessage,
} from '@/features/whatsapp/whatsapp';
import {
  useWhatsAppBridgeStatus,
  useStartWhatsAppBridge,
  useLogoutWhatsAppBridge,
  sendDirectWhatsAppMessage,
} from '@/services/whatsappBridge';
import { TransactionMessageView } from '@/features/whatsapp/TransactionMessageView';
import { ArrowUp, RefreshCw, Search, X } from 'lucide-react';

type Tab = 'connect' | 'transaction-message';
type FilterType = 'all' | 'customer' | 'supplier' | 'due';

interface Contact {
  id: string;
  type: 'Customer' | 'Supplier';
  name: string;
  mobile: string;
  balance: number;
}

const money = (value: number): string =>
  Number(Math.abs(value) || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export function WhatsAppPage(): JSX.Element {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'connect';

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [selected, setSelected] = useState<Contact | null>(null);
  const [message, setMessage] = useState('');
  const [showQrModal, setShowQrModal] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [isSendingDirect, setIsSendingDirect] = useState(false);

  const q = useDebounced(search, 250);
  // Every party, not the first page. The list only ever loaded 25 customers,
  // so anyone past "D" alphabetically could not be messaged from here.
  const customerPages = useCustomersInfinite({ q });
  const supplierPages = useSuppliersInfinite({ q });
  useEffect(() => {
    if (customerPages.hasNextPage && !customerPages.isFetchingNextPage) void customerPages.fetchNextPage();
  }, [customerPages.hasNextPage, customerPages.isFetchingNextPage, customerPages.fetchNextPage]);
  useEffect(() => {
    if (supplierPages.hasNextPage && !supplierPages.isFetchingNextPage) void supplierPages.fetchNextPage();
  }, [supplierPages.hasNextPage, supplierPages.isFetchingNextPage, supplierPages.fetchNextPage]);
  const customers = { data: customerPages.data?.pages.flatMap((pg) => pg.data) ?? [] };
  const suppliers = { data: supplierPages.data?.pages.flatMap((pg) => pg.data) ?? [] };
  const { data: settings } = useSettings();

  const { data: bridgeStatus } = useWhatsAppBridgeStatus();
  const startBridge = useStartWhatsAppBridge();
  const logoutBridge = useLogoutWhatsAppBridge();

  const isConnected = bridgeStatus?.state === 'CONNECTED';

  const shop = {
    name: settings?.business?.name ?? 'Santu Hardware',
    phone: settings?.business?.phonePrimary ?? null,
    upiId: settings?.business?.upiId ?? null,
  };

  const contacts = useMemo<Contact[]>(() => {
    const out: Contact[] = [];
    for (const c of customers?.data ?? []) {
      if (!normalizeIndianMobile(c.mobile)) continue;
      out.push({
        id: c.id,
        type: 'Customer',
        name: c.name,
        mobile: c.mobile!,
        balance: Number(c.outstanding_balance) || 0,
      });
    }
    for (const s of suppliers?.data ?? []) {
      if (!normalizeIndianMobile(s.mobile)) continue;
      out.push({
        id: s.id,
        type: 'Supplier',
        name: s.name,
        mobile: s.mobile!,
        balance: -(Number(s.outstanding_balance) || 0),
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [customerPages.data, supplierPages.data]);

  const filteredContacts = useMemo(() => {
    return contacts.filter((c) => {
      if (filter === 'customer') return c.type === 'Customer';
      if (filter === 'supplier') return c.type === 'Supplier';
      if (filter === 'due') return c.balance > 0;
      return true;
    });
  }, [contacts, filter]);

  const dueCount = useMemo(() => contacts.filter((c) => c.balance > 0).length, [contacts]);

  const { data: customerDetail } = useCustomer(
    selected?.type === 'Customer' ? selected.id : undefined,
  );

  const send = (): void => {
    if (!selected || !message.trim()) return;
    openWhatsApp(selected.mobile, message);
  };

  const handleStartBridge = async () => {
    setShowQrModal(true);
    try {
      await startBridge.mutateAsync();
    } catch {
      toast.error('Bridge Error', 'Could not start WhatsApp bridge.');
    }
  };

  const handleLogoutBridge = async () => {
    try {
      await logoutBridge.mutateAsync();
      toast.success('Logged out', 'WhatsApp is no longer linked.');
      setConfirmLogout(false);
      setShowQrModal(false);
    } catch (err) {
      toast.error('Logout failed', err instanceof Error ? err.message : 'Unable to logout WhatsApp bridge.');
    }
  };

  const handleDirectSend = async () => {
    if (!selected || !message.trim()) return;
    setIsSendingDirect(true);
    try {
      await sendDirectWhatsAppMessage(selected.mobile, message);
      // WhatsApp has accepted it; whether it reached the phone is only known
      // once the ticks turn in the shop's own WhatsApp, so do not claim it.
      toast.success('Message bhej diya', `${selected.name} (${selected.mobile}) ko WhatsApp par gaya.`);
    } catch (err: any) {
      toast.error('Direct Send Failed', err?.message || 'Could not send message via WhatsApp bridge.');
    } finally {
      setIsSendingDirect(false);
    }
  };

  const FONT =
    "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', 'Segoe UI', system-ui, sans-serif";

  const SEGMENTS: Array<[FilterType, string]> = [
    ['all', 'All'],
    ['customer', 'Customers'],
    ['due', 'Baki'],
    ['supplier', 'Suppliers'],
  ];

  const quickActions: Array<{ label: string; onClick: () => void; disabled?: boolean }> = selected
    ? [
        ...(selected.balance > 0
          ? [
              {
                label: `Reminder · ₹ ${money(selected.balance)}`,
                onClick: () => setMessage(reminderMessage(shop, selected.name, selected.balance)),
              },
            ]
          : []),
        {
          label: 'Statement',
          disabled: selected.type === 'Supplier' || !customerDetail,
          onClick: () => {
            if (!customerDetail) return;
            setMessage(
              statementMessage(
                shop,
                selected.name,
                Number(customerDetail.stats.total_purchases) || 0,
                Number(customerDetail.outstanding_balance) || 0,
              ),
            );
          },
        },
        { label: 'Thank you', onClick: () => setMessage(thankYouMessage(shop, selected.name)) },
        {
          label: 'Order ready',
          onClick: () =>
            setMessage(
              `Namaste ${selected.name} ji,\n\nAapka saman ${shop.name} par taiyar hai. Kripya dukan se prapt kar lein.\nDhanyawad!`,
            ),
        },
      ]
    : [];

  return (
    <div
      className="flex h-[calc(100vh-56px)] w-full overflow-hidden bg-[#f5f5f7] text-[#1d1d1f] antialiased select-none"
      style={{ fontFamily: FONT }}
    >
      {tab === 'transaction-message' ? (
        <div className="flex flex-1 overflow-hidden bg-white">
          <TransactionMessageView
            initialSettings={(settings as any)?.transaction_message_settings}
            onOpenQrModal={() => setShowQrModal(true)}
            onBackToChats={() => setParams({ tab: 'connect' })}
          />
        </div>
      ) : (
        <>
          {/* ------------------------------------------------ people */}
          <aside className="flex w-[340px] shrink-0 flex-col border-r border-black/[0.06] bg-white">
            <div className="px-5 pb-3 pt-5">
              <div className="flex items-end justify-between">
                <h1 className="text-[28px] font-semibold leading-none tracking-tight">WhatsApp</h1>
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => (isConnected ? setShowQrModal(true) : void handleStartBridge())}
                    className="cursor-pointer text-[13px] font-medium text-[#0071e3] hover:opacity-70"
                  >
                    {isConnected ? 'Settings' : 'Login'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setParams({ tab: 'transaction-message' })}
                    className="cursor-pointer text-[13px] font-medium text-[#0071e3] hover:opacity-70"
                  >
                    Templates
                  </button>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-1.5 text-[13px] text-black/50">
                <span className={`h-1.5 w-1.5 rounded-full ${isConnected ? 'bg-[#34c759]' : 'bg-black/25'}`} />
                <span>{isConnected ? `Linked · +91 ${bridgeStatus?.phone ?? ''}` : 'Not linked'}</span>
              </div>
            </div>

            <div className="space-y-2.5 px-4 pb-3">
              <div className="flex h-9 items-center gap-2 rounded-[10px] bg-black/[0.05] px-3">
                <Search className="h-4 w-4 shrink-0 text-black/40" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search"
                  className="w-full bg-transparent text-[14px] placeholder:text-black/40 focus:outline-none"
                />
                {search && (
                  <button type="button" onClick={() => setSearch('')} className="text-black/40 hover:text-black/70">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* segmented control */}
              <div className="grid grid-cols-4 rounded-[9px] bg-black/[0.05] p-0.5">
                {SEGMENTS.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFilter(value)}
                    className={`h-7 cursor-pointer rounded-[7px] text-[12px] font-medium transition-all ${
                      filter === value ? 'bg-white shadow-[0_1px_2px_rgba(0,0,0,0.12)]' : 'text-black/55 hover:text-black'
                    }`}
                  >
                    {label}
                    {value === 'due' && dueCount > 0 && <span className="ml-1 text-[#ff3b30]">{dueCount}</span>}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-2 pb-3">
              {filteredContacts.length === 0 ? (
                <p className="px-4 py-10 text-center text-[13px] text-black/40">
                  {search ? 'No results' : 'No one here yet'}
                </p>
              ) : (
                filteredContacts.map((c) => {
                  const active = selected?.type === c.type && selected.id === c.id;
                  return (
                    <button
                      key={`${c.type}:${c.id}`}
                      type="button"
                      onClick={() => {
                        setSelected(c);
                        setMessage(
                          c.balance > 0 ? reminderMessage(shop, c.name, c.balance) : thankYouMessage(shop, c.name),
                        );
                      }}
                      className={`flex w-full cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors ${
                        active ? 'bg-black/[0.06]' : 'hover:bg-black/[0.03]'
                      }`}
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/[0.06] text-[14px] font-medium text-black/60">
                        {c.name[0]?.toUpperCase() ?? '?'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium leading-tight">{c.name}</span>
                        <span className="block truncate text-[13px] leading-tight text-black/45">
                          {c.type === 'Supplier' ? 'Supplier · ' : ''}+91 {c.mobile}
                        </span>
                      </span>
                      {c.balance !== 0 && (
                        <span
                          className={`shrink-0 text-[13px] tabular-nums ${
                            c.balance > 0 ? 'text-[#ff3b30]' : 'text-[#248a3d]'
                          }`}
                        >
                          ₹ {money(c.balance)}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          {/* ------------------------------------------------ conversation */}
          <section className="flex min-w-0 flex-1 flex-col bg-[#fafafa]">
            {!selected ? (
              <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
                <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-black/[0.05]">
                  <img src="/icons/whatsapp/whatsapp.svg" alt="" className="h-7 w-7 opacity-50 grayscale" />
                </div>
                <h2 className="text-[19px] font-semibold tracking-tight">Choose someone</h2>
                <p className="mt-1.5 max-w-xs text-[14px] leading-relaxed text-black/50">
                  Pick a customer or supplier to write a reminder, a statement or a thank-you.
                </p>

                <div className="mt-8 flex flex-col items-center gap-2 text-[13px] text-black/50">
                  {isConnected ? (
                    <>
                      <span>Your phone is linked. Messages send straight from here.</span>
                      <button
                        type="button"
                        onClick={() => setShowQrModal(true)}
                        className="cursor-pointer font-medium text-[#ff3b30] hover:opacity-70"
                      >
                        Disconnect
                      </button>
                    </>
                  ) : (
                    <>
                      <span>Link your phone once to send without leaving the app.</span>
                      <button
                        type="button"
                        onClick={handleStartBridge}
                        className="cursor-pointer font-medium text-[#0071e3] hover:opacity-70"
                      >
                        Link phone
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <>
                <header className="flex h-[68px] shrink-0 items-center justify-between border-b border-black/[0.06] bg-white/80 px-6 backdrop-blur">
                  <div className="min-w-0">
                    <h2 className="truncate text-[17px] font-semibold leading-tight tracking-tight">{selected.name}</h2>
                    <p className="text-[13px] leading-tight text-black/45">
                      +91 {selected.mobile} · {selected.type === 'Supplier' ? 'Supplier' : 'Customer'}
                    </p>
                  </div>
                  {selected.balance !== 0 && (
                    <div className="text-right">
                      <p className="text-[11px] uppercase tracking-wide text-black/40">
                        {selected.balance > 0 ? 'Owes you' : 'You owe'}
                      </p>
                      <p
                        className={`text-[17px] font-semibold tabular-nums ${
                          selected.balance > 0 ? 'text-[#ff3b30]' : 'text-[#248a3d]'
                        }`}
                      >
                        ₹ {money(selected.balance)}
                      </p>
                    </div>
                  )}
                </header>

                <div className="flex shrink-0 items-center gap-2 overflow-x-auto px-6 py-3">
                  {quickActions.map((a) => (
                    <button
                      key={a.label}
                      type="button"
                      disabled={a.disabled}
                      onClick={a.onClick}
                      className="shrink-0 cursor-pointer rounded-full bg-black/[0.05] px-3.5 py-1.5 text-[13px] font-medium text-black/75 transition-colors hover:bg-black/[0.09] disabled:cursor-default disabled:opacity-40"
                    >
                      {a.label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-1 flex-col justify-end overflow-y-auto px-6 pb-6">
                  <p className="mb-2 text-right text-[11px] uppercase tracking-wide text-black/35">Preview</p>
                  <div className="ml-auto max-w-[78%] whitespace-pre-wrap rounded-[20px] rounded-br-[6px] border border-black/[0.06] bg-white px-4 py-3 text-[15px] leading-relaxed shadow-[0_1px_2px_rgba(0,0,0,0.04)] select-text">
                    {message || <span className="text-black/35">Write a message below</span>}
                  </div>
                </div>

                <footer className="shrink-0 border-t border-black/[0.06] bg-white px-6 py-4">
                  <div className="flex items-end gap-3 rounded-[22px] border border-black/10 bg-white py-1.5 pl-4 pr-1.5 focus-within:border-black/25">
                    <textarea
                      rows={2}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Message"
                      className="max-h-32 min-h-[44px] flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-relaxed placeholder:text-black/35 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={isConnected ? handleDirectSend : send}
                      disabled={!message.trim() || isSendingDirect}
                      aria-label={isConnected ? 'Send' : 'Open in WhatsApp'}
                      title={isConnected ? 'Send from your linked phone' : 'Opens WhatsApp with this message ready'}
                      className="mb-0.5 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#34c759] text-white transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-30"
                    >
                      {isSendingDirect ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.5} />
                      )}
                    </button>
                  </div>

                  <p className="mt-2.5 px-2 text-[12px] text-black/40">
                    {isConnected ? (
                      <>
                        Sends from your linked phone.{' '}
                        <button
                          type="button"
                          onClick={send}
                          disabled={!message.trim()}
                          className="cursor-pointer text-[12px] text-[#0071e3] hover:opacity-70 disabled:opacity-40"
                        >
                          Open in WhatsApp instead
                        </button>
                      </>
                    ) : (
                      <>
                        Opens WhatsApp with this message ready — you press send.{' '}
                        <button
                          type="button"
                          onClick={handleStartBridge}
                          className="cursor-pointer text-[12px] text-[#0071e3] hover:opacity-70"
                        >
                          Link phone to send directly
                        </button>
                      </>
                    )}
                  </p>
                </footer>
              </>
            )}
          </section>
        </>
      )}

      {/* ------------------------------------------------ link phone */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-md rounded-[24px] bg-white p-8 shadow-2xl" style={{ fontFamily: FONT }}>
            <button
              type="button"
              onClick={() => setShowQrModal(false)}
              aria-label="Close"
              className="absolute right-5 top-5 flex h-7 w-7 items-center justify-center rounded-full bg-black/[0.06] text-black/50 hover:bg-black/10"
            >
              <X className="h-4 w-4" />
            </button>

            <h3 className="text-[22px] font-semibold tracking-tight">{isConnected ? 'WhatsApp settings' : 'Link your phone'}</h3>
            <p className="mt-1 text-[14px] text-black/50">
              {isConnected ? 'Bills and reminders send from this phone.' : 'Once, and messages send from here.'}
            </p>

            {isConnected ? (
              <div className="py-8 text-center">
                <p className="text-[17px] font-semibold">Linked</p>
                <p className="mt-1 text-[14px] text-black/50">+91 {bridgeStatus?.phone}</p>
                <div className="mt-6 flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => (confirmLogout ? void handleLogoutBridge() : setConfirmLogout(true))}
                    disabled={logoutBridge.isPending}
                    className="h-10 cursor-pointer rounded-full bg-[#ff3b30]/10 px-6 text-[14px] font-medium text-[#ff3b30] hover:bg-[#ff3b30]/15 disabled:opacity-50"
                  >
                    {logoutBridge.isPending ? 'Logging out…' : confirmLogout ? 'Tap again to log out' : 'Log out'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowQrModal(false)}
                    className="h-10 cursor-pointer rounded-full bg-[#1d1d1f] px-6 text-[14px] font-medium text-white hover:opacity-85"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : bridgeStatus?.qr ? (
              <div className="mt-6 space-y-5">
                <div className="flex justify-center rounded-2xl bg-black/[0.03] p-5">
                  <img src={bridgeStatus.qr} alt="WhatsApp QR code" className="h-56 w-56 rounded-xl bg-white p-2" />
                </div>
                <ol className="space-y-1.5 text-[13px] text-black/55">
                  <li>1. Open WhatsApp on your phone</li>
                  <li>2. Settings → Linked Devices → Link a Device</li>
                  <li>3. Point the camera at this code</li>
                </ol>
                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => startBridge.mutate()}
                    disabled={startBridge.isPending}
                    className="flex cursor-pointer items-center gap-1.5 text-[13px] font-medium text-[#0071e3] hover:opacity-70"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${startBridge.isPending ? 'animate-spin' : ''}`} />
                    New code
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowQrModal(false)}
                    className="h-10 cursor-pointer rounded-full bg-[#1d1d1f] px-6 text-[14px] font-medium text-white hover:opacity-85"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div className="py-12 text-center">
                <RefreshCw className="mx-auto h-6 w-6 animate-spin text-black/30" />
                <p className="mt-3 text-[14px] text-black/50">Preparing your code…</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
