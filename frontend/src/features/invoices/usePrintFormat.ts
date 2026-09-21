import { useCallback } from 'react';

export type PrintFormat = 'A4' | 'THERMAL_80' | 'THERMAL_58';

export const PRINT_FORMAT_LABELS: Record<PrintFormat, string> = {
  A4: 'A4',
  THERMAL_80: '80 mm',
  THERMAL_58: '58 mm',
};

// Thermal rolls are continuous: give the page an explicit width and let the
// height run, otherwise the driver pads every receipt to a full sheet.
const PAGE_RULES: Record<PrintFormat, string> = {
  A4: '@page { size: A4; margin: 12mm; }',
  THERMAL_80: '@page { size: 80mm auto; margin: 2mm; }',
  THERMAL_58: '@page { size: 58mm auto; margin: 2mm; }',
};

const STYLE_ID = 'santu-print-page-rule';

/**
 * Prints the current invoice in a chosen paper format.
 *
 * `@page` cannot be selected by an attribute, so the size rule is injected
 * immediately before printing and removed afterwards; the format also lands on
 * <html data-print-format> so print.css can style the content to match.
 */
export function usePrintFormat(): (format: PrintFormat) => void {
  return useCallback((format: PrintFormat) => {
    const root = document.documentElement;
    const previous = root.getAttribute('data-print-format');

    root.setAttribute('data-print-format', format);

    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent = PAGE_RULES[format];

    const cleanup = (): void => {
      if (previous) root.setAttribute('data-print-format', previous);
      else root.removeAttribute('data-print-format');
      style?.remove();
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);

    // Let the browser apply the new rules before opening the dialog. Safari on
    // iPad in particular reads @page at the moment print() is called.
    window.setTimeout(() => {
      window.print();
      // Safari does not always fire afterprint; clear up regardless.
      window.setTimeout(cleanup, 1000);
    }, 50);
  }, []);
}
