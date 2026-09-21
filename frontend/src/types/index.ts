export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Unit {
  code: string;
  name: string;
  dimension: 'COUNT' | 'WEIGHT' | 'VOLUME' | 'LENGTH';
  factor_to_base: number;
  is_base: boolean;
  decimals: number;
}

export interface NamedRecord {
  id: string;
  name: string;
}

export interface Warehouse extends NamedRecord {
  code: string;
  address: string | null;
  is_default: boolean;
  is_active: boolean;
}

export interface ItemVariant {
  id: string;
  item_id: string;
  name: string;
  sku: string;
  barcode: string | null;
  pack_size: number;
  pack_unit: string;
  purchase_price: number;
  selling_price: number;
  mrp: number;
  min_stock: number;
  is_default: boolean;
  is_active: boolean;
  stock: number;
}

export interface Item {
  id: string;
  name: string;
  item_code: string;
  description: string | null;
  hsn_code: string | null;
  tax_rate: number;
  stock_unit: string;
  is_active: boolean;
  brand_id: string | null;
  brand_name: string | null;
  category_id: string | null;
  category_name: string | null;
  item_group_id: string | null;
  item_group_name: string | null;
  created_at: string;
  variants: ItemVariant[];
}

export interface Customer {
  id: string;
  name: string;
  mobile: string | null;
  email: string | null;
  address: string | null;
  gstin: string | null;
  credit_limit: number;
  outstanding_balance: number;
  is_active: boolean;
  notes?: string | null;
  created_at: string;
}

export interface CustomerDetail extends Customer {
  stats: { invoice_count: number; total_purchases: number };
  invoices: Array<{
    id: string;
    invoice_number: string;
    invoice_date: string;
    grand_total: number;
    paid_amount: number;
    due_amount: number;
    payment_status: 'PAID' | 'PARTIAL' | 'UNPAID';
    status: string;
  }>;
  payments: Array<{
    id: string;
    payment_number: string;
    amount: number;
    payment_date: string;
    notes: string | null;
    methods: Array<{ method: string; amount: number }>;
  }>;
}

export interface BusinessSettings {
  name: string;
  tagline: string;
  /** Trade strip printed under the logo, e.g. "HARDWARE · ELECTRICAL · PAINTS". */
  trades: string;
  addressLine1: string;
  addressLine2: string;
  phonePrimary: string;
  phoneSecondary: string;
  /** Registration number printed as shop identity. No tax is charged on it. */
  gstin: string;
  state: string;
  logoUrl: string;
  /** Logo for thermal receipts; falls back to logoUrl when empty. */
  thermalLogoUrl?: string;
  /** Logo shown on the Shop Profile screen only; bills never use it. */
  shopLogoUrl?: string;
  /** Logo visibility and height (px) per paper size. */
  showLogoOnA4: boolean;
  showLogoOnThermal: boolean;
  a4LogoHeight: number;
  thermalLogoHeight: number;
  currency: string;
  /** UPI address the Scan & Pay code resolves to. */
  upiId: string;
  upiPayeeName: string;
  /** Printed in bold above the terms. */
  exchangeNote: string;
  /** Free text, printed small and centred. Hindi is fine. */
  terms: string;
  thankYouNote: string;
  invoiceFooter: string;
  defaultPrintFormat: 'A4' | 'THERMAL_58' | 'THERMAL_80';
}
