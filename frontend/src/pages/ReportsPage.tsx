import { useMemo, useState } from 'react';
import {
  downloadReportCsv,
  useReport,
  type ReportColumn,
  type ReportKey,
} from '@/services/reports';

/**
 * Reports.
 *
 * The category rail, workspace header and table are the ones
 * `santu_reports_nav.js` / `_table.js` produced, so
 * `styles/santu/santu_reports.css` styles this screen unchanged.
 *
 * Only the reports this app actually computes are listed. The old screen
 * also offered GSTR-1/2, Balance Sheet, Trial Balance and the rest of
 * ERPNext's accounting family; none of those exist here, and listing a name
 * that opens nothing is worse than not listing it.
 */

interface ReportDef {
  id: ReportKey;
  label: string;
  category: string;
  /** Reports the counter rarely opens sit behind the category's "More". */
  lessUsed?: boolean;
}

const CATEGORIES: Array<[string, string]> = [
  ['transaction', 'Transaction report'],
  ['party', 'Party report'],
  ['stock', 'Item / Stock report'],
  ['business', 'Business Status'],
];

const REPORTS: ReportDef[] = [
  { id: 'daily-sales', label: 'Day Book', category: 'transaction' },
  { id: 'monthly-sales', label: 'Monthly Sale', category: 'transaction' },
  { id: 'purchases', label: 'Purchase', category: 'transaction' },
  { id: 'payments', label: 'Payments Received', category: 'transaction', lessUsed: true },
  { id: 'customer-sales', label: 'Party Statement', category: 'party' },
  { id: 'receivables', label: 'Outstanding Receivables', category: 'party' },
  { id: 'item-sales', label: 'Item Wise Sale', category: 'stock' },
  { id: 'stock', label: 'Stock Valuation', category: 'stock' },
  { id: 'profit', label: 'Profit', category: 'business' },
];

