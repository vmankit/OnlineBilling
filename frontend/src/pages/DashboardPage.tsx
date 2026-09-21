import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDashboard } from '@/services/sales';
import { useReport } from '@/services/reports';
import { useStockSummary } from '@/services/catalog';
import { SalesChart } from '@/features/dashboard/SalesChart';

/**
 * Home.
 *
 * Markup and class names come from the shop's earlier `santu_dashboard.js`,
 * so `styles/santu/santu_dashboard.css` styles this screen unchanged. Every
 * figure is read from the API: the month total, the change percentage and
 * the chart line were all hardcoded here once, so the screen reported money
 * the shop had not taken.
 */

const RANGES = ['This Month', 'This Week', 'Today', 'This Year'] as const;
type Range = (typeof RANGES)[number];

const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The chosen window, plus the equal window before it, so the change compares like with like. */
function rangesFor(range: Range): {
  current: { from: string; to: string };
  previous: { from: string; to: string };
} {
  const today = new Date();
  const start = new Date(today);

  if (range === 'This Week') start.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  if (range === 'This Month') start.setDate(1);
  if (range === 'This Year') start.setMonth(0, 1);

  const spanDays = Math.max(1, Math.round((today.getTime() - start.getTime()) / 86_400_000) + 1);
  const prevTo = new Date(start);
  prevTo.setDate(start.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevTo.getDate() - (spanDays - 1));

  return {
    current: { from: iso(start), to: iso(today) },
    previous: { from: iso(prevFrom), to: iso(prevTo) },
  };
}

const money = (value: number): string =>
  Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Point {
  day: string;
  total: number;
}

