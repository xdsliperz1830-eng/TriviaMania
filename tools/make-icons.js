/**
 * Rasterises the app mark from tools/logo.js into the launcher icons.
 *
 *   node tools/make-icons.js      (or: npm run icons)
 *
 * Every PNG is inspected before it is written. A blank key art nearly shipped
 * once because an invalid gradient silently rendered white, so nothing here is
 * trusted to have drawn just because the screenshot succeeded.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const logo = require("./logo");

const OUT = path.resolve(__dirname, "..", "icons");

const TARGETS = [
  { name: "apple-touch-icon.png", size: 180 },
  { name: "icon-192.png", size: 192 },
  { name: "icon-512.png", size: 512 },
  // Android may crop a maskable icon to the circle covering the middle 80%.
  // tests/icons.test.js measures where the mark actually falls: it clears that
  // circle up to about scale 1.05, so 0.88 leaves room for launchers that crop
  // a little tighter than the spec without shrinking the mark to a dot.
  { name: "icon-maskable-512.png", size: 512, scale: 0.88 },
  { name: "favicon-32.png", size: 32, simple: true },
  { name: "favicon-16.png", size: 16, simple: true }
];

/** Reads the rendered pixels back and refuses anything that did not draw. */
async function inspect(page, size) {
  return page.evaluate((s) => {
    const img = document.querySelector("img");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = s;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, s, s);
    const px = ctx.getImageData(0, 0, s, s).data;

    const colours = new Set();
    let yellow = 0, bright = 0, opaque = 0;
    for (let i = 0; i < px.length; i += 4) {
      const [r, g, b, a] = [px[i], px[i + 1], px[i + 2], px[i + 3]];
      if (a < 250) continue;
      opaque++;
      colours.add((r << 16) | (g << 8) | b);
      if (r > 200 && g > 150 && b < 130) yellow++;
      if (r > 200 && g > 220 && b > 220) bright++;
    }
    const total = s * s;
    return {
      colours: colours.size,
      opaque: opaque / total,
      yellow: yellow / total,
      bright: bright / total
    };
  }, size);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  // tools/logo.js is the editable master; this is the browser-facing vector.
  fs.writeFileSync(path.join(OUT, "favicon.svg"), logo.build({}));
  console.log("  favicon.svg              vector");

  const browser = await chromium.launch();
  for (const target of TARGETS) {
    const svg = logo.build({ scale: target.scale, simple: target.simple });
    const page = await browser.newPage({
      viewport: { width: target.size, height: target.size },
      deviceScaleFactor: 1
    });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}img{display:block;width:100vw;height:100vh}</style>` +
      `<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}">`
    );
    await page.waitForFunction(() => {
      const img = document.querySelector("img");
      return img && img.complete && img.naturalWidth > 0;
    });

    const seen = await inspect(page, target.size);
    const small = target.size < 64;
    const problems = [];
    if (seen.opaque < 0.99) problems.push(`not full-bleed (${(seen.opaque * 100).toFixed(1)}% opaque)`);
    if (seen.colours < (small ? 24 : 400)) problems.push(`flat render (${seen.colours} colours)`);
    if (seen.yellow < 0.01) problems.push(`no bolt (${(seen.yellow * 100).toFixed(2)}% yellow)`);
    if (!target.simple && seen.bright < 0.04) problems.push(`no brain (${(seen.bright * 100).toFixed(2)}% bright)`);
    if (problems.length) {
      throw new Error(`refusing to write ${target.name}: ${problems.join("; ")}`);
    }

    await page.screenshot({ path: path.join(OUT, target.name), omitBackground: false });
    console.log(
      `  ${target.name.padEnd(24)} ${String(target.size).padStart(3)}px   ` +
      `${seen.colours} colours, ${(seen.yellow * 100).toFixed(1)}% bolt`
    );
    await page.close();
  }
  await browser.close();
})();
