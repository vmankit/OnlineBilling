import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { SaleDetail } from '@/services/sales';
import { InvoiceThermal } from '@/features/invoices/InvoiceThermal';
import { saleToThermal } from '@/features/invoices/toThermal';
import { sendDirectWhatsAppImage } from '@/services/whatsappBridge';
import { normalizeIndianMobile } from './whatsapp';

/**
 * Sends a finished bill to the customer through the linked-phone bridge, as
 * the same 80 mm receipt the shop prints — one picture, readable in the chat
 * at a glance. No PDF: the customer wants to see the bill, not open a file.
 *
 * The receipt is drawn off-screen and photographed, because that is the one
 * place the design lives: the server has no browser, so it cannot render it.
 *
 * Resolves with what actually went out. It never throws for a missing mobile
 * or an unlinked phone — callers decide whether that is worth a notice.
 */
export interface BillSendResult {
  sent: boolean;
  error?: string;
}

/** Waits until every image inside `root` (the QR code, the logo) has loaded. */
async function imagesReady(root: HTMLElement, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const images = [...root.querySelectorAll('img')];
    if (images.length > 0 && images.every((img) => img.complete && img.naturalWidth > 0)) return;
    // No <img> yet can mean the QR has not been generated; give it a moment.
    if (images.length === 0 && Date.now() - start > 1200) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * html2canvas draws an SVG that has only a viewBox (no width or height) at the
 * wrong shape — the shop's "SH" logo came out as a huge black blob across the
 * top of every receipt. The browser itself draws it correctly, so each SVG
 * image is redrawn by the browser onto a canvas and swapped for a plain PNG
 * before the photograph is taken.
 */
async function rasterizeSvgImages(root: HTMLElement): Promise<void> {
  const svgs = [...root.querySelectorAll('img')].filter((img) => /\.svg(\?|$)/i.test(img.src));
  await Promise.all(
    svgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          const source = new Image();
          source.onload = () => {
            // A fixed width, so an SVG without dimensions still has a size to
            // draw at, and the height follows the picture's own shape.
            const ratio =
              source.naturalWidth && source.naturalHeight ? source.naturalWidth / source.naturalHeight : 1;
            const canvas = document.createElement('canvas');
            canvas.width = 512;
            canvas.height = Math.max(1, Math.round(512 / ratio));
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(source, 0, 0, canvas.width, canvas.height);
            img.onload = () => resolve();
            img.src = canvas.toDataURL('image/png');
          };
          source.onerror = () => resolve();
          source.src = img.src;
        }),
    ),
  );
}

export async function renderReceipt(sale: SaleDetail): Promise<HTMLCanvasElement> {
  const host = document.createElement('div');
  // Far off-screen but laid out for real — display:none would give html2canvas
  // nothing to measure.
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:340px;background:#fff;pointer-events:none;';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    root.render(createElement(InvoiceThermal, { doc: saleToThermal(sale), width: 80 }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    await imagesReady(host);
    await rasterizeSvgImages(host);
    const html2canvas = (await import('html2canvas')).default;
    return await html2canvas(host, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
  } finally {
    root.unmount();
    host.remove();
  }
}

export async function sendBillOnWhatsApp(
  sale: SaleDetail,
  mobile: string | null | undefined,
  caption?: string,
): Promise<BillSendResult> {
  const number = normalizeIndianMobile(mobile);
  if (!number) return { sent: false, error: 'Customer ka mobile number nahi hai.' };

  try {
    const canvas = await renderReceipt(sale);
    await sendDirectWhatsAppImage(number, canvas.toDataURL('image/png'), caption);
    return { sent: true };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : 'Bill WhatsApp par nahi ja saka.' };
  }
}
