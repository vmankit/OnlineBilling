import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Search,
  X,
  Plus,
  RotateCcw,
  Receipt,
  Wallet,
  FileText,
} from 'lucide-react';
import { Card, Skeleton } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { useSalesReturns } from '@/services/operations';
import { useSales } from '@/services/sales';
import { useDebounced } from '@/hooks/useDebounced';
import { SalesReturnModal } from '@/features/returns/SalesReturnModal';

const money = (value: number): string =>
  `₹ ${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const asUserDate = (value: string): string =>
  new Date(value).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

export function SalesReturnsPage(): JSX.Element {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [selectInvoiceModal, setSelectInvoiceModal] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  const debouncedSearch = useDebounced(search, 250);
  const { data: returnsData, isLoading } = useSalesReturns({ page, pageSize: 25 });

  const returns = returnsData?.data ?? [];

  // Filter returns by search term
  const filteredReturns = useMemo(() => {
    if (!debouncedSearch.trim()) return returns;
    const term = debouncedSearch.toLowerCase();
    return returns.filter(
      (r) =>
        r.return_number.toLowerCase().includes(term) ||
        r.invoice_number.toLowerCase().includes(term) ||
        r.customer_name.toLowerCase().includes(term),
    );
  }, [returns, debouncedSearch]);

  // Aggregate KPI stats
  const stats = useMemo(() => {
    const totalAmount = returns.reduce((sum, r) => sum + Number(r.total_amount || 0), 0);
    const creditNoteAmount = returns
      .filter((r) => r.refund_mode === 'CREDIT_NOTE')
      .reduce((sum, r) => sum + Number(r.total_amount || 0), 0);
    const cashUpiAmount = totalAmount - creditNoteAmount;
    return {
      count: returnsData?.total ?? returns.length,
      totalAmount,
      creditNoteAmount,
      cashUpiAmount,
    };
  }, [returns, returnsData]);

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      {/* ----------------- TOP HEADER BAR ----------------- */}
      <div className="border-b border-slate-200 bg-white px-4 sm:px-8 py-4 mb-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-500/10 border border-cyan-500/20 p-2 shadow-xs">
              <RotateCcw className="h-6 w-6 text-cyan-600" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <Link
                  to="/sales"
                  className="text-xs font-bold text-slate-500 hover:text-blue-600 transition-colors flex items-center gap-1"
                >
                  <span>Sale</span>
                </Link>
                <span className="text-slate-300 font-bold">/</span>
                <h1 className="text-lg font-bold text-slate-900 tracking-tight">
                  Sale Return / Credit Note
                </h1>
                <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-xs font-bold text-cyan-700 ring-1 ring-cyan-200">
                  Customer Returns
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Manage customer goods returns, credit note adjustments, and restock to inventory
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/sales"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs shadow-2xs transition-colors"
            >
              <Receipt className="h-4 w-4 text-blue-600" />
              <span>Sale Invoices</span>
            </Link>

            <button
              type="button"
              onClick={() => setSelectInvoiceModal(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 shadow-sm active:scale-98 transition-all cursor-pointer"
            >
              <Plus className="h-4 w-4 stroke-[2.5]" />
              <span>Record Sale Return</span>
            </button>
          </div>
        </div>
      </div>

      <div className="px-4 pb-12 sm:px-8 space-y-5">
        {/* ----------------- 3 EXECUTIVE KPI SUMMARY CARDS ----------------- */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* Total Returns Card */}
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold tracking-wider uppercase text-slate-500">
                Total Returns Recorded
              </p>
              <h3 className="text-2xl font-extrabold text-slate-900 mt-1">
                {stats.count}{' '}
                <span className="text-xs font-bold text-slate-500">Credit Notes</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">Total Value: {money(stats.totalAmount)}</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-50 border border-cyan-100 text-cyan-600">
              <RotateCcw className="h-6 w-6" />
            </div>
          </div>

          {/* Credit Note Adjustments Card */}
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold tracking-wider uppercase text-slate-500">
                Credit Note Adjustments
              </p>
              <h3 className="text-2xl font-extrabold text-blue-600 mt-1">
                {money(stats.creditNoteAmount)}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">Adjusted against customer outstanding dues</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 border border-blue-100 text-blue-600">
              <FileText className="h-6 w-6" />
            </div>
          </div>

          {/* Cash / Direct Refunds Card */}
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold tracking-wider uppercase text-slate-500">
                Cash & UPI Refunds
              </p>
              <h3 className="text-2xl font-extrabold text-rose-600 mt-1">
                {money(stats.cashUpiAmount)}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">Direct money paid back to customers</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 border border-rose-100 text-rose-600">
              <Wallet className="h-6 w-6" />
            </div>
          </div>
        </div>

        {/* ----------------- SEARCH & FILTER TOOLBAR ----------------- */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="relative min-w-[260px] max-w-md flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by Return #, Invoice # or Customer name..."
              className="w-full h-9 pl-9 pr-8 text-xs rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-slate-50 focus:bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none transition-colors text-slate-800 placeholder-slate-400"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">
              Showing {filteredReturns.length} of {returnsData?.total ?? returns.length} returns
            </span>
          </div>
        </div>

        {/* ----------------- TABLE / CONTENT ----------------- */}
        {isLoading ? (
          <Card className="divide-y divide-slate-100 rounded-2xl overflow-hidden border border-slate-200/80">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="p-4 flex items-center justify-between">
                <Skeleton className="h-5 w-64" />
                <Skeleton className="h-5 w-24" />
              </div>
            ))}
          </Card>
        ) : filteredReturns.length === 0 ? (
          <div className="rounded-2xl border border-slate-200/80 bg-white p-12 text-center shadow-xs">
            <img
              src="/icons/sales/sale-return.svg"
              alt="Sale Return"
              className="h-36 w-auto mx-auto mb-4 object-contain opacity-80"
            />
            <h4 className="text-base font-bold text-slate-800">
              {search ? 'No matching sale returns found' : 'No sale returns recorded yet'}
            </h4>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              {search
                ? 'Try searching with a different return number or invoice number.'
                : 'When a customer brings back sold goods, you can book a sale return to put stock back in the ledger and refund or issue a credit note.'}
            </p>
            <button
              type="button"
              onClick={() => setSelectInvoiceModal(true)}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 shadow-xs cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Record Sale Return</span>
            </button>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200/80 bg-white shadow-xs overflow-hidden">
            {/* Table Header */}
            <div className="grid grid-cols-12 gap-3 border-b border-slate-200 bg-slate-50/80 px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <div className="col-span-3">Return # & Date</div>
              <div className="col-span-3">Customer</div>
              <div className="col-span-2">Original Invoice</div>
              <div className="col-span-2 text-center">Refund Mode</div>
              <div className="col-span-2 text-right">Return Amount</div>
            </div>

            {/* Table Body */}
            <div className="divide-y divide-slate-100">
              {filteredReturns.map((r) => (
                <div
                  key={r.id}
                  className="grid grid-cols-12 gap-3 items-center px-5 py-3.5 hover:bg-slate-50/80 transition-colors text-xs"
                >
                  {/* Return number & date */}
                  <div className="col-span-3 min-w-0">
                    <p className="font-bold text-slate-900 tabular-nums text-sm">{r.return_number}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">{asUserDate(r.return_date)}</p>
                  </div>

                  {/* Customer */}
                  <div className="col-span-3 min-w-0">
                    <p className="font-semibold text-slate-800 truncate">{r.customer_name}</p>
                  </div>

                  {/* Original Invoice */}
                  <div className="col-span-2">
                    <span className="text-xs font-bold text-blue-600 hover:underline cursor-pointer tabular-nums">
                      {r.invoice_number}
                    </span>
                  </div>

                  {/* Refund mode */}
                  <div className="col-span-2 text-center">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                        r.refund_mode === 'CREDIT_NOTE'
                          ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
                          : r.refund_mode === 'CASH'
                          ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                          : 'bg-purple-50 text-purple-700 ring-1 ring-purple-200'
                      }`}
                    >
                      {r.refund_mode.replace('_', ' ')}
                    </span>
                  </div>

                  {/* Amount */}
                  <div className="col-span-2 text-right">
                    <p className="text-sm font-extrabold text-slate-900">{money(r.total_amount)}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination footer */}
            {returnsData && returnsData.totalPages > 1 && (
              <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <span className="text-xs text-slate-500 font-medium">
                  Page {returnsData.page} of {returnsData.totalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs cursor-pointer"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={page >= returnsData.totalPages}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs cursor-pointer"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Select Invoice Modal */}
      {selectInvoiceModal && (
        <SelectInvoiceForReturnModal
          onClose={() => setSelectInvoiceModal(false)}
          onSelectInvoice={(invId) => {
            setSelectInvoiceModal(false);
            setSelectedInvoiceId(invId);
          }}
        />
      )}

      {/* Book Return Modal */}
      {selectedInvoiceId && (
        <SalesReturnModal
          invoiceId={selectedInvoiceId}
          onClose={() => setSelectedInvoiceId(null)}
        />
      )}
    </div>
  );
}

