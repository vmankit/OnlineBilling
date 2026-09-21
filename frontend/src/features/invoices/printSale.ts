import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { SaleDetail } from '@/services/sales';
import { InvoiceA4 } from './InvoiceA4';
import { InvoiceThermal } from './InvoiceThermal';
import { saleToThermal } from './toThermal';
import type { PrintFormat } from './usePrintFormat';
import './print.css';

const HIDE_STYLE_ID = 'santu-print-host-style';

/**
 * Prints a saved bill from wherever the counter already is.
 *
 * The bill used to be printed by opening its own page in the app and printing
 * that, which took the cashier off the billing screen after every sale. This
 * draws the bill in a hidden holder, prints it, and removes it — the till stays
 * exactly where it was, ready for the next customer.
 *
 * `print` is the app's usual `usePrintFormat()` function, so the paper size and
 * the print rules are the same ones the bill page uses.
 *
 * Resolves once the print dialog has been dealt with (printed or cancelled).
 */
export async function printSaleNow(
  sale: SaleDetail,
  format: PrintFormat,
  print: (format: PrintFormat) => void,
): Promise<void> {
  // The holder lives off-screen for the screen and in the normal place for the
  // page — print.css lifts anything called .print-root to the top of the sheet.
  if (!document.getElementById(HIDE_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = HIDE_STYLE_ID;
    style.textContent = '@media screen { .print-host-hidden { position: fixed; left: -10000px; top: 0; width: 794px; } }';
    document.head.appendChild(style);
  }

  const host = document.createElement('div');
  host.className = 'print-root print-host-hidden';
  document.body.appendChild(host);
  const root = createRoot(host);

  const teardown = (): void => {
    root.unmount();
    host.remove();
  };

  try {
    root.render(
      format === 'A4'
        ? createElement(InvoiceA4, { sale })
        : createElement(InvoiceThermal, { doc: saleToThermal(sale), width: format === 'THERMAL_58' ? 58 : 80 }),
    );

    // Let it lay out, and let the QR code and logo load, before the dialog opens.
    await new Promise((resolve) => setTimeout(resolve, 250));
    const start = Date.now();
    while (Date.now() - start < 3000) {
      const images = [...host.querySelectorAll('img')];
      if (images.every((img) => img.complete)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    await new Promise<void>((resolve) => {
      const done = (): void => {
        window.removeEventListener('afterprint', done);
        resolve();
      };
      window.addEventListener('afterprint', done);
      print(format);
      // Some browsers never fire afterprint; do not hold the caller forever.
      window.setTimeout(done, 60_000);
    });
  } finally {
    teardown();
  }
}
