import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const url = process.env.PREVIEW_URL || 'http://localhost:5173/preview.html';
const out = '/tmp/shots';
mkdirSync(out, { recursive: true });

const b = await chromium.launch({ executablePath: exe });
const targets = [
  { name: 'desktop', width: 1366, height: 900 },
  { name: 'movil', width: 390, height: 844 },
];
for (const t of targets) {
  const ctx = await b.newContext({ viewport: { width: t.width, height: t.height }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'load', timeout: 30000 });
  await p.waitForTimeout(1200); // que asienten fuentes/animaciones
  await p.screenshot({ path: `${out}/nexus-${t.name}.png`, fullPage: true });
  console.log(`shot: ${out}/nexus-${t.name}.png (${t.width}x${t.height})`);
  await ctx.close();
}
await b.close();
console.log('DONE');
