/**
 * Renders the store art from tools/keyart.html.
 *
 * The exact dimensions YouTube requires are not confirmed (the certification
 * pages were unreachable when this was written), so this produces the common
 * sizes and can regenerate any other on demand:
 *   node tools/make-art.js            # the default set
 *   node tools/make-art.js 1600x900   # one extra size, wide variant
 */
const path = require("path");
const { chromium } = require("playwright");

const PAGE = "file://" + path.resolve(__dirname, "keyart.html");
const OUT = path.resolve(__dirname, "..", "art");

const DEFAULTS = [
  { w: 1280, h: 720, variant: "wide", name: "keyart-1280x720.png" },
  { w: 1920, h: 1080, variant: "wide", name: "keyart-1920x1080.png" },
  { w: 512, h: 512, variant: "square", name: "icon-512.png" },
  { w: 1024, h: 1024, variant: "square", name: "icon-1024.png" }
];

(async () => {
  const extra = process.argv.slice(2).map((arg) => {
    const [w, h] = arg.split("x").map(Number);
    if (!w || !h) throw new Error(`bad size: ${arg} (expected WIDTHxHEIGHT)`);
    return { w, h, variant: w === h ? "square" : "wide", name: `keyart-${w}x${h}.png` };
  });
  const jobs = extra.length ? extra : DEFAULTS;

  const browser = await chromium.launch();
  for (const job of jobs) {
    const page = await browser.newPage({
      viewport: { width: job.w, height: job.h },
      deviceScaleFactor: 1
    });
    await page.goto(`${PAGE}?variant=${job.variant}`);
    await page.waitForTimeout(250);

    // An invalid value anywhere in the background shorthand drops every layer
    // and silently renders white, which is how a blank key art nearly shipped.
    const layers = await page.evaluate(
      () => (getComputedStyle(document.body).backgroundImage.match(/gradient/g) || []).length);
    if (layers < 4) {
      throw new Error(`background did not parse (${layers} of 4 gradient layers) — refusing to write ${job.name}`);
    }
    const file = path.join(OUT, job.name);
    await page.screenshot({ path: file });
    console.log(`  ${job.name.padEnd(24)} ${job.w}x${job.h}`);
    await page.close();
  }
  await browser.close();
})();
