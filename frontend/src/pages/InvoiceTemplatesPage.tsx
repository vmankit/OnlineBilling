import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Hash, Image as ImageIcon, Printer, Save, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { FieldError, Input, Label, Textarea } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { useSettings, useUpdateSetting } from '@/services/catalog';
import {
  DOC_TYPE_LABELS, previewNumber, useSaveSequence, useSequences,
  type DocType, type NumberingSeries,
} from '@/services/sequences';
import { useAuth } from '@/features/auth/AuthProvider';
import { InvoiceA4 } from '@/features/invoices/InvoiceA4';
import { fileToLogo } from '@/features/invoices/logoFile';
import { ZoomableBill } from '@/features/invoices/ZoomableBill';
import { Modal } from '@/components/ui/Modal';
import { InvoiceThermal } from '@/features/invoices/InvoiceThermal';
import { saleToThermal } from '@/features/invoices/toThermal';
import {
  PRINT_FORMAT_LABELS, usePrintFormat, type PrintFormat,
} from '@/features/invoices/usePrintFormat';
import '@/features/invoices/print.css';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { BusinessSettings } from '@/types';
import type { SaleDetail } from '@/services/sales';

/**
 * Invoice settings.
 *
 * Every control here writes to the same `business` settings row the printed
 * documents read, and the preview is rendered by the very components that
 * print — so what is on screen is what comes out of the printer.
 */
const DEFAULT_LOGO = '/santu-logo-official.png';
const DEFAULT_THERMAL_LOGO = '/santu-logo-thermal.png';

/** The whole bill, shrunk to fit its frame, so the effect of a logo change is visible in place. */
function MiniBill({ naturalWidth, title, children }: { naturalWidth: number; title: string; children: JSX.Element }): JSX.Element {
  const [zoomed, setZoomed] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ scale: 0.3, height: 300 });
  useEffect(() => {
    const measure = (): void => {
      if (!frame.current || !inner.current) return;
      const scale = frame.current.clientWidth / naturalWidth;
      setBox({ scale, height: inner.current.offsetHeight * scale });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (frame.current) ro.observe(frame.current);
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
  }, [naturalWidth]);
  return (
    <>
      <div
        role="button"
        tabIndex={0}
        ref={frame}
        onClick={() => setZoomed(true)}
        onKeyDown={(e) => e.key === 'Enter' && setZoomed(true)}
        title="Click to zoom"
        className="relative w-full min-w-0 cursor-zoom-in select-none overflow-hidden rounded-lg border border-slate-300 bg-slate-100 text-left"
        style={{ height: box.height, contain: 'paint' }}
      >
        <div ref={inner} className="pointer-events-none" style={{ width: naturalWidth, transform: `scale(${box.scale})`, transformOrigin: 'top left' }}>
          {children}
        </div>
      </div>
      <Modal open={zoomed} onClose={() => setZoomed(false)} title={title} size="xl">
        <ZoomableBill naturalWidth={naturalWidth}>{children}</ZoomableBill>
      </Modal>
    </>
  );
}

function LogoRow({
  label, value, fallback, shown, height, disabled, onPick, onError, onToggle, onHeight, bill, naturalWidth,
}: {
  bill: JSX.Element; naturalWidth: number;
  label: string; value: string; fallback: string; shown: boolean; height: number; disabled?: boolean;
  onPick: (v: string) => void; onError: () => void; onToggle: (v: boolean) => void; onHeight: (v: number) => void;
}): JSX.Element {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_15rem] gap-3 rounded-xl border border-slate-200 p-3">
      <div className="min-w-0 space-y-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-sm font-semibold text-slate-800">{label}</span>
          <label
            className={`inline-flex h-7 cursor-pointer items-center rounded-md bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800 ${disabled ? 'pointer-events-none opacity-50' : ''}`}
          >
            Upload
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              disabled={disabled}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                try {
                  onPick(await fileToLogo(file));
                } catch {
                  onError();
                }
              }}
            />
          </label>
          {value && value !== fallback && (
            <button type="button" disabled={disabled} onClick={() => onPick(fallback)} className="text-xs font-semibold text-slate-500 hover:text-slate-800">
              Reset
            </button>
          )}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700">
          <input type="checkbox" checked={shown} disabled={disabled} onChange={(e) => onToggle(e.target.checked)} className="h-4 w-4 accent-brand-600" />
          Show on bill
        </label>
        {shown && (
          <div className="flex items-center gap-2">
            <input
              type="range" min={30} max={160} step={2} value={height} disabled={disabled}
              onChange={(e) => onHeight(Number(e.target.value))}
              className="min-w-0 flex-1 accent-brand-600"
            />
            <span className="w-12 shrink-0 text-right text-xs tabular-nums text-slate-500">{height} px</span>
          </div>
        )}
      </div>
      <MiniBill naturalWidth={naturalWidth} title={`${label} preview`}>{bill}</MiniBill>
    </div>
  );
}

