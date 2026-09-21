import { Fragment, useEffect, useState } from 'react';
import { TrimmedLogo } from './TrimmedLogo';
import QRCode from 'qrcode';
import { formatDateTime, formatMoney, formatQty } from '@/lib/utils';
import type { BusinessSettings } from '@/types';

export interface ThermalLine {
  id: string;
  line_no: number;
  item_name: string;
  variant_name: string | null;
  quantity: number;
  sold_unit: string;
  rate: number;
  discount_amt: number;
  line_total: number;
}

export interface ThermalDocument {
  /** Printed under the header, e.g. "QUOTATION (Not a Tax Invoice)". */
  title: string;
  number: string;
  date: string;
  customerName: string;
  customerMobile: string | null;
  customerAddress?: string | null;
  items: ThermalLine[];
  subtotal: number;
  itemDiscount: number;
  billDiscount: number;
  roundOff: number;
  grandTotal: number;
  paidAmount: number | null;
  dueAmount: number | null;
  paymentModes: string[];
  cancelled?: boolean;
  /** Extra header line, e.g. a quotation's validity date. */
  validity?: string | null;
  business: BusinessSettings | null;
}

/**
 * Receipt for a 58 mm or 80 mm thermal roll.
 *
 * Laid out to match the shop's own printed bill: logo, trade strip, address
 * block, a titled document header, the item table, a bold total, the UPI
 * Scan & Pay block and the terms. Thermal paper has a fixed character width
 * and no margins, so this is one column, pure black on white, with the dashed
 * separators the shop already uses.
 *
 * The width here mirrors the paper for the on-screen preview; `print.css`
 * sets the real millimetre width when it actually prints.
 */
