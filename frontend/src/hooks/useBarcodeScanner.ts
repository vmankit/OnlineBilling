import { useEffect, useRef } from 'react';

/**
 * Hardware barcode scanners (USB or Bluetooth) behave like keyboards: they
 * type the code very fast and finish with Enter. This listens globally for
 * that burst pattern and ignores ordinary typing — a human cannot type 6+
 * characters at <35 ms intervals.
 */
export function useBarcodeScanner(onScan: (code: string) => void, enabled = true): void {
  const buffer = useRef('');
  const lastKeyAt = useRef(0);
  const handler = useRef(onScan);
  handler.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent): void => {
      const now = Date.now();
      const gap = now - lastKeyAt.current;
      lastKeyAt.current = now;

      if (gap > 120) buffer.current = '';

      if (e.key === 'Enter') {
        const code = buffer.current.trim();
        buffer.current = '';
        if (code.length >= 6) {
          e.preventDefault();
          handler.current(code);
        }
        return;
      }

      if (e.key.length === 1 && gap < 120) buffer.current += e.key;
      else if (e.key.length === 1) buffer.current = e.key;
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [enabled]);
}
