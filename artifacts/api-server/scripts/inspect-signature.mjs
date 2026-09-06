import { readFileSync } from "fs";
import { inflateSync } from "zlib";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(__dirname, "../src/assets/iroc-signature.png");

function parsePNG(buf) {
  let offset = 8;
  let ihdr = null;
  const idatChunks = [];
  while (offset < buf.length) {
    const len  = buf.readUInt32BE(offset); offset += 4;
    const type = buf.toString("ascii", offset, offset + 4); offset += 4;
    const data = buf.slice(offset, offset + len); offset += len;
    offset += 4;
    if (type === "IHDR") ihdr = data;
    if (type === "IDAT") idatChunks.push(data);
    if (type === "IEND") break;
  }
  return { ihdr, idat: Buffer.concat(idatChunks) };
}

function unfilter(raw, width, height, bpp) {
  const stride = width * bpp;
  const pixels = Buffer.alloc(height * stride);
  let rawOff = 0, pixOff = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rawOff++];
    const row = raw.slice(rawOff, rawOff + stride); rawOff += stride;
    const prev = y > 0 ? pixels.slice((y-1)*stride, y*stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? pixels[pixOff + x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = row[x];
      switch (filter) {
        case 1: v = (v + a) & 0xff; break;
        case 2: v = (v + b) & 0xff; break;
        case 3: v = (v + Math.floor((a+b)/2)) & 0xff; break;
        case 4: { const pa=Math.abs(b-c),pb=Math.abs(a-c),pc=Math.abs(a+b-2*c); v=(v+(pa<=pb&&pa<=pc?a:pb<=pc?b:c))&0xff; break; }
      }
      pixels[pixOff + x] = v;
    }
    pixOff += stride;
  }
  return pixels;
}

const buf = readFileSync(src);
const { ihdr, idat } = parsePNG(buf);
const width = ihdr.readUInt32BE(0);
const height = ihdr.readUInt32BE(4);
const colorType = ihdr[9];
const bpp = colorType === 6 ? 4 : 3;

console.log(`Size: ${width}×${height}, colorType=${colorType} (6=RGBA), bpp=${bpp}`);

const raw = inflateSync(idat);
const pixels = unfilter(raw, width, height, bpp);

// Analyse pixel distribution
let fullyTransparent = 0, fullyOpaque = 0, semiTransparent = 0;
let darkOpaque = 0, lightOpaque = 0;
// Sample first 20 opaque pixels
const samples = [];

for (let i = 0; i < pixels.length; i += bpp) {
  const r = pixels[i], g = pixels[i+1], b = pixels[i+2], a = pixels[i+3] ?? 255;
  if (a === 0) fullyTransparent++;
  else if (a === 255) {
    fullyOpaque++;
    const brightness = (r + g + b) / 3;
    if (brightness < 128) darkOpaque++;
    else lightOpaque++;
    if (samples.length < 20) samples.push({ r, g, b, a, brightness: brightness.toFixed(0) });
  } else {
    semiTransparent++;
    if (samples.length < 20) samples.push({ r, g, b, a, brightness: ((r+g+b)/3).toFixed(0) });
  }
}

const total = width * height;
console.log(`Total pixels: ${total}`);
console.log(`Fully transparent (a=0): ${fullyTransparent}`);
console.log(`Fully opaque (a=255): ${fullyOpaque}`);
console.log(`Semi-transparent: ${semiTransparent}`);
console.log(`Dark opaque (brightness<128): ${darkOpaque}`);
console.log(`Light opaque (brightness>=128): ${lightOpaque}`);
console.log(`\nFirst ${samples.length} non-transparent pixel samples:`);
samples.forEach((s, i) => console.log(`  [${i}] r=${s.r} g=${s.g} b=${s.b} a=${s.a} brightness=${s.brightness}`));
