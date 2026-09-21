import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Item, ItemVariant } from '@/types';

const STORAGE_KEY = 'santu.pos.cart.v1';

export interface CartLine {
  /** Stable key for React and for quantity edits. */
  key: string;
  variantId: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  variantName: string;
  stockUnit: string;
  packUnit: string;
  packSize: number;
  availableStock: number;
  taxRate: number;
  mrp: number;
  quantity: number;
  soldUnit: string;
  rate: number;
  discountPct: number;
  discountAmt: number;
}

export interface CartState {
  customerId: string | null;
  customerName: string;
  customerMobile?: string | null;
  customerAddress?: string | null;
  customerGstin?: string | null;
  lines: CartLine[];
  billDiscount: number;
  notes: string;
  /** Set while this cart is a quotation being turned into a bill. */
  quotationId: string | null;
  quotationNumber: string | null;
}

const EMPTY: CartState = {
  customerId: null,
  customerName: 'Walk-in Customer',
  customerMobile: null,
  customerAddress: null,
  customerGstin: null,
  lines: [],
  billDiscount: 0,
  notes: '',
  quotationId: null,
  quotationNumber: null,
};

function persist(state: CartState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage full or private mode: the cart simply isn't restorable */
  }
}

function load(): CartState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as CartState;
    if (!Array.isArray(parsed.lines)) return EMPTY;
    return { ...EMPTY, ...parsed };
  } catch {
    return EMPTY;
  }
}

export function lineNet(line: CartLine): number {
  const gross = line.quantity * line.rate;
  const discount = line.discountAmt > 0 ? line.discountAmt : (gross * line.discountPct) / 100;
  return Math.max(0, gross - discount);
}

/**
 * POS cart. Mirrored into localStorage on every change so a Safari tab
 * reload, an accidental swipe, or the iPad putting the app to sleep never
 * loses a half-built bill.
 */
export function usePosCart() {
  const [state, setState] = useState<CartState>(load);
  // True only on the very first render, and only when the previous session
  // left a half-built bill behind — so the POS can say so once instead of
  // silently resurrecting lines the operator has forgotten about.
  const [restoredCount] = useState(() => state.lines.length);

  useEffect(() => persist(state), [state]);

  const addLine = useCallback((item: Item, variant: ItemVariant, quantity = 1) => {
    setState((prev) => {
      const existing = prev.lines.find((l) => l.variantId === variant.id && l.soldUnit === variant.pack_unit);
      if (existing) {
        return {
          ...prev,
          lines: prev.lines.map((l) =>
            l.key === existing.key ? { ...l, quantity: l.quantity + quantity } : l,
          ),
        };
      }

      // Default sale unit is a whole pack: one "20 L" tin, one piece, one coil.
      const line: CartLine = {
        key: `${variant.id}-${Date.now()}`,
        variantId: variant.id,
        itemId: item.id,
        itemName: item.name,
        itemCode: item.item_code,
        variantName: variant.name,
        stockUnit: item.stock_unit,
        packUnit: variant.pack_unit,
        packSize: Number(variant.pack_size),
        availableStock: Number(variant.stock),
        taxRate: Number(item.tax_rate),
        mrp: Number(variant.mrp),
        quantity,
        soldUnit: variant.pack_unit,
        rate: Number(variant.selling_price),
        discountPct: 0,
        discountAmt: 0,
      };
      return { ...prev, lines: [...prev.lines, line] };
    });
  }, []);

  const updateLine = useCallback((key: string, patch: Partial<CartLine>) => {
    setState((prev) => ({
      ...prev,
      lines: prev.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    }));
  }, []);

  const removeLine = useCallback((key: string) => {
    setState((prev) => ({ ...prev, lines: prev.lines.filter((l) => l.key !== key) }));
  }, []);

  const setCustomer = useCallback(
    (
      customerId: string | null,
      customerName: string,
      customerMobile: string | null = null,
      customerAddress: string | null = null,
      customerGstin: string | null = null,
    ) => {
      setState((prev) => ({
        ...prev,
        customerId,
        customerName,
        customerMobile,
        customerAddress,
        customerGstin,
      }));
    },
    [],
  );

  const setBillDiscount = useCallback((billDiscount: number) => {
    setState((prev) => ({ ...prev, billDiscount }));
  }, []);

  const setNotes = useCallback((notes: string) => {
    setState((prev) => ({ ...prev, notes }));
  }, []);

  /**
   * Empties the cart.
   *
   * Written to storage immediately, for the same reason loadCart is: the POS
   * clears the cart and navigates to the finished invoice in the same tick, so
   * the persist effect never runs. Without the eager write the bill that was
   * just sold is still sitting in the cart when the next customer walks up.
   */
  const clear = useCallback(() => {
    persist(EMPTY);
    setState(EMPTY);
  }, []);

  /**
   * Replaces the whole cart — used when a quotation is opened for billing.
   * The rates passed in are the ones the operator already chose (quoted or
   * current), so nothing is re-decided here.
   *
   * localStorage is written synchronously rather than waiting for the effect:
   * the caller navigates to the POS immediately afterwards, and this hook's
   * state lives per component. Without the eager write the quotations screen
   * unmounts before the effect runs and the POS loads an empty cart.
   */
  const loadCart = useCallback((next: CartState) => {
    persist(next);
    setState(next);
  }, []);

  const totals = useMemo(() => {
    const subtotal = state.lines.reduce((sum, l) => sum + l.quantity * l.rate, 0);
    const itemDiscount = state.lines.reduce(
      (sum, l) => sum + (l.discountAmt > 0 ? l.discountAmt : (l.quantity * l.rate * l.discountPct) / 100),
      0,
    );
    const net = state.lines.reduce((sum, l) => sum + lineNet(l), 0);
    const billDiscount = Math.min(state.billDiscount, net);
    const grandTotal = Math.max(0, net - billDiscount);
    const count = state.lines.reduce((sum, l) => sum + l.quantity, 0);
    return { subtotal, itemDiscount, billDiscount, grandTotal, count };
  }, [state]);

  return {
    state,
    totals,
    restoredCount,
    addLine,
    updateLine,
    removeLine,
    setCustomer,
    setBillDiscount,
    setNotes,
    clear,
    loadCart,
  };
}
