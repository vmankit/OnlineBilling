import { useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Search,
  Calendar,
  ChevronDown,
  BarChart2,
  X,
  ArrowRight,
  TrendingUp,
  CheckCircle2,
  AlertCircle,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { useSales, type SaleSummary } from '@/services/sales';
import { api } from '@/lib/api';
import type { Paginated } from '@/types';
import { openWhatsApp } from '@/features/whatsapp/whatsapp';

const PERIODS = [
  'Today',
  'This Week',
  'This Month',
  'Last Month',
  'This Quarter',
  'This Year',
  'Custom',
] as const;
type Period = (typeof PERIODS)[number];

const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function rangeFor(period: Period, now = new Date()): { from: string; to: string } | null {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (period) {
    case 'Today':
      return { from: iso(now), to: iso(now) };
    case 'This Week': {
      const offset = (now.getDay() + 6) % 7;
      return { from: iso(new Date(y, m, now.getDate() - offset)), to: iso(now) };
    }
    case 'This Month':
      return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    case 'Last Month':
      return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case 'This Quarter': {
      const q = Math.floor(m / 3) * 3;
      return { from: iso(new Date(y, q, 1)), to: iso(new Date(y, q + 3, 0)) };
    }
    case 'This Year':
      return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)) };
    case 'Custom':
      return null;
  }
}

