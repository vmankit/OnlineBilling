import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';

const STEPS = [0.4, 0.5, 0.65, 0.8, 1, 1.25, 1.5, 2];

/**
 * A bill at a size the operator picks: − / + steps, and "Fit" to the width of
 * the space it sits in. The bill itself is the real print component, only
 * scaled, so what is zoomed is exactly what prints.
 */
export function ZoomableBill({
  naturalWidth,
  children,
  maxHeight = '70vh',
}: {
  naturalWidth: number;
  children: ReactNode;
  maxHeight?: string;
}): JSX.Element {
  const area = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(true);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const measure = (): void => {
      if (!area.current || !inner.current) return;
      const next = fit ? Math.min(1, (area.current.clientWidth - 2) / naturalWidth) : scale;
      if (fit) setScale(next);
      setHeight(inner.current.offsetHeight * next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (area.current) ro.observe(area.current);
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
  }, [fit, scale, naturalWidth]);

  const step = (dir: 1 | -1): void => {
    const idx = STEPS.reduce((best, s, i) => (Math.abs(s - scale) < Math.abs(STEPS[best]! - scale) ? i : best), 0);
    const next = STEPS[Math.min(STEPS.length - 1, Math.max(0, idx + dir))]!;
    setFit(false);
    setScale(next);
  };

  return (
    <div>
      <div className="no-print mb-2 flex items-center gap-2">
        <button type="button" onClick={() => step(-1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50" aria-label="Zoom out">
          <Minus className="h-4 w-4" />
        </button>
        <span className="w-14 text-center text-sm font-semibold tabular-nums text-slate-700">{Math.round(scale * 100)}%</span>
        <button type="button" onClick={() => step(1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50" aria-label="Zoom in">
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setFit(true)}
          className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold ${fit ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
        >
          <Maximize2 className="h-3.5 w-3.5" /> Fit
        </button>
      </div>
      <div ref={area} className="overflow-auto rounded-xl border border-slate-200 bg-slate-100" style={{ maxHeight }}>
        <div data-zoom-outer style={{ width: naturalWidth * scale, height, margin: "0 auto" }}>
          <div ref={inner} data-zoom-inner style={{ width: naturalWidth, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
