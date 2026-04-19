// create-icons.js — Generates icon16.png, icon48.png, icon128.png from source image
// Run once: node create-icons.js

const fs   = require("fs");
const path = require("path");
const zlib = require("zlib");

// ── Minimal PNG encoder (no dependencies) ──
function crc32(buf) {
  let crc = 0xffffffff;
  const table = new Uint32Array(256).map((_, i) => {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    return c;
  });
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf  = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(data.length);
  const crcBuf  = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function makePNG(size, r, g, b) {
  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8]  = 8;  // bit depth
  ihdr[9]  = 2;  // color type RGB
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  // Raw pixel data: each row = filter byte (0) + R G B * size
  const rawRows = Buffer.allocUnsafe(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const base = y * (1 + size * 3);
    rawRows[base] = 0; // filter none
    for (let x = 0; x < size; x++) {
      rawRows[base + 1 + x * 3]     = r;
      rawRows[base + 1 + x * 3 + 1] = g;
      rawRows[base + 1 + x * 3 + 2] = b;
    }
  }

  const idat = zlib.deflateSync(rawRows, { level: 9 });

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

// ── Icon color: deep indigo #7c3aed = rgb(124, 58, 237) ──
const R = 124, G = 58, B = 237;

const iconsDir = path.join(__dirname, "..", "extension", "icons");
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

for (const size of [16, 48, 128]) {
  const file = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(file, makePNG(size, R, G, B));
  console.log(`✅ Created icons/icon${size}.png (${size}x${size} solid indigo)`);
}

console.log("\n✨ All icons created. Reload the extension in chrome://extensions");
