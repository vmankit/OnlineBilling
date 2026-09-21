/**
 * Shrinks a picked image to a bill-sized PNG and returns it as a data URL, so
 * no file hosting is needed. The empty white border round the artwork is cut
 * off, so the logo sits flush with the text beside it on paper.
 */
export function fileToLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, 900 / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return reject(new Error('canvas'));
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      // Bounding box of everything that is not (near) white.
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
      const pad = 3;
      const sx = maxX < 0 ? 0 : Math.max(0, minX - pad);
      const sy = maxX < 0 ? 0 : Math.max(0, minY - pad);
      const sw = maxX < 0 ? w : Math.min(w, maxX + pad + 1) - sx;
      const sh = maxX < 0 ? h : Math.min(h, maxY + pad + 1) - sy;

      const out = document.createElement('canvas');
      out.width = sw;
      out.height = sh;
      const octx = out.getContext('2d');
      if (!octx) return reject(new Error('canvas'));
      octx.fillStyle = '#fff';
      octx.fillRect(0, 0, sw, sh);
      octx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
      const png = out.toDataURL('image/png');
      resolve(png.length > 400_000 ? out.toDataURL('image/jpeg', 0.9) : png);
    };
    img.onerror = () => reject(new Error('image'));
    img.src = url;
  });
}
