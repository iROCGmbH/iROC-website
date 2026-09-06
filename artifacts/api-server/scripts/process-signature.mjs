/**
 * Converts iroc-signature.png (white strokes on black opaque background)
 * → iroc-signature-processed.png (dark strokes on transparent background)
 * Uses only Node.js built-ins (zlib + Buffer).
 */
import { readFileSync, writeFileSync } from "fs";
import { inflateSync, deflateSync } from "zlib";
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS    = path.resolve(__dirname, "../src/assets");

// ── CRC32 ────────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf  = Buffer.allocUnsafe(4); lenBuf.writeUInt32BE(data.length);
  const crcBuf  = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// ── Parse PNG ────────────────────────────────────────────────────────────────
function parsePNG(buf) {
  // Verify signature
  const SIG = [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a];
  for (let i = 0; i < 8; i++) if (buf[i] !== SIG[i]) throw new Error("Not a PNG");

  let offset = 8;
  let ihdr = null;
  const idatChunks = [];

  while (offset < buf.length) {
    const len  = buf.readUInt32BE(offset);     offset += 4;
    const type = buf.toString("ascii", offset, offset + 4); offset += 4;
    const data = buf.slice(offset, offset + len);            offset += len;
    offset += 4; // skip CRC

    if (type === "IHDR") ihdr = data;
    if (type === "IDAT") idatChunks.push(data);
    if (type === "IEND") break;
  }
  return { ihdr, idat: Buffer.concat(idatChunks) };
}

// ── Un-filter scanlines ───────────────────────────────────────────────────────
function unfilter(raw, width, height, bpp) {
  const stride = width * bpp;
  const pixels = Buffer.alloc(height * stride);
  let rawOff = 0, pixOff = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[rawOff++];
    const row    = raw.slice(rawOff, rawOff + stride); rawOff += stride;
    const prev   = y > 0 ? pixels.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);

    for (let x = 0; x < stride; x++) {
      const a = x >= bpp   ? pixels[pixOff + x - bpp]     : 0;
      const b = prev[x];
      const c = x >= bpp   ? prev[x - bpp]                : 0;
      let v = row[x];
      switch (filter) {
        case 0: break;                                               // None
        case 1: v = (v + a) & 0xff; break;                          // Sub
        case 2: v = (v + b) & 0xff; break;                          // Up
        case 3: v = (v + Math.floor((a + b) / 2)) & 0xff; break;   // Average
        case 4: {                                                    // Paeth
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
          break;
        }
      }
      pixels[pixOff + x] = v;
    }
    pixOff += stride;
  }
  return pixels;
}

// ── Build filtered scanlines (filter=0 / None) ────────────────────────────────
function buildRaw(pixels, width, height, bpp) {
  const stride = width * bpp;
  const out    = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    out[y * (stride + 1)] = 0; // filter = None
    pixels.copy(out, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return out;
}

// ── Main ─────────────────────────────────────────────────────────────────────
const src  = path.join(ASSETS, "iroc-signature.png");
const dest = path.join(ASSETS, "iroc-signature-processed.png");

const buf    = readFileSync(src);
const { ihdr, idat } = parsePNG(buf);

const width      = ihdr.readUInt32BE(0);
const height     = ihdr.readUInt32BE(4);
const colorType  = ihdr[9]; // 6 = RGBA
const bpp        = colorType === 6 ? 4 : colorType === 2 ? 3 : 4;

console.log(`Input: ${width}×${height} colorType=${colorType} bpp=${bpp}`);

const rawDecompressed = inflateSync(idat);
const pixels          = unfilter(rawDecompressed, width, height, bpp);

// Process: for each pixel, if dark background → transparent; else invert to dark ink
let converted = 0;
for (let i = 0; i < pixels.length; i += bpp) {
  const r = pixels[i], g = pixels[i+1], b = pixels[i+2];
  const brightness = (r + g + b) / 3;

  if (brightness < 128) {
    // Dark / background pixel → fully transparent
    pixels[i]   = 0;
    pixels[i+1] = 0;
    pixels[i+2] = 0;
    pixels[i+3] = 0;
    converted++;
  } else {
    // Light pixel (signature stroke) → invert to dark, fully opaque
    pixels[i]   = 255 - r;
    pixels[i+1] = 255 - g;
    pixels[i+2] = 255 - b;
    pixels[i+3] = 255;
  }
}
console.log(`Converted ${converted} background pixels to transparent`);

const rawFiltered    = buildRaw(pixels, width, height, bpp);
const compressed     = deflateSync(rawFiltered, { level: 9 });

// Rebuild PNG
const PNG_SIG = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
const out = Buffer.concat([
  PNG_SIG,
  makeChunk("IHDR", ihdr),
  makeChunk("IDAT", compressed),
  makeChunk("IEND", Buffer.alloc(0)),
]);

writeFileSync(dest, out);
console.log(`Saved → ${dest} (${out.length} bytes)`);