const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function formatCell(value: string | number | null, column: ReportColumn): string {
  if (value === null || value === undefined || value === '') return '—';
  if (column.type === 'money') {
    return `₹ ${Number(value).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  if (column.type === 'number') return Number(value).toLocaleString('en-IN');
  if (column.type === 'date' || column.type === 'datetime') {
    return new Date(String(value)).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }
  return String(value);
}

const PAGE_SIZE = 50;

export function ReportsPage(): JSX.Element {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const [selected, setSelected] = useState<ReportDef>(REPORTS[0]!);
  const [from, setFrom] = useState(iso(monthStart));
  const [to, setTo] = useState(iso(today));
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [openMore, setOpenMore] = useState<Record<string, boolean>>({});
  const [exporting, setExporting] = useState(false);

  const filters = { from, to };
  const { data, isLoading, isError, refetch } = useReport(selected.id, filters);

  const filteredRows = useMemo(() => {
    const rows = data?.rows ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      Object.values(row).some((v) => String(v ?? '').toLowerCase().includes(q)),
    );
  }, [data, search]);

  const pageRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));

  const pick = (report: ReportDef): void => {
    setSelected(report);
    setSearch('');
    setPage(1);
  };

  return (
    <div className="santu-reports">
      <div className="santu-reports-layout">
        <aside className="santu-reports-nav-panel">
          <div className="santu-reports-nav-scroll">
            {CATEGORIES.map(([id, label]) => {
              const inCategory = REPORTS.filter((r) => r.category === id);
              if (inCategory.length === 0) return null;
              const main = inCategory.filter((r) => !r.lessUsed);
              const more = inCategory.filter((r) => r.lessUsed);
              const isOpen = openMore[id] ?? more.some((r) => r.id === selected.id);

              return (
                <div key={id}>
                  <div className="santu-reports-cat-header">{label}</div>
                  {(main.length ? main : inCategory).map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className={`santu-reports-nav-item${r.id === selected.id ? ' is-active' : ''}`}
                      onClick={() => pick(r)}
                    >
                      {r.label}
                    </button>
                  ))}
                  {main.length > 0 && more.length > 0 && (
                    <>
                      <button
                        type="button"
                        className="santu-reports-nav-more"
                        onClick={() => setOpenMore((prev) => ({ ...prev, [id]: !isOpen }))}
                      >
                        More <span className="santu-reports-nav-more-arrow">{isOpen ? '▾' : '▸'}</span>
                      </button>
                      {isOpen && (
                        <div className="santu-reports-nav-more-items">
                          {more.map((r) => (
                            <button
                              key={r.id}
                              type="button"
                              className={`santu-reports-nav-item${
                                r.id === selected.id ? ' is-active' : ''
                              }`}
                              onClick={() => pick(r)}
                            >
                              {r.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        <main className="santu-reports-workspace">
          <div className="santu-reports-generic-area">
            <div className="santu-reports-ws-header">
              <h2 className="santu-reports-ws-title">{selected.label}</h2>
              <div className="santu-reports-ws-toolbar">
                <button
                  type="button"
                  className="santu-reports-tb-btn"
                  title="Refresh"
                  onClick={() => void refetch()}
                >
                  🔄
                </button>
                <button
                  type="button"
                  className="santu-reports-tb-btn"
                  title="Export CSV"
                  disabled={exporting}
                  onClick={() => {
                    setExporting(true);
                    void downloadReportCsv(selected.id, filters).finally(() => setExporting(false));
                  }}
                >
                  📗
                </button>
                <button
                  type="button"
                  className="santu-reports-tb-btn"
                  title="Print"
                  onClick={() => window.print()}
                >
                  🖨
                </button>
              </div>
            </div>

            <div className="santu-reports-filters">
              <label>
                From{' '}
                <input
                  type="date"
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
              <label>
                To{' '}
                <input
                  type="date"
                  value={to}
                  onChange={(e) => {
                    setTo(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
            </div>

            <div className="santu-reports-table-area">
              {isLoading ? (
                <div className="santu-reports-empty">Loading…</div>
              ) : isError || !data ? (
                <div className="santu-reports-empty">Could not load this report.</div>
              ) : filteredRows.length === 0 ? (
                <div className="santu-reports-empty">
                  {search ? 'Kuch nahi mila.' : 'Is date range me koi data nahi hai.'}
                </div>
              ) : (
                <>
                  <div className="santu-reports-table-toolbar">
                    <input
                      type="text"
                      className="form-control santu-reports-table-search"
                      placeholder="Search in report..."
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setPage(1);
                      }}
                    />
                    <span className="santu-reports-row-count">
                      {filteredRows.length} row{filteredRows.length === 1 ? '' : 's'}
                    </span>
                  </div>

                  <div className="santu-reports-table-wrap">
                    <table className="santu-reports-table">
                      <thead>
                        <tr>
                          {data.columns.map((c) => (
                            <th key={c.key} className={c.align === 'right' ? 'num' : ''}>
                              {c.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pageRows.map((row, i) => (
                          <tr key={i}>
                            {data.columns.map((c) => (
                              <td key={c.key} className={c.align === 'right' ? 'num' : ''}>
                                {formatCell(row[c.key] ?? null, c)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                      {data.totals && (
                        <tfoot>
                          <tr>
                            {data.columns.map((c, i) => (
                              <td key={c.key} className={c.align === 'right' ? 'num' : ''}>
                                {i === 0
                                  ? 'Total'
                                  : data.totals![c.key] !== undefined
                                    ? formatCell(data.totals![c.key]!, c)
                                    : ''}
                              </td>
                            ))}
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>

                  {totalPages > 1 && (
                    <div className="santu-sale-txn-footer">
                      <span>
                        Page {page} of {totalPages}
                      </span>
                      <div>
                        <button
                          type="button"
                          className="santu-reports-tb-btn"
                          disabled={page <= 1}
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                        >
                          ‹ Previous
                        </button>
                        <button
                          type="button"
                          className="santu-reports-tb-btn"
                          disabled={page >= totalPages}
                          onClick={() => setPage((p) => p + 1)}
                        >
                          Next ›
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