/** Helper modal to pick an invoice to return against */
function SelectInvoiceForReturnModal({
  onClose,
  onSelectInvoice,
}: {
  onClose: () => void;
  onSelectInvoice: (invoiceId: string) => void;
}): JSX.Element {
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const debounced = useDebounced(invoiceSearch, 250);
  const { data: salesData, isLoading } = useSales({ q: debounced, page: 1 });

  return (
    <Modal open onClose={onClose} size="lg" title="Select Completed Sale Invoice to Return Against">
      <div className="space-y-4">
        <p className="text-xs text-slate-500">
          Search and pick the customer's completed sale invoice to return items against.
        </p>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={invoiceSearch}
            onChange={(e) => setInvoiceSearch(e.target.value)}
            placeholder="Search invoice number or customer name…"
            className="pl-9"
            autoFocus
          />
        </div>

        <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-200">
          {isLoading ? (
            <div className="p-4 space-y-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
          ) : salesData?.data && salesData.data.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              No matching completed invoices found.
            </div>
          ) : (
            salesData?.data.map((inv) => (
              <div
                key={inv.id}
                onClick={() => onSelectInvoice(inv.id)}
                className="flex items-center justify-between p-3 hover:bg-blue-50/70 cursor-pointer transition-colors"
              >
                <div>
                  <p className="font-bold text-sm text-slate-900 tabular-nums">{inv.invoice_number}</p>
                  <p className="text-xs text-slate-500">
                    {inv.customer_name} · {asUserDate(inv.invoice_date)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-extrabold text-sm text-slate-900">{money(inv.grand_total)}</p>
                  <span className="text-[10px] font-bold text-blue-600 inline-flex items-center gap-1">
                    Select to Return &rarr;
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
