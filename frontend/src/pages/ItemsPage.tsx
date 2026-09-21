import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, RefreshCw, X, AlertTriangle } from 'lucide-react';
import { useItems, useCategories, useStockSummary, useUnits } from '@/services/catalog';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { useDebounced } from '@/hooks/useDebounced';
import { ItemFormModal } from '@/features/items/ItemFormModal';
import type { Item } from '@/types';

type SortKey =
  | 'item_name' | 'qty' | 'cost_rate' | 'sale_rate'
  | 'stock_value' | 'hsn_code' | 'brand' | 'barcodes';

const COLUMNS: Array<[SortKey, string, 'left' | 'right']> = [
  ['item_name', 'ITEM NAME', 'left'],
  ['qty', 'IN STOCK', 'right'],
  ['cost_rate', 'PURCHASE RATE', 'right'],
  ['sale_rate', 'SELLING PRICE', 'right'],
  ['stock_value', 'STOCK VALUE', 'right'],
  ['hsn_code', 'HSN', 'left'],
  ['brand', 'BRAND', 'left'],
  ['barcodes', 'BARCODE', 'left'],
];

interface Row {
  id: string;
  variantId: string;
  rawItem: Item;
  item_name: string;
  qty: number;
  uom: string;
  cost_rate: number;
  sale_rate: number;
  stock_value: number;
  hsn_code: string;
  brand: string;
  barcodes: string;
  low: boolean;
}

