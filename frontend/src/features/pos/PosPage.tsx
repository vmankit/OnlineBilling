import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Calendar,
  FileText,
  Minus,
  Plus,
  Printer,
  X,
  WifiOff,
  Search,
  Check,
  Trash2,
  Calculator,
  Percent,
  Lock,
  Edit2,
  Mic,
  MessageSquare,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useCustomers, useItems, useSettings, useUnits } from '@/services/catalog';
import { useCreateSale } from '@/services/sales';
import { useCreateQuotation } from '@/services/quotations';
import { useDebounced } from '@/hooks/useDebounced';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { useQueryClient } from '@tanstack/react-query';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { api, ApiError } from '@/lib/api';
import { cn, formatMoney } from '@/lib/utils';
import { lineNet, usePosCart } from './usePosCart';
import { PaymentModal } from './PaymentModal';
import { CustomerFormModal } from '@/features/customers/CustomerFormModal';
import type { Customer, Item, ItemVariant, Unit } from '@/types';
import { normalizeIndianMobile } from '@/features/whatsapp/whatsapp';
import { printSaleNow } from '@/features/invoices/printSale';
import { usePrintFormat, type PrintFormat } from '@/features/invoices/usePrintFormat';
import { sendBillOnWhatsApp } from '@/features/whatsapp/sendBill';
import { useWhatsAppBridgeStatus } from '@/services/whatsappBridge';
import type { SaleDetail } from '@/services/sales';

const isValidUuid = (val: string | null | undefined): boolean =>
  typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

const TABS_KEY = 'santu.pos.tabs.v1';

function loadTabs(): { tabs: string[]; active: string; counter: number; parked: Record<string, never> } | null {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!Array.isArray(v.tabs) || !v.tabs.length || !v.tabs.includes(v.active)) return null;
    return v;
  } catch {
    return null;
  }
}

