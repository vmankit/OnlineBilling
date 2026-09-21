import { useEffect, useRef, useState } from 'react';

/**
 * The daily-sales line for Home.
 *
 * The earlier app drew this with frappe-charts: a filled line with dots, a
 * value axis on the left, dates along the bottom and a tooltip on hover. That
 * library is not in this app, so the same chart is drawn directly — which also
 * avoids the redraw bug that version carried (it measured its container once
 * and never again, so the line stayed at whatever height the window had while
 * it was still opening).
 *
 * It is measured in real pixels rather than scaled from a fixed viewBox, so
 * the labels stay the size they are meant to be at any width.
 */

export interface SalesPoint {
  day: string;
  total: number;
}

const PAD = { top: 12, right: 16, bottom: 26, left: 64 };
const MIN_HEIGHT = 180;

const shortMoney = (value: number): string => {
  if (value >= 10_000_000) return `${(value / 10_000_000).toFixed(1)}Cr`;
  if (value >= 100_000) return `${(value / 100_000).toFixed(1)}L`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(Math.round(value));
};

const fullMoney = (value: number): string =>
  `₹ ${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/**
 * Month names are spelled out here rather than taken from the locale, which
 * renders September as "Sep" in one place and "Sept" in another — on the same
 * chart that reads as two different months.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const dayLabel = (iso: string): string => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]}`;
};

/** A round-ish top for the value axis, so the ticks read as whole numbers. */
function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

export function SalesChart({ points }: { points: SalesPoint[] }): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: MIN_HEIGHT });
  const [hover, setHover] = useState<number | null>(null);

  // Redraws whenever the card actually changes size, including the first
  // paint and any later window resize.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setBox({
        width: entry.contentRect.width,
        height: Math.max(MIN_HEIGHT, entry.contentRect.height),
      });
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const { width, height } = box;
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = Math.max(0, height - PAD.top - PAD.bottom);

  const top = niceCeiling(Math.max(...points.map((p) => p.total), 0));
  const xAt = (i: number): number =>
    PAD.left + (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const yAt = (value: number): number => PAD.top + plotH - (value / top) * plotH;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(p.total)}`).join(' ');
  const area = `${line} L ${xAt(points.length - 1)} ${PAD.top + plotH} L ${xAt(0)} ${PAD.top + plotH} Z`;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);

  // Enough room for every date only when they fit; otherwise show a few.
  const labelStep = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(plotW / 70))));

  // A dot per day is a marker at a week's range and a caterpillar at a
  // year's, so they stop once the line has more points than it has room for.
  const showDots = points.length <= Math.max(2, Math.floor(plotW / 14));
  // The hover strips must not overlap, or the wrong day lights up.
  const hitWidth = points.length <= 1 ? 36 : Math.max(6, plotW / (points.length - 1));

  return (
    <div ref={hostRef} style={{ width: '100%', height: '100%', minHeight: MIN_HEIGHT, position: 'relative' }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Daily sales">
          <defs>
            <linearGradient id="santuSaleFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
            </linearGradient>
          </defs>

          {ticks.map((value) => (
            <g key={value}>
              <line
                x1={PAD.left}
                x2={PAD.left + plotW}
                y1={yAt(value)}
                y2={yAt(value)}
                stroke="#e2e8f0"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 10}
                y={yAt(value) + 4}
                textAnchor="end"
                fontSize={11}
                fill="#94a3b8"
              >
                {shortMoney(value)}
              </text>
            </g>
          ))}

          <path d={area} fill="url(#santuSaleFill)" />
          <path d={line} fill="none" stroke="#3b82f6" strokeWidth={2.5} strokeLinejoin="round" />

          {points.map((p, i) => (
            <g key={p.day}>
              {(showDots || hover === i) && (
                <circle
                  cx={xAt(i)}
                  cy={yAt(p.total)}
                  r={hover === i ? 5.5 : 3.5}
                  fill="#ffffff"
                  stroke="#3b82f6"
                  strokeWidth={2}
                />
              )}
              {/* A generous hit area, so a thin line is still easy to hover. */}
              <rect
                x={xAt(i) - hitWidth / 2}
                y={PAD.top}
                width={hitWidth}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
              {i % labelStep === 0 && (
                <text
                  x={xAt(i)}
                  y={PAD.top + plotH + 18}
                  textAnchor="middle"
                  fontSize={11}
                  fill="#94a3b8"
                >
                  {dayLabel(p.day)}
                </text>
              )}
            </g>
          ))}
        </svg>
      )}

      {hover !== null && points[hover] && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(Math.max(xAt(hover) - 60, 0), Math.max(0, width - 130)),
            top: Math.max(0, yAt(points[hover]!.total) - 52),
            pointerEvents: 'none',
            background: '#0f172a',
            color: '#ffffff',
            borderRadius: 8,
            padding: '6px 10px',
            fontSize: 12,
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
          }}
        >
          <div style={{ opacity: 0.75 }}>{dayLabel(points[hover]!.day)}</div>
          <b>{fullMoney(points[hover]!.total)}</b>
        </div>
      )}
    </div>
  );
}
