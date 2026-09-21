import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Search,
  X,
  SlidersHorizontal,
  History,
  AlertTriangle,
  Package,
  TrendingUp,
  ArrowDownRight,
  ArrowUpRight,
} from 'lucide-react';
import { Badge, Card, Skeleton } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FieldError, Input, Label, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useAdjustStock, useStock, useStockLedger, type StockRow } from '@/services/operations';
import { useUnits, useStockSummary } from '@/services/catalog';
import { useDebounced } from '@/hooks/useDebounced';
import { useAuth } from '@/features/auth/AuthProvider';
import { ApiError } from '@/lib/api';
import { cn, formatDateTime, formatQty } from '@/lib/utils';

const TXN_LABELS: Record<string, { label: string; tone: 'green' | 'red' | 'blue' | 'amber' | 'slate' }> = {
  OPENING: { label: 'Opening', tone: 'slate' },
  SALE: { label: 'Sale', tone: 'red' },
  PURCHASE: { label: 'Purchase', tone: 'green' },
  SALES_RETURN: { label: 'Sales Return', tone: 'green' },
  PURCHASE_RETURN: { label: 'Purchase Return', tone: 'red' },
  ADJUSTMENT: { label: 'Adjustment', tone: 'amber' },
  TRANSFER_IN: { label: 'Transfer In', tone: 'blue' },
  TRANSFER_OUT: { label: 'Transfer Out', tone: 'blue' },
  CANCELLATION: { label: 'Cancellation', tone: 'slate' },
};

