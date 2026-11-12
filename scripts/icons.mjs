import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const svg = await readFile(join(root, 'assets', 'icon.svg'), 'utf8');
const build = join(root, 'build');
await mkdir(build, { recursive: true });

const browser = await chromium.launch({ channel: process.env.RELAY_BROWSER_CHANNEL ?? 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.screenshot({ path: join(build, 'icon.png'), omitBackground: true, clip: { x: 0, y: 0, width: 1024, height: 1024 } });
} finally {
  await browser.close();
}

const iconset = join(build, 'icon.iconset');
await rm(iconset, { recursive: true, force: true });
await mkdir(iconset, { recursive: true });
const png = join(build, 'icon.png');
for (const size of [16, 32, 128, 256, 512]) {
  execFileSync('sips', ['-z', String(size), String(size), png, '--out', join(iconset, `icon_${size}x${size}.png`)], { stdio: 'ignore' });
  execFileSync('sips', ['-z', String(size * 2), String(size * 2), png, '--out', join(iconset, `icon_${size}x${size}@2x.png`)], { stdio: 'ignore' });
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(build, 'icon.icns')]);

const images = [];
for (const size of [16, 32, 48, 64, 128, 256]) {
  const file = join(build, `icon-${size}.png`);
  execFileSync('sips', ['-z', String(size), String(size), png, '--out', file], { stdio: 'ignore' });
  images.push({ size, data: await readFile(file) });
  await rm(file, { force: true });
}
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
const entries = [];
let offset = 6 + 16 * images.length;
for (const image of images) {
  const entry = Buffer.alloc(16);
  entry[0] = image.size >= 256 ? 0 : image.size;
  entry[1] = image.size >= 256 ? 0 : image.size;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(image.data.length, 8);
  entry.writeUInt32LE(offset, 12);
  entries.push(entry);
  offset += image.data.length;
}
await writeFile(join(build, 'icon.ico'), Buffer.concat([header, ...entries, ...images.map((image) => image.data)]));
await rm(iconset, { recursive: true, force: true });
console.log('Wrote build/icon.png, build/icon.icns and build/icon.ico');
