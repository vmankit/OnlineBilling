import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, FileCheck2, MessageCircle, Printer, Receipt } from 'lucide-react';
import { Badge, Card, EmptyState, Skeleton } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/features/auth/AuthProvider';
import { useCancelQuotation, useQuotation } from '@/services/quotations';
import {
  PRINT_FORMAT_LABELS, usePrintFormat, type PrintFormat,
} from '@/features/invoices/usePrintFormat';
import { InvoiceThermal } from '@/features/invoices/InvoiceThermal';
import { quotationToThermal } from '@/features/invoices/toThermal';
import '@/features/invoices/print.css';
import { ApiError } from '@/lib/api';
import { formatDate, formatDateTime, formatMoney, formatQty } from '@/lib/utils';
import { buildWaLink } from '@/features/whatsapp/whatsapp';

export function QuotationDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const { data, isLoading, isError } = useQuotation(id);
  const cancel = useCancelQuotation();
  const print = usePrintFormat();
  const [confirming, setConfirming] = useState(false);
  const [format, setFormat] = useState<PrintFormat>('A4');

  if (isLoading) {
    return (
      <div className="space-y-4 p-4 lg:p-8">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-4 lg:p-8">
        <Card>
          <EmptyState
            title="Quotation not found"
            action={
              <Link to="/quotations">
                <Button variant="secondary">Back to quotations</Button>
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  const biz = data.business;
  const expired =
    data.status === 'OPEN' && !!data.valid_until && new Date(data.valid_until) < new Date();

  const shareText =
    `${biz?.name ?? 'SANTU HARDWARE'}\n` +
    `Quotation ${data.quotation_number}\n` +
    `Date: ${formatDate(data.quotation_date)}\n` +
    (data.valid_until ? `Valid until: ${formatDate(data.valid_until)}\n` : '') +
    `Total: ${formatMoney(data.grand_total)}\n\n` +
    data.items
      .map((i) => `${i.item_name} ${formatQty(i.quantity)} ${i.sold_unit} = ${formatMoney(i.line_total)}`)
      .join('\n');

  const whatsappUrl = buildWaLink(data.customer_mobile, shareText);

  const doCancel = async (): Promise<void> => {
    try {
      await cancel.mutateAsync(data.id);
      toast.success('Quotation cancelled');
      setConfirming(false);
    } catch (err) {
      toast.error('Could not cancel', err instanceof ApiError ? err.message : undefined);
    }
  };

  return (
    <>
      <div className="px-4 pb-12 pt-6 lg:px-8">
        <div className="no-print">
          <Link
            to="/quotations"
            className="mb-4 inline-flex touch-target items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800"
          >
            <ArrowLeft className="h-4 w-4" />
            All quotations
          </Link>

          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
                  {data.quotation_number}
                </h1>
                {data.status === 'CONVERTED' ? (
                  <Badge tone="green">Billed</Badge>
                ) : data.status === 'CANCELLED' ? (
                  <Badge tone="slate">Cancelled</Badge>
                ) : expired ? (
                  <Badge tone="amber">Expired</Badge>
                ) : (
                  <Badge tone="blue">Open</Badge>
                )}
              </div>
              <p className="mt-1 text-[15px] text-slate-500">
                {data.customer_name} · {formatDateTime(data.quotation_date)}
              </p>
              {data.converted_invoice_number && (
                <Link
                  to={`/sales/${data.converted_invoice_id}`}
                  className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-brand-600"
                >
                  <Receipt className="h-4 w-4" />
                  Billed as {data.converted_invoice_number}
                </Link>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <div className="inline-flex overflow-hidden rounded-xl border border-slate-200 bg-white">
                {(Object.keys(PRINT_FORMAT_LABELS) as PrintFormat[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFormat(f)}
                    className={
                      f === format
                        ? 'touch-target bg-brand-50 px-4 text-sm font-medium text-brand-700'
                        : 'touch-target px-4 text-sm font-medium text-slate-500 hover:bg-slate-50'
                    }
                  >
                    {PRINT_FORMAT_LABELS[f]}
                  </button>
                ))}
              </div>
              <Button variant="secondary" onClick={() => print(format)}>
                <Printer className="h-5 w-5" />
                Print / save PDF
              </Button>
              <a href={whatsappUrl} target="_blank" rel="noreferrer">
                <Button variant="secondary" className="text-emerald-700">
                  <MessageCircle className="h-5 w-5" />
                  WhatsApp
                </Button>
              </a>
              {data.status === 'OPEN' && can('sale:create') && (
                <Button variant="secondary" className="text-brand-700" onClick={() => navigate(`/quotations?convert=${data.id}`)}>
                  <FileCheck2 className="h-5 w-5" />
                  Convert to Bill
                </Button>
              )}
              {data.status === 'OPEN' && can('sale:create') && (
                <Button
                  variant="secondary"
                  className="text-rose-600"
                  onClick={() => setConfirming(true)}
                >
                  <Ban className="h-5 w-5" />
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="print-root">
          {format !== 'A4' ? (
            <InvoiceThermal
              doc={quotationToThermal(data)}
              width={format === 'THERMAL_80' ? 80 : 58}
            />
          ) : (
          <div className="printable mx-auto w-full max-w-[794px] bg-white p-8 sm:p-10 font-sans text-slate-900 shadow-md border border-slate-300 rounded-xl print:max-w-none print:p-0 print:border-none print:shadow-none select-text">
            {/* Header: Shop Left, Document Meta Right */}
            <div className="flex items-start justify-between gap-6 pb-4">
              <div className="flex flex-col items-start">
                <img
                  src={biz?.logoUrl || '/santu-logo-official.png'}
                  alt="Santu Hardware"
                  className="h-20 w-auto object-contain"
                />
                <div className="mt-2 text-xs text-slate-700 space-y-0.5">
                  <p>{biz?.addressLine1 || 'Main Road Ishuwapur, Saran, Bihar, 841411'}</p>
                  {biz?.addressLine2 && <p>{biz.addressLine2}</p>}
                  <p>Phone: {biz?.phonePrimary || '7739802334'}{biz?.phoneSecondary ? ` · ${biz.phoneSecondary}` : ''}</p>
                  <p className="font-semibold text-slate-800">
                    GSTIN: <span className="font-mono">{biz?.gstin || '10BULPP3722N1ZG'}</span>
                  </p>
                </div>
              </div>

              <div className="text-right">
                <h1 className="text-2xl font-black tracking-tight text-[#1D4ED8] uppercase">
                  ESTIMATE / QUOTATION
                </h1>
                <p className="mt-1 text-xs text-slate-600">
                  <span className="font-bold text-slate-800">Quote No:</span>{' '}
                  <span className="font-bold text-slate-900 tabular-nums">{data.quotation_number}</span>
                </p>
                <p className="text-xs text-slate-600">
                  <span className="font-bold text-slate-800">Date:</span> {formatDate(data.quotation_date)}
                </p>
                {data.valid_until && (
                  <p className="text-xs text-slate-600">
                    <span className="font-bold text-slate-800">Valid until:</span> {formatDate(data.valid_until)}
                  </p>
                )}
                <div className="mt-2">
                  {data.status === 'CANCELLED' ? (
                    <span className="inline-block rounded-md border border-rose-300 bg-rose-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-600">
                      CANCELLED
                    </span>
                  ) : data.status === 'CONVERTED' ? (
                    <span className="inline-block rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                      BILLED
                    </span>
                  ) : expired ? (
                    <span className="inline-block rounded-md border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">
                      EXPIRED
                    </span>
                  ) : (
                    <span className="inline-block rounded-md border border-blue-300 bg-blue-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-700">
                      ACTIVE QUOTE
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Horizontal Divider */}
            <div className="my-4 border-t border-slate-200" />

            {/* Customer on Left & Total on Right */}
            <div className="flex items-start justify-between gap-4 py-2">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  QUOTATION FOR
                </span>
                <h2 className="text-lg font-bold text-slate-900 mt-0.5">{data.customer_name}</h2>
                {data.customer_mobile && (
                  <p className="text-xs text-slate-600 mt-0.5">Phone: {data.customer_mobile}</p>
                )}
                {data.customer_address && (
                  <p className="text-xs font-medium text-slate-700 mt-0.5">{data.customer_address}</p>
                )}
              </div>

              <div className="text-right">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  ESTIMATED TOTAL
                </span>
                <p className="text-2xl font-black text-slate-900 mt-0.5 tabular-nums">
                  Rs. {formatMoney(data.grand_total).replace('₹', '').trim()}
                </p>
              </div>
            </div>

            {/* Items Table */}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b-2 border-slate-900 text-slate-700 font-bold uppercase text-[10px] tracking-wider">
                    <th className="py-2 text-left w-8">#</th>
                    <th className="py-2 text-left">ITEM</th>
                    <th className="py-2 text-center w-24">QTY</th>
                    <th className="py-2 text-right w-24">RATE</th>
                    <th className="py-2 text-right w-20">DISC</th>
                    <th className="py-2 text-right w-28">AMOUNT</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                      <td className="py-2.5 text-slate-400 align-top">{item.line_no}</td>
                      <td className="py-2.5 align-top">
                        <p className="font-bold text-slate-800">{item.item_name}</p>
                        {item.variant_name && (
                          <p className="text-[10px] text-slate-500">{item.variant_name}</p>
                        )}
                      </td>
                      <td className="py-2.5 text-center text-slate-700 align-top tabular-nums">
                        {formatQty(item.quantity)} {item.sold_unit}
                      </td>
                      <td className="py-2.5 text-right text-slate-700 align-top tabular-nums font-medium">
                        {formatMoney(item.rate)}
                      </td>
                      <td className="py-2.5 text-right text-slate-500 align-top tabular-nums">
                        {item.discount_amt > 0 ? `− ${formatMoney(item.discount_amt)}` : '—'}
                      </td>
                      <td className="py-2.5 text-right font-bold text-slate-900 align-top tabular-nums">
                        {formatMoney(item.line_total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals Section */}
            <div className="flex justify-end mt-4">
              <div className="w-64 space-y-1.5 text-xs">
                <Row label="Subtotal" value={formatMoney(data.subtotal)} />
                {data.item_discount > 0 && (
                  <Row label="Item discount" value={`− ${formatMoney(data.item_discount)}`} />
                )}
                {data.bill_discount > 0 && (
                  <Row label="Bill discount" value={`− ${formatMoney(data.bill_discount)}`} />
                )}
                <div className="border-t-2 border-slate-900 pt-2 flex justify-between items-baseline">
                  <span className="text-base font-bold text-slate-900">Grand Total</span>
                  <span className="text-xl font-black text-slate-900 tabular-nums">
                    {formatMoney(data.grand_total)}
                  </span>
                </div>
              </div>
            </div>

            {data.notes && (
              <p className="mt-4 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600 print:bg-transparent print:p-0">
                <span className="font-bold">Note:</span> {data.notes}
              </p>
            )}

            {/* Signatory */}
            <div className="flex justify-end mt-10">
              <div className="text-center w-56">
                <div className="border-t border-slate-400 w-full mb-1" />
                <p className="text-xs font-bold text-slate-800">For Santu Hardware</p>
                <p className="text-[10px] text-slate-500">Authorised Signatory</p>
              </div>
            </div>

            {/* Footer */}
            <div className="mt-8 pt-4 border-t border-dashed border-slate-200 text-center text-xs">
              <p className="font-semibold text-blue-600">Thank you for shopping with Santu Hardware!</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                https://santuhw.netlify.app | santuhardware7739@gmail.com
              </p>
            </div>
          </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Cancel this quotation?"
        message="It stays on file, but it can no longer be turned into a bill."
        confirmLabel="Cancel quotation"
        destructive
        loading={cancel.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void doCancel()}
      />
    </>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