export function InvoiceThermal({
  doc,
  width,
}: {
  doc: ThermalDocument;
  width: 58 | 80;
}): JSX.Element {
  const biz = doc.business;
  const narrow = width === 58;
  const previewWidth = narrow ? 240 : 320;

  // The QR is a standard UPI intent, so any UPI app resolves it.
  const payable = doc.dueAmount && doc.dueAmount > 0 ? doc.dueAmount : doc.grandTotal;
  const qr = useUpiQr({
    upiId: biz?.upiId ?? '',
    payeeName: biz?.upiPayeeName || biz?.name || 'SANTU HARDWARE',
    amount: payable,
    note: doc.number,
  });

  return (
    <div
      className={`printable thermal-receipt mx-auto bg-white px-2 py-2 text-black shadow-card print:shadow-none ${
        narrow ? 'text-[11px]' : 'text-xs'
      }`}
      style={{ width: previewWidth }}
    >
      {/* ---------------- header ---------------- */}
      <div className="flex flex-col items-center text-center">
        {biz?.showLogoOnThermal !== false && (
          <TrimmedLogo
            src={biz?.thermalLogoUrl || biz?.logoUrl || '/santu-logo-thermal.png'}
            alt={biz?.name ?? 'Santu Hardware'}
            className="mx-auto block w-auto max-w-full object-contain filter contrast-200"
            style={{ maxHeight: (biz?.thermalLogoHeight ?? 100) * (narrow ? 0.8 : 1) }}
          />
        )}
        <div className={`text-center font-bold leading-snug pt-0.5 ${narrow ? 'text-[11px]' : 'text-[13px]'}`}>
          <p>{biz?.addressLine1 || 'Main Road Ishuwapur, Saran, Bihar, 841411'}</p>
          <p>GSTIN: {biz?.gstin || '10BULPP3722N1ZG'}</p>
          <p>Ph: {[biz?.phonePrimary || '9097441600', biz?.phoneSecondary || '7739802334'].filter(Boolean).join(', ')}</p>
        </div>
      </div>

      <Divider />

      <p className="text-center text-sm font-bold">{doc.title}</p>

      <Divider />

      {/* ---------------- document meta ---------------- */}
      <div className="leading-tight">
        <Row left="Bill No." right={doc.number} />
        <Row left="Date" right={formatDateTime(doc.date)} />
        <Row left="Customer" right={doc.customerName} />
        {doc.customerMobile && <Row left="Mobile" right={doc.customerMobile} />}
        {doc.customerAddress && <Row left="Pata" right={doc.customerAddress} />}
        {doc.validity && <Row left="Valid until" right={doc.validity} />}
      </div>

      <Divider />

      {/* ---------------- items ---------------- */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-2 tabular-nums">
        <span className="pb-1 font-bold">Item</span>
        <span className="pb-1 text-center font-bold">Qty</span>
        <span className="pb-1 text-right font-bold">Rate</span>
        <span className="pb-1 text-right font-bold">Amount</span>
        {doc.items.map((item) => (
          <Fragment key={item.id}>
            <span className="break-words">
              {item.item_name}
              {item.variant_name && item.variant_name !== 'Standard' ? ` ${item.variant_name}` : ''}
              {item.discount_amt > 0 && <span className="block">less {formatMoney(item.discount_amt)}</span>}
            </span>
            <span className="whitespace-nowrap text-center">
              {formatQty(item.quantity)}
              {item.sold_unit && !['PCS', 'NOS'].includes(item.sold_unit) ? ` ${item.sold_unit}` : ''}
            </span>
            <span className="whitespace-nowrap text-right">{formatMoney(item.rate)}</span>
            <span className="whitespace-nowrap text-right">{formatMoney(item.line_total)}</span>
          </Fragment>
        ))}
      </div>

      <Divider />

      {/* ---------------- totals ---------------- */}
      <Row left="Subtotal" right={formatMoney(doc.subtotal)} />
      <Divider />
      <div className="flex items-baseline justify-between py-1 text-base font-bold tabular-nums">
        <span>TOTAL</span>
        <span>{formatMoney(doc.grandTotal)}</span>
      </div>

      <div className="leading-tight tabular-nums">
        {doc.paidAmount !== null && <Row left="PAID" right={formatMoney(doc.paidAmount)} />}
        {doc.paymentModes.length > 0 && <Row left="Payment Mode" right={doc.paymentModes.join(', ')} />}
        {doc.dueAmount !== null && doc.dueAmount > 0 && (
          <Row left="BALANCE DUE" right={formatMoney(doc.dueAmount)} bold />
        )}
      </div>

      {/* ---------------- scan & pay ---------------- */}
      {qr && (
        <>
          <Divider />
          <p className="text-center font-bold">Scan &amp; Pay</p>
          <img src={qr} alt="UPI QR code" className="mx-auto my-1 block" style={{ width: '65%' }} />
          <p className="text-center">UPI ID: {biz?.upiId}</p>
        </>
      )}

      <Divider />

      {/* ---------------- terms ---------------- */}
      <div className="text-center leading-tight">
        {doc.cancelled && <p className="mb-1 font-bold">** CANCELLED **</p>}
        {biz?.exchangeNote && <p className="font-bold">{biz.exchangeNote}</p>}
        {biz?.terms && <p className="mt-1">{biz.terms}</p>}
        <p className="mt-1.5 text-base font-bold">{biz?.thankYouNote || 'Thank You!'}</p>
        <p>Visit Again</p>
      </div>
    </div>
  );
}

/** Builds the UPI intent URI and renders it to a QR data URL. */
function useUpiQr(args: {
  upiId: string;
  payeeName: string;
  amount: number;
  note: string;
}): string | null {
  const { upiId, payeeName, amount, note } = args;
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!upiId) {
      setDataUrl(null);
      return;
    }

    const uri =
      `upi://pay?pa=${encodeURIComponent(upiId)}` +
      `&pn=${encodeURIComponent(payeeName)}` +
      `&am=${amount.toFixed(2)}&cu=INR` +
      `&tn=${encodeURIComponent(note)}`;

    let cancelled = false;
    QRCode.toDataURL(uri, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 320,
      // Pure black on white: a thermal head has no greyscale.
      color: { dark: '#000000', light: '#FFFFFF' },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        // A QR that cannot be drawn simply does not print; the bill still does.
        if (!cancelled) setDataUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [upiId, payeeName, amount, note]);

  return dataUrl;
}

function Divider(): JSX.Element {
  return <div className="my-1.5 border-t border-dashed border-black" />;
}

function Row({ left, right, bold }: { left: string; right: string; bold?: boolean }): JSX.Element {
  return (
    <div className={`flex justify-between gap-2 ${bold ? 'font-bold' : ''}`}>
      <span className="shrink-0">{left}</span>
      <span className="break-words text-right">{right}</span>
    </div>
  );
}
