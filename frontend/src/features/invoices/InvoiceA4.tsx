import { formatDateTime, formatMoney, formatQty } from '@/lib/utils';
import { TrimmedLogo } from './TrimmedLogo';
import type { SaleDetail } from '@/services/sales';

/**
 * A4 invoice. Styled to match Santu Hardware's official A4 bill layout
 * with high-definition logo, category strip, GSTIN, clear customer address,
 * itemized ledger rows, summary cards, authorised signature, and branded footer.
 */
export function InvoiceA4({ sale }: { sale: SaleDetail }): JSX.Element {
  const biz = sale.business;
  const isDue = sale.due_amount > 0;
  const logoSrc = biz?.logoUrl || '/santu-logo-official.png';

  return (
    <div className="printable mx-auto w-full max-w-[794px] bg-white p-8 sm:p-10 font-sans text-slate-900 shadow-md border border-slate-300 rounded-xl print:max-w-none print:p-0 print:border-none print:shadow-none select-text">
      {/* ----------------- HEADER ----------------- */}
      <div className="flex items-start justify-between gap-6 pb-3">
        {/* Left: Branding & Shop Info */}
        <div className="flex flex-col items-start">
          {biz?.showLogoOnA4 !== false && (
            <TrimmedLogo
              src={logoSrc}
              alt={biz?.name ?? 'Santu Hardware'}
              className="w-auto object-contain mix-blend-multiply"
              style={{ height: biz?.a4LogoHeight ?? 80 }}
            />
          )}
          <div className="mt-1.5 text-xs text-slate-700 space-y-0.5 leading-snug">
            <p>{biz?.addressLine1 || 'Main Road Ishuwapur, Saran, Bihar, 841411'}</p>
            {biz?.addressLine2 && <p>{biz.addressLine2}</p>}
            <p>Phone: {biz?.phonePrimary || '9097441600'}{` · ${biz?.phoneSecondary || '7739802334'}`}</p>
            <p className="font-semibold text-slate-800">
              GSTIN: <span className="font-mono">{biz?.gstin || '10BULPP3722N1ZG'}</span>
            </p>
          </div>
        </div>

        {/* Right: Document Title & Meta */}
        <div className="text-right">
          <h1 className="text-2xl font-black tracking-tight text-[#1D4ED8] uppercase">
            TAX INVOICE
          </h1>
          <p className="mt-1 text-xs text-slate-600">
            <span className="font-bold text-slate-800">Invoice:</span>{' '}
            <span className="font-mono font-bold text-slate-900">{sale.invoice_number}</span>
          </p>
          <p className="text-xs text-slate-600">
            <span className="font-bold text-slate-800">Date:</span> {formatDateTime(sale.invoice_date)}
          </p>
          <div className="mt-2">
            {sale.status === 'CANCELLED' ? (
              <span className="inline-block rounded-md border border-rose-300 bg-rose-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-600">
                CANCELLED
              </span>
            ) : isDue ? (
              <span className="inline-block rounded-md border border-rose-300 bg-rose-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-600">
                BALANCE DUE
              </span>
            ) : (
              <span className="inline-block rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                PAID IN FULL
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Horizontal Divider */}
      <div className="my-4 border-t border-slate-200" />

      {/* ----------------- BILL TO & BALANCE BANNER ----------------- */}
      <div className="flex items-start justify-between gap-4 py-2">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            BILL TO
          </span>
          <h2 className="text-lg font-bold text-slate-900 mt-0.5">{sale.customer_name}</h2>
          {sale.customer_mobile && (
            <p className="text-xs text-slate-600 mt-0.5">Phone: {sale.customer_mobile}</p>
          )}
          {sale.customer_address && (
            <p className="text-xs font-medium text-slate-700 mt-0.5">{sale.customer_address}</p>
          )}
          {sale.customer_gstin && (
            <p className="text-xs font-semibold text-slate-800 mt-0.5">
              GSTIN: <span className="font-mono">{sale.customer_gstin}</span>
            </p>
          )}
        </div>

      </div>

      {/* ----------------- ITEMS TABLE ----------------- */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b-2 border-slate-900 text-slate-700 font-bold uppercase text-[10px] tracking-wider">
              <th className="py-2 text-left w-8">#</th>
              <th className="py-2 text-left">ITEM</th>
              <th className="py-2 text-center w-24">QTY</th>
              <th className="py-2 text-right w-24">RATE</th>
              {sale.item_discount > 0 && <th className="py-2 text-right w-20">DISC</th>}
              <th className="py-2 text-right w-28">AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {sale.items.map((item, idx) => (
              <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                <td className="py-2.5 text-slate-400 align-top">{idx + 1}</td>
                <td className="py-2.5 align-top">
                  <p className="font-bold text-slate-800">{item.item_name}</p>
                  {item.variant_name && (
                    <p className="text-[10px] text-slate-500">{item.variant_name}</p>
                  )}
                </td>
                <td className="py-2.5 text-center text-slate-700 align-top tabular-nums">
                  {formatQty(item.quantity)} {item.sold_unit}
                </td>
                <td className="py-2.5 text-right font-mono text-slate-700 align-top tabular-nums">
                  {formatMoney(item.rate)}
                </td>
                {sale.item_discount > 0 && (
                  <td className="py-2.5 text-right font-mono text-slate-500 align-top tabular-nums">
                    {item.discount_amt > 0 ? `− ${formatMoney(item.discount_amt)}` : '—'}
                  </td>
                )}
                <td className="py-2.5 text-right font-mono font-bold text-slate-900 align-top tabular-nums">
                  {formatMoney(item.line_total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ----------------- TOTALS SECTION ----------------- */}
      <div className="flex justify-end mt-4">
        <div className="w-64 space-y-1.5 text-xs">
          <div className="flex justify-between text-slate-600">
            <span>Subtotal</span>
            <span className="font-mono font-bold text-slate-900">{formatMoney(sale.subtotal)}</span>
          </div>
          {sale.item_discount > 0 && (
            <div className="flex justify-between text-slate-600">
              <span>Item discount</span>
              <span className="font-mono font-medium text-emerald-600">− {formatMoney(sale.item_discount)}</span>
            </div>
          )}
          {sale.bill_discount > 0 && (
            <div className="flex justify-between text-slate-600">
              <span>Bill discount</span>
              <span className="font-mono font-medium text-emerald-600">− {formatMoney(sale.bill_discount)}</span>
            </div>
          )}
          {sale.round_off !== 0 && (
            <div className="flex justify-between text-slate-600">
              <span>Round off</span>
              <span className="font-mono">{formatMoney(sale.round_off)}</span>
            </div>
          )}
          <div className="border-t-2 border-slate-900 pt-2 flex justify-between items-baseline">
            <span className="text-base font-bold text-slate-900">Total</span>
            <span className="text-xl font-black font-mono text-slate-900">
              Rs. {formatMoney(sale.grand_total).replace('₹', '').trim()}
            </span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>Paid</span>
            <span className="font-mono font-bold text-slate-900">{formatMoney(sale.paid_amount)}</span>
          </div>
          {isDue && (
            <div className="flex justify-between font-bold text-[#DC2626]">
              <span>Balance Due</span>
              <span className="font-mono">Rs. {formatMoney(sale.due_amount).replace('₹', '').trim()}</span>
            </div>
          )}
        </div>
      </div>

      {/* ----------------- TWO BOTTOM SUMMARY CARDS ----------------- */}
      <div className="mt-6">
        {/* Kab Kitna Dena Hai / Payment Modes */}
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 text-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-2">
            {isDue ? 'KAB KITNA DENA HAI' : 'PAYMENT MODE'}
          </span>
          {isDue ? (
            <div className="flex justify-between text-slate-800 font-medium">
              <span>{sale.invoice_number} · Immediate</span>
              <span className="font-mono font-bold text-slate-900">
                Rs. {formatMoney(sale.due_amount).replace('₹', '').trim()}
              </span>
            </div>
          ) : (
            <p className="text-slate-700">
              {sale.payments.length
                ? sale.payments
                    .flatMap((p) => p.methods.map((m) => `${m.method}: ${formatMoney(m.amount)}`))
                    .join(', ')
                : 'Paid in full'}
            </p>
          )}
        </div>
      </div>

      {sale.notes && (
        <p className="mt-4 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600 print:bg-transparent print:p-0">
          <span className="font-bold">Note:</span> {sale.notes}
        </p>
      )}

      {/* ----------------- AUTHORISED SIGNATORY ----------------- */}
      <div className="flex justify-end mt-10">
        <div className="text-center w-56">
          <div className="border-t border-slate-400 w-full mb-1" />
          <p className="text-xs font-bold text-slate-800">For Santu Hardware</p>
          <p className="text-[10px] text-slate-500">Authorised Signatory</p>
        </div>
      </div>

      {/* ----------------- BRANDED FOOTER ----------------- */}
      <div className="mt-8 pt-4 border-t border-dashed border-slate-200 text-center text-xs">
        <p className="font-semibold text-blue-600">Thank you for shopping with Santu Hardware!</p>
        <p className="text-[11px] text-slate-400 mt-0.5">
          https://santuhw.netlify.app | santuhardware7739@gmail.com
        </p>
      </div>
    </div>
  );
}
