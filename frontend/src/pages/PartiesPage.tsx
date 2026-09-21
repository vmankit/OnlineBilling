import { useMemo, useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Search, X, Plus, Edit2, ArrowUpRight, ArrowDownLeft, CheckCircle2 } from 'lucide-react';
import { useCustomer, useCustomersInfinite, useSettings } from '@/services/catalog';
import { useSupplier, useSuppliersInfinite } from '@/services/operations';
import { useDebounced } from '@/hooks/useDebounced';
import { openWhatsApp, reminderMessage, thankYouMessage } from '@/features/whatsapp/whatsapp';
import { PartyFormModal, type InitialPartyData } from '@/features/parties/PartyFormModal';
import { CustomerPaymentModal } from '@/features/parties/CustomerPaymentModal';
import { SupplierPaymentModal } from '@/features/purchases/SupplierPaymentModal';

type PartyType = '' | 'Customer' | 'Supplier';

interface Party {
  id: string;
  type: 'Customer' | 'Supplier';
  name: string;
  mobile: string;
  address: string;
  gstin: string;
  email: string;
  creditLimit: number;
  /** Positive means the party owes the shop; negative means the shop owes. */
  balance: number;
}

const money = (value: number): string =>
  Number(Math.abs(value) || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const asUserDate = (value: string): string =>
  new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });

const getInitials = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'P';