const money = (value: number): string =>
  `₹ ${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const asUserDate = (value: string): string =>
  new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });

export function SalesPage(): JSX.Element {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>('This Month');
  const initial = rangeFor('This Month')!;
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const pickPeriod = (next: Period): void => {
    setPeriod(next);
    const range = rangeFor(next);
    if (range) {
      setFrom(range.from);
      setTo(range.to);
    }
    setPage(1);
  };

  const { data, isLoading, refetch, isFetching } = useSales({ q: search || undefined, from, to, page });

  const rows = useMemo(
    () =>
      (data?.data ?? []).map((s) => ({
        id: s.id,
        date: s.invoice_date,
        invoiceNo: s.invoice_number,
        partyName: s.customer_name || 'Walk-in Customer',
        partyMobile: s.customer_mobile ?? '',
        partyAddress: s.customer_address ?? '',
        cancelled: s.status === 'CANCELLED',
        paymentType: s.payment_status,
        amount: Number(s.grand_total),
        balance: Number(s.due_amount || 0),
      })),
    [data],
  );

  const totals = {
    sales: data?.summary?.sales ?? 0,
    received: data?.summary?.received ?? 0,
    balance: data?.summary?.balance ?? 0,
  };

  const exportCsv = async (): Promise<void> => {
    setExporting(true);
    try {
      const all: SaleSummary[] = [];
      for (let p = 1; ; p++) {
        const res = await api.get<Paginated<SaleSummary>>('/api/sales', {
          q: search || undefined,
          from,
          to,
          page: p,
          pageSize: 100,
        });
        all.push(...res.data);
        if (p >= res.totalPages) break;
      }

      const header = ['Date', 'Invoice No', 'Party Name', 'Transaction', 'Payment Type', 'Amount', 'Balance'];
      const escape = (cell: string | number): string => {
        const text = String(cell);
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      };
      const body = all.map((sale) => [
        asUserDate(sale.invoice_date),
        sale.invoice_number,
        sale.customer_name || 'Walk-in Customer',
        sale.status === 'CANCELLED' ? 'Cancelled' : 'Sale',
        sale.payment_status,
        Number(sale.grand_total),
        Number(sale.due_amount || 0),
      ]);
      const csv = [header, ...body].map((line) => line.map(escape).join(',')).join('\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `Sale_Invoices_${from}_to_${to}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#f8fafc] text-slate-800 text-xs pb-12 select-none">
      {/* ----------------- TOP HEADER BAR ----------------- */}
      <div className="bg-white border-b border-slate-200 px-4 sm:px-6 py-4 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-50 border border-emerald-200/80 p-2 flex items-center justify-center shadow-2xs">
              <img src="/icons/sales/Sale.svg" alt="Sale" className="h-6 w-6 object-contain" />
            </div>

            {/* Document Switcher Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                className="flex items-center gap-1.5 text-lg font-extrabold text-slate-900 tracking-tight hover:text-emerald-700 transition-colors cursor-pointer"
              >
                <span>Sale Invoices</span>
                <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
              </button>
              <p className="text-[11px] text-slate-500 font-medium">
                Customer billing ledger, payments received, and credit balances
              </p>

              {menuOpen && (
                <div className="absolute left-0 top-full mt-2 w-52 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-40 animate-fade-in">
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-xs font-bold text-emerald-700 bg-emerald-50 flex items-center gap-2"
                  >
                    <img src="/icons/sales/blue_invoice_icon.svg" alt="" className="h-4 w-4" />
                    <span>Sale Invoices</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('/quotations')}
                    className="w-full px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                  >
                    <img src="/icons/sales/estimate.svg" alt="" className="h-4 w-4" />
                    <span>Estimate / Quotation</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('/pos')}
                    className="w-full px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                  >
                    <img src="/icons/sales/pos_billing_black.svg" alt="" className="h-4 w-4" />
                    <span>POS Counter Billing</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons: Add Sale, Quotations, POS */}
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              to="/quotations"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs shadow-2xs transition-colors cursor-pointer"
            >
              <img src="/icons/sales/estimate.svg" alt="" className="h-4 w-4" />
              <span>Estimates</span>
            </Link>

            <Link
              to="/pos"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold text-xs shadow-sm transition-all cursor-pointer hover:shadow-md"
            >
              <img src="/icons/sales/pos_billing_black.svg" alt="" className="h-4 w-4 invert brightness-200" />
              <span>+ Add Sale (POS)</span>
            </Link>
          </div>
        </div>

        {/* ----------------- PERIOD FILTER BAR ----------------- */}
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-3 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mr-1">
              Period:
            </span>
            <div className="inline-flex bg-slate-100 p-0.5 rounded-xl border border-slate-200/80 gap-0.5">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => pickPeriod(p)}
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                    period === p
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>

            {/* Custom Date Pickers */}
            <div className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1 text-xs">
              <Calendar className="h-3.5 w-3.5 text-slate-400" />
              <input
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPeriod('Custom');
                }}
                className="bg-transparent text-slate-700 font-semibold focus:outline-hidden text-xs cursor-pointer"
              />
              <span className="text-slate-400 font-bold">to</span>
              <input
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setPeriod('Custom');
                }}
                className="bg-transparent text-slate-700 font-semibold focus:outline-hidden text-xs cursor-pointer"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void refetch()}
              title="Refresh sales list"
              className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-colors cursor-pointer"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin text-emerald-600' : ''}`} />
            </button>
          </div>
        </div>

        {/* ----------------- SUMMARY CARDS ----------------- */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
          {/* Card 1: Total Sales */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-white to-slate-50 border border-slate-200/80 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5 text-blue-600" />
                <span>Total Sales Amount</span>
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                {period}
              </span>
            </div>
            <div className="text-2xl font-black text-slate-900 mt-1">
              {money(totals.sales)}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Gross sales billed in this date range
            </div>
          </div>

          {/* Card 2: Received */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-white to-emerald-50/40 border border-emerald-100 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                <span>Total Received</span>
              </span>
              <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
            </div>
            <div className="text-2xl font-black text-emerald-700 mt-1">
              {money(totals.received)}
            </div>
            <div className="text-[11px] text-emerald-600/90 mt-0.5">
              Cash, UPI, and Bank settlements collected
            </div>
          </div>

          {/* Card 3: Balance Due */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-white to-amber-50/40 border border-amber-200/80 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-amber-800 uppercase tracking-wider flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                <span>Balance Due (Udhar)</span>
              </span>
              <span className="h-2 w-2 rounded-full bg-amber-500"></span>
            </div>
            <div className="text-2xl font-black text-amber-700 mt-1">
              {money(totals.balance)}
            </div>
            <div className="text-[11px] text-amber-700/90 mt-0.5">
              Pending payment on credit transactions
            </div>
          </div>
        </div>
      </div>

      {/* ----------------- TRANSACTIONS LIST CARD ----------------- */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          {/* Table Header & Toolbar */}
          <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-slate-50/50">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900">Transactions List</h3>
              {data && (
                <span className="text-xs text-slate-500 font-semibold bg-white border border-slate-200 px-2 py-0.5 rounded-full">
                  {data.total} Invoices
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Search Box */}
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Search invoice or customer..."
                  className="pl-8 pr-7 py-1.5 text-xs rounded-xl border border-slate-200 bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500 w-52 sm:w-64"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Reports Link */}
              <Link
                to="/reports"
                title="Sales Performance Report"
                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-colors"
              >
                <BarChart2 className="h-4 w-4" />
              </Link>

              {/* Export CSV */}
              <button
                type="button"
                onClick={() => void exportCsv()}
                disabled={exporting}
                title="Export CSV / Excel"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs transition-colors cursor-pointer"
              >
                <img src="/images/items/ExcelIcon.webp" alt="" className="h-3.5 w-3.5" />
                <span>{exporting ? 'Exporting...' : 'Export'}</span>
              </button>

              {/* Print Button */}
              <button
                type="button"
                onClick={() => window.print()}
                title="Print invoices list"
                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-colors cursor-pointer"
              >
                <img src="/icons/sales/print-invoice-blue.svg" alt="" className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Table or Empty State */}
          {rows.length === 0 ? (
            <div className="text-center py-16 px-4 space-y-3">
              <img
                src="/images/sales/no-transactions-to-show.webp"
                alt="No transactions"
                className="h-36 w-auto mx-auto opacity-80"
              />
              <h3 className="text-base font-bold text-slate-800">
                {isLoading ? 'Loading sales invoices…' : 'No Transactions Found'}
              </h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                {isLoading
                  ? 'Fetching records from server...'
                  : search
                  ? 'No bills match your search criteria.'
                  : 'No invoices have been billed in this selected date period.'}
              </p>
              {!isLoading && (
                <div className="pt-2">
                  <Link
                    to="/pos"
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm cursor-pointer"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Create First Sale Bill</span>
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50/90 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    <th className="py-3 px-3">Date</th>
                    <th className="py-3 px-3">Invoice No</th>
                    <th className="py-3 px-3">Party Name</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3">Payment Type</th>
                    <th className="py-3 px-3 text-right">Amount</th>
                    <th className="py-3 px-3 text-right">Balance Due</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {rows.map((r) => {
                    const meta = [r.partyAddress, r.partyMobile].filter(Boolean).join(' · ');
                    return (
                      <tr
                        key={r.id}
                        onClick={() => navigate(`/sales/${r.id}`)}
                        className="hover:bg-slate-50/80 transition-colors cursor-pointer group"
                      >
                        <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">
                          {asUserDate(r.date)}
                        </td>

                        <td className="py-2.5 px-3 font-bold text-slate-900 group-hover:text-emerald-700 transition-colors whitespace-nowrap tabular-nums">
                          #{r.invoiceNo}
                        </td>

                        <td className="py-2.5 px-3">
                          <div className="font-bold text-slate-900">{r.partyName}</div>
                          <div className="text-[10px] text-slate-400 truncate max-w-xs">{meta || 'No phone/address on file'}</div>
                        </td>

                        <td className="py-2.5 px-3">
                          {r.cancelled ? (
                            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold">
                              Cancelled
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold">
                              Sale
                            </span>
                          )}
                        </td>

                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                              r.paymentType === 'PAID'
                                ? 'bg-emerald-100 text-emerald-800'
                                : r.paymentType === 'PARTIAL'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {r.paymentType}
                          </span>
                        </td>

                        <td className="py-2.5 px-3 text-right whitespace-nowrap font-extrabold text-slate-900">
                          {money(r.amount)}
                        </td>

                        <td className="py-2.5 px-3 text-right whitespace-nowrap font-bold">
                          {r.balance > 0 ? (
                            <span className="text-amber-700">{money(r.balance)}</span>
                          ) : (
                            <span className="text-slate-400 font-normal">—</span>
                          )}
                        </td>

                        <td className="py-2.5 px-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <div className="inline-flex items-center gap-1.5">
                            {/* Print */}
                            <button
                              type="button"
                              onClick={() => navigate(`/sales/${r.id}?print=1`)}
                              title="Print Bill"
                              className="p-1 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 transition-colors cursor-pointer"
                            >
                              <img src="/icons/sales/print-invoice-blue.svg" alt="" className="h-3.5 w-3.5" />
                            </button>

                            {/* WhatsApp Share */}
                            <button
                              type="button"
                              onClick={() => {
                                const link = `${window.location.origin}/bill/${r.id}`;
                                openWhatsApp(
                                  r.partyMobile,
                                  [
                                    `*SANTU HARDWARE*`,
                                    `Bill #${r.invoiceNo} — ${money(r.amount)}`,
                                    r.balance > 0 ? `Baki: ${money(r.balance)}` : 'Poora bhugtan ho gaya. Dhanyawad!',
                                    `Download Bill: ${link}`,
                                  ].join('\n'),
                                );
                              }}
                              title="Share on WhatsApp"
                              className="p-1 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 transition-colors cursor-pointer"
                            >
                              <img src="/icons/whatsapp/whatsapp.svg" alt="" className="h-3.5 w-3.5" />
                            </button>

                            {/* View Detail */}
                            <button
                              type="button"
                              onClick={() => navigate(`/sales/${r.id}`)}
                              title="View Details"
                              className="p-1 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 transition-colors cursor-pointer"
                            >
                              <ArrowRight className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {data && data.totalPages > 1 && (
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
              <span>
                Showing {(data.page - 1) * 25 + 1} – {Math.min(data.page * 25, data.total)} of <strong>{data.total}</strong> invoices
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={data.page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 font-bold transition-colors cursor-pointer"
                >
                  ‹ Prev
                </button>
                <span className="px-2 font-bold text-slate-800">
                  {data.page} / {data.totalPages}
                </span>
                <button
                  type="button"
                  disabled={data.page >= data.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 font-bold transition-colors cursor-pointer"
                >
                  Next ›
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
