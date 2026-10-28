// Renders the extension icon (orange rounded square + white ‹ › chevrons) to PNGs.
// Usage: node make-icons.js <outDir>
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const outDir = process.argv[2];
fs.mkdirSync(outDir, { recursive: true });

// Geometry in a 128x128 design space.
const BG = [0xf4, 0x75, 0x21];
const FG = [0xff, 0xff, 0xff];
const RADIUS = 28;
const STROKE = 16;
const CHEVRONS = [
  [[54, 38], [30, 64], [54, 90]],
  [[74, 38], [98, 64], [74, 90]],
];

function insideRoundedRect(x, y) {
  const cx = Math.min(Math.max(x, RADIUS), 128 - RADIUS);
  const cy = Math.min(Math.max(y, RADIUS), 128 - RADIUS);
  return x >= 0 && x <= 128 && y >= 0 && y <= 128 && (x - cx) ** 2 + (y - cy) ** 2 <= RADIUS ** 2;
}

function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function onChevron(x, y) {
  return CHEVRONS.some(([a, b, c]) =>
    Math.min(distToSegment(x, y, a, b), distToSegment(x, y, b, c)) <= STROKE / 2);
}

function render(size) {
  const SS = 8; // supersampling per axis for anti-aliasing
  const scale = 128 / size;
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bg = 0, fg = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) * scale;
          const y = (py + (sy + 0.5) / SS) * scale;
          if (!insideRoundedRect(x, y)) continue;
          if (onChevron(x, y)) fg++; else bg++;
        }
      }
      const covered = bg + fg;
      const i = (py * size + px) * 4;
      if (covered === 0) continue;
      for (let c = 0; c < 3; c++) pixels[i + c] = Math.round((BG[c] * bg + FG[c] * fg) / covered);
      pixels[i + 3] = Math.round((covered / (SS * SS)) * 255);
    }
  }
  return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of [16, 32, 48, 128]) {
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), encodePng(size, render(size)));
}

const svgPaths = CHEVRONS.map(([a, b, c]) => `M${a[0]} ${a[1]} L${b[0]} ${b[1]} L${c[0]} ${c[1]}`).join(" ");
fs.writeFileSync(path.join(outDir, "icon.svg"),
`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="${RADIUS}" fill="#f47521"/>
  <path d="${svgPaths}" fill="none" stroke="#fff" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`);
console.log("done");