export function PartiesPage(): JSX.Element {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  // Payment In / Payment Out in the sidebar open this screen already narrowed
  // to customers or mahajan; they used to land on the full list.
  const [searchParams] = useSearchParams();
  const initialType = searchParams.get('type');
  const [type, setType] = useState<PartyType>(
    initialType === 'Customer' || initialType === 'Supplier' ? initialType : '',
  );
  const [payingParty, setPayingParty] = useState<Party | null>(null);
  // Only WHICH party is open is stored. Its figures are read back from the
  // live list, so a payment updates the panel instead of leaving the old
  // balance on screen beside a list that already shows the new one.
  const [pickedParty, setSelected] = useState<Party | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingParty, setEditingParty] = useState<InitialPartyData | null>(null);
  const [txnSearch, setTxnSearch] = useState('');
  const q = useDebounced(search, 250);

  const wantCustomers = type !== 'Supplier';
  const wantSuppliers = type !== 'Customer';

  const customers = useCustomersInfinite({ q });
  const suppliers = useSuppliersInfinite({ q });

  const customerTotal = customers.data?.pages[0]?.total ?? 0;
  const supplierTotal = suppliers.data?.pages[0]?.total ?? 0;
  const loading = customers.isLoading || suppliers.isLoading;
  const fetchingMore = customers.isFetchingNextPage || suppliers.isFetchingNextPage;
  const failed = customers.isError || suppliers.isError;

  const hasMore =
    (wantCustomers && customers.hasNextPage) || (wantSuppliers && suppliers.hasNextPage);

  const loadMore = (): void => {
    if (wantCustomers && customers.hasNextPage) void customers.fetchNextPage();
    if (wantSuppliers && suppliers.hasNextPage) void suppliers.fetchNextPage();
  };

  const parties = useMemo<Party[]>(() => {
    const out: Party[] = [];
    if (wantCustomers) {
      for (const page of customers.data?.pages ?? []) {
        for (const c of page.data) {
          out.push({
            id: c.id,
            type: 'Customer',
            name: c.name,
            mobile: c.mobile ?? '',
            address: c.address ?? '',
            gstin: c.gstin ?? '',
            email: c.email ?? '',
            creditLimit: Number(c.credit_limit) || 0,
            balance: Number(c.outstanding_balance) || 0,
          });
        }
      }
    }
    if (wantSuppliers) {
      for (const page of suppliers.data?.pages ?? []) {
        for (const sup of page.data) {
          out.push({
            id: sup.id,
            type: 'Supplier',
            name: sup.name,
            mobile: sup.mobile ?? '',
            address: sup.address ?? '',
            gstin: sup.gstin ?? '',
            email: sup.email ?? '',
            creditLimit: 0,
            balance: -(Number(sup.outstanding_balance) || 0),
          });
        }
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [customers.data, suppliers.data, wantCustomers, wantSuppliers]);

  const selected = useMemo(
    () =>
      pickedParty
        ? (parties.find((p) => p.type === pickedParty.type && p.id === pickedParty.id) ?? pickedParty)
        : null,
    [pickedParty, parties],
  );

  const shownTotal =
    (wantCustomers ? customerTotal : 0) + (wantSuppliers ? supplierTotal : 0);

  const { data: customerDetail } = useCustomer(
    selected?.type === 'Customer' ? selected.id : undefined,
  );
  const { data: supplierDetail } = useSupplier(
    selected?.type === 'Supplier' ? selected.id : undefined,
  );
  const { data: settings } = useSettings();

  const shop = {
    name: settings?.business?.name ?? 'Santu Hardware',
    phone: settings?.business?.phonePrimary ?? null,
    upiId: settings?.business?.upiId ?? null,
  };

  const messageFor = (p: Party): string =>
    p.balance > 0 ? reminderMessage(shop, p.name, p.balance) : thankYouMessage(shop, p.name);

  // Filter transactions in detail panel by search
  const filteredCustomerInvoices = useMemo(() => {
    if (!customerDetail?.invoices) return [];
    if (!txnSearch.trim()) return customerDetail.invoices;
    const term = txnSearch.toLowerCase();
    return customerDetail.invoices.filter((inv) =>
      inv.invoice_number.toLowerCase().includes(term) || inv.invoice_date.includes(term),
    );
  }, [customerDetail, txnSearch]);

  const filteredSupplierPurchases = useMemo(() => {
    if (!supplierDetail?.purchases) return [];
    if (!txnSearch.trim()) return supplierDetail.purchases;
    const term = txnSearch.toLowerCase();
    return supplierDetail.purchases.filter(
      (p) =>
        p.purchase_number.toLowerCase().includes(term) ||
        (p.supplier_invoice_number && p.supplier_invoice_number.toLowerCase().includes(term)) ||
        p.invoice_date.includes(term),
    );
  }, [supplierDetail, txnSearch]);

  return (
    <div className="santu-parties-page">
      {/* ----------------- TOP HEADER BAR ----------------- */}
      <div className="santu-parties-page-header border-b border-slate-200">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 shadow-xs">
            <img src="/icons/parties/Parties.svg" alt="Parties" className="h-5 w-5 object-contain" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="santu-parties-title-text text-lg font-bold text-slate-900">Parties</span>
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 ring-1 ring-blue-200">
                {shownTotal} Total
              </span>
            </div>
            <p className="text-[11px] text-slate-500 hidden sm:block">
              Manage customers, suppliers, khata credit balances & transaction ledger
            </p>
          </div>
        </div>

        <div className="santu-parties-header-right flex items-center gap-2">
          {/* Quick link: POS Billing */}
          <Link
            to="/pos"
            className="hidden md:inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-2xs"
          >
            <ArrowUpRight className="h-3.5 w-3.5 text-emerald-600" />
            <span>Sale Bill</span>
          </Link>

          {/* Primary + Add Party Button */}
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 transition-all shadow-sm active:scale-98 cursor-pointer"
            onClick={() => {
              setEditingParty(null);
              setAdding(true);
            }}
          >
            <Plus className="h-4 w-4 stroke-[2.5]" />
            <span>Add Party</span>
          </button>
        </div>
      </div>

      {/* ----------------- SPLIT VIEW WORKSPACE ----------------- */}
      <div className="santu-parties">
        {/* Left: Party List Panel */}
        <div className="santu-parties-list-panel">
          {/* Search Box */}
          <div className="santu-parties-search-wrap">
            <div className="relative w-full">
              <input
                type="text"
                className="w-full h-9 pl-9 pr-8 text-xs rounded-lg border border-slate-200 bg-slate-50/70 hover:bg-slate-50 focus:bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none transition-colors text-slate-800 placeholder-slate-400"
                placeholder="Search Party by Name or Phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Type switcher pills with live counts */}
          <div className="santu-parties-typebar">
            {([
              ['', `Sab (${customerTotal + supplierTotal})`],
              ['Customer', `Customer (${customerTotal})`],
              ['Supplier', `Mahajan (${supplierTotal})`],
            ] as Array<[PartyType, string]>).map(([value, label]) => (
              <button
                key={label}
                type="button"
                className={`santu-parties-type${type === value ? ' is-active' : ''}`}
                onClick={() => {
                  setType(value);
                  setSelected(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* List Table Column Header */}
          <div className="santu-parties-list-head">
            <span>
              Party Name
              {shownTotal > 0 && <span className="santu-parties-count text-slate-400 font-normal"> ({parties.length})</span>}
            </span>
            <span>Balance</span>
          </div>

          {/* Parties List Body */}
          <div className="santu-parties-list scroll-area">
            {parties.length === 0 ? (
              <div className="santu-parties-list-empty py-12 px-4 text-center">
                <img
                  src="/images/parties/customerIconFTU.webp"
                  alt=""
                  className="mx-auto h-16 w-16 opacity-60 mb-2 object-contain"
                />
                <b className="text-slate-700 font-bold text-sm">
                  {loading ? 'Loading Parties…' : failed ? 'Party list load nahi hui' : 'No Party Found'}
                </b>
                {!loading && (
                  <span className="text-xs text-slate-400 block mt-1">
                    {failed
                      ? 'Server error. Please retry.'
                      : search
                      ? 'No party matched your search query.'
                      : 'Add your customers and mahajan to get started.'}
                  </span>
                )}
              </div>
            ) : (
              <>
                {parties.map((p) => {
                  const meta = [p.address, p.mobile].filter(Boolean).join(' · ');
                  const isActive = selected?.type === p.type && selected.id === p.id;
                  const initials = getInitials(p.name);
                  const isSupplier = p.type === 'Supplier';

                  return (
                    <div
                      key={`${p.type}:${p.id}`}
                      className={`santu-parties-row${meta ? ' has-meta' : ''}${
                        isActive ? ' santu-parties-row-active' : ''
                      }`}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setSelected(p);
                        setTxnSearch('');
                      }}
                    >
                      {/* Avatar circle */}
                      <div
                        className={`mr-2.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                          isSupplier
                            ? 'bg-purple-100 text-purple-700 border border-purple-200'
                            : 'bg-blue-100 text-blue-700 border border-blue-200'
                        }`}
                      >
                        {initials}
                      </div>

                      <div className="santu-parties-row-main min-w-0 flex-1 overflow-hidden">
                        {/* Top Line: Party Name and Balance */}
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                            <span className="santu-parties-row-name font-bold text-sm text-slate-900 truncate leading-tight">
                              {p.name}
                            </span>
                            {isSupplier && (
                              <span className="shrink-0 rounded bg-purple-50 px-1 py-0.2 text-[9px] font-semibold text-purple-700 ring-1 ring-purple-200">
                                M
                              </span>
                            )}
                          </div>
                          <span
                            className={`shrink-0 text-xs font-bold tabular-nums text-right leading-tight ${
                              p.balance > 0
                                ? 'text-rose-600'
                                : p.balance < 0
                                ? 'text-amber-600'
                                : 'text-slate-400'
                            }`}
                          >
                            {p.balance ? `₹ ${money(p.balance)}` : '—'}
                          </span>
                        </div>

                        {/* Bottom Line: Address and Phone (never overlaps with balance) */}
                        {meta && (
                          <div className="santu-parties-row-meta mt-1" title={meta}>
                            <span>{meta}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {hasMore && (
                  <button
                    type="button"
                    className="santu-parties-more-load w-full py-2.5 text-center text-xs font-semibold text-blue-600 hover:bg-blue-50 transition-colors border-t border-slate-100"
                    disabled={fetchingMore}
                    onClick={loadMore}
                  >
                    {fetchingMore
                      ? 'Loading more…'
                      : `Load more (${Math.max(0, shownTotal - parties.length)} remaining)`}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right: Party Detail Panel */}
        <div className="santu-parties-detail-panel">
          {!selected ? (
            /* Authentic Landing / Empty State */
            <div className="santu-parties-landing">
              <img
                src="/images/parties/PartyLandingPage.webp"
                alt="Parties"
                className="h-60 w-auto object-contain"
              />
              <div className="santu-parties-landing-text">
                <h2>Manage Customers & Suppliers</h2>
                <p>
                  Select a party from the list on the left to view complete khata transactions, send WhatsApp payment
                  reminders, or record payments.
                </p>
                <button
                  type="button"
                  className="btn btn-primary santu-parties-add-btn cursor-pointer inline-flex items-center gap-2"
                  onClick={() => {
                    setEditingParty(null);
                    setAdding(true);
                  }}
                >
                  <Plus className="h-4 w-4" />
                  <span>+ Add New Party</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Party Profile & Balance Card */}
              <div className="santu-parties-card">
                {/* Header: Name, Badge, Actions */}
                <div className="santu-parties-detail-head">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold shadow-xs ${
                        selected.type === 'Supplier'
                          ? 'bg-purple-100 text-purple-800 border border-purple-300'
                          : 'bg-blue-100 text-blue-800 border border-blue-300'
                      }`}
                    >
                      {getInitials(selected.name)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="santu-parties-detail-name truncate">{selected.name}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            selected.type === 'Supplier'
                              ? 'bg-purple-50 text-purple-700 ring-1 ring-purple-200'
                              : 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
                          }`}
                        >
                          {selected.type === 'Supplier' ? 'Mahajan (Supplier)' : 'Customer (Grahak)'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">
                        {selected.address || 'No address'} {selected.mobile ? `· ${selected.mobile}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="santu-parties-detail-icons flex items-center gap-2">
                    {/* Edit Party Button */}
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer shadow-2xs"
                      title="Edit Party Details"
                      onClick={() =>
                        setEditingParty({
                          id: selected.id,
                          type: selected.type,
                          name: selected.name,
                          mobile: selected.mobile,
                          address: selected.address,
                          gstin: selected.gstin,
                          creditLimit: selected.creditLimit,
                        })
                      }
                    >
                      <Edit2 className="h-3.5 w-3.5 text-blue-600" />
                      <span>Edit</span>
                    </button>

                    {/* WhatsApp Action Button */}
                    {selected.mobile && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors cursor-pointer shadow-2xs"
                        title="Chat on WhatsApp"
                        onClick={() => openWhatsApp(selected.mobile, messageFor(selected))}
                      >
                        <img src="/icons/whatsapp/whatsapp.svg" alt="WA" className="h-3.5 w-3.5 object-contain" />
                        <span>WhatsApp</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Outstanding Balance Banner */}
                {selected.balance === 0 ? (
                  <div className="santu-parties-balance santu-parties-balance-clear mt-3 flex items-center justify-between bg-emerald-50/70 border border-emerald-200 rounded-xl p-3 text-emerald-900">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                      <span className="text-xs font-semibold text-emerald-800">All settled — nothing pending</span>
                    </div>
                    {selected.type === 'Customer' ? (
                      <Link
                        to="/pos"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-700 shadow-2xs"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>New Sale</span>
                      </Link>
                    ) : (
                      <Link
                        to="/purchases"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-700 shadow-2xs"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>Receive Stock</span>
                      </Link>
                    )}
                  </div>
                ) : (
                  <div
                    className={`santu-parties-balance mt-3 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 ${
                      selected.balance > 0
                        ? 'bg-rose-50/80 border border-rose-200 text-rose-900'
                        : 'bg-amber-50/80 border border-amber-200 text-amber-900'
                    }`}
                  >
                    <div className="santu-parties-balance-main flex items-baseline gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                        {selected.balance > 0 ? 'Owes You (Den Hai)' : 'You Owe (Lena Hai)'}
                      </span>
                      <span
                        className={`text-xl font-extrabold ${
                          selected.balance > 0 ? 'text-rose-600' : 'text-amber-600'
                        }`}
                      >
                        ₹ {money(selected.balance)}
                      </span>
                    </div>

                    <div className="santu-parties-balance-actions flex items-center gap-2">
                      {/* Send Reminder button */}
                      {selected.balance > 0 && selected.mobile && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition-colors shadow-2xs cursor-pointer"
                          onClick={() =>
                            openWhatsApp(
                              selected.mobile,
                              reminderMessage(shop, selected.name, selected.balance),
                            )
                          }
                        >
                          <img src="/icons/whatsapp/whatsapp.svg" alt="WA" className="h-3.5 w-3.5 brightness-200" />
                          <span>Send Reminder</span>
                        </button>
                      )}

                      {/* Payment In (customer) / Payment Out (mahajan) — only while
                          money is actually owed in that direction. */}
                      {((selected.type === 'Customer' && selected.balance > 0) ||
                        (selected.type === 'Supplier' && selected.balance < 0)) && (
                      <button
                        type="button"
                        onClick={() => setPayingParty(selected)}
                        className={
                          selected.type === 'Customer'
                            ? 'inline-flex items-center gap-1.5 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50 transition-colors shadow-2xs cursor-pointer'
                            : 'inline-flex items-center gap-1.5 rounded-lg border border-purple-300 bg-white px-3 py-1.5 text-xs font-bold text-purple-700 hover:bg-purple-50 transition-colors shadow-2xs cursor-pointer'
                        }
                      >
                        {selected.type === 'Customer' ? (
                          <ArrowDownLeft className="h-3.5 w-3.5" />
                        ) : (
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        )}
                        <span>{selected.type === 'Customer' ? 'Payment In' : 'Payment Out'}</span>
                      </button>
                      )}
                    </div>
                  </div>
                )}

                {/* 5 Metadata Info Tiles with Authentic SVGs */}
                <div className="santu-parties-detail-info grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 pt-3 border-t border-slate-100">
                  {/* Phone */}
                  <div className="flex items-start gap-2 rounded-lg bg-slate-50/70 p-2 border border-slate-100">
                    <img src="/icons/parties/party_phone.svg" alt="" className="h-4 w-4 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-semibold text-slate-500">Phone Number</div>
                      <div className="text-xs font-bold text-slate-900 truncate">
                        {selected.mobile || '—'}
                      </div>
                    </div>
                  </div>

                  {/* Billing Address */}
                  <div className="flex items-start gap-2 rounded-lg bg-slate-50/70 p-2 border border-slate-100">
                    <img src="/icons/parties/party_address.svg" alt="" className="h-4 w-4 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-semibold text-slate-500">Billing Address</div>
                      <div className="text-xs font-bold text-slate-900 truncate" title={selected.address}>
                        {selected.address || '—'}
                      </div>
                    </div>
                  </div>

                  {/* GSTIN */}
                  <div className="flex items-start gap-2 rounded-lg bg-slate-50/70 p-2 border border-slate-100">
                    <img src="/icons/parties/party_gstin.svg" alt="" className="h-4 w-4 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-semibold text-slate-500">GSTIN</div>
                      <div className="text-xs font-bold text-slate-900 truncate tabular-nums">
                        {selected.gstin || '—'}
                      </div>
                    </div>
                  </div>

                  {/* Email */}
                  <div className="flex items-start gap-2 rounded-lg bg-slate-50/70 p-2 border border-slate-100">
                    <img src="/icons/parties/party_mail.svg" alt="" className="h-4 w-4 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-semibold text-slate-500">Email</div>
                      <div className="text-xs font-bold text-slate-900 truncate" title={selected.email}>
                        {selected.email || '—'}
                      </div>
                    </div>
                  </div>

                  {/* Credit Limit or Total Purchases */}
                  <div className="flex items-start gap-2 rounded-lg bg-slate-50/70 p-2 border border-slate-100">
                    <img src="/icons/parties/party_rupee.svg" alt="" className="h-4 w-4 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-semibold text-slate-500">
                        {selected.type === 'Customer' ? 'Credit Limit' : 'Total Purchases'}
                      </div>
                      <div className="text-xs font-bold text-slate-900 truncate">
                        {selected.type === 'Customer'
                          ? selected.creditLimit
                            ? `₹ ${money(selected.creditLimit)}`
                            : 'No limit'
                          : supplierDetail
                          ? `₹ ${money(Number(supplierDetail.stats.total_purchases))}`
                          : '—'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Transactions Ledger Card */}
              <div className="santu-parties-txn-card">
                <div className="santu-parties-txn-head flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="santu-parties-detail-section-title font-bold text-slate-900 text-sm">
                      Transaction Ledger
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
                      {selected.type === 'Supplier'
                        ? filteredSupplierPurchases.length
                        : filteredCustomerInvoices.length}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Filter search in transactions */}
                    <div className="relative">
                      <input
                        type="text"
                        className="h-7 w-40 pl-6 pr-2 text-[11px] rounded-md border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:border-blue-500"
                        placeholder="Filter bills..."
                        value={txnSearch}
                        onChange={(e) => setTxnSearch(e.target.value)}
                      />
                      <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400" />
                    </div>

                    {/* New Transaction Button */}
                    {selected.type === 'Customer' ? (
                      <Link
                        to="/pos"
                        className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-blue-700 transition-colors"
                      >
                        <Plus className="h-3 w-3" />
                        <span>Add Bill</span>
                      </Link>
                    ) : (
                      <Link
                        to="/purchases"
                        className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-blue-700 transition-colors"
                      >
                        <Plus className="h-3 w-3" />
                        <span>Add Purchase</span>
                      </Link>
                    )}
                  </div>
                </div>

                {/* Ledger Table */}
                <div className="santu-parties-bills scroll-area">
                  {selected.type === 'Supplier' ? (
                    !supplierDetail ? (
                      <div className="santu-parties-empty py-8 text-center text-xs text-slate-400">Loading ledger…</div>
                    ) : filteredSupplierPurchases.length === 0 ? (
                      <div className="santu-parties-empty py-12 text-center text-xs text-slate-500">
                        Is mahajan se koi kharid record nahi hui hai.
                      </div>
                    ) : (
                      <table className="santu-parties-bills-table w-full text-left">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                            <th className="px-4 py-2.5">Date</th>
                            <th className="px-4 py-2.5">Purchase No</th>
                            <th className="px-4 py-2.5">Supplier Inv No</th>
                            <th className="px-4 py-2.5 text-right">Total Amount</th>
                            <th className="px-4 py-2.5 text-right">Balance Due</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                          {filteredSupplierPurchases.map((p) => (
                            <tr
                              key={p.id}
                              onClick={() => navigate('/purchases')}
                              className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                            >
                              <td className="px-4 py-3 text-slate-600 tabular-nums">{asUserDate(p.invoice_date)}</td>
                              <td className="px-4 py-3 font-semibold text-blue-600">{p.purchase_number}</td>
                              <td className="px-4 py-3 text-slate-500">{p.supplier_invoice_number || '—'}</td>
                              <td className="px-4 py-3 text-right font-bold text-slate-900">
                                ₹ {money(Number(p.grand_total))}
                              </td>
                              <td className="px-4 py-3 text-right font-semibold text-amber-600">
                                {Number(p.due_amount) ? `₹ ${money(Number(p.due_amount))}` : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )
                  ) : !customerDetail ? (
                    <div className="santu-parties-empty py-8 text-center text-xs text-slate-400">Loading ledger…</div>
                  ) : filteredCustomerInvoices.length === 0 ? (
                    <div className="santu-parties-empty py-12 text-center text-xs text-slate-500">
                      Abhi tak is grahak ka koi bill record nahi hua hai.
                    </div>
                  ) : (
                    <table className="santu-parties-bills-table w-full text-left">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                          <th className="px-4 py-2.5">Date</th>
                          <th className="px-4 py-2.5">Invoice No</th>
                          <th className="px-4 py-2.5 text-right">Total Amount</th>
                          <th className="px-4 py-2.5 text-right">Balance Due</th>
                          <th className="px-4 py-2.5 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                        {filteredCustomerInvoices.map((inv) => {
                          const due = Number(inv.due_amount) || 0;
                          const total = Number(inv.grand_total) || 0;
                          const isPaid = due === 0;
                          const isPartial = due > 0 && due < total;

                          return (
                            <tr
                              key={inv.id}
                              onClick={() => navigate(`/sales/${inv.id}`)}
                              className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                            >
                              <td className="px-4 py-3 text-slate-600 tabular-nums">{asUserDate(inv.invoice_date)}</td>
                              <td className="px-4 py-3 font-semibold text-blue-600 hover:underline">
                                {inv.invoice_number}
                              </td>
                              <td className="px-4 py-3 text-right font-bold text-slate-900">₹ {money(total)}</td>
                              <td className="px-4 py-3 text-right font-semibold text-rose-600">
                                {due ? `₹ ${money(due)}` : '—'}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                    isPaid
                                      ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                                      : isPartial
                                      ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                                      : 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
                                  }`}
                                >
                                  {isPaid ? 'PAID' : isPartial ? 'PARTIAL' : 'UNPAID'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {payingParty?.type === 'Customer' && (
        <CustomerPaymentModal
          customer={{ id: payingParty.id, name: payingParty.name, owes: Math.max(0, payingParty.balance) }}
          onClose={() => setPayingParty(null)}
        />
      )}
      {payingParty?.type === 'Supplier' && (
        <SupplierPaymentModal
          supplier={{ id: payingParty.id, name: payingParty.name, owed: Math.max(0, -payingParty.balance) }}
          onClose={() => setPayingParty(null)}
        />
      )}

      {/* Add / Edit Party Modal */}
      {(adding || editingParty) && (
        <PartyFormModal
          initialParty={editingParty}
          onClose={() => {
            setAdding(false);
            setEditingParty(null);
          }}
        />
      )}
    </div>
  );
}