export function DashboardPage(): JSX.Element {
  const navigate = useNavigate();
  const [range, setRange] = useState<Range>('This Month');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // A dropdown that only closes by picking something traps the reader: on a
  // counter iPad the obvious move is to tap away from it.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent): void => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const { current, previous } = rangesFor(range);
  const { data, isLoading, isError, refetch } = useDashboard();
  const currentSales = useReport('daily-sales', current);
  const previousSales = useReport('daily-sales', previous);
  const { data: stock } = useStockSummary();

  // The daily-sales report names the money column "sales".
  const sumOf = (rows: Array<Record<string, unknown>> | undefined): number =>
    (rows ?? []).reduce((sum, r) => sum + (Number(r.sales) || 0), 0);

  // The report lists the newest day first; a chart has to read left to right.
  const trend = useMemo<Point[]>(
    () =>
      (currentSales.data?.rows ?? [])
        .map((r) => ({ day: String(r.day ?? ''), total: Number(r.sales) || 0 }))
        .sort((a, b) => a.day.localeCompare(b.day)),
    [currentSales.data],
  );

  const total = sumOf(currentSales.data?.rows);
  const before = sumOf(previousSales.data?.rows);
  // With nothing to compare against, a percentage would be meaningless (and
  // dividing by zero gives Infinity), so the period is named instead.
  const pct = before > 0 ? ((total - before) / before) * 100 : null;
  const changeLabel =
    pct !== null
      ? `${pct >= 0 ? '↗' : '↘'} ${Math.abs(pct).toFixed(1)}%`
      : total > 0
        ? 'Pichhli baar kuch nahi bika'
        : null;

  if (isLoading) {
    return <div className="santu-dash-loading">Loading...</div>;
  }

  if (isError || !data) {
    return (
      <div className="santu-dash-error">
        Could not load the dashboard.
        <button type="button" onClick={() => void refetch()}>
          Try again
        </button>
      </div>
    );
  }

  const reports: Array<[string, string]> = [
    ['Sale Report', '/reports'],
    ['Stock Summary', '/items'],
    ['Parties', '/parties'],
    ['Printer Settings', '/invoice-templates'],
  ];

  return (
    <div className="santu-dash">
      <div className="santu-dash-layout">
        <div className="santu-dash-main">
          <div className="santu-dash-vy-row santu-dash-vy-row-single">
            <div
              className="santu-dash-vy-card"
              role="button"
              tabIndex={0}
              onClick={() => navigate('/parties')}
            >
              <div className="santu-dash-vy-card-top">
                <div className="santu-dash-vy-card-data">
                  <div className="santu-dash-vy-card-label">Total Receivable</div>
                  <div className="santu-dash-vy-card-amount santu-figures">
                    ₹ {money(data.receivables.outstanding)}
                  </div>
                </div>
                <div className="santu-dash-vy-card-icon santu-tone-good">₹</div>
              </div>
              <div className="santu-dash-vy-card-sub">
                {data.receivables.customers > 0 ? (
                  <>
                    From <span className="santu-dash-party-count-num">{data.receivables.customers}</span>{' '}
                    {data.receivables.customers === 1 ? 'Party' : 'Parties'}
                  </>
                ) : (
                  "You don't have any pending amount to be received."
                )}
              </div>
            </div>
          </div>

          <div className="santu-dash-section santu-dash-vy-chart-card">
            <div className="santu-dash-vy-chart-head">
              <div>
                <div className="santu-dash-section-title santu-dash-sale-link">Total Sale</div>
                <div className="santu-dash-vy-chart-amount-row">
                  <div className="santu-dash-vy-chart-amount santu-figures santu-dash-sale-link">
                    ₹ {money(total)}
                  </div>
                  {changeLabel && (
                    <div
                      className={`santu-dash-vy-chart-pct ${
                        pct === null ? 'is-same' : pct > 0 ? 'is-up' : pct < 0 ? 'is-down' : 'is-same'
                      }`}
                      title={`vs ${previous.from} – ${previous.to}`}
                    >
                      {changeLabel}
                    </div>
                  )}
                </div>
              </div>
              <div className="santu-dash-vy-chart-dropdown" ref={menuRef}>
                <button
                  type="button"
                  className="santu-dash-vy-chart-badge"
                  onClick={() => setMenuOpen((open) => !open)}
                >
                  <span className="santu-dash-vy-chart-range-label">{range}</span>
                  <span>▾</span>
                </button>
                {menuOpen && (
                  <div className="santu-dash-vy-chart-menu">
                    {RANGES.map((r) => (
                      <div
                        key={r}
                        className="santu-dash-vy-chart-menu-item"
                        onClick={() => {
                          setRange(r);
                          setMenuOpen(false);
                        }}
                      >
                        {r}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="santu-dash-chart">
              {currentSales.isLoading ? (
                <div className="santu-dash-chart-empty">Loading chart…</div>
              ) : trend.length === 0 ? (
                <div className="santu-dash-chart-empty">No sales recorded for this period.</div>
              ) : (
                <SalesChart points={trend} />
              )}
            </div>
          </div>

          <div className="santu-dash-reports-section">
            <div className="santu-dash-section-head">
              <div className="santu-dash-section-title santu-dash-section-kicker">Most Used Reports</div>
              <button type="button" className="santu-dash-view-all" onClick={() => navigate('/reports')}>
                View All
              </button>
            </div>
            <div className="santu-dash-reports-row">
              {reports.map(([label, to]) => (
                <div
                  key={label}
                  className="santu-dash-report-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(to)}
                >
                  <span>{label}</span>
                  <span className="santu-dash-report-arrow">›</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <aside className="santu-dash-widgets">
          <div className="santu-dash-widget-rail">
            <div className="santu-dash-widget-list">
              <div
                className="santu-dash-w-card"
                role="button"
                tabIndex={0}
                onClick={() => navigate('/items?low=1')}
              >
                <div className="santu-dash-w-top">
                  <div className="santu-dash-w-title">Low Stock</div>
                  <div className="santu-dash-w-period">As of today</div>
                </div>
                <div className="santu-dash-w-value">
                  {stock?.low_count ?? 0} <span className="santu-dash-w-unit">running low</span>
                </div>
                {stock?.critical_count ? (
                  <div className="santu-dash-w-subline">
                    <span className="santu-dash-w-chip is-critical">{stock.critical_count} critical</span>
                  </div>
                ) : null}
              </div>

              <div className="santu-dash-w-card" role="button" tabIndex={0} onClick={() => navigate('/items')}>
                <div className="santu-dash-w-top">
                  <div className="santu-dash-w-title">Stock Value</div>
                  <div className="santu-dash-w-period">At cost</div>
                </div>
                <div className="santu-dash-w-value">₹ {money(stock?.stock_value ?? 0)}</div>
                <div className="santu-dash-w-subline">
                  <span className="santu-dash-w-unit">{stock?.items ?? 0} items</span>
                </div>
              </div>

              <div className="santu-dash-w-card" role="button" tabIndex={0} onClick={() => navigate('/sales')}>
                <div className="santu-dash-w-top">
                  <div className="santu-dash-w-title">Aaj ka Kaam</div>
                  <div className="santu-dash-w-period">Today</div>
                </div>
                <div className="santu-dash-w-value">
                  {data.today.bills} <span className="santu-dash-w-unit">bills</span>
                </div>
                <div className="santu-dash-w-subline">
                  <span className="santu-dash-w-unit">
                    ₹ {money(data.today.sales)} · ₹ {money(data.today.collected)} collected
                  </span>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
