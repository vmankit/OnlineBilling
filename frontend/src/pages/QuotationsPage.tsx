import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Calendar,
  FileText,
  Minus,
  Plus,
  Printer,
  X,
  Search,
  Check,
  Calculator,
  Percent,
  Lock,
  Edit2,
  Mic,
  MessageSquare,
  List,
} from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { useCustomers, useItems } from '@/services/catalog';
import { useCreateQuotation, useQuotations, fetchForBilling, type BillingLine } from '@/services/quotations';
import { useDebounced } from '@/hooks/useDebounced';
import { cn, formatMoney, formatDate } from '@/lib/utils';
import { usePosCart, type CartLine } from '@/features/pos/usePosCart';
import { CustomerFormModal } from '@/features/customers/CustomerFormModal';
import { PriceChangeModal } from '@/features/pos/PriceChangeModal';
import type { Customer, Item, ItemVariant } from '@/types';
import type { PriceDifference } from '@/services/sales';
import { buildWaLink } from '@/features/whatsapp/whatsapp';

interface EstimateLine {
  key: string;
  variantId: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  variantName: string;
  stockUnit: string;
  packUnit: string;
  availableStock: number;
  quantity: number;
  rate: number;
  discountAmt: number;
}

interface PendingConversion {
  quotationId: string;
  quotationNumber: string;
  customerId: string | null;
  customerName: string;
  billDiscount: number;
  notes: string | null;
  items: BillingLine[];
  differences: PriceDifference[];
}