export function PosPage(): JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const cart = usePosCart();
  const createSale = useCreateSale();
  const createQuotation = useCreateQuotation();

  // Multi-Bill Tabs (Matching Screenshot: #2026/1, #2026/2, #2026/3, #2026/4, #2026/5)
  // Open bill tabs survive leaving the Sale screen (and a reload): they are kept
  // in localStorage until the operator closes them or the bill is saved.
  const savedTabs = useRef(loadTabs()).current;
  const [billTabs, setBillTabs] = useState<string[]>(savedTabs?.tabs ?? ['#2026/1']);
  const [activeTab, setActiveTab] = useState<string>(savedTabs?.active ?? '#2026/1');
  const tabCounter = useRef(savedTabs?.counter ?? 1);
  // Each tab keeps its own bill. The live cart holds the active tab; the others
  // are parked here until the operator comes back to them.
  const parkedBills = useRef<Record<string, typeof cart.state>>(savedTabs?.parked ?? {});
  useEffect(() => {
    try {
      localStorage.setItem(
        TABS_KEY,
        JSON.stringify({ tabs: billTabs, active: activeTab, counter: tabCounter.current, parked: parkedBills.current }),
      );
    } catch {
      /* storage unavailable: tabs just won't survive */
    }
  }, [billTabs, activeTab, cart.state]);

  const switchTab = (next: string): void => {
    if (next === activeTab) return;
    parkedBills.current[activeTab] = cart.state;
    setActiveTab(next);
    const saved = parkedBills.current[next];
    if (saved) cart.loadCart(saved);
    else cart.clear();
    delete parkedBills.current[next];
    searchRef.current?.focus();
  };
  const openNewTab = (): void => {
    const label = `#2026/${++tabCounter.current}`;
    setBillTabs((tabs) => [...tabs, label]);
    switchTab(label);
    toast.toast({ tone: 'info', title: `New bill ${label} started` });
  };
  const closeTab = (tab: string): void => {
    if (billTabs.length <= 1) {
      cart.clear();
      return;
    }
    const remaining = billTabs.filter((t) => t !== tab);
    setBillTabs(remaining);
    if (activeTab === tab) {
      const next = remaining[remaining.length - 1]!;
      setActiveTab(next);
      const saved = parkedBills.current[next];
      if (saved) cart.loadCart(saved);
      else cart.clear();
      delete parkedBills.current[next];
    } else {
      delete parkedBills.current[tab];
    }
  };

  // Search & Modals
  const [search, setSearch] = useState('');
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [hlIndex, setHlIndex] = useState(0);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showBreakup, setShowBreakup] = useState(false);
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [customerModal, setCustomerModal] = useState<{ open: boolean; customer: Customer | null }>({
    open: false,
    customer: null,
  });

  // Billing inline payment state
  const [paymentMode, setPaymentMode] = useState<'UPI' | 'CASH' | 'CARD' | 'BANK' | 'CREDIT'>('UPI');
  const [amountReceived, setAmountReceived] = useState<string>('');

  // A bill is always dated the moment it is saved — the server stamps it, and
  // there is no date in the request. This used to be a fixed "06/09/2026"
  // typed into an editable box, so every bill looked like it was made on that
  // day and typing another date changed nothing.
  const billDateFormatted = new Date().toLocaleDateString('en-GB');

  // Customer search inline
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const debouncedCustomer = useDebounced(customerSearch, 150);
  const { data: customerHits } = useCustomers({ q: debouncedCustomer });

  const searchRef = useRef<HTMLInputElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const pendingScrollVariant = useRef<string | null>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const customerContainerRef = useRef<HTMLDivElement>(null);

  // Item Search
  const debouncedItemSearch = useDebounced(search, 150);
  const { data: itemHits, isLoading: searchingItems } = useItems({
    q: debouncedItemSearch,
    pageSize: 15,
  });

  // Keep amountReceived in sync with grandTotal if changed
  useEffect(() => {
    if (cart.totals.grandTotal > 0) {
      // The exact total, paise included. Rounding it to a whole rupee made a
      // ₹47.40 bill default to "47 received" — ₹0.40 short, which a walk-in
      // sale is not allowed to leave unpaid, so the cashier had to retype it.
      setAmountReceived(String(Number(cart.totals.grandTotal.toFixed(2))));
    }
  }, [cart.totals.grandTotal]);

  const { data: unitList } = useUnits();

  /**
   * Units a line may be sold in: its own pack unit, the unit stock is held in,
   * and anything else measuring the same thing — so a pipe stocked in METER
   * can be sold by the FOOT and the conversion happens server-side.
   */
  const sellableUnits = useCallback(
    (line: { soldUnit: string; packUnit: string; stockUnit: string }): Unit[] => {
      const all = unitList ?? [];
      // Every unit is offered. One of a different kind (PCS on a KG item) is billed
      // only after ✓ makes it the item's own unit.
      const codes = new Set<string>([line.soldUnit, line.packUnit, line.stockUnit]);
      for (const u of all) codes.add(u.code);
      return [...codes]
        .filter(Boolean)
        .map((code) => all.find((u) => u.code === code) ?? ({ code } as Unit));
    },
    [unitList],
  );

  /**
   * Changing a line's unit re-prices it, so the bill still charges the same
   * amount per kilo (or metre, or litre) that it did.
   *
   * The rate on a line is per sold unit. Switching 95-a-KG to GRAM used to
   * leave the rate at 95, so 500 g billed as ₹47,500 instead of ₹47.50. Only
   * units that measure the same thing convert this way: for counted goods
   * (PCS, BOX, PACK) a box is not one piece, and how many pieces are in it is
   * the item's pack size, which the server resolves.
   */
  const changeUnit = useCallback(
    (line: { key: string; soldUnit: string; rate: number }, nextCode: string) => {
      const all = unitList ?? [];
      const from = all.find((u) => u.code === line.soldUnit);
      const to = all.find((u) => u.code === nextCode);
      const measurable = from && to && from.dimension === to.dimension && from.dimension !== 'COUNT';

      const patch: { soldUnit: string; rate?: number } = { soldUnit: nextCode };
      if (measurable && from.factor_to_base > 0 && to.factor_to_base > 0) {
        // 4 places: the smallest conversion the app makes (a gram is 0.001 kg)
        // still needs 0.0095-style rates to stay exact.
        patch.rate = Math.round(((line.rate * to.factor_to_base) / from.factor_to_base) * 10_000) / 10_000;
      }
      cart.updateLine(line.key, patch);
    },
    [unitList, cart],
  );

  // Bring the line that was just added (or bumped) into view, so a long bill
  // scrolls down to where the operator edits next.
  useEffect(() => {
    const id = pendingScrollVariant.current;
    if (!id) return;
    pendingScrollVariant.current = null;
    const rows = tableScrollRef.current?.querySelectorAll<HTMLElement>(`tr[data-variant="${id}"]`);
    rows?.[rows.length - 1]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [cart.state.lines]);

  const [savedRates, setSavedRates] = useState<Record<string, number>>({});
  const saveMasterPrice = async (line: (typeof cart.state.lines)[number]): Promise<void> => {
    const unitChanged = line.soldUnit !== line.packUnit;
    try {
      await api.patch(`/api/items/variants/${line.variantId}/price`, {
        selling_price: line.rate,
        ...(unitChanged ? { unit: line.soldUnit } : {}),
      });
      if (unitChanged) {
        cart.updateLine(line.key, { packUnit: line.soldUnit, stockUnit: line.soldUnit, packSize: 1 });
      }
      setSavedRates((m) => ({ ...m, [line.key]: line.rate }));
      void queryClient.invalidateQueries({ queryKey: ['items'] });
      toast.toast({
        tone: 'success',
        title: unitChanged ? 'Unit & price saved' : 'Price saved',
        description: `${line.itemName} → ₹${line.rate} / ${line.soldUnit}`,
      });
    } catch {
      toast.toast({ tone: 'error', title: 'Could not save' });
    }
  };

  const addVariant = useCallback(
    (item: Item, variant: ItemVariant) => {
      pendingScrollVariant.current = variant.id;
      cart.addLine(item, variant);
      setSearch('');
      setShowSearchDropdown(false);
      searchRef.current?.focus();
    },
    [cart],
  );

  // Hardware / Bluetooth barcode scanner listener
  const onScan = useCallback(
    async (code: string) => {
      try {
        const { data: hit } = await api.get<{ data: { item: Item; variant: ItemVariant } }>(
          `/api/items/barcode/${encodeURIComponent(code)}`,
        );
        addVariant(hit.item, hit.variant);
      } catch (err) {
        toast.error('Barcode not recognised', err instanceof ApiError ? err.message : code);
      }
    },
    [addVariant, toast],
  );
  useBarcodeScanner((code) => void onScan(code), !showPaymentModal);

  // Close dropdowns on outside click
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

  const canCheckout = cart.state.lines.length > 0;

  // Auto-send: when the shop has switched on "send bill on save" (WhatsApp →
  // Transaction Message) and the phone is linked, every completed bill goes to
  // the customer as the receipt image and a PDF. It runs after the bill is
  // saved and never holds the counter up — a bill is made whether or not
  // WhatsApp works.
  const { data: bridgeStatus } = useWhatsAppBridgeStatus();
  const { data: allSettings } = useSettings();
  const txnSettings = (allSettings as { transaction_message_settings?: {
    auto_send_on_submit?: boolean;
    send_bill_as_image?: boolean;
    auto_send_types?: Record<string, boolean>;
  } } | undefined)?.transaction_message_settings;
  const autoSendBills =
    bridgeStatus?.state === 'CONNECTED' &&
    !!txnSettings?.auto_send_on_submit &&
    !!txnSettings?.send_bill_as_image &&
    txnSettings?.auto_send_types?.['Sales Transaction'] !== false;

  const printFormat = usePrintFormat();
  const defaultFormat: PrintFormat = allSettings?.business?.defaultPrintFormat ?? 'A4';

  /**
   * What happens once a bill is saved. There is no window and no follow-up
   * screen — the cashier stays on the till and gets a short notice for each
   * thing that was done: Saved, Sent on WhatsApp, Printed.
   */
  const finishBill = (invoice: SaleDetail, action: 'save' | 'print' | 'whatsapp'): void => {
    toast.success('Saved', invoice.invoice_number);

    // WhatsApp goes out when asked for, or when the shop has it set to send
    // every bill on its own.
    if (action === 'whatsapp' || autoSendBills) {
      if (!normalizeIndianMobile(invoice.customer_mobile)) {
        if (action === 'whatsapp') toast.error('WhatsApp par nahi gaya', 'Customer ka mobile number nahi hai.');
      } else if (bridgeStatus?.state !== 'CONNECTED') {
        if (action === 'whatsapp') toast.error('WhatsApp par nahi gaya', 'Phone linked nahi hai. WhatsApp me "Link phone" karein.');
      } else {
        void sendBillOnWhatsApp(
          invoice,
          invoice.customer_mobile,
          `${invoice.invoice_number} — ₹${Number(invoice.grand_total).toLocaleString('en-IN')}`,
        ).then((res) => {
          if (res.sent) toast.success('Sent on WhatsApp', invoice.customer_name);
          else toast.error('WhatsApp par nahi gaya', res.error);
        });
      }
    }

    if (action === 'print') {
      void printSaleNow(invoice, defaultFormat, printFormat)
        .then(() => toast.success('Printed', invoice.invoice_number))
        .catch(() => toast.error('Print nahi ho saka'));
    }
  };

  // Checkout submission
  const submitSale = async (
    payments: Array<{ method: string; amount: number; reference?: string | null }>,
    status: 'COMPLETED' | 'HELD' = 'COMPLETED',
    andPrint = false,
  ): Promise<void> => {
    try {
      const invoice = await createSale.mutateAsync({
        customer_id: isValidUuid(cart.state.customerId) ? cart.state.customerId : null,
        customer_name: cart.state.customerName || 'Cash / Walk-in Customer',
        customer_mobile: cart.state.customerMobile ?? null,
        customer_address: cart.state.customerAddress ?? null,
        customer_gstin: cart.state.customerGstin ?? null,
        quotation_id: cart.state.quotationId,
        status,
        bill_discount: cart.state.billDiscount,
        round_off: 0,
        notes: cart.state.notes || null,
        items: cart.state.lines.map((l) => ({
          variant_id: l.variantId,
          quantity: l.quantity,
          sold_unit: l.soldUnit,
          rate: l.rate,
          discount_pct: l.discountPct,
          discount_amt: l.discountAmt,
        })),
        payments: payments.map((p) => ({ method: p.method, amount: p.amount, reference: p.reference ?? null })),
      });

      cart.clear();
      setShowPaymentModal(false);

      if (status === 'HELD') {
        toast.success('Bill held', invoice.invoice_number);
        return;
      }

      finishBill(invoice, andPrint ? 'print' : 'save');
    } catch (err) {
      toast.error('Failed to create bill', err instanceof ApiError ? err.message : undefined);
    }
  };

  /**
   * Turns what the till collected into the payment lines the invoice records.
   *
   * A customer handing over a 500 rupee note for a 180 rupee bill is the
   * normal case at a counter, so the amount typed in is what was *handed
   * over*, not what the bill is worth: the invoice records at most the bill
   * total and the rest is change. Sending the full 500 made the server reject
   * the sale outright.
   */
  const buildTenders = (): Array<{ method: string; amount: number; reference: string | null }> => {
    // On credit nothing is collected now; the balance goes to the ledger.
    if (paymentMode === 'CREDIT') return [];

    const handedOver = amountReceived.trim() === ''
      ? cart.totals.grandTotal
      : Number(amountReceived) || 0;
    const collected = Math.min(handedOver, cart.totals.grandTotal);
    if (collected <= 0) return [];

    return [{ method: paymentMode, amount: Number(collected.toFixed(2)), reference: null }];
  };

  /** Blocks the two ways a bill can only fail once it reaches the server. */
  const checkoutProblem = (): string | null => {
    if (!canCheckout) return 'Add at least one item before saving.';

    const tenders = buildTenders();
    const collected = tenders.reduce((sum, t) => sum + t.amount, 0);
    const due = Number((cart.totals.grandTotal - collected).toFixed(2));

    const all = unitList ?? [];
    const stray = cart.state.lines.find((l) => {
      const from = all.find((u) => u.code === l.soldUnit);
      const to = all.find((u) => u.code === l.stockUnit);
      return from && to && from.dimension !== to.dimension;
    });
    if (stray) {
      return `${stray.itemName}: ${stray.soldUnit} is not this item's unit (${stray.stockUnit}). Press ✓ on that line to make ${stray.soldUnit} its unit.`;
    }

    if (due > 0 && !cart.state.customerId) {
      return `${formatMoney(due)} baki rahegi. Walk-in ko baki nahi milti: saved customer chuniye, ya poora paisa lijiye.`;
    }
    if (due > 0 && (!cart.state.customerName?.trim() || !cart.state.customerAddress?.trim())) {
      return `${formatMoney(due)} baki rahegi. Baki ke liye customer ka naam aur address zaroori hai. Parties me address bharein.`;
    }
    return null;
  };

  // Save Bill Only (Bill Save Karo)
  const handleSaveBillOnly = async () => {
    const problem = checkoutProblem();
    if (problem) {
      toast.error('Cannot save this bill', problem);
      return;
    }
    try {
      const invoice = await createSale.mutateAsync({
        customer_id: isValidUuid(cart.state.customerId) ? cart.state.customerId : null,
        customer_name: cart.state.customerName || 'Cash / Walk-in Customer',
        customer_mobile: cart.state.customerMobile ?? null,
        customer_address: cart.state.customerAddress ?? null,
        customer_gstin: cart.state.customerGstin ?? null,
        quotation_id: cart.state.quotationId,
        status: 'COMPLETED',
        bill_discount: cart.state.billDiscount,
        round_off: 0,
        notes: cart.state.notes || null,
        items: cart.state.lines.map((l) => ({
          variant_id: l.variantId,
          quantity: l.quantity,
          sold_unit: l.soldUnit,
          rate: l.rate,
          discount_pct: l.discountPct,
          discount_amt: l.discountAmt,
        })),
        payments: buildTenders().map((p) => ({ method: p.method, amount: p.amount, reference: p.reference ?? null })),
      });

      cart.clear();
      setShowPaymentModal(false);
      finishBill(invoice, 'save');
    } catch (err) {
      toast.error('Failed to create bill', err instanceof ApiError ? err.message : undefined);
    }
  };

  // Save & Print Primary Action
  const handleSaveAndPrint = async () => {
    const problem = checkoutProblem();
    if (problem) {
      toast.error('Cannot save this bill', problem);
      return;
    }
    await submitSale(buildTenders(), 'COMPLETED', true);
  };

  // Send WhatsApp: saves the bill and sends it to the customer.
  const handleSendWhatsApp = async () => {
    const problem = checkoutProblem();
    if (problem) {
      toast.error('Cannot save this bill', problem);
      return;
    }
    try {
      const invoice = await createSale.mutateAsync({
        customer_id: isValidUuid(cart.state.customerId) ? cart.state.customerId : null,
        customer_name: cart.state.customerName || 'Cash / Walk-in Customer',
        customer_mobile: cart.state.customerMobile ?? null,
        customer_address: cart.state.customerAddress ?? null,
        customer_gstin: cart.state.customerGstin ?? null,
        quotation_id: cart.state.quotationId,
        status: 'COMPLETED',
        bill_discount: cart.state.billDiscount,
        round_off: 0,
        notes: cart.state.notes || null,
        items: cart.state.lines.map((l) => ({
          variant_id: l.variantId,
          quantity: l.quantity,
          sold_unit: l.soldUnit,
          rate: l.rate,
          discount_pct: l.discountPct,
          discount_amt: l.discountAmt,
        })),
        payments: buildTenders().map((p) => ({ method: p.method, amount: p.amount, reference: p.reference ?? null })),
      });

      cart.clear();
      setShowPaymentModal(false);
      finishBill(invoice, 'whatsapp');
    } catch (err) {
      toast.error('Failed to create bill', err instanceof ApiError ? err.message : undefined);
    }
  };

  // Keyboard shortcuts: Enter, Ctrl+T, Ctrl+F, Ctrl+M, Ctrl+P, Ctrl+D
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't') {
        e.preventDefault();
        // New Bill Tab
        openNewTab();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'F1' || e.key.toLowerCase() === 'f')) {
        e.preventDefault();
        setShowBreakup((v) => !v);
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'b' || e.key.toLowerCase() === 'm')) {
        e.preventDefault();
        setShowPaymentModal(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        void handleSaveAndPrint();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setCustomerModal({ open: true, customer: null });
      } else if (e.key === 'Enter' && !showSearchDropdown && !showPaymentModal && canCheckout) {
        // Prevent default only if not in text input or if outside search
        if (document.activeElement?.tagName !== 'INPUT' || document.activeElement === searchRef.current) {
          e.preventDefault();
          void handleSaveBillOnly();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [billTabs, activeTab, canCheckout, cart, handleSaveBillOnly, handleSaveAndPrint, showSearchDropdown, showPaymentModal]);

  return (
    <div className="flex flex-col h-full bg-[#f4f7fb] p-3 sm:p-4 overflow-hidden select-none font-sans">
      {/* ----------------- TOP TABS & UTILITY BUTTONS BAR ----------------- */}
      <div className="flex items-center justify-between pb-1 shrink-0">
        {/* Multi-Bill Tabs: #2026/1, #2026/2, #2026/3, #2026/4, #2026/5 */}
        <div className="flex items-end gap-1.5 overflow-x-auto no-scrollbar">
          {billTabs.map((tab) => {
            const isActive = activeTab === tab;
            return (
              <div
                key={tab}
                onClick={() => switchTab(tab)}
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
                    closeTab(tab);
                  }}
                  className="text-slate-400 hover:text-rose-500 rounded p-0.5 transition-colors"
                  title="Close tab"
                >
                  <X className="h-3 w-3 stroke-[2.5]" />
                </button>
              </div>
            );
          })}
        </div>

        {/* Right utility buttons matching screenshot Image 1: Lock, Calculator, Document, + New Bill (Ctrl+T) */}
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
          <button
            type="button"
            onClick={() => navigate('/sales')}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200/80 transition-colors"
            title="Sales History"
          >
            <FileText className="h-3.5 w-3.5" />
          </button>

          {/* + New Bill (Ctrl+T) */}
          <button
            type="button"
            onClick={openNewTab}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-blue-600 hover:bg-blue-50/50 transition-colors shadow-2xs cursor-pointer ml-1"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New Bill</span>
            <span className="text-[10px] text-slate-400 font-normal">Ctrl+T</span>
          </button>
        </div>
      </div>

      {/* ----------------- MAIN BILLING WORKSPACE ----------------- */}
      <div className="flex flex-1 min-h-0 gap-3.5 flex-col lg:flex-row overflow-hidden pt-1">
        {/* =========================================================
            LEFT COLUMN (70%): Search Bar + Line Items Table + Footer Total
           ========================================================= */}
        <div className="flex flex-1 flex-col rounded-2xl bg-white border border-slate-200/90 shadow-2xs overflow-hidden">
          {/* Top Search Bar */}
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
                  setHlIndex(0);
                }}
                onFocus={() => setShowSearchDropdown(true)}
                onKeyDown={(e) => {
                  const flat = (itemHits?.data ?? []).flatMap((it) => (it.variants ?? []).map((v) => ({ it, v })));
                  if (e.key === 'ArrowDown' && flat.length) {
                    e.preventDefault();
                    setShowSearchDropdown(true);
                    setHlIndex((i) => Math.min(flat.length - 1, i + 1));
                  } else if (e.key === 'ArrowUp' && flat.length) {
                    e.preventDefault();
                    setHlIndex((i) => Math.max(0, i - 1));
                  } else if (e.key === 'Escape') {
                    setShowSearchDropdown(false);
                  } else if (e.key === 'Enter' && flat.length) {
                    const pick = flat[Math.min(hlIndex, flat.length - 1)]!;
                    addVariant(pick.it, pick.v);
                    setHlIndex(0);
                  }
                }}
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

            {/* Live Autocomplete Search Results Dropdown */}
            {showSearchDropdown && search.trim() && (
              <div className="absolute left-3 right-3 top-[56px] z-50 max-h-72 overflow-y-auto rounded-xl bg-white shadow-2xl border border-slate-200 divide-y divide-slate-100 animate-fade-in">
                {searchingItems && (
                  <div className="p-3 text-center text-xs text-slate-400">Searching items…</div>
                )}
                {itemHits && itemHits.data.length === 0 && (
                  <div className="p-4 text-center text-xs text-slate-500">
                    No items found matching "{search}".
                  </div>
                )}
                {(() => {
                  let flatIdx = -1;
                  return itemHits?.data.map((item) => (
                  <div key={item.id} className="p-2 hover:bg-blue-50/50 transition-colors">
                    {item.variants?.map((v) => {
                      flatIdx += 1;
                      const active = flatIdx === hlIndex;
                      return (
                      <div
                        key={v.id}
                        ref={active ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                        onClick={() => addVariant(item, v)}
                        onMouseEnter={((n) => () => setHlIndex(n))(flatIdx)}
                        className={cn(
                          'flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors',
                          active ? 'bg-blue-100 ring-1 ring-blue-300' : 'hover:bg-blue-100/70',
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-slate-900">
                            {item.name} {v.name !== 'Standard' && `· ${v.name}`}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span
                              className={cn(
                                'text-[11px] font-semibold',
                                Number(v.stock) <= 0 ? 'text-rose-500' : 'text-emerald-600',
                              )}
                            >
                              Available: {v.stock} {v.pack_unit}
                            </span>
                            <span className="text-slate-300">|</span>
                            <span className="text-[11px] text-slate-500 font-mono">Code: {item.item_code}</span>
                          </div>
                        </div>
                        <div className="text-right ml-3">
                          <p className="text-xs font-extrabold text-blue-900">{formatMoney(Number(v.selling_price))}</p>
                          <span className="text-[10px] text-slate-400">per {v.pack_unit}</span>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                  ));
                })()}
              </div>
            )}
          </div>

          {/* Table Header & Scrollable Body matching reference image */}
          <div ref={tableScrollRef} className="flex-1 overflow-y-auto min-h-0">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 bg-[#f8fafc] text-slate-600 uppercase text-[10px] font-black tracking-wider border-b border-slate-200 select-none z-10">
                <tr>
                  <th className="py-2.5 px-3 w-10 text-center">#</th>
                  <th className="py-2.5 px-3 min-w-[200px]">ITEM NAME</th>
                  <th className="py-2.5 px-3 w-32 text-center">QTY</th>
                  <th className="py-2.5 px-3 w-24 text-left">UNIT</th>
                  <th className="py-2.5 px-3 w-28 text-center">PRICE/UNIT (₹)</th>
                  <th className="py-2.5 px-3 w-24 text-center">DISCOUNT (₹)</th>
                  <th className="py-2.5 px-3 w-28 text-right">TOTAL (₹)</th>
                  <th className="py-2.5 px-2 w-10 text-center"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cart.state.lines.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-20 text-center text-slate-400">
                      <p className="text-xs font-semibold text-slate-600">Bill is empty</p>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Scan barcode or search product name above to add items.
                      </p>
                    </td>
                  </tr>
                ) : (
                  cart.state.lines.map((line, idx) => (
                    <tr key={line.key} data-variant={line.variantId} className="hover:bg-blue-50/20 transition-colors group">
                      {/* Index # */}
                      <td className="py-3 px-3 text-center text-slate-400 font-bold text-xs">
                        <span className="group-hover:hidden">{idx + 1}</span>
                        <button
                          type="button"
                          title="Remove item"
                          onClick={() => cart.removeLine(line.key)}
                          className="hidden group-hover:inline-flex h-6 w-6 items-center justify-center rounded-md border border-red-200 bg-red-50 text-red-500 hover:bg-red-100 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>

                      {/* ITEM NAME & Available Stock in Green */}
                      <td className="py-3 px-3">
                        <p className="font-extrabold text-slate-900 text-xs tracking-tight">
                          {line.itemName}
                        </p>
                        {/* Only comparable when the bill and the shelf count in the
                            same unit; any other mix is checked by the server, which
                            refuses an oversell either way. */}
                        {line.soldUnit === line.stockUnit && Number(line.quantity) > line.availableStock ? (
                          <p className="text-[11px] font-bold text-rose-600 mt-0.5">
                            Sirf {line.availableStock} {line.stockUnit} hai — {line.quantity} nahi bik sakta
                          </p>
                        ) : (
                          <p className="text-[11px] font-semibold text-emerald-600 mt-0.5">
                            Available: {line.availableStock} {line.stockUnit}
                          </p>
                        )}
                      </td>

                      {/* QTY Stepper: -  1.00  + */}
                      <td className="py-3 px-3">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              if (line.quantity > 1) {
                                cart.updateLine(line.key, { quantity: line.quantity - 1 });
                              } else {
                                cart.removeLine(line.key);
                              }
                            }}
                            className="h-5 w-5 flex items-center justify-center rounded text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
                          >
                            <Minus className="h-3 w-3 stroke-[2.5]" />
                          </button>
                          <input
                            type="number"
                            value={line.quantity.toFixed(2)}
                            onChange={(e) => {
                              const val = Math.max(0.01, Number(e.target.value) || 0);
                              cart.updateLine(line.key, { quantity: val });
                            }}
                            className="w-14 text-center text-xs font-bold text-slate-900 bg-transparent border-0 focus:outline-none focus:ring-0 p-0"
                            step="any"
                          />
                          <button
                            type="button"
                            onClick={() => cart.updateLine(line.key, { quantity: line.quantity + 1 })}
                            className="h-5 w-5 flex items-center justify-center rounded text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
                          >
                            <Plus className="h-3 w-3 stroke-[2.5]" />
                          </button>
                        </div>
                      </td>

                      {/* UNIT: Pcs ⌵ */}
                      <td className="py-3 px-3">
                        <div className="relative inline-block w-20">
                          <select
                            value={line.soldUnit}
                            onChange={(e) => changeUnit(line, e.target.value)}
                            className="w-full text-xs font-medium text-slate-700 bg-transparent pr-4 focus:outline-none cursor-pointer"
                          >
                            {/*
                              Real unit codes from the database, limited to the
                              ones this line can actually be sold in. The old
                              hardcoded list used labels ("Ltr", "Mtr") that are
                              not unit codes at all: the select could never match
                              a line's LITRE, so it displayed the wrong unit, and
                              picking one sent a code the server rejects. It also
                              had no FEET, so selling by the foot from metre stock
                              was impossible from the counter.
                            */}
                            {sellableUnits(line).map((u) => (
                              <option key={u.code} value={u.code}>
                                {u.code}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>

                      {/* PRICE/UNIT (₹) */}
                      <td className="py-3 px-3 text-center font-semibold text-slate-800 text-xs">
                        <input
                          type="number"
                          value={line.rate}
                          onChange={(e) => cart.updateLine(line.key, { rate: Number(e.target.value) || 0 })}
                          className="w-16 text-center text-xs font-semibold text-slate-800 bg-transparent border-0 focus:outline-none focus:bg-white focus:ring-1 focus:ring-blue-300 rounded px-1"
                          step="any"
                        />
                      </td>

                      {/* DISCOUNT (₹) */}
                      <td className="py-3 px-3 text-center text-slate-700 text-xs">
                        <input
                          type="number"
                          value={line.discountAmt === 0 ? '0.00' : line.discountAmt}
                          onChange={(e) => cart.updateLine(line.key, { discountAmt: Number(e.target.value) || 0 })}
                          className="w-16 text-center text-xs font-medium text-slate-700 bg-transparent border-0 focus:outline-none focus:bg-white focus:ring-1 focus:ring-blue-300 rounded px-1"
                          step="any"
                        />
                      </td>

                      {/* TOTAL (₹) */}
                      <td className="py-3 px-3 text-right font-black text-slate-900 text-xs">
                        {lineNet(line).toFixed(2)}
                      </td>

                      {/* Checkmark icon ✓ */}
                      <td className="py-3 px-2 text-center">
                        <button
                          type="button"
                          title={savedRates[line.key] === line.rate ? 'Saved in item master' : 'Save this unit and price in the item master'}
                          onClick={() => void saveMasterPrice(line)}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-blue-50 cursor-pointer"
                        >
                          <Check
                            className={cn(
                              'h-3.5 w-3.5 stroke-[2.5]',
                              savedRates[line.key] === line.rate ? 'text-emerald-500' : 'text-blue-500',
                            )}
                          />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Table Bottom Total Bar (matching screenshot: ₹ 25.00 on right) */}
          <div className="flex items-center justify-end border-t border-slate-200 bg-white px-6 py-3 shrink-0">
            <div className="text-right">
              <span className="text-sm font-black text-slate-900">
                ₹ {cart.totals.grandTotal.toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* =========================================================
            RIGHT COLUMN (30%): Date + Customer + Total Card + Payment + Save Button
           ========================================================= */}
        <div className="flex flex-col w-full lg:w-[320px] xl:w-[340px] shrink-0 space-y-3">
          {/* 1. Date Picker (05/09/2026 📅) */}
          <div className="flex items-center justify-between rounded-xl bg-white border border-slate-200/90 px-3.5 py-2.5 shadow-2xs">
            <input
              type="text"
              value={billDateFormatted}
              readOnly
              title="Bill aaj ki tareekh par banta hai"
              className="text-xs font-bold text-slate-800 focus:outline-none bg-transparent w-full cursor-default"
            />
            <Calendar className="h-4 w-4 text-slate-400 shrink-0 cursor-pointer" />
          </div>

          {/* 2. Customer Card & Search Dropdown matching Image 1 & Image 2 */}
          <div className="relative" ref={customerContainerRef}>
            {cart.state.customerId && !showCustomerDropdown ? (
              /* Selected Customer Card (Image 1: Ankit / Ishuapur - 8789657048) */
              <div className="flex items-center justify-between rounded-xl bg-white border border-slate-200/90 px-3.5 py-2.5 shadow-2xs hover:border-blue-400 transition-all">
                <div
                  className="min-w-0 flex-1 cursor-pointer"
                  onClick={() => {
                    setCustomerSearch(cart.state.customerName || '');
                    setShowCustomerDropdown(true);
                  }}
                >
                  <p className="text-xs font-black text-slate-900 leading-snug">{cart.state.customerName}</p>
                  <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                    {cart.state.customerAddress ? `${cart.state.customerAddress} ` : ''}
                    {cart.state.customerAddress && cart.state.customerMobile ? '- ' : ''}
                    {cart.state.customerMobile || ''}
                  </p>
                </div>
                <div className="flex items-center gap-1 ml-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCustomerSearch('');
                      setShowCustomerDropdown(true);
                    }}
                    className="p-1 text-slate-400 hover:text-blue-600 rounded transition-colors"
                    title="Change Customer"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      cart.setCustomer(null, 'Walk-in Customer', null, null, null);
                      setCustomerSearch('');
                    }}
                    className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                    title="Clear Customer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              /* Customer Search Input matching Image 2 */
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
                {customerSearch && (
                  <button
                    type="button"
                    onClick={() => {
                      setCustomerSearch('');
                      setShowCustomerDropdown(false);
                    }}
                    className="text-slate-400 hover:text-slate-600 p-0.5 ml-1"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}

            {/* Customer Results Dropdown Popup matching Image 2 */}
            {showCustomerDropdown && (
              <div className="absolute left-0 right-0 top-[44px] z-50 overflow-hidden rounded-xl bg-white shadow-2xl border border-slate-200 divide-y divide-slate-100 animate-fade-in">
                {/* Header: Name | Phone Number */}
                <div className="grid grid-cols-2 px-3 py-2 bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100 select-none">
                  <span>Name</span>
                  <span className="text-right pr-6">Phone Number</span>
                </div>

                {/* Rows matching Image 2 */}
                <div className="max-h-56 overflow-y-auto divide-y divide-slate-50">
                  {/* Walk-in Cash Customer Option */}
                  <div
                    onClick={() => {
                      cart.setCustomer(null, 'Walk-in Customer', null, null, null);
                      setCustomerSearch('');
                      setShowCustomerDropdown(false);
                    }}
                    className="flex items-center justify-between px-3 py-2 hover:bg-slate-50 cursor-pointer text-xs font-bold text-slate-700"
                  >
                    <span>🚶 Cash / Walk-in Customer</span>
                    <span className="text-[11px] text-slate-400">Cash Counter</span>
                  </div>

                  {/* API Customers */}
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
                          cart.setCustomer(cust.id, cust.name, cust.mobile, cust.address || null, null);
                          setCustomerSearch('');
                          setShowCustomerDropdown(false);
                          toast.toast({ tone: 'info', title: `Customer: ${cust.name}` });
                        }}
                        className="grid grid-cols-2 items-center px-3 py-2.5 hover:bg-blue-50/70 cursor-pointer text-xs transition-colors"
                      >
                        <span className="font-bold text-slate-900 truncate">{cust.name}</span>
                        <div className="flex items-center justify-end gap-2 text-right">
                          <span className="text-slate-600 font-mono text-[11px]">{cust.mobile || '—'}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCustomerModal({ open: true, customer: cust as any });
                            }}
                            className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-100 rounded transition-colors"
                            title="Edit Customer"
                          >
                            <Edit2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                </div>

                {/* Footer: + Add Customer Ctrl+D */}
                <div className="p-2 bg-slate-50/90 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => {
                      setCustomerModal({ open: true, customer: null });
                      setShowCustomerDropdown(false);
                    }}
                    className="w-full py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 shadow-2xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5 text-slate-500" />
                    <span>Add Customer</span>
                    <span className="text-[10px] text-slate-400 font-normal">Ctrl+D</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 3. Total Card with Full Breakup [Ctrl+F] > */}
          <div className="rounded-2xl bg-white border border-slate-200/90 p-4 shadow-2xs space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600 shrink-0">
                  <FileText className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-xl font-black text-slate-900 tracking-tight">
                    Total ₹ {cart.totals.grandTotal.toFixed(2)}
                  </p>
                  <p className="text-[11px] font-semibold text-slate-400 mt-0.5">
                    Items: {cart.state.lines.length} , Quantity: {cart.totals.count}
                  </p>
                </div>
              </div>

              {/* Full Breakup [Ctrl+F] > */}
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

            {/* Expandable Breakup */}
            {showBreakup && (
              <div className="mt-3 pt-3 border-t border-slate-100 text-xs space-y-1.5 text-slate-600 animate-slide-up">
                <div className="flex justify-between">
                  <span>Gross Subtotal:</span>
                  <span className="font-semibold text-slate-800">₹ {cart.totals.subtotal.toFixed(2)}</span>
                </div>
                {cart.totals.itemDiscount > 0 && (
                  <div className="flex justify-between text-emerald-600">
                    <span>Item Discounts:</span>
                    <span>- ₹ {cart.totals.itemDiscount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center py-0.5">
                  <span className="flex items-center gap-1">
                    <Percent className="h-3 w-3 text-slate-400" />
                    Bill Discount:
                  </span>
                  <input
                    type="number"
                    value={cart.state.billDiscount || ''}
                    onChange={(e) => cart.setBillDiscount(Number(e.target.value) || 0)}
                    placeholder="0"
                    className="w-16 h-6 text-right px-1.5 text-xs font-semibold rounded border border-slate-200"
                  />
                </div>
              </div>
            )}
          </div>

          {/* 4. Payment Section: Payment Mode & Amount Received */}
          <div className="rounded-2xl bg-white border border-slate-200/90 p-3.5 shadow-2xs">
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="text-[11px] font-bold text-slate-600 block mb-1.5">Payment Mode</label>
                <select
                  value={paymentMode}
                  onChange={(e) => setPaymentMode(e.target.value as any)}
                  className="w-full h-9 px-2 text-xs font-bold rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-blue-500 cursor-pointer"
                >
                  <option value="UPI">UPI</option>
                  <option value="CASH">Cash</option>
                  <option value="CARD">Card</option>
                  <option value="BANK">Net Banking</option>
                  <option value="CREDIT">Other/Credit</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-600 block mb-1.5">Amount Received</label>
                <div className="relative flex items-center">
                  <span className="absolute left-2.5 text-xs font-bold text-slate-400">₹</span>
                  <input
                    type="number"
                    value={amountReceived}
                    onChange={(e) => setAmountReceived(e.target.value)}
                    className="w-full h-9 pl-6 pr-2 text-xs font-black text-slate-900 rounded-lg border border-slate-200 focus:outline-none focus:border-blue-500 text-right"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 5. More • Toggle */}
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
                  value={cart.state.notes}
                  onChange={(e) => cart.setNotes(e.target.value)}
                  placeholder="Bill remarks / vehicle no / delivery notes…"
                  className="w-full h-8 px-2 text-xs rounded-lg border border-slate-200 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={async () => {
                    if (!canCheckout) return;
                    try {
                      const q = await createQuotation.mutateAsync({
                        customer_id: cart.state.customerId,
                        customer_name: cart.state.customerName,
                        bill_discount: cart.state.billDiscount,
                        notes: cart.state.notes || null,
                        valid_until: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
                        items: cart.state.lines.map((l) => ({
                          variant_id: l.variantId,
                          quantity: l.quantity,
                          sold_unit: l.soldUnit,
                          rate: l.rate,
                          discount_pct: l.discountPct,
                          discount_amt: l.discountAmt,
                        })),
                      });
                      cart.clear();
                      toast.success('Quotation saved', q.quotation_number);
                      navigate('/quotations');
                    } catch (err) {
                      toast.error('Could not save quote');
                    }
                  }}
                  className="w-full py-1.5 text-xs font-semibold rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100"
                >
                  Save as Quotation (Est.)
                </button>
              </div>
            )}
          </div>

          {/* Offline status alert */}
          {!online && (
            <div className="flex items-center justify-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 rounded-lg py-1.5 border border-amber-200">
              <WifiOff className="h-3.5 w-3.5" />
              <span>Offline</span>
            </div>
          )}

          {/* 6. Primary Action: Bill Save Karo (Solid Green Button matching Image 1 & 2) */}
          <button
            type="button"
            onClick={() => void handleSaveBillOnly()}
            disabled={!canCheckout || createSale.isPending || !online}
            className="w-full py-3.5 rounded-xl bg-[#22c55e] hover:bg-[#16a34a] text-white font-black text-sm tracking-wide shadow-md shadow-emerald-600/25 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span>Bill Save Karo</span>
          </button>

          {/* 7. Dual Action Buttons: Save & Print [Ctrl+P] + Send WhatsApp (Image 1 & 2) */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void handleSaveAndPrint()}
              disabled={!canCheckout || createSale.isPending || !online}
              className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
            >
              <Printer className="h-3.5 w-3.5 text-slate-500" />
              <span>Save & Print</span>
              <span className="text-[10px] text-slate-400 font-normal">Ctrl+P</span>
            </button>

            <button
              type="button"
              onClick={() => void handleSendWhatsApp()}
              disabled={!canCheckout || createSale.isPending || !online}
              className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border border-emerald-200 bg-emerald-50/70 hover:bg-emerald-100/70 text-xs font-bold text-emerald-800 shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
            >
              <MessageSquare className="h-3.5 w-3.5 text-emerald-600" />
              <span>Send WhatsApp</span>
            </button>
          </div>

          {/* 8. Other/Credit Payments (Ctrl+M) Button matching Image 1 & 2 */}
          <div className="text-center pt-1">
            <button
              type="button"
              onClick={() => setShowPaymentModal(true)}
              className="w-full py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-[#1877F2] shadow-2xs transition-colors cursor-pointer"
            >
              Other/Credit Payments <span className="text-[10px] text-slate-400 font-normal">Ctrl+M</span>
            </button>
          </div>
        </div>
      </div>

      {/* ----------------- ADVANCED / SPLIT PAYMENT MODAL ----------------- */}
      {showPaymentModal && (
        <PaymentModal
          total={cart.totals.grandTotal}
          customerId={cart.state.customerId}
          customerName={cart.state.customerName}
          lines={cart.state.lines}
          submitting={createSale.isPending}
          skipPriceCheck={!!cart.state.quotationId}
          onCancel={() => setShowPaymentModal(false)}
          onConfirm={(payments) => void submitSale(payments, 'COMPLETED', true)}
          onRateChange={(variantId, rate) => {
            const line = cart.state.lines.find((l) => l.variantId === variantId);
            if (line) cart.updateLine(line.key, { rate });
          }}
        />
      )}

      {/* ----------------- CLEAR BILL CONFIRMATION ----------------- */}
      <ConfirmDialog
        open={confirmClear}
        title="Clear this bill?"
        message="Every item in this invoice will be removed."
        confirmLabel="Clear bill"
        destructive
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          cart.clear();
          setConfirmClear(false);
          searchRef.current?.focus();
        }}
      />

      {/* ----------------- ADD / EDIT CUSTOMER MODAL ----------------- */}
      {customerModal.open && (
        <CustomerFormModal
          customer={customerModal.customer}
          onClose={() => setCustomerModal({ open: false, customer: null })}
          onCreated={(cust) => {
            cart.setCustomer(cust.id, cust.name, cust.mobile, cust.address, cust.gstin);
            toast.success('Customer selected', cust.name);
          }}
        />
      )}

    </div>
  );
}

export default PosPage;
