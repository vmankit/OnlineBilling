import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { buildWaLink, normalizeIndianMobile } from './whatsapp';
import type { SaleDetail } from '@/services/sales';
import { formatDateTime, formatQty } from '@/lib/utils';

export interface WhatsAppBillOptions {
  includeItems?: boolean;
  includePdfLink?: boolean;
  includeUpi?: boolean;
  customNote?: string;
  recipientMobile?: string;
  customTemplate?: string;
}

/**
 * Builds a structured, professional WhatsApp message matching Indian retail standards.
 * Supports custom transaction templates or default structured invoice breakdown.
 */
export function buildInvoiceWhatsAppText(
  sale: SaleDetail,
  options?: WhatsAppBillOptions,
): string {
  const biz = sale.business;
  const shopName = biz?.name || 'SANTU HARDWARE';
  const shopPhone = biz?.phonePrimary || '7739802334';
  const shopUpi = biz?.upiId || '';
  const shopGstin = biz?.gstin || '10BULPP3722N1ZG';
  const shopAddress = biz?.addressLine1 || 'Main Road Ishuwapur, Saran, Bihar';

  const customerName = sale.customer_name || 'Valued Customer';
  const isDue = sale.due_amount > 0;
  const billUrl = `${window.location.origin}/bill/${sale.id}`;

  if (options?.customTemplate) {
    let text = options.customTemplate;
    const replacements: Record<string, string> = {
      company_name: shopName,
      customer_name: customerName,
      party_name: customerName,
      supplier_name: customerName,
      invoice_no: sale.invoice_number,
      transaction_type: 'Sales Transaction',
      posting_date: formatDateTime(sale.invoice_date),
      grand_total: Number(sale.grand_total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      paid_amount: Number(sale.paid_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      outstanding_amount: Number(sale.due_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      current_balance: Number(sale.due_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      payment_link: shopUpi,
      invoice_link: billUrl,
      company_phone: shopPhone,
      company_address: shopAddress,
    };
    for (const [key, val] of Object.entries(replacements)) {
      text = text.replaceAll(`{{ ${key} }}`, val);
      text = text.replaceAll(`{{${key}}}`, val);
    }
    return text;
  }

  const lines: string[] = [
    `*${shopName.toUpperCase()}*`,
    `${shopAddress}`,
    `Ph: ${shopPhone} | GSTIN: ${shopGstin}`,
    `--------------------------------`,
    `Namaste *${customerName}* ji,`,
    `Aapka bill generate ho gaya hai:`,
    '',
    `🧾 *Invoice No:* #${sale.invoice_number}`,
    `📅 *Date:* ${formatDateTime(sale.invoice_date)}`,
    `💰 *Total Amount:* ₹${Number(sale.grand_total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
    `✅ *Paid Amount:* ₹${Number(sale.paid_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
  ];

  if (isDue) {
    lines.push(`🔴 *Balance Due:* ₹${Number(sale.due_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
  } else {
    lines.push(`🟢 *Status:* Paid in Full (Pura Bhugtan)`);
  }

  // Include item lines if requested or default true
  if (options?.includeItems !== false && sale.items && sale.items.length > 0) {
    lines.push('', `📋 *Items Purchased (${sale.items.length}):*`);
    const displayItems = sale.items.slice(0, 15);
    displayItems.forEach((item, index) => {
      const qtyStr = `${formatQty(item.quantity)} ${item.sold_unit || 'PCS'}`;
      const rateStr = `₹${Number(item.rate || 0).toLocaleString('en-IN')}`;
      const totalStr = `₹${Number(item.line_total || 0).toLocaleString('en-IN')}`;
      lines.push(`${index + 1}. ${item.item_name} (${qtyStr} @ ${rateStr}) = ${totalStr}`);
    });
    if (sale.items.length > 15) {
      lines.push(`...aur ${sale.items.length - 15} items`);
    }
  }

  // Direct Bill PDF / Online link
  if (options?.includePdfLink !== false) {
    lines.push(
      '',
      `📄 *View & Download Official Bill PDF:*`,
      `${billUrl}`,
    );
  }

  // UPI payment info
  if ((options?.includeUpi !== false || isDue) && shopUpi) {
    lines.push('', `📲 *Pay via UPI:* ${shopUpi}`);
  }

  if (options?.customNote) {
    lines.push('', `💬 ${options.customNote}`);
  }

  lines.push(
    '',
    `--------------------------------`,
    `Santu Hardware se kharidari ke liye dhanyawad! Phir aaiyega!`,
  );

  return lines.join('\n');
}

/**
 * Captures an HTML element and renders it into a high-resolution canvas.
 */
export async function renderElementToCanvas(
  element: HTMLElement,
  scale = 2,
): Promise<HTMLCanvasElement> {
  return await html2canvas(element, {
    scale,
    useCORS: true,
    allowTaint: true,
    backgroundColor: '#ffffff',
    logging: false,
    windowWidth: 1200,
  });
}

/**
 * Copies the rendered invoice element directly into the system clipboard as a PNG image.
 * This allows the user in WhatsApp Web to simply press `Ctrl + V` to paste the bill image directly!
 */
export async function copyInvoiceImageToClipboard(
  element: HTMLElement,
): Promise<boolean> {
  try {
    const canvas = await renderElementToCanvas(element, 2);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png', 0.95),
    );

    if (!blob) return false;

    if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': blob,
        }),
      ]);
      return true;
    }
    return false;
  } catch (err) {
    console.warn('Clipboard write failed:', err);
    return false;
  }
}

/**
 * Downloads the invoice element directly as a high-resolution PNG image.
 */
export async function downloadInvoiceImage(
  element: HTMLElement,
  filename = 'invoice.png',
): Promise<void> {
  const canvas = await renderElementToCanvas(element, 2);
  const link = document.createElement('a');
  link.download = filename;
  link.href = canvas.toDataURL('image/png');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Generates and downloads the invoice element as a standard PDF file using jsPDF.
 */
export async function downloadInvoicePdf(
  element: HTMLElement,
  filename = 'invoice.pdf',
): Promise<void> {
  const canvas = await renderElementToCanvas(element, 2);
  const imgData = canvas.toDataURL('image/png');

  // A4 dimensions in mm: 210 x 297
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  const imgWidth = pageWidth - 20; // 10mm margin each side
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  let position = 10;
  let remainingHeight = imgHeight;

  pdf.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight);
  remainingHeight -= pageHeight;

  while (remainingHeight > 0) {
    position = -(imgHeight - remainingHeight) + 10;
    pdf.addPage();
    pdf.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight);
    remainingHeight -= pageHeight;
  }

  pdf.save(filename);
}

/**
 * Executes full WhatsApp sharing:
 * 1. Copies bill image to clipboard (if element is present)
 * 2. Compiles formatted message with direct online bill PDF link
 * 3. Opens WhatsApp Web / App to the recipient's phone number
 */
export async function shareInvoiceOnWhatsApp(
  sale: SaleDetail,
  element?: HTMLElement | null,
  options?: WhatsAppBillOptions,
): Promise<{ copiedImage: boolean; targetNumber: string | null }> {
  let copiedImage = false;
  if (element) {
    copiedImage = await copyInvoiceImageToClipboard(element);
  }

  const mobile = options?.recipientMobile ?? sale.customer_mobile;
  const message = buildInvoiceWhatsAppText(sale, options);
  const targetNumber = normalizeIndianMobile(mobile);

  const url = buildWaLink(mobile, message);
  window.open(url, '_blank', 'noopener,noreferrer');

  return { copiedImage, targetNumber };
}