export function QuotationsPage(): JSX.Element {
  const toast = useToast();
  const navigate = useNavigate();
  const cart = usePosCart();
  const createQuotation = useCreateQuotation();

  // Mode: 'create' matching Image 4 or 'history'
  const [viewMode, setViewMode] = useState<'create' | 'history'>('create');

  // Estimate Tabs matching Image 4 (Estimate #1)
  const [estimateTabs, setEstimateTabs] = useState<string[]>(['Estimate #1']);
  const [activeTab, setActiveTab] = useState<string>('Estimate #1');

  // Estimate form state
  const [lines, setLines] = useState<EstimateLine[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState<string>('');
  const [customerMobile, setCustomerMobile] = useState<string>('');
  const [customerAddress, setCustomerAddress] = useState<string>('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [billDiscount, setBillDiscount] = useState<number>(0);
  const [notes, setNotes] = useState<string>('');
  const [showBreakup, setShowBreakup] = useState(false);
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  const [estimateDate, setEstimateDate] = useState<string>('07/09/2026');
  const [customerModal, setCustomerModal] = useState<{ open: boolean; customer: Customer | null }>({
    open: false,
    customer: null,
  });

  // Search input
  const [search, setSearch] = useState('');
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const customerContainerRef = useRef<HTMLDivElement>(null);

  // History query
  const [historySearch, setHistorySearch] = useState('');
  const debouncedHistory = useDebounced(historySearch, 200);
  const { data: pastQuotes, isLoading: loadingQuotes } = useQuotations({ q: debouncedHistory, page: 1 });
  const [pendingConversion, setPendingConversion] = useState<PendingConversion | null>(null);

  // Item Search
  const debouncedItem = useDebounced(search, 150);
  const { data: itemHits, isLoading: searchingItems } = useItems({ q: debouncedItem, pageSize: 15 });

  // Customer Search
  const debouncedCustomer = useDebounced(customerSearch, 150);
  const { data: customerHits } = useCustomers({ q: debouncedCustomer });

  // Calculations
  const grossSubtotal = lines.reduce((sum, l) => sum + l.quantity * l.rate, 0);
  const totalDiscounts = lines.reduce((sum, l) => sum + l.discountAmt, 0) + billDiscount;
  const grandTotal = Math.max(0, grossSubtotal - totalDiscounts);
  const totalQty = lines.reduce((sum, l) => sum + l.quantity, 0);

  // Outside click listener
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowSearchDropdown(false);
      }
      if (customerContainerRef.current && !customerContainerRef.current.contains(e.target as Node)) {
        setShowCustomerDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const addVariantToEstimate = (item: Item, variant: ItemVariant) => {
    const existing = lines.find((l) => l.variantId === variant.id);
    if (existing) {
      setLines((curr) =>
        curr.map((l) => (l.variantId === variant.id ? { ...l, quantity: l.quantity + 1 } : l)),
      );
    } else {
      const newLine: EstimateLine = {
        key: `est-${variant.id}-${Date.now()}`,
        variantId: variant.id,
        itemId: item.id,
        itemName: item.name,
        itemCode: item.item_code,
        variantName: variant.name,
        stockUnit: item.stock_unit,
        packUnit: variant.pack_unit,
        availableStock: Number(variant.stock) || 0,
        quantity: 1,
        rate: Number(variant.selling_price) || 0,
        discountAmt: 0,
      };
      setLines((curr) => [...curr, newLine]);
    }
    setSearch('');
    setShowSearchDropdown(false);
    searchRef.current?.focus();
    toast.toast({ tone: 'info', title: `Added ${item.name} to Estimate` });
  };

  const handleSaveEstimate = async (andPrint = false) => {
    if (lines.length === 0) {
      toast.error('Estimate is empty', 'Add at least one item before saving.');
      return;
    }
    try {
      const saved = await createQuotation.mutateAsync({
        customer_id: customerId,
        customer_name: customerName || 'Walk-in Customer',
        bill_discount: billDiscount,
        notes: notes || null,
        valid_until: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
        items: lines.map((l) => ({
          variant_id: l.variantId,
          quantity: l.quantity,
          sold_unit: l.packUnit,
          rate: l.rate,
          discount_pct: 0,
          discount_amt: l.discountAmt,
        })),
      });
      toast.success('Estimate Saved', saved.quotation_number);
      if (andPrint) {
        navigate(`/quotations/${saved.id}?print=true`);
      } else {
        setLines([]);
        setCustomerId(null);
        setCustomerName('');
        setCustomerMobile('');
        setCustomerAddress('');
      }
    } catch {
      toast.error('Failed to save estimate');
    }
  };

  const handleSendWhatsApp = () => {
    if (lines.length === 0) {
      toast.error('Estimate is empty');
      return;
    }
    const customer = customerName || 'Customer';
    const total = grandTotal.toFixed(2);
    const text = encodeURIComponent(
      `*Santu Hardware - Estimate / Quotation*\nNamaste ${customer},\nAapka estimate total amount hai ₹${total} (${lines.length} items).\nYeh quotation 30 dino ke liye valid hai.\nThank you!`
    );
    const phone = customerMobile ? customerMobile.replace(/\D/g, '') : '';
    const url = buildWaLink(phone, decodeURIComponent(text));
    window.open(url, '_blank');
    toast.success('WhatsApp opened', customer);
  };

  // Arrives from an estimate's own page: /quotations?convert=<id> starts the same conversion.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const id = searchParams.get('convert');
    if (!id) return;
    setSearchParams({}, { replace: true });
    void convertToPosSale(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const convertToPosSale = async (quoteId: string) => {
    try {
      const data = await fetchForBilling(quoteId);
      if (data.differences.length > 0) {
        setPendingConversion({
          quotationId: quoteId,
          quotationNumber: data.quotation.quotation_number,
          customerId: data.quotation.customer_id,
          customerName: data.quotation.customer_name,
          billDiscount: Number(data.quotation.bill_discount) || 0,
          notes: data.quotation.notes,
          items: data.items,
          differences: data.differences,
        });
      } else {
        const cartLines: CartLine[] = data.items.map((l, index) => ({
          key: `${l.variant_id}-${index}`,
          variantId: l.variant_id!,
          itemId: '',
          itemName: l.item_name,
          itemCode: l.item_code,
          variantName: l.variant_name ?? '',
          stockUnit: l.stock_unit,
          packUnit: l.pack_unit,
          packSize: Number(l.pack_size),
          availableStock: Number(l.stock),
          taxRate: Number(l.tax_rate),
          mrp: Number(l.mrp),
          quantity: Number(l.quantity),
          soldUnit: l.sold_unit,
          rate: Number(l.quoted_rate),
          discountPct: Number(l.discount_pct),
          discountAmt: Number(l.discount_amt),
        }));
        cart.loadCart({
          customerId: data.quotation.customer_id,
          customerName: data.quotation.customer_name,
          lines: cartLines,
          billDiscount: Number(data.quotation.bill_discount) || 0,
          notes: data.quotation.notes || '',
          quotationId: quoteId,
          quotationNumber: data.quotation.quotation_number,
        });
        toast.success('Loaded into POS', data.quotation.quotation_number);
        navigate('/pos');
      }
    } catch {
      toast.error('Failed to load estimate');
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#f4f7fb] p-3 sm:p-4 overflow-hidden select-none font-sans">
      {/* ----------------- TOP TABS & CONTROLS (Image 4) ----------------- */}
      <div className="flex items-center justify-between pb-1 shrink-0">
        {/* Left: Estimate Tabs (Estimate #1 ×) */}
        <div className="flex items-end gap-1.5 overflow-x-auto no-scrollbar">
          {estimateTabs.map((tab) => {
            const isActive = activeTab === tab && viewMode === 'create';
            return (
              <div
                key={tab}
                onClick={() => {
                  setActiveTab(tab);
                  setViewMode('create');
                }}
                className={cn(
                  'flex items-center gap-2 rounded-t-xl px-4 py-2 text-xs font-bold transition-all cursor-pointer border-t border-x',
                  isActive
                    ? 'bg-white text-slate-900 border-slate-200/90 shadow-2xs font-extrabold relative z-10'
                    : 'bg-slate-100/70 text-slate-500 border-transparent hover:bg-slate-200/60 hover:text-slate-700',
                )}
              >
                <span>{tab}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLines([]);
                  }}
                  className="text-slate-400 hover:text-rose-500 rounded p-0.5 transition-colors"
                  title="Clear estimate"
                >
                  <X className="h-3 w-3 stroke-[2.5]" />
                </button>
              </div>
            );
          })}

          {/* Past Estimates History Tab */}
          <button
            type="button"
            onClick={() => setViewMode((m) => (m === 'create' ? 'history' : 'create'))}
            className={cn(
              'flex items-center gap-1.5 rounded-t-xl px-3.5 py-2 text-xs font-bold transition-all border-t border-x cursor-pointer ml-2',
              viewMode === 'history'
                ? 'bg-white text-blue-700 border-slate-200/90 shadow-2xs font-extrabold relative z-10'
                : 'bg-slate-100/60 text-slate-500 border-transparent hover:bg-slate-200/50',
            )}
          >
            <List className="h-3.5 w-3.5 text-blue-500" />
            <span>Past Estimates</span>
          </button>
        </div>

        {/* Right utility buttons matching screenshot Image 4: Lock, Calculator, + New Estimate (Ctrl+T) */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => toast.toast({ tone: 'info', title: 'Terminal Locked' })}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200/80 transition-colors"
            title="Lock Terminal"
          >
            <Lock className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setShowMoreDetails((v) => !v)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200/80 transition-colors"
            title="Calculator"
          >
            <Calculator className="h-3.5 w-3.5" />
          </button>

          {/* + New Estimate (Ctrl+T) */}
          <button
            type="button"
            onClick={() => {
              const nextNum = estimateTabs.length + 1;
              const nextLabel = `Estimate #${nextNum}`;
              setEstimateTabs((tabs) => [...tabs, nextLabel]);
              setActiveTab(nextLabel);
              setViewMode('create');
              setLines([]);
              searchRef.current?.focus();
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-blue-600 hover:bg-blue-50/50 transition-colors shadow-2xs cursor-pointer ml-1"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New Estimate</span>
            <span className="text-[10px] text-slate-400 font-normal">Ctrl+T</span>
          </button>
        </div>
      </div>

      {/* ----------------- VIEW: CREATE ESTIMATE (MATCHING IMAGE 4) ----------------- */}
      {viewMode === 'create' ? (
        <div className="flex flex-1 min-h-0 gap-3.5 flex-col lg:flex-row overflow-hidden pt-1">
          {/* =========================================================
              LEFT COLUMN (70%): Search Bar + Line Items Table + Footer Total
             ========================================================= */}
          <div className="flex flex-1 flex-col rounded-2xl bg-white border border-slate-200/90 shadow-2xs overflow-hidden">
            {/* Top Search Bar matching Image 4 */}
            <div ref={searchContainerRef} className="relative p-3 border-b border-slate-100 z-20">
              <div className="relative flex items-center">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setShowSearchDropdown(true);
                  }}
                  onFocus={() => setShowSearchDropdown(true)}
                  placeholder="Scan or search by item code, model no or item name"
                  className="w-full h-11 pl-10 pr-10 text-xs sm:text-sm rounded-xl border border-slate-300/90 bg-white hover:border-blue-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all placeholder-slate-400 font-medium"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => toast.toast({ tone: 'info', title: 'Voice search listening...' })}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-blue-600 cursor-pointer"
                  title="Voice Search"
                >
                  <Mic className="h-4 w-4" />
                </button>
              </div>

              {/* Autocomplete Item Dropdown */}
              {showSearchDropdown && search.trim() && (
                <div className="absolute left-3 right-3 top-[56px] z-50 max-h-72 overflow-y-auto rounded-xl bg-white shadow-2xl border border-slate-200 divide-y divide-slate-100 animate-fade-in">
                  {searchingItems && (
                    <div className="p-3 text-center text-xs text-slate-400">Searching items…</div>
                  )}
                  {itemHits?.data?.map((item) => (
                    <div key={item.id} className="p-2 hover:bg-blue-50/50">
                      {item.variants?.map((v) => (
                        <div
                          key={v.id}
                          onClick={() => addVariantToEstimate(item, v)}
                          className="flex items-center justify-between p-2 rounded-lg cursor-pointer hover:bg-blue-100/70"
                        >
                          <div>
                            <p className="text-xs font-bold text-slate-900">{item.name}</p>
                            <p className="text-[11px] text-slate-500">
                              Available: {v.stock} {v.pack_unit} | Code: {item.item_code}
                            </p>
                          </div>
                          <p className="text-xs font-black text-blue-900">
                            {formatMoney(Number(v.selling_price))}
                          </p>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Table Header & Rows matching Image 4 */}
            <div className="flex-1 overflow-y-auto min-h-0">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 bg-[#f8fafc] text-slate-600 uppercase text-[10px] font-black tracking-wider border-b border-slate-200 select-none z-10">
                  <tr>
                    <th className="py-2.5 px-3 w-10 text-center">#</th>
                    <th className="py-2.5 px-3 min-w-[200px]">ITEM NAME</th>
                    <th className="py-2.5 px-3 w-32 text-center">QTY</th>
                    <th className="py-2.5 px-3 w-24 text-left">UNIT</th>
                    <th className="py-2.5 px-3 w-28 text-center">PRICE/UNIT(₹)</th>
                    <th className="py-2.5 px-3 w-24 text-center">DISCOUNT (₹)</th>
                    <th className="py-2.5 px-3 w-28 text-right">TOTAL(₹)</th>
                    <th className="py-2.5 px-2 w-10 text-center"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-24 text-center text-slate-400">
                        <FileText className="h-8 w-8 text-slate-300 mx-auto mb-2 stroke-[1.5]" />
                        <p className="text-xs font-bold text-slate-600">No items added to this estimate yet</p>
                        <p className="text-[11px] text-slate-400 mt-1">
                          Scan barcode or search product name above to quote items.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    lines.map((line, idx) => (
                      <tr key={line.key} className="hover:bg-blue-50/20 transition-colors">
                        <td className="py-3 px-3 text-center text-slate-400 font-bold text-xs">{idx + 1}</td>
                        <td className="py-3 px-3">
                          <p className="font-extrabold text-slate-900 text-xs">{line.itemName}</p>
                          <p className="text-[11px] font-semibold text-emerald-600 mt-0.5">
                            Available: {line.availableStock} {line.stockUnit}
                          </p>
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                if (line.quantity > 1) {
                                  setLines((curr) =>
                                    curr.map((l) => (l.key === line.key ? { ...l, quantity: l.quantity - 1 } : l)),
                                  );
                                } else {
                                  setLines((curr) => curr.filter((l) => l.key !== line.key));
                                }
                              }}
                              className="h-5 w-5 flex items-center justify-center rounded text-slate-400 hover:text-slate-800 hover:bg-slate-100"
                            >
                              <Minus className="h-3 w-3 stroke-[2.5]" />
                            </button>
                            <span className="w-12 text-center text-xs font-bold text-slate-900">
                              {line.quantity.toFixed(2)}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setLines((curr) =>
                                  curr.map((l) => (l.key === line.key ? { ...l, quantity: l.quantity + 1 } : l)),
                                )
                              }
                              className="h-5 w-5 flex items-center justify-center rounded text-slate-400 hover:text-slate-800 hover:bg-slate-100"
                            >
                              <Plus className="h-3 w-3 stroke-[2.5]" />
                            </button>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-xs font-medium text-slate-700">{line.packUnit}</td>
                        <td className="py-3 px-3 text-center font-semibold text-slate-800 text-xs">
                          {line.rate.toFixed(2)}
                        </td>
                        <td className="py-3 px-3 text-center text-slate-700 text-xs">
                          {line.discountAmt.toFixed(2)}
                        </td>
                        <td className="py-3 px-3 text-right font-black text-slate-900 text-xs">
                          {(line.quantity * line.rate - line.discountAmt).toFixed(2)}
                        </td>
                        <td className="py-3 px-2 text-center">
                          <Check className="h-3.5 w-3.5 text-blue-500 stroke-[2.5] inline-block" />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Table Bottom Total Bar (₹ 0.00) matching Image 4 */}
            <div className="flex items-center justify-end border-t border-slate-200 bg-white px-6 py-3 shrink-0">
              <div className="text-right">
                <span className="text-sm font-black text-slate-900">
                  ₹ {grandTotal.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* =========================================================
              RIGHT COLUMN (30%): Date + Customer + Total Card + Save Estimate
             ========================================================= */}
          <div className="flex flex-col w-full lg:w-[320px] xl:w-[340px] shrink-0 space-y-3">
            {/* 1. Date Picker (07/09/2026 📅) */}
            <div className="flex items-center justify-between rounded-xl bg-white border border-slate-200/90 px-3.5 py-2.5 shadow-2xs">
              <input
                type="text"
                value={estimateDate}
                onChange={(e) => setEstimateDate(e.target.value)}
                className="text-xs font-bold text-slate-800 focus:outline-none bg-transparent w-full"
                placeholder="DD/MM/YYYY"
              />
              <Calendar className="h-4 w-4 text-slate-400 shrink-0 cursor-pointer" />
            </div>

            {/* 2. Customer Search / Card */}
            <div className="relative" ref={customerContainerRef}>
              {customerId && !showCustomerDropdown ? (
                <div className="flex items-center justify-between rounded-xl bg-white border border-slate-200/90 px-3.5 py-2.5 shadow-2xs">
                  <div
                    className="min-w-0 flex-1 cursor-pointer"
                    onClick={() => {
                      setCustomerSearch(customerName);
                      setShowCustomerDropdown(true);
                    }}
                  >
                    <p className="text-xs font-black text-slate-900 leading-snug">{customerName}</p>
                    <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                      {customerAddress ? `${customerAddress} - ` : ''}
                      {customerMobile || 'No phone'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    <button
                      type="button"
                      onClick={() => {
                        setCustomerSearch('');
                        setShowCustomerDropdown(true);
                      }}
                      className="p-1 text-slate-400 hover:text-blue-600 rounded"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCustomerId(null);
                        setCustomerName('');
                        setCustomerMobile('');
                        setCustomerAddress('');
                      }}
                      className="p-1 text-slate-400 hover:text-rose-600 rounded"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center rounded-xl bg-white border border-slate-200/90 px-3.5 py-2.5 shadow-2xs hover:border-blue-400 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
                  <input
                    type="text"
                    value={customerSearch}
                    onChange={(e) => {
                      setCustomerSearch(e.target.value);
                      setShowCustomerDropdown(true);
                    }}
                    onFocus={() => setShowCustomerDropdown(true)}
                    placeholder="Search for a customer by name, phone number"
                    className="w-full text-xs font-medium text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none"
                  />
                </div>
              )}

              {/* Customer Dropdown */}
              {showCustomerDropdown && (
                <div className="absolute left-0 right-0 top-[44px] z-50 overflow-hidden rounded-xl bg-white shadow-2xl border border-slate-200 divide-y divide-slate-100 animate-fade-in">
                  <div className="grid grid-cols-2 px-3 py-2 bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100">
                    <span>Name</span>
                    <span className="text-right pr-4">Phone</span>
                  </div>
                  <div className="max-h-52 overflow-y-auto divide-y divide-slate-50">
                    {(customerHits?.data || [])
                      .filter(
                        (c) =>
                          !customerSearch ||
                          c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
                          (c.mobile && c.mobile.includes(customerSearch)),
                      )
                      .map((cust) => (
                        <div
                          key={cust.id}
                          onClick={() => {
                            setCustomerId(cust.id);
                            setCustomerName(cust.name);
                            setCustomerMobile(cust.mobile || '');
                            setCustomerAddress(cust.address || '');
                            setCustomerSearch('');
                            setShowCustomerDropdown(false);
                          }}
                          className="grid grid-cols-2 items-center px-3 py-2.5 hover:bg-blue-50/70 cursor-pointer text-xs"
                        >
                          <span className="font-bold text-slate-900 truncate">{cust.name}</span>
                          <span className="text-slate-600 font-mono text-[11px] text-right">{cust.mobile || '—'}</span>
                        </div>
                      ))}
                  </div>
                  <div className="p-2 bg-slate-50/90 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => {
                        setCustomerModal({ open: true, customer: null });
                        setShowCustomerDropdown(false);
                      }}
                      className="w-full py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 shadow-2xs flex items-center justify-center gap-1.5"
                    >
                      <Plus className="h-3.5 w-3.5 text-slate-500" />
                      <span>Add Customer</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 3. Total Card with Full Breakup [Ctrl+F] > (Image 4) */}
            <div className="rounded-2xl bg-white border border-slate-200/90 p-4 shadow-2xs space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600 shrink-0">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-xl font-black text-slate-900 tracking-tight">
                      Total ₹ {grandTotal.toFixed(2)}
                    </p>
                    <p className="text-[11px] font-semibold text-slate-400 mt-0.5">
                      Items: {lines.length} , Quantity: {totalQty}
                    </p>
                  </div>
                </div>

                <div className="text-right">
                  <button
                    type="button"
                    onClick={() => setShowBreakup((v) => !v)}
                    className="text-xs font-bold text-[#1877F2] hover:underline cursor-pointer inline-flex items-center gap-0.5"
                  >
                    <span>Full Breakup</span>
                  </button>
                  <span className="text-[10px] text-blue-500 font-semibold block mt-0.5">[Ctrl+F] &gt;</span>
                </div>
              </div>

              {showBreakup && (
                <div className="mt-3 pt-3 border-t border-slate-100 text-xs space-y-1.5 text-slate-600 animate-slide-up">
                  <div className="flex justify-between">
                    <span>Gross Subtotal:</span>
                    <span className="font-semibold text-slate-800">₹ {grossSubtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center py-0.5">
                    <span className="flex items-center gap-1">
                      <Percent className="h-3 w-3 text-slate-400" />
                      Bill Discount:
                    </span>
                    <input
                      type="number"
                      value={billDiscount || ''}
                      onChange={(e) => setBillDiscount(Number(e.target.value) || 0)}
                      placeholder="0"
                      className="w-16 h-6 text-right px-1.5 text-xs font-semibold rounded border border-slate-200"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 4. More • Toggle */}
            <div className="text-center pt-0.5">
              <button
                type="button"
                onClick={() => setShowMoreDetails((v) => !v)}
                className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1 mx-auto cursor-pointer"
              >
                <span>More •</span>
              </button>

              {showMoreDetails && (
                <div className="mt-2 space-y-2 text-xs p-3 bg-white rounded-xl border border-slate-200 animate-slide-up text-left">
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Estimate remarks / validity / terms…"
                    className="w-full h-8 px-2 text-xs rounded-lg border border-slate-200 focus:outline-none"
                  />
                </div>
              )}
            </div>

            {/* 5. Primary Green Button: Save Estimate (Image 4) */}
            <button
              type="button"
              onClick={() => void handleSaveEstimate(false)}
              disabled={createQuotation.isPending}
              className="w-full py-3.5 rounded-xl bg-[#22c55e] hover:bg-[#16a34a] text-white font-black text-sm tracking-wide shadow-md shadow-emerald-600/25 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
            >
              <span>Save Estimate</span>
            </button>

            {/* 6. Dual Action Buttons: Save & Print [Ctrl+P] + Send WhatsApp (Image 4) */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void handleSaveEstimate(true)}
                disabled={createQuotation.isPending}
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 shadow-2xs transition-colors cursor-pointer"
              >
                <Printer className="h-3.5 w-3.5 text-slate-500" />
                <span>Save & Print</span>
                <span className="text-[10px] text-slate-400 font-normal">Ctrl+P</span>
              </button>

              <button
                type="button"
                onClick={handleSendWhatsApp}
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border border-emerald-200 bg-emerald-50/70 hover:bg-emerald-100/70 text-xs font-bold text-emerald-800 shadow-2xs transition-colors cursor-pointer"
              >
                <MessageSquare className="h-3.5 w-3.5 text-emerald-600" />
                <span>Send WhatsApp</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* ----------------- VIEW: SAVED ESTIMATES LIST ----------------- */
        <div className="flex-1 rounded-2xl bg-white border border-slate-200/90 shadow-2xs overflow-hidden flex flex-col p-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-sm font-black text-slate-900">Saved Quotations & Estimates</h2>
              <p className="text-[11px] text-slate-500">Search and convert saved estimates into POS sales with 1-click.</p>
            </div>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Search estimate or customer…"
                className="w-full h-8 pl-8 pr-3 text-xs rounded-lg border border-slate-200"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 pt-2">
            {loadingQuotes && <div className="p-8 text-center text-xs text-slate-400">Loading estimates…</div>}
            {pastQuotes && pastQuotes.data.length === 0 && (
              <div className="p-12 text-center text-xs text-slate-400">No estimates found.</div>
            )}
            <div className="divide-y divide-slate-100">
              {pastQuotes?.data?.map((q) => (
                <div key={q.id} className="flex items-center justify-between py-3 hover:bg-blue-50/30 px-2 rounded-lg">
                  <div>
                    <p className="text-xs font-black text-slate-900">
                      {q.quotation_number} · {q.customer_name}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Dated {formatDate(q.quotation_date)} · Valid until {formatDate(q.valid_until)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-black text-slate-900">{formatMoney(Number(q.grand_total))}</span>
                    <button
                      type="button"
                      onClick={() => void convertToPosSale(q.id)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-2xs cursor-pointer"
                    >
                      Convert to Bill
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ----------------- ADD CUSTOMER MODAL ----------------- */}
      {customerModal.open && (
        <CustomerFormModal
          customer={customerModal.customer}
          onClose={() => setCustomerModal({ open: false, customer: null })}
          onCreated={(cust) => {
            setCustomerId(cust.id);
            setCustomerName(cust.name);
            setCustomerMobile(cust.mobile || '');
            setCustomerAddress(cust.address || '');
            toast.success('Customer selected', cust.name);
          }}
        />
      )}

      {/* ----------------- PRICE CHANGE MODAL ----------------- */}
      {pendingConversion && (
        <PriceChangeModal
          differences={pendingConversion.differences}
          documentLabel="quotation"
          onKeep={() => {
            const linesToLoad: CartLine[] = pendingConversion.items.map((l, index) => ({
              key: `${l.variant_id}-${index}`,
              variantId: l.variant_id!,
              itemId: '',
              itemName: l.item_name,
              itemCode: l.item_code,
              variantName: l.variant_name ?? '',
              stockUnit: l.stock_unit,
              packUnit: l.pack_unit,
              packSize: Number(l.pack_size),
              availableStock: Number(l.stock),
              taxRate: Number(l.tax_rate),
              mrp: Number(l.mrp),
              quantity: Number(l.quantity),
              soldUnit: l.sold_unit,
              rate: Number(l.quoted_rate),
              discountPct: Number(l.discount_pct),
              discountAmt: Number(l.discount_amt),
            }));
            cart.loadCart({
              customerId: pendingConversion.customerId,
              customerName: pendingConversion.customerName,
              lines: linesToLoad,
              billDiscount: pendingConversion.billDiscount,
              notes: pendingConversion.notes || '',
              quotationId: pendingConversion.quotationId,
              quotationNumber: pendingConversion.quotationNumber,
            });
            setPendingConversion(null);
            navigate('/pos');
          }}
          onUpdate={() => {
            const linesToLoad: CartLine[] = pendingConversion.items.map((l, index) => ({
              key: `${l.variant_id}-${index}`,
              variantId: l.variant_id!,
              itemId: '',
              itemName: l.item_name,
              itemCode: l.item_code,
              variantName: l.variant_name ?? '',
              stockUnit: l.stock_unit,
              packUnit: l.pack_unit,
              packSize: Number(l.pack_size),
              availableStock: Number(l.stock),
              taxRate: Number(l.tax_rate),
              mrp: Number(l.mrp),
              quantity: Number(l.quantity),
              soldUnit: l.sold_unit,
              rate: l.current_rate !== null ? Number(l.current_rate) : Number(l.quoted_rate),
              discountPct: Number(l.discount_pct),
              discountAmt: Number(l.discount_amt),
            }));
            cart.loadCart({
              customerId: pendingConversion.customerId,
              customerName: pendingConversion.customerName,
              lines: linesToLoad,
              billDiscount: pendingConversion.billDiscount,
              notes: pendingConversion.notes || '',
              quotationId: pendingConversion.quotationId,
              quotationNumber: pendingConversion.quotationNumber,
            });
            setPendingConversion(null);
            navigate('/pos');
          }}
        />
      )}
    </div>
  );
}

export default QuotationsPage;
