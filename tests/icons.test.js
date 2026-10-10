/**
 * Launcher icons and the web app manifest.
 *
 * Added to a home screen, the game used to show a letter "B" because the page
 * declared no icon at all. These checks cover the whole chain: the <head>
 * declarations, the manifest, the files they point at, and — because a broken
 * gradient once rendered a key art pure white — the pixels inside each PNG.
 */
const fs = require("fs");
const path = require("path");
const { createSuite, openGame } = require("./harness");

const ROOT = path.resolve(__dirname, "..");
const t = createSuite("icons");

/**
 * Pixel facts about one image, read back through a canvas. The bytes are handed
 * over as a data URL: a file:// image taints the canvas and getImageData throws.
 */
function describe(page, href) {
  const bytes = fs.readFileSync(path.join(ROOT, href)).toString("base64");
  return page.evaluate(async (file) => {
    const img = new Image();
    img.src = file;
    await img.decode();

    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const { width: w, height: h } = canvas;
    const px = ctx.getImageData(0, 0, w, h).data;

    const colours = new Set();
    let transparent = 0, yellow = 0, bright = 0, outsideMark = 0;
    // Android may crop a maskable icon to the circle covering the middle 80%.
    const r = 0.4 * w;

    for (let i = 0; i < px.length; i += 4) {
      const [red, green, blue, a] = [px[i], px[i + 1], px[i + 2], px[i + 3]];
      if (a < 250) { transparent++; continue; }
      colours.add((red << 16) | (green << 8) | blue);
      const isYellow = red > 200 && green > 150 && blue < 130;
      const isBright = red > 200 && green > 220 && blue > 220;
      if (isYellow) yellow++;
      if (isBright) bright++;
      if (isYellow || isBright) {
        const n = i / 4, x = (n % w) - w / 2, y = Math.floor(n / w) - h / 2;
        if (Math.hypot(x, y) > r) outsideMark++;
      }
    }
    const total = w * h;
    return {
      width: w, height: h,
      colours: colours.size,
      transparent: transparent / total,
      yellow: yellow / total,
      bright: bright / total,
      outsideMark
    };
  }, `data:image/png;base64,${bytes}`);
}

