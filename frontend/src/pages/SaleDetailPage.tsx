import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Ban, FileText, Share2, Undo2 } from 'lucide-react';
import { Badge, Card, EmptyState, Skeleton } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/features/auth/AuthProvider';
import { useCancelSale, useSale } from '@/services/sales';
import { useCreateQuotation } from '@/services/quotations';
import { ApiError } from '@/lib/api';
import { formatDateTime, formatMoney, formatQty } from '@/lib/utils';
import { FitToScreen } from '@/components/layout/FitToScreen';
import { InvoiceA4 } from '@/features/invoices/InvoiceA4';
import { InvoiceThermal } from '@/features/invoices/InvoiceThermal';
import { saleToThermal } from '@/features/invoices/toThermal';
import {
  PRINT_FORMAT_LABELS, usePrintFormat, type PrintFormat,
} from '@/features/invoices/usePrintFormat';
import '@/features/invoices/print.css';
import { SalesReturnModal } from '@/features/returns/SalesReturnModal';
import { sendBillOnWhatsApp } from '@/features/whatsapp/sendBill';
import { normalizeIndianMobile } from '@/features/whatsapp/whatsapp';
import { useWhatsAppBridgeStatus } from '@/services/whatsappBridge';

export function SaleDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const toast = useToast();
  const createQuotation = useCreateQuotation();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useSale(id);
  const cancel = useCancelSale();
  const print = usePrintFormat();
  const [format, setFormat] = useState<PrintFormat>('A4');
  const [cancelling, setCancelling] = useState(false);
  const [returning, setReturning] = useState(false);
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false);
  const { data: bridge } = useWhatsAppBridgeStatus();
  const [reason, setReason] = useState('');
  const [cancelError, setCancelError] = useState('');

  // The Print button on the Sale Invoices list opens this page with
  // ?print=1. Nothing read it, so that button only ever opened the bill.
  // It prints once, after the bill has loaded, and the flag is then dropped
  // so a reload or Back does not print a second copy.
  const [params, setParams] = useSearchParams();
  const printedRef = useRef(false);
  useEffect(() => {
    if (!data || printedRef.current || (params.get('print') !== '1' && params.get('print') !== 'true')) return;
    printedRef.current = true;
    setParams({}, { replace: true });
    // One frame so the invoice is laid out before the print dialog opens.
    requestAnimationFrame(() => print(format));
  }, [data, params, setParams, print, format]);

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
            title="Invoice not found"
            action={
              <Link to="/sales">
                <Button variant="secondary">Back to sales</Button>
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  const shareText =
    `${data.business?.name ?? 'SANTU HARDWARE'}\n` +
    `Invoice ${data.invoice_number}\n` +
    `Date: ${formatDateTime(data.invoice_date)}\n` +
    `Total: ${formatMoney(data.grand_total)}\n` +
    (data.due_amount > 0 ? `Due: ${formatMoney(data.due_amount)}\n` : 'Paid in full\n') +
    `\n${data.items.map((i) => `${i.item_name} ${formatQty(i.quantity)} ${i.sold_unit} = ${formatMoney(i.line_total)}`).join('\n')}`;



  const share = async (): Promise<void> => {
    if (navigator.share) {
      try {
        await navigator.share({ title: `Invoice ${data.invoice_number}`, text: shareText });
        return;
      } catch {
        /* user dismissed the sheet */
      }
    }
    try {
      await navigator.clipboard.writeText(shareText);
      toast.success('Invoice copied', 'Paste it wherever you need.');
    } catch {
      toast.error('Could not share this invoice');
    }
  };

  // Straight to the customer, no window: a notice says whether it went.
  /** Copies this bill's lines into a new estimate. The bill itself is left as it is. */
  const makeEstimate = async (): Promise<void> => {
    if (!data) return;
    if (data.items.some((l) => !l.variant_id)) {
      toast.error('Estimate nahi bana', 'Is bill ki lines ka item link nahi mila.');
      return;
    }
    try {
      const quote = await createQuotation.mutateAsync({
        customer_id: data.customer_id ?? null,
        customer_name: data.customer_name,
        customer_mobile: data.customer_mobile ?? null,
        customer_address: data.customer_address ?? null,
        customer_gstin: data.customer_gstin ?? null,
        valid_until: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
        bill_discount: Number(data.bill_discount) || 0,
        notes: data.notes ?? null,
        items: data.items.map((l) => ({
          variant_id: l.variant_id,
          quantity: Number(l.quantity),
          sold_unit: l.sold_unit,
          rate: Number(l.rate),
          discount_pct: Number(l.discount_pct) || 0,
          discount_amt: Number(l.discount_amt) || 0,
        })),
      });
      toast.success('Estimate bana', quote.quotation_number);
      navigate(`/quotations/${quote.id}`);
    } catch (err) {
      toast.error('Estimate nahi bana', err instanceof ApiError ? err.message : undefined);
    }
  };

  const sendWhatsApp = async (): Promise<void> => {
    if (!normalizeIndianMobile(data.customer_mobile)) {
      toast.error('WhatsApp par nahi gaya', 'Customer ka mobile number nahi hai.');
      return;
    }
    if (bridge?.state !== 'CONNECTED') {
      toast.error('WhatsApp par nahi gaya', 'Phone linked nahi hai. WhatsApp me "Link phone" karein.');
      return;
    }
    setSendingWhatsApp(true);
    const res = await sendBillOnWhatsApp(
      data,
      data.customer_mobile,
      `${data.invoice_number} — ${formatMoney(data.grand_total)}`,
    );
    setSendingWhatsApp(false);
    if (res.sent) toast.success('Sent on WhatsApp', data.customer_name);
    else toast.error('WhatsApp par nahi gaya', res.error);
  };

  const doCancel = async (): Promise<void> => {
    setCancelError('');
    if (reason.trim().length < 3) {
      setCancelError('Give a short reason for the cancellation.');
      return;
    }
    try {
      await cancel.mutateAsync({ id: data.id, reason: reason.trim() });
      toast.success('Invoice cancelled', 'Stock has been returned.');
      setCancelling(false);
    } catch (err) {
      setCancelError(err instanceof ApiError ? err.message : 'Unable to cancel this invoice.');
    }
  };

  const canCancel =
    data.status === 'COMPLETED' && (user?.role === 'ADMIN' || user?.role === 'MANAGER');

  return (
    <>
      {/* One screen: a single header row on top, the bill scaled to the room
          that is left. The page used to be a tall header, two rows of
          buttons and a full-size A4 sheet, so the bottom of every bill was a
          scroll away. */}
      <div className="flex h-full min-h-0 flex-col px-4 pb-3 pt-3 lg:px-6">
        <div className="no-print mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              to="/sales"
              title="All sales"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-white hover:text-slate-800"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-slate-900 tabular-nums">
                  {data.invoice_number}
                </h1>
                {data.status === 'CANCELLED' ? (
                  <Badge tone="slate">Cancelled</Badge>
                ) : (
                  <Badge
                    tone={
                      data.payment_status === 'PAID'
                        ? 'green'
                        : data.payment_status === 'PARTIAL'
                          ? 'amber'
                          : 'red'
                    }
                  >
                    {data.payment_status}
                  </Badge>
                )}
                <span className="truncate text-sm text-slate-500">
                  {data.customer_name} · {formatDateTime(data.invoice_date)}
                </span>
              </div>
              {data.cancel_reason && (
                <p className="text-xs text-rose-600">Cancelled: {data.cancel_reason}</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 bg-white">
              {(Object.keys(PRINT_FORMAT_LABELS) as PrintFormat[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={
                    f === format
                      ? 'h-9 bg-brand-50 px-3 text-sm font-medium text-brand-700'
                      : 'h-9 px-3 text-sm font-medium text-slate-500 hover:bg-slate-50'
                  }
                >
                  {PRINT_FORMAT_LABELS[f]}
                </button>
              ))}
            </div>
            <Button variant="secondary" onClick={() => print(format)} className="flex h-9 items-center gap-1.5 px-3">
              <img src="/icons/sales/print-invoice-blue.svg" alt="" className="h-4 w-4" />
              <span>Print</span>
            </Button>
            <Button variant="secondary" onClick={() => void share()} className="flex h-9 items-center gap-1.5 px-3">
              <Share2 className="h-4 w-4" />
              <span>Share</span>
            </Button>
            <Button
              variant="secondary"
              className="flex h-9 cursor-pointer items-center gap-1.5 border-emerald-200 px-3 text-emerald-700 hover:bg-emerald-50"
              onClick={() => void sendWhatsApp()}
              disabled={sendingWhatsApp}
            >
              <img src="/icons/whatsapp/whatsapp.svg" alt="" className="h-4 w-4" />
              <span>WhatsApp</span>
            </Button>
            <Button
              variant="secondary"
              className="flex h-9 items-center gap-1.5 px-3"
              onClick={() => void makeEstimate()}
              disabled={createQuotation.isPending}
            >
              <FileText className="h-4 w-4" />
              Make Estimate
            </Button>
            {data.status === 'COMPLETED' && (
              <Button variant="secondary" className="flex h-9 items-center gap-1.5 px-3" onClick={() => setReturning(true)}>
                <Undo2 className="h-4 w-4" />
                Return
              </Button>
            )}
            {canCancel && (
              <Button
                variant="secondary"
                className="flex h-9 items-center gap-1.5 px-3 text-rose-600"
                onClick={() => setCancelling(true)}
              >
                <Ban className="h-4 w-4" />
                Cancel
              </Button>
            )}
          </div>
        </div>

        <div className="print-root min-h-0 flex-1">
          <FitToScreen minScale={format === 'A4' ? 0.5 : 0.6}>
            {format === 'A4' ? (
              <InvoiceA4 sale={data} />
            ) : (
              <InvoiceThermal doc={saleToThermal(data)} width={format === 'THERMAL_80' ? 80 : 58} />
            )}
          </FitToScreen>
        </div>
      </div>

      {returning && <SalesReturnModal invoiceId={data.id} onClose={() => setReturning(false)} />}

      <Modal
        open={cancelling}
        onClose={() => setCancelling(false)}
        title="Cancel this invoice?"
        description="The invoice stays on file for audit, and every item returns to stock."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelling(false)} disabled={cancel.isPending}>
              Keep invoice
            </Button>
            <Button variant="danger" onClick={() => void doCancel()} loading={cancel.isPending}>
              Cancel invoice
            </Button>
          </>
        }
      >
        <label className="block text-sm font-medium text-slate-700">Reason</label>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Wrong item billed"
          className="mt-1.5"
          autoFocus
        />
        {cancelError && <p className="mt-2 text-sm text-rose-600">{cancelError}</p>}
      </Modal>

    </>
  );
}
