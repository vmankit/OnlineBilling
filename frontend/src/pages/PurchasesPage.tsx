import { useState } from 'react';
import { usePurchases, type PurchaseSummary } from '@/services/operations';
import { api } from '@/lib/api';
import type { Paginated } from '@/types';
import { useDebounced } from '@/hooks/useDebounced';
import { useAuth } from '@/features/auth/AuthProvider';
import { PurchaseFormModal } from '@/features/purchases/PurchaseFormModal';
import { PurchaseDetailModal } from '@/features/purchases/PurchaseDetailModal';

/**
 * Purchase bills.
 *
 * Markup and class names are the ones `santu_purchase_page.js` /
 * `_summary.js` / `_transactions.js` produced, so
 * `styles/santu/santu_purchase.css` styles this screen unchanged. The old
 * screen's Purchase Order and Debit Note views are not carried over — this
 * app does not have those documents. Payment Out lives on each bill.
 */

const PERIODS = ['This Month', 'Last Month', 'This Quarter', 'This Year', 'All Time'] as const;
type Period = (typeof PERIODS)[number];

const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function rangeFor(period: Period, now = new Date()): { from: string; to: string } | null {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (period) {
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
    case 'All Time':
      return null;
  }
}

const money = (value: number): string =>
  `₹ ${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const asUserDate = (value: string): string =>
  new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });

export function PurchasesPage(): JSX.Element {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [period, setPeriod] = useState<Period>('This Month');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const debounced = useDebounced(search, 250);
  const range = rangeFor(period);

  // Filtered and totalled by the server. The date range used to be applied in
  // the browser to the 25 rows already loaded, so a month's figures depended
  // on which page happened to be open.
  const { data, isLoading } = usePurchases({
    q: debounced,
    from: range?.from,
    to: range?.to,
    page,
  });
  const rows = data?.data ?? [];
  const totals = data?.summary ?? { total: 0, paid: 0, unpaid: 0, payable: 0, payableParties: 0 };

  const exportCsv = async (): Promise<void> => {
    setExporting(true);
    try {
      const all: PurchaseSummary[] = [];
      for (let p = 1; ; p++) {
        const res = await api.get<Paginated<PurchaseSummary>>('/api/purchases', {
          q: debounced || undefined,
          from: range?.from,
          to: range?.to,
          page: p,
          pageSize: 100,
        });
        all.push(...res.data);
        if (p >= res.totalPages) break;
      }
      const header = ['Date', 'Purchase no', 'Supplier invoice', 'Party Name', 'Amount', 'Paid', 'Balance', 'Status'];
      const escape = (cell: string | number): string => {
        const text = String(cell);
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      };
      const body = all.map((p) => [
        asUserDate(p.invoice_date), p.purchase_number, p.supplier_invoice_number ?? '',
        p.supplier_name, Number(p.grand_total), Number(p.paid_amount), Number(p.due_amount), p.status,
      ]);
      const csv = [header, ...body].map((line) => line.map(escape).join(',')).join('\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `Purchase_Bills_${range ? `${range.from}_to_${range.to}` : 'all'}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="santu-purchase">
      <div className="santu-purchase-page-header">
        <div className="santu-purchase-page-title">
          <span className="santu-purchase-title-text">Purchase Bills</span>
        </div>
        <div className="santu-purchase-header-actions">
          {can('purchase:create') && (
            <button
              type="button"
              className="btn btn-primary santu-purchase-add-btn"
              onClick={() => setCreating(true)}
            >
              + Add Purchase
            </button>
          )}
        </div>
      </div>

      <div className="santu-purchase-filter-bar">
        <select
          className="santu-purchase-pill santu-purchase-period"
          aria-label="Time period"
          value={period}
          onChange={(e) => {
            setPeriod(e.target.value as Period);
            setPage(1);
          }}
        >
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        {range && (
          <>
            <span className="santu-purchase-between-label">Between</span>
            <div className="santu-purchase-date-range">
              <span className="santu-purchase-cal-icon" aria-hidden="true">
                📅
              </span>
              <span>{asUserDate(range.from)}</span>
              <span className="santu-purchase-date-to">To</span>
              <span>{asUserDate(range.to)}</span>
            </div>
          </>
        )}
        <div className="santu-purchase-filter-actions">
          <button
            type="button"
            className="santu-purchase-filter-link santu-purchase-excel-btn"
            disabled={exporting}
            onClick={() => void exportCsv()}
          >
            <span className="santu-purchase-filter-link-icon">📗</span>
            {exporting ? 'Ban raha hai…' : 'Excel Report'}
          </button>
          <button
            type="button"
            className="santu-purchase-filter-link santu-purchase-print-btn"
            onClick={() => window.print()}
          >
            <span className="santu-purchase-filter-link-icon">🖨</span>Print
          </button>
        </div>
      </div>

      <div className="santu-purchase-summary-wrap">
        {totals.payable > 0 && (
          <div className="santu-purchase-total-payable" title="Aaj tak sab mahajan ko kitna dena baki hai">
            <div className="santu-purchase-total-payable-label">Total Payable</div>
            <div className="santu-purchase-total-payable-amount santu-figures">{money(totals.payable)}</div>
            <div className="santu-purchase-total-payable-sub">
              From <b>{totals.payableParties}</b> {totals.payableParties === 1 ? 'Party' : 'Parties'}
            </div>
          </div>
        )}
        <div className="santu-purchase-summary-triple">
          <div className="santu-purchase-sum-card santu-purchase-sum-paid">
            <div className="santu-purchase-sum-label">Paid</div>
            <div className="santu-purchase-sum-value santu-figures">{money(totals.paid)}</div>
          </div>
          <span className="santu-purchase-sum-op">+</span>
          <div className="santu-purchase-sum-card santu-purchase-sum-unpaid">
            <div className="santu-purchase-sum-label">Unpaid</div>
            <div className="santu-purchase-sum-value santu-figures">{money(totals.unpaid)}</div>
          </div>
          <span className="santu-purchase-sum-op">=</span>
          <div className="santu-purchase-sum-card santu-purchase-sum-total">
            <div className="santu-purchase-sum-label">Total</div>
            <div className="santu-purchase-sum-value santu-figures">{money(totals.total)}</div>
          </div>
        </div>
      </div>

      <div className="santu-purchase-txn-wrap">
        <div className="santu-purchase-txn-card-inner">
          <div className="santu-purchase-txn-header">
            <span className="santu-purchase-txn-title">TRANSACTIONS</span>
            <div className="santu-purchase-txn-toolbar">
              <button
                type="button"
                className="santu-purchase-icon-btn santu-purchase-txn-search-btn"
                title="Search"
                onClick={() => setSearchOpen((open) => !open)}
              >
                🔍
              </button>
              <button
                type="button"
                className="santu-purchase-icon-btn santu-purchase-txn-export-btn"
                title="Export"
                disabled={exporting}
                onClick={() => void exportCsv()}
              >
                📗
              </button>
              <button
                type="button"
                className="santu-purchase-icon-btn santu-purchase-txn-print-btn"
                title="Print"
                onClick={() => window.print()}
              >
                🖨
              </button>
            </div>
          </div>

          {searchOpen && (
            <div className="santu-purchase-txn-search-panel">
              <input
                type="text"
                className="form-control santu-purchase-txn-search"
                placeholder="Search transactions..."
                autoFocus
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          )}

          {rows.length === 0 ? (
            <div className="santu-purchase-empty">
              {isLoading ? 'Loading…' : 'Is date range me koi purchase bill nahi hai.'}
            </div>
          ) : (
            <div className="santu-purchase-txn-table-wrap">
              <table className="santu-purchase-txn-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Purchase no</th>
                    <th>Supplier invoice</th>
                    <th>Party Name</th>
                    <th className="num">Amount</th>
                    <th className="num">Balance</th>
                    <th>Status</th>
                    <th className="num">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className="santu-purchase-txn-row" onClick={() => setOpenId(p.id)}>
                      <td>{asUserDate(p.invoice_date)}</td>
                      <td>{p.purchase_number}</td>
                      <td>{p.supplier_invoice_number || '—'}</td>
                      <td>{p.supplier_name}</td>
                      <td className="num santu-figures">{money(Number(p.grand_total))}</td>
                      <td className="num santu-figures">
                        {Number(p.due_amount) ? money(Number(p.due_amount)) : '—'}
                      </td>
                      <td>{p.status}</td>
                      <td className="num santu-purchase-row-actions">
                        {Number(p.due_amount) > 0 && p.status !== 'CANCELLED' && (
                          <button
                            type="button"
                            className="santu-purchase-row-btn"
                            title="Payment darj karein"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenId(p.id);
                            }}
                          >
                            💰
                          </button>
                        )}
                        <button
                          type="button"
                          className="santu-purchase-row-btn"
                          title="Open"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenId(p.id);
                          }}
                        >
                          📄
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data && data.totalPages > 1 && (
            <div className="santu-sale-txn-footer">
              <span>
                Page {data.page} of {data.totalPages}
              </span>
              <div className="santu-sale-pager">
                <button
                  type="button"
                  className="santu-sale-pager-btn"
                  disabled={data.page <= 1}
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                >
                  ‹ Previous
                </button>
                <button
                  type="button"
                  className="santu-sale-pager-btn"
                  disabled={data.page >= data.totalPages}
                  onClick={() => setPage((prev) => prev + 1)}
                >
                  Next ›
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {creating && <PurchaseFormModal onClose={() => setCreating(false)} />}
      {openId && <PurchaseDetailModal purchaseId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
