// Stills of a built player for visual checks: node snap.mjs <dist/videos/slug/index.html> <out dir> [t1,t2,...]
// Without times it takes one still per cue, a second after the cue starts.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const [, , html, out, times] = process.argv;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => console.error('PAGE ERROR', e.message));
await page.goto('file://' + html + '?capture');
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);
const ts = times ? times.split(',').map(Number) : await page.evaluate(() => TIMELINE.scenes.flatMap((s) => s.cues.map((c) => +(c.start + Math.min(1.2, c.dur * 0.6)).toFixed(2))));
for (const t of ts) {
  await page.evaluate((t) => render(t), t);
  await page.screenshot({ path: `${out}/${String(t.toFixed(1)).padStart(7, '0')}.png` });
}
console.log('stills', ts.length);
await browser.close();
