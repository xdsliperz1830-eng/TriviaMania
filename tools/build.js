/**
 * Produces the submission bundle.
 *
 * A Playable is uploaded as a ZIP. The whole game is one self-contained file,
 * so the bundle is just index.html at the archive root — no build step, no
 * external assets, nothing to resolve at runtime.
 *
 *   node tools/build.js      (or: npm run build)
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const ZIP = path.join(DIST, "brain-blitz-playable.zip");

const MiB = 1024 * 1024;
const INITIAL_CAP = 30 * MiB;     // hard: the game will not launch above this
const RECOMMENDED = 15 * MiB;
const BUNDLE_CAP = 250 * MiB;
const FILE_CAP = 30 * MiB;        // per file inside the bundle

const CONTENTS = ["index.html"];

function kb(bytes) { return (bytes / 1024).toFixed(0) + " KB"; }

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

for (const file of CONTENTS) {
  const from = path.join(ROOT, file);
  if (!fs.existsSync(from)) throw new Error(`missing ${file}`);
  fs.copyFileSync(from, path.join(DIST, file));
}

// index.html must sit at the archive root, so zip from inside dist/.
execFileSync("zip", ["-q", "-X", "-r", ZIP, ...CONTENTS], { cwd: DIST });

const zipSize = fs.statSync(ZIP).size;
const problems = [];

for (const file of CONTENTS) {
  const size = fs.statSync(path.join(DIST, file)).size;
  console.log(`  ${file.padEnd(28)} ${kb(size)}`);
  if (size > FILE_CAP) problems.push(`${file} exceeds the ${FILE_CAP / MiB} MiB per-file limit`);
  if (size > INITIAL_CAP) problems.push(`${file} exceeds the ${INITIAL_CAP / MiB} MiB initial payload cap`);
}

console.log(`\n  bundle                       ${kb(zipSize)}  (${path.relative(ROOT, ZIP)})`);
console.log(`  initial payload cap          ${INITIAL_CAP / MiB} MiB   — using ${(zipSize / INITIAL_CAP * 100).toFixed(2)}%`);
console.log(`  recommended                  ${RECOMMENDED / MiB} MiB   — ${zipSize < RECOMMENDED ? "within" : "OVER"}`);
console.log(`  total bundle cap             ${BUNDLE_CAP / MiB} MiB  — ${zipSize < BUNDLE_CAP ? "within" : "OVER"}`);

if (problems.length) {
  problems.forEach((p) => console.error("  PROBLEM: " + p));
  process.exit(1);
}

// Play the built file, not the source. This is the artifact that gets
// uploaded, so it is the one worth proving.
(async () => {
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const from = (m.location() && m.location().url) || "";
    // The SDK only resolves inside YouTube; failing to fetch it is expected.
    if (from.indexOf("youtube.com/game_api") === -1) errors.push(m.text());
  });

  await page.goto("file://" + path.join(DIST, "index.html"));
  await page.waitForSelector("#playBtn", { state: "visible" });
  await page.locator("#playBtn").click();
  await page.waitForTimeout(400);

  const ok = await page.evaluate(() => ({
    answers: document.querySelectorAll(".ans").length,
    questions: typeof QUESTIONS !== "undefined" ? QUESTIONS.length : 0,
    round: state.round.length
  }));
  await browser.close();

  const failures = [];
  if (ok.answers !== 4) failures.push(`expected 4 answers, saw ${ok.answers}`);
  if (ok.questions !== 300) failures.push(`expected 300 questions, saw ${ok.questions}`);
  if (ok.round !== 10) failures.push(`expected a 10-question round, saw ${ok.round}`);
  if (errors.length) failures.push("page errors: " + errors.join("; "));

  if (failures.length) {
    failures.forEach((f) => console.error("  PROBLEM: " + f));
    process.exit(1);
  }
  console.log(`  smoke test                   a round plays from the bundle (${ok.questions} questions)`);
  console.log("\n  Ready to upload.");
})();
