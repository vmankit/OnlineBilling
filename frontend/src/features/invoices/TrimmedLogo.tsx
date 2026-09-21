import { useEffect, useState, type CSSProperties } from 'react';

const cache = new Map<string, string>();

/** Crops the empty white border off a logo image; resolves to the original on any failure. */
function trim(src: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (!ctx) return resolve(src);
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(0, 0, w, h);
        let minX = w, minY = h, maxX = -1, maxY = -1;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            if (data[i]! < 235 || data[i + 1]! < 235 || data[i + 2]! < 235) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
        if (maxX < 0) return resolve(src);
        const sw = maxX - minX + 1;
        const sh = maxY - minY + 1;
        if (sw >= w - 4 && sh >= h - 4) return resolve(src); // already tight
        const o = document.createElement('canvas');
        o.width = sw;
        o.height = sh;
        const octx = o.getContext('2d');
        if (!octx) return resolve(src);
        octx.fillStyle = '#fff';
        octx.fillRect(0, 0, sw, sh);
        octx.drawImage(c, minX, minY, sw, sh, 0, 0, sw, sh);
        resolve(o.toDataURL('image/png'));
      } catch {
        resolve(src);
      }
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
}

/** A logo with its own blank margin removed, so it sits flush with the text beside it. */
export function TrimmedLogo({
  src, alt, className, style,
}: { src: string; alt: string; className?: string; style?: CSSProperties }): JSX.Element {
  const [shown, setShown] = useState(cache.get(src) ?? src);
  useEffect(() => {
    let live = true;
    const hit = cache.get(src);
    if (hit) {
      setShown(hit);
      return;
    }
    setShown(src);
    void trim(src).then((out) => {
      cache.set(src, out);
      if (live) setShown(out);
    });
    return () => {
      live = false;
    };
  }, [src]);
  return <img src={shown} alt={alt} className={className} style={style} />;
}