const money = (value: number): string =>
  `₹ ${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export function StockPage(): JSX.Element {
  const { can } = useAuth();
  const [tab, setTab] = useState<'position' | 'ledger'>('position');
  const [search, setSearch] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [adjusting, setAdjusting] = useState<StockRow | null>(null);
  const [ledgerFor, setLedgerFor] = useState<StockRow | null>(null);

  const debounced = useDebounced(search, 250);
  const stock = useStock({ q: debounced, lowStockOnly, page });
  const ledger = useStockLedger({
    variantId: ledgerFor?.variant_id,
    page: tab === 'ledger' ? page : 1,
  });
  const { data: summary } = useStockSummary();

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      {/* ----------------- TOP HEADER BAR ----------------- */}
      <div className="border-b border-slate-200 bg-white px-4 sm:px-8 py-4 mb-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/20 p-2 shadow-xs">
              <img src="/icons/items/item_adj.svg" alt="Stock" className="h-6 w-6 object-contain" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <Link
                  to="/items"
                  className="text-xs font-bold text-slate-500 hover:text-blue-600 transition-colors flex items-center gap-1"
                >
                  <img src="/icons/items/Items.svg" alt="" className="h-3.5 w-3.5" />
                  <span>Items</span>
                </Link>
                <span className="text-slate-300 font-bold">/</span>
                <h1 className="text-lg font-bold text-slate-900 tracking-tight">
                  Stock Adjust & Ledger
                </h1>
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700 ring-1 ring-amber-200">
                  Inventory Audit
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Live inventory stock position and chronological movement audit trail (In / Out / Adjustments)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/items"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs shadow-2xs transition-colors"
            >
              <img src="/icons/items/ItemsListIcon.svg" alt="" className="h-4 w-4 object-contain" />
              <span>Stock Summary</span>
            </Link>

            <Link
              to="/import-items"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs shadow-2xs transition-colors"
            >
              <img src="/icons/items/bulk_update_item_icon.svg" alt="" className="h-4 w-4 object-contain" />
              <span>Update In Bulk</span>
            </Link>
          </div>
        </div>
      </div>

      <div className="px-4 pb-12 sm:px-8 space-y-5">
        {/* ----------------- 3 EXECUTIVE KPI SUMMARY CARDS ----------------- */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* Total In Stock Card */}
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold tracking-wider uppercase text-slate-500">Total Tracked Stock</p>
              <h3 className="text-2xl font-extrabold text-slate-900 mt-1">
                {summary ? Number(summary.total_qty || 0).toLocaleString('en-IN') : '—'}{' '}
                <span className="text-xs font-bold text-slate-500">Units</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Across {summary?.items ?? '—'} products in catalogue
              </p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 border border-blue-100 text-blue-600">
              <Package className="h-6 w-6" />
            </div>
          </div>

          {/* Stock Valuation Card */}
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold tracking-wider uppercase text-slate-500">Stock Valuation (At Cost)</p>
              <h3 className="text-2xl font-extrabold text-slate-900 mt-1">
                {summary ? money(summary.stock_value) : '—'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Retail potential: {summary ? money(summary.sale_value) : '—'}
              </p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 border border-emerald-100 text-emerald-600">
              <TrendingUp className="h-6 w-6" />
            </div>
          </div>

          {/* Low Stock Alerts Card (interactive filter toggle) */}
          <div
            onClick={() => {
              setLowStockOnly((v) => !v);
              setTab('position');
              setPage(1);
            }}
            className={cn(
              'rounded-2xl border p-4 shadow-xs flex items-center justify-between cursor-pointer transition-all',
              lowStockOnly
                ? 'border-amber-400 bg-amber-50/70 ring-2 ring-amber-300'
                : 'border-slate-200/80 bg-white hover:border-amber-300',
            )}
            title="Click to toggle low stock filter"
          >
            <div>
              <div className="flex items-center gap-1.5">
                <p className="text-[11px] font-bold tracking-wider uppercase text-amber-700">Low Stock Alert</p>
                {lowStockOnly && (
                  <span className="rounded-full bg-amber-200/80 px-1.5 py-0.2 text-[9px] font-bold text-amber-900">
                    Active Filter
                  </span>
                )}
              </div>
              <h3 className="text-2xl font-extrabold text-amber-600 mt-1">
                {summary ? summary.low_count : '—'}{' '}
                <span className="text-xs font-bold text-amber-700">Items</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {lowStockOnly ? 'Click to show all products' : 'Click to filter only low stock items'}
              </p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 border border-amber-200 text-amber-600">
              <AlertTriangle className="h-6 w-6" />
            </div>
          </div>
        </div>

        {/* ----------------- TABS & SEARCH TOOLBAR ----------------- */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200/80 shadow-xs">
          {/* Tab Switcher */}
          <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100/80 p-1">
            <button
              onClick={() => {
                setTab('position');
                setPage(1);
              }}
              className={cn(
                'rounded-lg px-4 py-2 text-xs font-bold transition-all flex items-center gap-2 cursor-pointer',
                tab === 'position'
                  ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-200'
                  : 'text-slate-600 hover:text-slate-900',
              )}
            >
              <img src="/icons/items/ItemsListIcon.svg" alt="" className="h-4 w-4 object-contain" />
              <span>Stock Position</span>
            </button>
            <button
              onClick={() => {
                setTab('ledger');
                setPage(1);
              }}
              className={cn(
                'rounded-lg px-4 py-2 text-xs font-bold transition-all flex items-center gap-2 cursor-pointer',
                tab === 'ledger'
                  ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-200'
                  : 'text-slate-600 hover:text-slate-900',
              )}
            >
              <img src="/icons/items/date_item_adjustment.svg" alt="" className="h-4 w-4 object-contain" />
              <span>Movement Ledger</span>
            </button>
          </div>

          {/* Search & Action Controls */}
          <div className="flex flex-wrap items-center gap-2 flex-1 justify-end">
            {tab === 'position' && (
              <>
                <div className="relative min-w-[240px] max-w-sm flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Search item name, SKU or barcode…"
                    className="w-full h-9 pl-9 pr-8 text-xs rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-slate-50 focus:bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none transition-colors text-slate-800 placeholder-slate-400"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearch('');
                        setPage(1);
                      }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setLowStockOnly((v) => !v);
                    setPage(1);
                  }}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer',
                    lowStockOnly
                      ? 'bg-amber-500 text-white border-amber-600 shadow-xs'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 shadow-2xs',
                  )}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  <span>Low Stock Only</span>
                </button>
              </>
            )}

            {tab === 'ledger' && ledgerFor && (
              <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-1.5 text-xs text-blue-900">
                <span className="font-semibold">
                  Filtered by: <span className="font-bold">{ledgerFor.item_name}</span> ({ledgerFor.variant_name})
                </span>
                <button
                  type="button"
                  onClick={() => setLedgerFor(null)}
                  className="rounded-md bg-blue-200/80 px-2 py-0.5 text-[11px] font-bold text-blue-900 hover:bg-blue-300 transition-colors cursor-pointer"
                >
                  Show All Movements
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ----------------- TAB CONTENT ----------------- */}
        {tab === 'position' ? (
          <>
            {stock.isLoading && (
              <Card className="divide-y divide-slate-100 rounded-2xl overflow-hidden border border-slate-200/80">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="p-4 flex items-center justify-between">
                    <div className="space-y-2">
                      <Skeleton className="h-5 w-64" />
                      <Skeleton className="h-4 w-36" />
                    </div>
                    <Skeleton className="h-8 w-28" />
                  </div>
                ))}
              </Card>
            )}

            {stock.data && stock.data.data.length === 0 && (
              <div className="rounded-2xl border border-slate-200/80 bg-white p-12 text-center shadow-xs">
                <img
                  src="/images/items/empty-stock-txn-items.webp"
                  alt="Empty"
                  className="h-36 w-auto mx-auto mb-3 object-contain"
                />
                <h4 className="text-base font-bold text-slate-800">
                  {lowStockOnly ? 'No items below minimum stock level' : 'No stock records found'}
                </h4>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  {lowStockOnly
                    ? 'All tracked items in your inventory currently meet or exceed their minimum required quantity.'
                    : 'Try clearing your search query or add items to your catalogue.'}
                </p>
                {lowStockOnly && (
                  <button
                    type="button"
                    onClick={() => setLowStockOnly(false)}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 shadow-xs cursor-pointer"
                  >
                    View All Stock Items
                  </button>
                )}
              </div>
            )}

            {stock.data && stock.data.data.length > 0 && (
              <div className="rounded-2xl border border-slate-200/80 bg-white shadow-xs overflow-hidden">
                {/* Table Header */}
                <div className="grid grid-cols-12 gap-3 border-b border-slate-200 bg-slate-50/80 px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <div className="col-span-5">Product & SKU</div>
                  <div className="col-span-2 text-right">In Stock</div>
                  <div className="col-span-2 text-right">Stock Value (Cost)</div>
                  <div className="col-span-3 text-right">Actions</div>
                </div>

                {/* Table Rows */}
                <div className="divide-y divide-slate-100">
                  {stock.data.data.map((row) => {
                    const low = Number(row.stock) <= Number(row.min_stock);
                    const zero = Number(row.stock) === 0;

                    return (
                      <div
                        key={row.variant_id}
                        className="grid grid-cols-12 gap-3 items-center px-5 py-3.5 hover:bg-slate-50/80 transition-colors"
                      >
                        {/* Product info */}
                        <div className="col-span-5 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-semibold text-slate-900">{row.item_name}</p>
                            {low && (
                              <span className="rounded-full bg-amber-50 px-2 py-0.2 text-[10px] font-bold text-amber-700 ring-1 ring-amber-300">
                                {zero ? 'Out of Stock' : 'Low Stock'}
                              </span>
                            )}
                          </div>
                          <p className="truncate text-xs text-slate-500 mt-0.5">
                            {row.variant_name} · <span className="tabular-nums text-slate-600 font-medium">{row.sku}</span>
                          </p>
                        </div>

                        {/* In stock */}
                        <div className="col-span-2 text-right">
                          <p
                            className={cn(
                              'text-sm font-extrabold',
                              zero
                                ? 'text-rose-600'
                                : low
                                ? 'text-amber-600'
                                : 'text-slate-900',
                            )}
                          >
                            {formatQty(row.stock)}{' '}
                            <span className="text-xs font-normal text-slate-500">{row.stock_unit}</span>
                          </p>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            Min: {formatQty(row.min_stock)} {row.stock_unit}
                          </p>
                        </div>

                        {/* Stock value */}
                        <div className="col-span-2 text-right">
                          <p className="text-sm font-bold text-slate-900">{money(row.stock_value)}</p>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            @{money(row.purchase_price)}/unit
                          </p>
                        </div>

                        {/* Actions */}
                        <div className="col-span-3 flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setLedgerFor(row);
                              setTab('ledger');
                              setPage(1);
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-blue-600 transition-colors shadow-2xs cursor-pointer"
                            title="View Stock Movement Ledger"
                          >
                            <History className="h-3.5 w-3.5 text-blue-600" />
                            <span>Ledger</span>
                          </button>

                          {can('stock:adjust') && (
                            <button
                              type="button"
                              onClick={() => setAdjusting(row)}
                              className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50/70 px-2.5 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-100 transition-colors shadow-2xs cursor-pointer"
                              title="Correct or Adjust Current Stock"
                            >
                              <img src="/icons/items/item_adj.svg" alt="" className="h-3.5 w-3.5" />
                              <span>Adjust</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Pagination */}
                <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50">
                  <Pager
                    page={stock.data.page}
                    totalPages={stock.data.totalPages}
                    total={stock.data.total}
                    noun="item"
                    onChange={setPage}
                  />
                </div>
              </div>
            )}
          </>
        ) : (
          /* ----------------- LEDGER TAB ----------------- */
          <div className="rounded-2xl border border-slate-200/80 bg-white shadow-xs overflow-hidden">
            <div className="border-b border-slate-200 px-5 py-3.5 flex items-center justify-between bg-slate-50/80">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Chronological Movement Ledger</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Every inventory movement, purchase inward, sale deduction, and manual correction.
                </p>
              </div>
              {ledger.data && (
                <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-bold text-blue-700 ring-1 ring-blue-200">
                  {ledger.data.total} Total Movements
                </span>
              )}
            </div>

            {ledger.isLoading && (
              <div className="divide-y divide-slate-100 p-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="py-3 flex items-center justify-between">
                    <Skeleton className="h-5 w-72" />
                    <Skeleton className="h-5 w-24" />
                  </div>
                ))}
              </div>
            )}

            {ledger.data && ledger.data.data.length === 0 && (
              <div className="p-12 text-center">
                <img
                  src="/images/items/empty-stock-txn.webp"
                  alt="Empty Ledger"
                  className="h-36 w-auto mx-auto mb-3 object-contain"
                />
                <h4 className="text-base font-bold text-slate-800">No stock movements recorded yet</h4>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  Sales, purchases, returns, and inventory corrections will automatically record audit lines here.
                </p>
              </div>
            )}

            {ledger.data && ledger.data.data.length > 0 && (
              <>
                <div className="divide-y divide-slate-100">
                  {ledger.data.data.map((row) => {
                    const meta = TXN_LABELS[row.txn_type] ?? { label: row.txn_type, tone: 'slate' as const };
                    const inward = Number(row.quantity) > 0;

                    return (
                      <div
                        key={row.id}
                        className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 hover:bg-slate-50/80 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-[240px] flex-1">
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">
                              {row.item_name} · <span className="font-normal text-slate-600">{row.variant_name}</span>
                            </p>
                            <p className="truncate text-xs text-slate-500 mt-0.5">
                              {formatDateTime(row.created_at)}
                              {row.user_name ? ` · By ${row.user_name}` : ''}
                              {row.notes ? ` · "${row.notes}"` : ''}
                            </p>
                          </div>
                        </div>

                        {/* Movement Quantity */}
                        <div className="shrink-0 text-right min-w-[120px]">
                          <p
                            className={cn(
                              'text-sm font-extrabold flex items-center justify-end gap-1',
                              inward ? 'text-emerald-600' : 'text-rose-600',
                            )}
                          >
                            {inward ? (
                              <ArrowUpRight className="h-4 w-4 stroke-[2.5]" />
                            ) : (
                              <ArrowDownRight className="h-4 w-4 stroke-[2.5]" />
                            )}
                            <span>
                              {inward ? '+' : ''}
                              {formatQty(row.quantity)} {row.stock_unit}
                            </span>
                          </p>
                          {row.entered_unit && row.entered_unit !== row.stock_unit && (
                            <p className="text-[11px] text-slate-400">
                              Entered {formatQty(row.entered_qty)} {row.entered_unit}
                            </p>
                          )}
                        </div>

                        {/* Balance After */}
                        <div className="w-28 shrink-0 text-right border-l border-slate-100 pl-3">
                          <p className="text-sm font-extrabold text-slate-900">
                            {formatQty(row.balance_after)} {row.stock_unit}
                          </p>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Balance After</p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50">
                  <Pager
                    page={ledger.data.page}
                    totalPages={ledger.data.totalPages}
                    total={ledger.data.total}
                    noun="movement"
                    onChange={setPage}
                  />
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Modernized Adjust Stock Modal */}
      {adjusting && <AdjustStockModal row={adjusting} onClose={() => setAdjusting(null)} />}
    </div>
  );
}

function Pager({
  page,
  totalPages,
  total,
  noun,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  noun: string;
  onChange: (updater: (p: number) => number) => void;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4">
      <p className="text-xs font-semibold text-slate-500">
        Showing {total} {noun}
        {total === 1 ? '' : 's'} · Page {page} of {totalPages}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onChange((p) => Math.max(1, p - 1))}
          disabled={page <= 1}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs cursor-pointer"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => onChange((p) => p + 1)}
          disabled={page >= totalPages}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs cursor-pointer"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function AdjustStockModal({ row, onClose }: { row: StockRow; onClose: () => void }): JSX.Element {
  const toast = useToast();
  const adjust = useAdjustStock();
  const units = useUnits();

  const [direction, setDirection] = useState<'add' | 'remove'>('remove');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState(row.stock_unit);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const dimension = units.data?.find((u) => u.code === row.stock_unit)?.dimension;
  const unitOptions = units.data?.filter((u) => u.dimension === dimension) ?? [];

  // Calculate live preview of projected balance
  const numQty = Number(quantity) || 0;
  const currentStock = Number(row.stock) || 0;
  const projectedBalance = direction === 'add' ? currentStock + numQty : currentStock - numQty;

  const quickReasons = [
    'Physical Audit Correction',
    'Damaged / Broken in Shop',
    'Display / Shelf Sample',
    'Returned by Customer',
    'Returned to Supplier',
    'Defective Stock Written-Off',
  ];

  const submit = async (): Promise<void> => {
    setError('');
    const value = Number(quantity);
    if (!value || value <= 0) return setError('Enter a quantity greater than zero.');
    if (reason.trim().length < 3)
      return setError('Please specify a valid reason for this stock adjustment.');

    try {
      const result = await adjust.mutateAsync({
        variant_id: row.variant_id,
        quantity: direction === 'add' ? value : -value,
        unit,
        reason: reason.trim(),
      });
      toast.success(
        'Stock Adjusted Successfully',
        `${row.item_name} balance is now ${formatQty(result.balance)} ${result.stockUnit}.`,
      );
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to adjust stock.');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Adjust Inventory Stock"
      description={`${row.item_name} · ${row.variant_name}`}
      footer={
        <div className="flex justify-end gap-2 w-full pt-2">
          <Button variant="secondary" onClick={onClose} disabled={adjust.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            loading={adjust.isPending}
            className={cn(
              'text-white font-bold',
              direction === 'add' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700',
            )}
          >
            Confirm {direction === 'add' ? 'Addition' : 'Reduction'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Item Banner with Current Stock */}
        <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 border border-slate-200/80">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
              <img src="/icons/items/item_adj.svg" alt="" className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-800">{row.item_name}</p>
              <p className="text-[11px] text-slate-500 tabular-nums">{row.sku}</p>
            </div>
          </div>
          <div className="text-right">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Current Stock</span>
            <span className="text-sm font-extrabold text-slate-900">
              {formatQty(row.stock)} {row.stock_unit}
            </span>
          </div>
        </div>

        {/* Direction Switcher (Add vs Reduce) */}
        <div>
          <Label>Adjustment Action</Label>
          <div className="grid grid-cols-2 gap-2 mt-1">
            <button
              type="button"
              onClick={() => setDirection('add')}
              className={cn(
                'flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer',
                direction === 'add'
                  ? 'bg-emerald-50 border-emerald-500 text-emerald-700 shadow-xs'
                  : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100',
              )}
            >
              <ArrowUpRight className="h-4 w-4" />
              <span>Add Stock (+)</span>
            </button>
            <button
              type="button"
              onClick={() => setDirection('remove')}
              className={cn(
                'flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer',
                direction === 'remove'
                  ? 'bg-rose-50 border-rose-500 text-rose-700 shadow-xs'
                  : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100',
              )}
            >
              <ArrowDownRight className="h-4 w-4" />
              <span>Reduce Stock (-)</span>
            </button>
          </div>
        </div>

        {/* Quantity and Unit Input */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="adj-qty" required>
              Quantity to {direction === 'add' ? 'Add' : 'Reduce'}
            </Label>
            <Input
              id="adj-qty"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              inputMode="decimal"
              placeholder="e.g. 5"
              autoFocus
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="adj-unit">Unit</Label>
            <Select
              id="adj-unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="mt-1"
            >
              {unitOptions.length > 0 ? (
                unitOptions.map((u) => (
                  <option key={u.code} value={u.code}>
                    {u.code} ({u.name})
                  </option>
                ))
              ) : (
                <option value={row.stock_unit}>{row.stock_unit}</option>
              )}
            </Select>
          </div>
        </div>

        {/* Projected Balance Callout */}
        {numQty > 0 && (
          <div className="flex items-center justify-between rounded-xl bg-blue-50/80 p-2.5 border border-blue-200 text-xs">
            <span className="font-semibold text-blue-900">Projected New Balance:</span>
            <span className="font-extrabold text-blue-700">
              {formatQty(currentStock)} {row.stock_unit}{' '}
              {direction === 'add' ? `+ ${numQty}` : `- ${numQty}`} ={' '}
              <span className={projectedBalance < 0 ? 'text-rose-600' : 'text-blue-900'}>
                {formatQty(projectedBalance)} {row.stock_unit}
              </span>
            </span>
          </div>
        )}

        {/* Reason Input with Quick Chips */}
        <div>
          <Label htmlFor="adj-reason" required>
            Adjustment Reason
          </Label>
          <Input
            id="adj-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Damaged during unloading, stock audit"
            className="mt-1"
          />

          <div className="flex flex-wrap gap-1.5 mt-2">
            {quickReasons.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className="rounded-lg bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-200 hover:text-slate-900 transition-colors cursor-pointer"
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {error && <FieldError>{error}</FieldError>}
      </div>
    </Modal>
  );
}