(async () => {
  const { browser, page } = await openGame();
  t.watch(page);

  // ── what the page declares ────────────────────────────────────────────────
  const head = await page.evaluate(() => ({
    links: [...document.querySelectorAll("link[rel]")].map((l) => ({
      rel: l.getAttribute("rel"),
      href: l.getAttribute("href"),
      sizes: l.getAttribute("sizes"),
      type: l.getAttribute("type")
    })),
    metas: Object.fromEntries(
      [...document.querySelectorAll("meta[name]")].map((m) => [m.name, m.content]))
  }));

  const rel = (name) => head.links.filter((l) => l.rel === name);

  t.check(rel("apple-touch-icon").length === 1,
    "the page declares an apple-touch-icon (iOS ignores the manifest)");
  t.check(rel("manifest").length === 1,
    "the page declares a web app manifest (Android ignores apple-touch-icon)");
  t.check(rel("icon").some((l) => l.type === "image/svg+xml"),
    "a vector favicon is offered for browsers that take one");
  t.check(rel("icon").some((l) => l.sizes === "32x32") && rel("icon").some((l) => l.sizes === "16x16"),
    "raster favicons cover 16 and 32 px");

  t.check(head.metas["apple-mobile-web-app-title"] === "Brain Blitz",
    'the home-screen label is set to "Brain Blitz", not the document title');
  t.check(head.metas["apple-mobile-web-app-capable"] === "yes" &&
          head.metas["mobile-web-app-capable"] === "yes",
    "launching from the home screen opens standalone on both platforms");
  t.check(head.metas["apple-mobile-web-app-status-bar-style"] === "black-translucent",
    "the status bar is translucent, which the safe-area padding already allows");

  // ── the manifest ──────────────────────────────────────────────────────────
  const manifestHref = rel("manifest")[0] && rel("manifest")[0].href;
  const manifestPath = path.join(ROOT, manifestHref || "manifest.webmanifest");
  t.check(fs.existsSync(manifestPath), `the manifest file exists (${manifestHref})`);

  let manifest = {};
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    t.check(true, "the manifest is valid JSON");
  } catch (e) {
    t.check(false, "the manifest is valid JSON: " + e.message);
  }

  t.check(manifest.name === "Brain Blitz" && manifest.short_name === "Brain Blitz",
    "the manifest names the app on both the install prompt and the launcher");
  t.check(manifest.display === "standalone",
    "the manifest asks for a standalone window, not a browser tab");
  t.check(manifest.theme_color === head.metas["theme-color"],
    `the manifest theme colour matches the meta tag (${manifest.theme_color})`);
  t.check(manifest.background_color === "#0F172A",
    "the splash background is the game's navy, so the launch does not flash white");
  t.check(!!manifest.start_url && !!manifest.scope,
    "the manifest sets start_url and scope, so it works from a project subpath");

  const icons = manifest.icons || [];
  t.check(icons.some((i) => i.sizes === "192x192") && icons.some((i) => i.sizes === "512x512"),
    "the manifest offers the 192 and 512 px icons Android asks for");
  t.check(icons.some((i) => (i.purpose || "").split(" ").includes("maskable")),
    "a maskable icon is offered, so Android does not letterbox the mark");

  // ── every declared file is really there ───────────────────────────────────
  const declared = [
    ...head.links.filter((l) => l.rel.includes("icon")).map((l) => l.href),
    ...icons.map((i) => i.src)
  ];
  const missing = declared.filter((href) => !fs.existsSync(path.join(ROOT, href)));
  t.check(missing.length === 0,
    `every declared icon resolves to a file (${declared.length} checked)` +
      (missing.length ? ": missing " + missing.join(", ") : ""));

  // ── the pixels ────────────────────────────────────────────────────────────
  const rasters = declared.filter((href) => href.endsWith(".png"));
  for (const href of rasters) {
    const seen = await describe(page, href);
    const small = seen.width < 64;
    const name = path.basename(href);

    t.check(seen.colours > (small ? 24 : 400),
      `${name} actually drew something (${seen.colours} colours)`);
    t.check(seen.transparent < 0.01,
      `${name} is full-bleed, so iOS cannot render its corners black`);
    t.check(seen.yellow > 0.01,
      `${name} shows the bolt (${(seen.yellow * 100).toFixed(1)}% of pixels)`);
    if (!small) {
      t.check(seen.bright > 0.04,
        `${name} shows the brain (${(seen.bright * 100).toFixed(1)}% of pixels)`);
    }
  }

  for (const href of rasters) {
    const declaredSize = (icons.find((i) => i.src === href) || {}).sizes;
    if (!declaredSize) continue;
    const seen = await describe(page, href);
    t.check(`${seen.width}x${seen.height}` === declaredSize,
      `${path.basename(href)} is really ${declaredSize}, as the manifest claims`);
  }

  const maskable = icons.find((i) => (i.purpose || "").split(" ").includes("maskable"));
  if (maskable) {
    const seen = await describe(page, maskable.src);
    t.check(seen.outsideMark === 0,
      "nothing in the maskable icon falls outside the circle Android may crop to" +
        (seen.outsideMark ? ` (${seen.outsideMark} px would be cut)` : ""));
  }

  // The apple-touch-icon is square, which is what iOS masks; a non-square one
  // gets stretched.
  const apple = rel("apple-touch-icon")[0];
  if (apple) {
    const seen = await describe(page, apple.href);
    t.check(seen.width === seen.height && seen.width >= 180,
      `the apple-touch-icon is square and at least 180 px (${seen.width}x${seen.height})`);
  }

  await browser.close();
  t.report();
})();
