// Generates a 1024x1024 placeholder PNG (solid TypIx blue) with no dependencies,
// so `tauri icon` can derive all platform icons from it.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const W = 1024;
const H = 1024;
const [r, g, b, a] = [37, 99, 235, 255]; // #2563eb

const rowBytes = 1 + W * 4;
const raw = Buffer.alloc(rowBytes * H);
for (let y = 0; y < H; y++) {
  const o = y * rowBytes;
  raw[o] = 0; // filter: none
  for (let x = 0; x < W; x++) {
    const p = o + 1 + x * 4;
    raw[p] = r;
    raw[p + 1] = g;
    raw[p + 2] = b;
    raw[p + 3] = a;
  }
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type: RGBA
const idat = deflateSync(raw, { level: 9 });
const png = Buffer.concat([
  sig,
  chunk("IHDR", ihdr),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = new URL("../app-icon.png", import.meta.url);
writeFileSync(out, png);
console.log(`wrote app-icon.png (${png.length} bytes)`);