export function InvoiceTemplatesPage(): JSX.Element {
  const { user } = useAuth();
  const toast = useToast();
  const { data: settings, isLoading } = useSettings();
  const updateSetting = useUpdateSetting();
  const sequences = useSequences();
  const saveSequence = useSaveSequence();
  const print = usePrintFormat();

  const readOnly = user?.role !== 'ADMIN';
  const [form, setForm] = useState<BusinessSettings | null>(null);
  const [preview, setPreview] = useState<PrintFormat>('THERMAL_80');
  const [error, setError] = useState('');

  useEffect(() => {
    if (settings?.business) setForm(settings.business);
  }, [settings]);

  const set = (patch: Partial<BusinessSettings>): void =>
    setForm((f) => (f ? { ...f, ...patch } : f));

  const sample = useMemo(() => sampleSale(form), [form]);

  /** Size and show/hide changes are stored a moment after the last tweak, so nothing depends on pressing Save. */
  const saveTimer = useRef<number | undefined>(undefined);
  const autoSave = (patch: Partial<BusinessSettings>, delay = 600): void => {
    if (!form) return;
    const next = { ...form, ...patch };
    setForm(next);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      updateSetting.mutate(
        { key: 'business', value: next },
        { onError: (err) => toast.error('Not saved', err instanceof ApiError ? err.message : 'Please try again.') },
      );
    }, delay);
  };

  /** A picked logo is stored straight away, so it is not lost if Save is never pressed. */
  const saveLogo = async (patch: Partial<BusinessSettings>): Promise<void> => {
    if (!form) return;
    const next = { ...form, ...patch };
    setForm(next);
    try {
      await updateSetting.mutateAsync({ key: 'business', value: next });
      toast.success('Logo saved', 'New bills will use it.');
    } catch (err) {
      toast.error('Logo not saved', err instanceof ApiError ? err.message : 'Please try again.');
    }
  };

  const save = async (): Promise<void> => {
    if (!form) return;
    setError('');
    try {
      await updateSetting.mutateAsync({ key: 'business', value: form });
      toast.success('Invoice settings saved', 'New bills will print with these settings.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save these settings.');
    }
  };

  if (isLoading || !form) {
    return (
      <div className="space-y-4 p-4 lg:p-8">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="no-print flex flex-wrap items-center justify-between gap-3 px-4 pb-4 pt-6 lg:px-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Invoice settings</h1>
          <p className="mt-1 text-[15px] text-slate-500">
            {readOnly
              ? 'Only an administrator can change these.'
              : 'Everything here is saved to the shop settings and used on every bill.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => print(preview)}>
            <Printer className="h-5 w-5" />
            Test print
          </Button>
          {!readOnly && (
            <Button onClick={() => void save()} loading={updateSetting.isPending}>
              <Save className="h-5 w-5" />
              Save
            </Button>
          )}
        </div>
      </div>

      <div className="grid flex-1 gap-5 px-4 pb-12 lg:px-8 xl:grid-cols-[380px_1fr]">
        {/* ------------------------------ controls ------------------------------ */}
        <div className="no-print space-y-5">
          <Section title="Default paper" icon={<Printer className="h-4 w-4" />}>
            <div className="space-y-2">
              {(Object.keys(PRINT_FORMAT_LABELS) as PrintFormat[]).map((f) => (
                <button
                  key={f}
                  disabled={readOnly}
                  onClick={() => set({ defaultPrintFormat: f })}
                  className={cn(
                    'flex w-full touch-target items-center justify-between rounded-xl border px-4 text-left transition-colors',
                    form.defaultPrintFormat === f
                      ? 'border-brand-200 bg-brand-50 text-brand-700'
                      : 'border-slate-200 hover:bg-slate-50',
                    readOnly && 'cursor-not-allowed opacity-60',
                  )}
                >
                  <span className="text-sm font-medium">
                    {PRINT_FORMAT_LABELS[f]}
                    <span className="ml-2 font-normal text-slate-500">
                      {f === 'A4' ? 'full page' : 'thermal roll'}
                    </span>
                  </span>
                  {form.defaultPrintFormat === f && <Check className="h-5 w-5" />}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Logo" icon={<ImageIcon className="h-4 w-4" />}>
            <div className="space-y-3">
              <LogoRow
                label="A4 invoice"
                value={form.logoUrl}
                fallback={DEFAULT_LOGO}
                shown={form.showLogoOnA4 !== false}
                height={form.a4LogoHeight ?? 80}
                disabled={readOnly}
                onPick={(v) => void saveLogo({ logoUrl: v })}
                onError={() => toast.error('Could not read this image', 'Pick a PNG or JPG file.')}
                onToggle={(v) => autoSave({ showLogoOnA4: v }, 0)}
                onHeight={(v) => autoSave({ a4LogoHeight: v })}
                naturalWidth={794}
                bill={<InvoiceA4 sale={sample} />}
              />
              <LogoRow
                label="Thermal receipt"
                value={form.thermalLogoUrl || ''}
                fallback={DEFAULT_THERMAL_LOGO}
                shown={form.showLogoOnThermal !== false}
                height={form.thermalLogoHeight ?? 100}
                disabled={readOnly}
                onPick={(v) => void saveLogo({ thermalLogoUrl: v })}
                onError={() => toast.error('Could not read this image', 'Pick a PNG or JPG file.')}
                onToggle={(v) => autoSave({ showLogoOnThermal: v }, 0)}
                onHeight={(v) => autoSave({ thermalLogoHeight: v })}
                naturalWidth={320}
                bill={<InvoiceThermal doc={saleToThermal(sample)} width={80} />}
              />
              <p className="text-xs text-slate-500">
                Logo, size and show/hide are saved automatically.
              </p>
            </div>
          </Section>

          <Section title="Scan & Pay" icon={<Smartphone className="h-4 w-4" />}>
            <Label htmlFor="upi-id">UPI ID</Label>
            <Input
              id="upi-id"
              value={form.upiId}
              disabled={readOnly}
              className="font-mono"
              autoCapitalize="none"
              placeholder="7739802334-2@ybl"
              onChange={(e) => autoSave({ upiId: e.target.value.trim() }, 900)}
            />
            <p className="mt-1.5 text-xs text-slate-500">
              The QR on every receipt uses this, and it is saved automatically. Leave it blank to print no QR.
            </p>

            <div className="mt-4">
              <Label htmlFor="upi-name">Payee name</Label>
              <Input
                id="upi-name"
                value={form.upiPayeeName}
                disabled={readOnly}
                onChange={(e) => autoSave({ upiPayeeName: e.target.value }, 900)}
              />
            </div>
          </Section>

          <Section title="Footer" icon={<Hash className="h-4 w-4" />}>
            <Label htmlFor="exchange">Exchange note</Label>
            <Input
              id="exchange"
              value={form.exchangeNote}
              disabled={readOnly}
              onChange={(e) => set({ exchangeNote: e.target.value })}
            />
            <div className="mt-4">
              <Label htmlFor="terms">Terms &amp; conditions</Label>
              <Textarea
                id="terms"
                rows={3}
                value={form.terms}
                disabled={readOnly}
                onChange={(e) => set({ terms: e.target.value })}
              />
            </div>
            <div className="mt-4">
              <Label htmlFor="thanks">Closing line</Label>
              <Input
                id="thanks"
                value={form.thankYouNote}
                disabled={readOnly}
                onChange={(e) => set({ thankYouNote: e.target.value })}
              />
            </div>
          </Section>

          <FieldError>{error}</FieldError>
        </div>

        {/* ------------------------------ preview ------------------------------ */}
        <div>
          <div className="no-print mb-3 inline-flex overflow-hidden rounded-xl border border-slate-200 bg-white">
            {(Object.keys(PRINT_FORMAT_LABELS) as PrintFormat[]).map((f) => (
              <button
                key={f}
                onClick={() => setPreview(f)}
                className={cn(
                  'touch-target px-5 text-sm font-medium transition-colors',
                  preview === f ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-50',
                )}
              >
                {PRINT_FORMAT_LABELS[f]}
              </button>
            ))}
          </div>

          <div className="print-root rounded-2xl bg-slate-100 p-4 print:bg-white print:p-0">
            {preview === 'A4' ? (
              <ZoomableBill naturalWidth={794} maxHeight="75vh">
                <InvoiceA4 sale={sample} />
              </ZoomableBill>
            ) : (
              <InvoiceThermal
                doc={saleToThermal(sample)}
                width={preview === 'THERMAL_80' ? 80 : 58}
              />
            )}
          </div>

          <p className="no-print mt-3 text-sm text-slate-500">
            Sample bill with a converted line (10 FEET sold from metre stock) and a split,
            part-paid payment — so nothing surprises you on paper.
          </p>

          {/* ------------------------- numbering series ------------------------- */}
          <div className="no-print mt-6">
            <h2 className="text-base font-semibold text-slate-900">Document numbering</h2>
            <p className="mt-1 text-sm text-slate-500">
              Use <code className="font-mono">{'{YYYY}'}</code>, <code className="font-mono">{'{YY}'}</code>{' '}
              or <code className="font-mono">{'{MM}'}</code> in the prefix for a date-based series.
            </p>

            {sequences.isLoading && <Skeleton className="mt-3 h-40 w-full" />}

            <div className="mt-3 space-y-3">
              {sequences.data?.map((series) => (
                <SeriesRow
                  key={series.doc_type}
                  series={series}
                  readOnly={readOnly}
                  onSave={async (next) => {
                    try {
                      await saveSequence.mutateAsync({
                        docType: series.doc_type,
                        payload: next,
                      });
                      toast.success(
                        `${DOC_TYPE_LABELS[series.doc_type]} numbering saved`,
                        `Next: ${previewNumber(next)}`,
                      );
                    } catch (err) {
                      toast.error(
                        'Could not save numbering',
                        err instanceof ApiError ? err.message : undefined,
                      );
                    }
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: JSX.Element;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center gap-2 text-slate-900">
        <span className="text-slate-400">{icon}</span>
        <h2 className="text-[15px] font-semibold">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function SeriesRow({
  series,
  readOnly,
  onSave,
}: {
  series: NumberingSeries;
  readOnly: boolean;
  onSave: (next: Omit<NumberingSeries, 'doc_type'>) => Promise<void>;
}): JSX.Element {
  const [prefix, setPrefix] = useState(series.prefix);
  const [suffix, setSuffix] = useState(series.suffix ?? '');
  const [padding, setPadding] = useState(String(series.padding));
  const [nextNumber, setNextNumber] = useState(String(series.next_number));
  const [saving, setSaving] = useState(false);

  const next = {
    prefix,
    suffix,
    padding: Number(padding) || 1,
    next_number: Number(nextNumber) || 1,
  };
  const dirty =
    prefix !== series.prefix ||
    suffix !== (series.suffix ?? '') ||
    Number(padding) !== series.padding ||
    Number(nextNumber) !== series.next_number;

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">
          {DOC_TYPE_LABELS[series.doc_type as DocType] ?? series.doc_type}
        </p>
        <p className="font-mono text-sm font-medium text-brand-700">{previewNumber(next)}</p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="text-xs text-slate-500">
          Prefix
          <Input
            value={prefix}
            disabled={readOnly}
            onChange={(e) => setPrefix(e.target.value)}
            className="mt-1 h-11 font-mono"
          />
        </label>
        <label className="text-xs text-slate-500">
          Next no.
          <Input
            value={nextNumber}
            disabled={readOnly}
            inputMode="numeric"
            onChange={(e) => setNextNumber(e.target.value)}
            className="mt-1 h-11"
          />
        </label>
        <label className="text-xs text-slate-500">
          Digits
          <Input
            value={padding}
            disabled={readOnly}
            inputMode="numeric"
            onChange={(e) => setPadding(e.target.value)}
            className="mt-1 h-11"
          />
        </label>
        <label className="text-xs text-slate-500">
          Suffix
          <Input
            value={suffix}
            disabled={readOnly}
            onChange={(e) => setSuffix(e.target.value)}
            className="mt-1 h-11 font-mono"
          />
        </label>
      </div>

      {!readOnly && dirty && (
        <Button
          size="sm"
          className="mt-3"
          loading={saving}
          onClick={() => {
            setSaving(true);
            void onSave(next).finally(() => setSaving(false));
          }}
        >
          Save series
        </Button>
      )}
    </div>
  );
}

/** A representative bill so each template can be judged before it is used. */
function sampleSale(business: BusinessSettings | null): SaleDetail {
  const now = new Date().toISOString();
  return {
    id: 'sample',
    invoice_number: 'INV-00042',
    customer_id: null,
    customer_name: 'Ramesh Kumar Constructions',
    customer_mobile: '9835012345',
    customer_address: 'Chhapra Road, Saran, Bihar',
    customer_gstin: null,
    invoice_date: now,
    subtotal: 25290,
    item_discount: 400,
    bill_discount: 200,
    tax_amount: 0,
    round_off: 0,
    grand_total: 24690,
    paid_amount: 20000,
    due_amount: 4690,
    payment_status: 'PARTIAL',
    status: 'COMPLETED',
    notes: null,
    cancel_reason: null,
    items: [
      {
        id: 'l1', line_no: 1, item_name: 'Asian Paints Apex Ultima Exterior Emulsion',
        item_code: 'AP-APEXULT', hsn_code: '3209', variant_name: '20 L',
        quantity: 2, sold_unit: 'LITRE', stock_qty: 40, rate: 11400, mrp: 12800,
        discount_pct: 0, discount_amt: 400, tax_rate: 0, tax_amount: 0, line_total: 22400,
      },
      {
        id: 'l2', line_no: 2, item_name: 'Astral CPVC Pipe 1 inch SDR-11',
        item_code: 'AS-CPVC-1', hsn_code: '3917', variant_name: 'Per Meter',
        quantity: 10, sold_unit: 'FEET', stock_qty: 3.048, rate: 82, mrp: 92,
        discount_pct: 0, discount_amt: 0, tax_rate: 0, tax_amount: 0, line_total: 820,
      },
      {
        id: 'l3', line_no: 3, item_name: 'Birla Opus Wall Putty',
        item_code: 'BO-PUTTY', hsn_code: '3214', variant_name: '20 KG',
        quantity: 2, sold_unit: 'KG', stock_qty: 40, rate: 760, mrp: 860,
        discount_pct: 0, discount_amt: 0, tax_rate: 0, tax_amount: 0, line_total: 1520,
      },
    ],
    payments: [
      {
        id: 'p1', payment_number: 'PAY-00031', amount: 20000, payment_date: now,
        methods: [
          { method: 'CASH', amount: 8000, reference: null },
          { method: 'UPI', amount: 12000, reference: 'UPI/4417' },
        ],
      },
    ],
    business,
  };
}
