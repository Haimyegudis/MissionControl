// Build mission-control.ico from the rendered PNGs (PNG-compressed ICO
// entries — supported since Vista). Usage: node make-ico.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const sizes = [16, 32, 48, 64, 256];
const pngs = sizes.map((s) => ({ s, buf: readFileSync(new URL(`./icon-${s}.png`, import.meta.url)) }));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(pngs.length, 4);

const dirSize = 16 * pngs.length;
let offset = 6 + dirSize;
const entries = [];
for (const { s, buf } of pngs) {
  const e = Buffer.alloc(16);
  e.writeUInt8(s === 256 ? 0 : s, 0); // width (0 = 256)
  e.writeUInt8(s === 256 ? 0 : s, 1); // height
  e.writeUInt8(0, 2); // palette
  e.writeUInt8(0, 3); // reserved
  e.writeUInt16LE(1, 4); // planes
  e.writeUInt16LE(32, 6); // bpp
  e.writeUInt32LE(buf.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += buf.length;
  entries.push(e);
}

const ico = Buffer.concat([header, ...entries, ...pngs.map((p) => p.buf)]);
writeFileSync(new URL('./mission-control.ico', import.meta.url), ico);
console.log(`mission-control.ico written (${ico.length} bytes, ${pngs.length} sizes)`);
