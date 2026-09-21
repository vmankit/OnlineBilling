import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Printer,
  Download,
  AlertCircle,
  Copy,
  MessageSquare,
  QrCode,
  Store,
  ImageIcon,
} from 'lucide-react';
import type { SaleDetail } from '@/services/sales';
import { apiRequest } from '@/lib/api';
import { InvoiceA4 } from '@/features/invoices/InvoiceA4';
import { InvoiceThermal } from '@/features/invoices/InvoiceThermal';
import { saleToThermal } from '@/features/invoices/toThermal';
import { usePrintFormat, type PrintFormat } from '@/features/invoices/usePrintFormat';
import {
  copyInvoiceImageToClipboard,
  downloadInvoiceImage,
  downloadInvoicePdf,
  buildInvoiceWhatsAppText,
} from '@/features/whatsapp/billSharing';
import { buildWaLink } from '@/features/whatsapp/whatsapp';
import { useToast } from '@/components/ui/Toast';
import { formatMoney } from '@/lib/utils';
import '@/features/invoices/print.css';

export function PublicBillPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const print = usePrintFormat();

  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [format, setFormat] = useState<PrintFormat>('A4');
  const [isProcessing, setIsProcessing] = useState(false);
  const [showUpiModal, setShowUpiModal] = useState(false);

  const printableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadBill() {
      if (!id) {
        setError('Invalid invoice ID');
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        // Use public endpoint first, fallback to regular if already authenticated
        const res = await apiRequest<{ data: SaleDetail }>(`/api/sales/public/${id}`).catch(() =>
          apiRequest<{ data: SaleDetail }>(`/api/sales/${id}`),
        );
        if (!cancelled) {
          setSale(res.data);
        }
      } catch (err) {
        if (!cancelled) {
          setError('Bill not found or link has expired.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    loadBill();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-4">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-emerald-600" />
          <p className="text-sm font-bold text-slate-700">Loading Santu Hardware Invoice...</p>
        </div>
      </div>
    );
  }

  if (error || !sale) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full bg-white rounded-2xl p-6 text-center shadow-lg border border-slate-200">
          <div className="h-12 w-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto mb-3">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-bold text-slate-900">Invoice Not Found</h2>
          <p className="text-xs text-slate-500 mt-1 mb-4">{error || 'Please check your bill link.'}</p>
          <Link
            to="/pos"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800"
          >
            <Store className="h-4 w-4" />
            <span>Go to Store Portal</span>
          </Link>
        </div>
      </div>
    );
  }

  const isDue = sale.due_amount > 0;
  const biz = sale.business;
  const upiId = biz?.upiId || '';

  const handlePrint = () => {
    print(format);
  };

  const handleDownloadPdf = async () => {
    if (!printableRef.current) return;
    setIsProcessing(true);
    try {
      await downloadInvoicePdf(printableRef.current, `Santu_Hardware_Bill_${sale.invoice_number}.pdf`);
      toast.success('Bill PDF Downloaded');
    } catch {
      toast.error('Download failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownloadImage = async () => {
    if (!printableRef.current) return;
    setIsProcessing(true);
    try {
      await downloadInvoiceImage(printableRef.current, `Santu_Hardware_Bill_${sale.invoice_number}.png`);
      toast.success('Bill Image Downloaded');
    } catch {
      toast.error('Download failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCopyImage = async () => {
    if (!printableRef.current) return;
    setIsProcessing(true);
    try {
      const ok = await copyInvoiceImageToClipboard(printableRef.current);
      if (ok) {
        toast.success('Bill Image Copied!', 'Chat me Ctrl+V karke paste karein.');
      } else {
        toast.error('Direct download use karein.');
      }
    } catch {
      toast.error('Copy failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleShareWhatsApp = () => {
    const text = buildInvoiceWhatsAppText(sale);
    const url = buildWaLink(sale.customer_mobile, text);
    window.open(url, '_blank');
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans select-text">
      {/* Top Banner (No Print) */}
      <header className="no-print bg-white border-b border-slate-200 px-4 py-3 sticky top-0 z-30 shadow-2xs">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 flex items-center justify-center text-white font-black text-sm shadow-xs">
              SH
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-extrabold text-slate-900 tracking-tight">
                  {biz?.name || 'Santu Hardware'}
                </h1>
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] tabular-nums font-bold text-slate-700 border border-slate-200">
                  #{sale.invoice_number}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-medium">
                Official Electronic Tax Invoice · Verified Customer Copy
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Format toggle */}
            <div className="inline-flex rounded-xl bg-slate-100 p-0.5 border border-slate-200 text-xs font-bold">
              <button
                type="button"
                onClick={() => setFormat('A4')}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  format === 'A4' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'
                }`}
              >
                A4
              </button>
              <button
                type="button"
                onClick={() => setFormat('THERMAL_80')}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  format === 'THERMAL_80' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'
                }`}
              >
                Thermal
              </button>
            </div>

            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-2xs cursor-pointer"
            >
              <Printer className="h-3.5 w-3.5 text-slate-600" />
              <span className="hidden sm:inline">Print</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={isProcessing}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-2xs cursor-pointer disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5 text-blue-600" />
              <span>PDF</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadImage}
              disabled={isProcessing}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-2xs cursor-pointer disabled:opacity-50"
            >
              <ImageIcon className="h-3.5 w-3.5 text-emerald-600" />
              <span>PNG</span>
            </button>

            <button
              type="button"
              onClick={handleCopyImage}
              disabled={isProcessing}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-2xs cursor-pointer disabled:opacity-50"
            >
              <Copy className="h-3.5 w-3.5 text-slate-500" />
              <span className="hidden sm:inline">Copy Image</span>
            </button>

            <button
              type="button"
              onClick={handleShareWhatsApp}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-3.5 py-1.5 text-xs font-bold text-white shadow-2xs cursor-pointer transition-colors"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              <span>WhatsApp</span>
            </button>

            {isDue && !!upiId && (
              <button
                type="button"
                onClick={() => setShowUpiModal(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-3.5 py-1.5 text-xs font-bold text-white shadow-2xs cursor-pointer"
              >
                <QrCode className="h-3.5 w-3.5" />
                <span>Pay ₹{formatMoney(sale.due_amount).replace('₹', '').trim()}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Invoice Container */}
      <main className="flex-1 p-4 sm:p-6 flex flex-col items-center">
        <div ref={printableRef} className="print-root w-full max-w-4xl flex justify-center">
          {format === 'A4' ? (
            <InvoiceA4 sale={sale} />
          ) : (
            <div className="bg-white p-4 shadow-md rounded-xl border border-slate-200">
              <InvoiceThermal doc={saleToThermal(sale)} width={80} />
            </div>
          )}
        </div>
      </main>

      {/* UPI Payment Modal */}
      {showUpiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-slate-200 text-center space-y-4">
            <h3 className="text-base font-bold text-slate-900">Pay via UPI (GPay / PhonePe / Paytm)</h3>
            <p className="text-xs text-slate-500">
              Invoice #{sale.invoice_number} · Due Amount: <span className="font-bold text-rose-600 tabular-nums">₹{formatMoney(sale.due_amount).replace('₹', '').trim()}</span>
            </p>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 inline-block mx-auto">
              <p className="text-xs font-bold text-slate-700 tabular-nums mb-1">{upiId}</p>
              <p className="text-[10px] text-slate-400">Scan using any UPI App</p>
            </div>

            <div className="flex gap-2">
              <a
                href={`upi://pay?pa=${upiId}&pn=${encodeURIComponent(biz?.name || 'Santu Hardware')}&am=${sale.due_amount}&cu=INR`}
                className="flex-1 py-2 rounded-xl bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-700 transition-colors"
              >
                Open UPI App
              </a>
              <button
                type="button"
                onClick={() => setShowUpiModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 font-bold text-xs hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
export default PublicBillPage;
