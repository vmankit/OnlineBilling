// Generates the PWA PNG icons from a 5x7 bitmap of "SH" on the brand square.
// Replace public/icons/*.png with real artwork whenever the shop has a logo —
// nothing else needs to change.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const BG = [15, 23, 42]; // slate-900
const FG = [255, 255, 255];

// 5x7 glyphs
const GLYPHS = {
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
};

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const pixels = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    pixels[i * 3] = BG[0];
    pixels[i * 3 + 1] = BG[1];
    pixels[i * 3 + 2] = BG[2];
  }

  // "SH": two 5x7 glyphs with a 1-column gap, centred, ~44% of the canvas tall.
  const scale = Math.floor((size * 0.44) / 7);
  const textW = (5 + 1 + 5) * scale;
  const textH = 7 * scale;
  const originX = Math.round((size - textW) / 2);
  const originY = Math.round((size - textH) / 2);

  const draw = (glyph, colOffset) => {
    glyph.forEach((row, y) => {
      [...row].forEach((bit, x) => {
        if (bit !== '1') return;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const px = originX + (colOffset + x) * scale + dx;
            const py = originY + y * scale + dy;
            if (px < 0 || py < 0 || px >= size || py >= size) continue;
            const idx = (py * size + px) * 3;
            pixels[idx] = FG[0];
            pixels[idx + 1] = FG[1];
            pixels[idx + 2] = FG[2];
          }
        }
      });
    });
  };
  draw(GLYPHS.S, 0);
  draw(GLYPHS.H, 6);

  // PNG scanlines: one filter byte (0 = none) per row.
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    pixels.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(join(OUT, `icon-${size}.png`), png(size));
  console.log(`wrote icons/icon-${size}.png`);
}