const money = (value: number): string =>
  `₹ ${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const count = (value: number): string =>
  Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

export function ItemsPage(): JSX.Element {
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [params, setParams] = useSearchParams();
  const [onlyLow, setOnlyLow] = useState(params.get('low') === '1');
  const [sort, setSort] = useState<SortKey>('item_name');
  const [dir, setDir] = useState<1 | -1>(1);
  const [stockFirst, setStockFirst] = useState(true);
  const [pricedOnly, setPricedOnly] = useState(true);
  const [, setPage] = useState(1);
  const [editingItem, setEditingItem] = useState<Item | 'new' | null>(null);

  const debouncedSearch = useDebounced(search, 250);
  const { data: serverItems, refetch, isFetching } = useItems({
    q: debouncedSearch,
    categoryId: categoryId || undefined,
    lowStockOnly: onlyLow,
    pricedOnly,
    page: 1,
    pageSize: 2000,
  });
  const { data: categories } = useCategories();
  const { data: summary } = useStockSummary();
  const { data: units } = useUnits();
  const queryClient = useQueryClient();
  const toast = useToast();

  const changeUnit = async (variantId: string, name: string, unit: string): Promise<void> => {
    try {
      await api.patch(`/api/items/variants/${variantId}/price`, { unit });
      void queryClient.invalidateQueries({ queryKey: ['items'] });
      toast.success('Unit changed', `${name} → ${unit}`);
    } catch (err) {
      toast.error('Unit not changed', err instanceof ApiError ? err.message : undefined);
    }
  };

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const item of serverItems?.data ?? []) {
      for (const variant of item.variants ?? []) {
        const qty = Number(variant.stock) || 0;
        const packSize = Number(variant.pack_size) || 1;
        out.push({
          id: item.id,
          variantId: variant.id,
          rawItem: item,
          item_name: `${item.name}${variant.name !== 'Standard' ? ` [${variant.name}]` : ''}`,
          qty,
          uom: variant.pack_unit || item.stock_unit || '',
          cost_rate: Number(variant.purchase_price) || 0,
          sale_rate: Number(variant.selling_price) || 0,
          stock_value: (qty * (Number(variant.purchase_price) || 0)) / packSize,
          hsn_code: item.hsn_code ?? '',
          brand: item.brand_name ?? '',
          barcodes: variant.barcode ?? '',
          low: qty <= Number(variant.min_stock || 0),
        });
      }
    }
    return out;
  }, [serverItems]);

  const sorted = useMemo(() => {
    const compare = (a: Row, b: Row): number => {
      const x = a[sort];
      const y = b[sort];
      if (typeof x === 'string' || typeof y === 'string') {
        return dir * String(x ?? '').localeCompare(String(y ?? ''));
      }
      return dir * ((Number(x) || 0) - (Number(y) || 0));
    };
    return rows.slice().sort((a, b) => {
      if (stockFirst) {
        const ax = a.qty > 0 ? 0 : 1;
        const bx = b.qty > 0 ? 0 : 1;
        if (ax !== bx) return ax - bx;
      }
      return compare(a, b);
    });
  }, [rows, sort, dir, stockFirst]);

  const sortBy = (key: SortKey): void => {
    setStockFirst(false);
    if (key === sort) setDir((d) => (d === 1 ? -1 : 1));
    else {
      setSort(key);
      setDir(1);
    }
  };

  const dash = <span className="text-slate-300 font-normal">—</span>;

  return (
    <div className="flex-1 overflow-y-auto bg-[#f8fafc] text-slate-800 text-xs pb-12 select-none">
      {/* ----------------- TOP HEADER BAR ----------------- */}
      <div className="bg-white border-b border-slate-200 px-4 sm:px-6 py-4 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-50 border border-amber-200/80 p-2 flex items-center justify-center shadow-2xs">
              <img src="/icons/items/Items.svg" alt="Items" className="h-6 w-6 object-contain" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-slate-900 tracking-tight">
                  Stock Summary (Items)
                </h1>
                <span className="px-2 py-0.5 rounded-md bg-slate-100 text-[11px] font-semibold text-slate-600 border border-slate-200">
                  {summary?.items ? `${count(summary.items)} Products` : 'Catalog'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-medium">
                Live inventory valuation, pricing, barcode lookup, and low-stock alerts
              </p>
            </div>
          </div>

          {/* Action Buttons: Add Item, Bulk Update, Stock Adjust */}
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              to="/stock"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs shadow-2xs transition-colors cursor-pointer"
            >
              <img src="/icons/items/item_adj.svg" alt="" className="h-4 w-4" />
              <span>Stock Adjust & Ledger</span>
            </Link>

            <Link
              to="/import-items"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs shadow-2xs transition-colors cursor-pointer"
            >
              <img src="/icons/items/bulk_update_item_icon.svg" alt="" className="h-4 w-4" />
              <span>Update In Bulk</span>
            </Link>

            <button
              type="button"
              onClick={() => setEditingItem('new')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#e8453c] hover:bg-[#d13c34] text-white font-bold text-xs shadow-sm transition-all cursor-pointer hover:shadow-md"
            >
              <img src="/icons/items/add_items.svg" alt="" className="h-4 w-4 invert brightness-200" />
              <span>+ Add Item</span>
            </button>
          </div>
        </div>

        {/* ----------------- SUMMARY CARDS ----------------- */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4 pt-3 border-t border-slate-100">
          {/* Card 1: Stock Value */}
          <div className="p-3.5 rounded-xl bg-gradient-to-br from-white to-slate-50 border border-slate-200/80 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Stock Value (at cost)
              </span>
              <span className="h-2 w-2 rounded-full bg-blue-500"></span>
            </div>
            <div className="text-xl font-extrabold text-slate-900 mt-1">
              {money(summary?.stock_value ?? 0)}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {count(summary?.items ?? 0)} items · {count(summary?.total_qty ?? 0)} units in stock
            </div>
          </div>

          {/* Card 2: Sale Value */}
          <div className="p-3.5 rounded-xl bg-gradient-to-br from-white to-slate-50 border border-slate-200/80 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Sale Value (at selling price)
              </span>
              <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
            </div>
            <div className="text-xl font-extrabold text-emerald-700 mt-1">
              {money(summary?.sale_value ?? 0)}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Potential revenue at today's shelf rates
            </div>
          </div>

          {/* Card 3: Running Low */}
          <div
            onClick={() => {
              const next = !onlyLow;
              setOnlyLow(next);
              setParams(next ? { low: '1' } : {}, { replace: true });
              setPage(1);
            }}
            className={`p-3.5 rounded-xl border transition-all cursor-pointer shadow-2xs ${
              onlyLow
                ? 'bg-amber-50 border-amber-300 ring-2 ring-amber-400/40'
                : 'bg-gradient-to-br from-white to-amber-50/40 border-slate-200/80 hover:border-amber-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-amber-800 uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                <span>Running Low</span>
              </span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-200/80 text-amber-900">
                {onlyLow ? 'Filter Active' : 'Click to Filter'}
              </span>
            </div>
            <div className="text-xl font-extrabold text-amber-900 mt-1">
              {count(summary?.low_count ?? 0)} <span className="text-xs font-semibold text-amber-700">Items</span>
            </div>
            <div className="text-[11px] text-amber-700 mt-0.5">
              Items at or below minimum alert level
            </div>
          </div>
        </div>
      </div>

      {/* ----------------- SEARCH & FILTERS BAR ----------------- */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-3 shadow-2xs flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2 flex-1 min-w-[280px]">
            {/* Search Input */}
            <div className="relative flex-1 max-w-md">
              <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search by item name, SKU, brand, or barcode..."
                className="w-full pl-9 pr-8 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-500 font-medium text-slate-900 placeholder:text-slate-400"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setPage(1);
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Category Dropdown */}
            <select
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setPage(1);
              }}
              className="py-2 px-3 text-xs rounded-xl border border-slate-200 bg-slate-50 hover:bg-white font-medium text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-amber-500 cursor-pointer"
            >
              <option value="">All Categories ({categories?.length ?? 0})</option>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3">
            {/* Low Stock Checkbox Toggle */}
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={onlyLow}
                onChange={(e) => {
                  setOnlyLow(e.target.checked);
                  setParams(e.target.checked ? { low: '1' } : {}, { replace: true });
                  setPage(1);
                }}
                className="rounded accent-amber-600 h-4 w-4 cursor-pointer"
              />
              <span>Only Low Stock</span>
            </label>

            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={pricedOnly}
                onChange={(e) => setPricedOnly(e.target.checked)}
                className="rounded accent-emerald-600 h-4 w-4 cursor-pointer"
              />
              <span>Only with price</span>
            </label>

            {/* Refresh Button */}
            <button
              type="button"
              onClick={() => void refetch()}
              title="Refresh stock list"
              className="p-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 transition-colors cursor-pointer"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin text-amber-600' : ''}`} />
            </button>
          </div>
        </div>

        {/* ----------------- DATA TABLE OR EMPTY STATE ----------------- */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          {sorted.length === 0 ? (
            <div className="text-center py-16 px-4 space-y-3">
              <img
                src="/icons/items/empty_item_box.svg"
                alt="No items"
                className="h-28 w-28 mx-auto opacity-80"
              />
              <h3 className="text-base font-bold text-slate-800">
                {isFetching ? 'Loading items catalogue…' : 'No items match your criteria'}
              </h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                {isFetching
                  ? 'Please wait while inventory is retrieved.'
                  : search || categoryId || onlyLow || pricedOnly
                  ? 'Try clearing the search query or category filter.'
                  : 'Add your first hardware or electrical product, or import via Excel.'}
              </p>
              {!isFetching && (
                <div className="pt-2 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingItem('new')}
                    className="px-4 py-2 rounded-xl bg-[#e8453c] hover:bg-[#d13c34] text-white font-bold text-xs shadow-sm cursor-pointer"
                  >
                    + Add New Item
                  </button>
                  <Link
                    to="/import-items"
                    className="px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs cursor-pointer"
                  >
                    Import via Excel
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50/90 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    <th className="py-3 px-3 w-10 text-center">#</th>
                    {COLUMNS.map(([key, label, align]) => (
                      <th
                        key={key}
                        onClick={() => sortBy(key)}
                        className={`py-3 px-3 cursor-pointer select-none hover:text-slate-800 transition-colors ${
                          align === 'right' ? 'text-right' : 'text-left'
                        }`}
                      >
                        <span className="inline-flex items-center gap-1">
                          {label}
                          {sort === key && (
                            <span className="text-amber-600 font-bold">{dir === 1 ? '▲' : '▼'}</span>
                          )}
                        </span>
                      </th>
                    ))}
                    <th className="py-3 px-3 text-right">ACTION</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {sorted.map((r, idx) => (
                    <tr
                      key={r.variantId}
                      className="hover:bg-amber-50/30 transition-colors group cursor-pointer"
                      onClick={() => setEditingItem(r.rawItem)}
                    >
                      <td className="py-2.5 px-3 text-center text-slate-400 tabular-nums text-[11px]">
                        {idx + 1}
                      </td>

                      {/* Item Name */}
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-900 group-hover:text-amber-700 transition-colors">
                          {r.item_name}
                        </div>
                        {r.low && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200/80 mt-0.5">
                            <AlertTriangle className="h-2.5 w-2.5" /> Low Stock
                          </span>
                        )}
                      </td>

                      {/* In Stock */}
                      <td className="py-2.5 px-3 text-right whitespace-nowrap font-semibold">
                        <span className={r.low ? 'text-amber-700 font-bold' : 'text-slate-900'}>
                          {count(r.qty)}
                        </span>{' '}
                        <select
                          value={r.uom}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => void changeUnit(r.variantId, r.item_name, e.target.value)}
                          className="ml-1 cursor-pointer rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] font-semibold text-slate-600 hover:border-amber-400"
                          title="Change unit"
                        >
                          {!units?.some((u) => u.code === r.uom) && <option value={r.uom}>{r.uom}</option>}
                          {units?.map((u) => (
                            <option key={u.code} value={u.code}>{u.code}</option>
                          ))}
                        </select>
                        {r.qty <= 1 && (
                          <span className="ml-1 text-[9px] font-bold bg-rose-100 text-rose-800 px-1 py-0.2 rounded">
                            Critical
                          </span>
                        )}
                      </td>

                      {/* Purchase Rate */}
                      <td className="py-2.5 px-3 text-right whitespace-nowrap text-slate-600">
                        {r.cost_rate ? money(r.cost_rate) : dash}
                      </td>

                      {/* Selling Price */}
                      <td className="py-2.5 px-3 text-right whitespace-nowrap font-bold text-slate-900">
                        {r.sale_rate ? money(r.sale_rate) : dash}
                      </td>

                      {/* Stock Value */}
                      <td className="py-2.5 px-3 text-right whitespace-nowrap font-semibold text-emerald-700">
                        {money(r.stock_value)}
                      </td>

                      {/* HSN */}
                      <td className="py-2.5 px-3 text-slate-500 tabular-nums text-[11px]">
                        {r.hsn_code || dash}
                      </td>

                      {/* Brand */}
                      <td className="py-2.5 px-3 text-slate-600 font-medium">
                        {r.brand || dash}
                      </td>

                      {/* Barcode */}
                      <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap tabular-nums text-[11px]">
                        {r.barcodes ? (
                          <span className="inline-flex items-center gap-1">
                            <img
                              src="/icons/items/default-barcode.svg"
                              alt=""
                              className="h-3.5 w-3.5 opacity-60"
                            />
                            <span>{r.barcodes}</span>
                          </span>
                        ) : (
                          <span className="text-slate-400 italic text-[10px]">no barcode</span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="py-2.5 px-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setEditingItem(r.rawItem)}
                            title="Edit Item"
                            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 transition-colors cursor-pointer"
                          >
                            <img src="/images/items/editIcon.webp" alt="Edit" className="h-3.5 w-3.5" />
                          </button>
                          <Link
                            to="/stock"
                            title="Stock Ledger"
                            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 transition-colors cursor-pointer"
                          >
                            <img src="/icons/items/item_adj.svg" alt="Ledger" className="h-3.5 w-3.5" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

        </div>
      </div>

      {/* Add / Edit Item Modal */}
      {editingItem && (
        <ItemFormModal
          item={editingItem === 'new' ? null : editingItem}
          onClose={() => {
            setEditingItem(null);
            void refetch();
          }}
        />
      )}
    </div>
  );
}
