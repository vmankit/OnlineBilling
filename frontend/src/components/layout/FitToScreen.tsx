import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Shrinks its content, when it has to, so the whole thing is visible at once.
 *
 * An A4 invoice preview is about 1,100px tall, so on a counter iPad or a
 * laptop the shopkeeper had to scroll just to see the bottom line of a bill.
 * This scales it down to whatever room the screen has — never up, and never
 * below `minScale`, past which text would be too small to read and the area
 * scrolls instead.
 *
 * Only the on-screen view is scaled. Printing resets it (see print.css), so
 * paper always gets the invoice at full size.
 */
export function FitToScreen({
  children,
  minScale = 0.5,
}: {
  children: ReactNode;
  minScale?: number;
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 1, height: 0 });

  useEffect(() => {
    const host = hostRef.current;
    const inner = innerRef.current;
    if (!host || !inner) return;

    const measure = (): void => {
      const naturalW = inner.offsetWidth;
      const naturalH = inner.offsetHeight;
      if (!naturalW || !naturalH) return;
      const scale = Math.min(
        1,
        host.clientHeight / naturalH,
        host.clientWidth / naturalW,
      );
      const clamped = Math.max(minScale, scale);
      setFit((prev) =>
        Math.abs(prev.scale - clamped) < 0.001 && prev.height === naturalH * clamped
          ? prev
          : { scale: clamped, height: naturalH * clamped },
      );
    };

    measure();
    // Content can change size (a bill with more lines, a format switch) and
    // so can the window, so both are watched rather than measured once.
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [minScale]);

  return (
    <div ref={hostRef} className="fit-screen" style={{ height: '100%', overflow: 'auto' }}>
      <div
        className="fit-screen-box"
        style={{ height: fit.height || undefined, display: 'flex', justifyContent: 'center' }}
      >
        <div
          ref={innerRef}
          className="fit-screen-inner"
          // flex-start, not the default stretch: a stretched box reports the height
          // it was given rather than the height of its content, so the measurement
          // fed itself and the scale never left 1.
          style={{
            transform: `scale(${fit.scale})`,
            transformOrigin: 'top center',
            width: 'max-content',
            alignSelf: 'flex-start',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
