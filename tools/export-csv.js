/**
 * Exports the question bank to CSV for review.
 *
 *   node tools/export-csv.js            -> dist/brain-blitz-questions.csv
 *   node tools/export-csv.js out.csv    -> a path of your choosing
 *
 * Columns are ordered for fact-checking: the correct answer sits next to the
 * question, with the three distractors after it, so a reviewer reads a row
 * left to right and can mark it without cross-referencing anything.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

const CATEGORIES = {};
const catBlock = source.match(/const CATEGORIES = \{[\s\S]*?\n\};/)[0];
catBlock.replace(/(\w+):\s*\{ name: "([^"]+)"/g, (_, key, name) => { CATEGORIES[key] = name; });

const rows = [];
const entry = /\{ c:"(\w+)", q:"([^"]+)", a:\[([^\]]*)\],\s*\n\s*e:"([^"]*)" \}/g;
let m;
while ((m = entry.exec(source)) !== null) {
  const [, cat, question, optionList, explanation] = m;
  const options = [...optionList.matchAll(/"([^"]*)"/g)].map((o) => o[1]);
  rows.push({
    category: CATEGORIES[cat] || cat,
    key: cat,
    question,
    correct: options[0],          // authoring order: the correct answer is first
    wrong: options.slice(1),
    explanation
  });
}

const quote = (v) => `"${String(v).replace(/"/g, '""')}"`;
const header = ["#","Category","Question","Correct answer","Wrong 1","Wrong 2","Wrong 3","Explanation","Checked","Notes"];
const lines = [header.map(quote).join(",")];
rows.forEach((r, i) => {
  lines.push([ i + 1, r.category, r.question, r.correct, r.wrong[0], r.wrong[1], r.wrong[2],
               r.explanation, "", "" ].map(quote).join(","));
});

const out = process.argv[2] || path.join(ROOT, "dist", "brain-blitz-questions.csv");
fs.mkdirSync(path.dirname(out), { recursive: true });
// A BOM makes Excel open UTF-8 correctly on Windows.
fs.writeFileSync(out, "\uFEFF" + lines.join("\r\n") + "\r\n", "utf8");

const perCat = {};
rows.forEach((r) => { perCat[r.category] = (perCat[r.category] || 0) + 1; });
console.log(`  ${rows.length} questions exported`);
Object.keys(perCat).sort().forEach((c) => console.log(`    ${c.padEnd(20)} ${perCat[c]}`));
console.log(`\n  ${path.relative(ROOT, out)}  (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
console.log("  Two blank columns, Checked and Notes, are there for the review pass.");
