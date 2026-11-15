/**
 * Builds the language files the game loads (lang/<code>.js) from the
 * plain-text sources in lang/src/<code>/, and checks them against the
 * English question bank in index.html.
 *
 *   node tools/make-lang.js                 build every language in lang/src/
 *   node tools/make-lang.js --check         check the sources and that lang/*.js is current; write nothing
 *   node tools/make-lang.js --english DIR   write the English bank to DIR in the
 *                                           same format, for a translator to work from
 *
 * Sources, per language:
 *   ui.json          { "ui": { key: text }, "cats": { key: name } }
 *   <category>.txt   one question per line, in the same order as index.html:
 *                    question | correct answer | wrong | wrong | wrong | explanation
 *
 * The order is what ties a translation to its question, so a line is never
 * moved, added or dropped on its own: change index.html and every language
 * together.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "lang", "src");
const SEP = " | ";

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
function literal(name, close) {
  const start = html.indexOf("const " + name + " = ");
  const end = html.indexOf(close, start);
  if (start === -1 || end === -1) throw new Error("could not find " + name + " in index.html");
  return (0, eval)("(" + html.slice(start + ("const " + name + " = ").length, end + close.length - 1) + ")");
}
const QUESTIONS = literal("QUESTIONS", "\n];");
const CATEGORIES = literal("CATEGORIES", "\n};");
const STR_EN = literal("STR_EN", "\n};");
const LANGS = literal("LANGS", "};");

const CAT_KEYS = Object.keys(CATEGORIES);
const byCat = {};
QUESTIONS.forEach((q, i) => { (byCat[q.c] = byCat[q.c] || []).push(i); });

const args = process.argv.slice(2);
if (args[0] === "--english") {
  const out = path.resolve(args[1] || path.join(ROOT, "dist", "lang-en"));
  fs.mkdirSync(out, { recursive: true });
  CAT_KEYS.forEach((cat) => {
    const lines = byCat[cat].map((i) => {
      const q = QUESTIONS[i];
      return [q.q].concat(q.a, [q.e]).join(SEP);
    });
    fs.writeFileSync(path.join(out, cat + ".txt"), lines.join("\n") + "\n");
  });
  const cats = {};
  CAT_KEYS.forEach((k) => { cats[k] = CATEGORIES[k].name; });
  fs.writeFileSync(path.join(out, "ui.json"), JSON.stringify({ ui: STR_EN, cats }, null, 2) + "\n");
  console.log("English sources written to " + out);
  process.exit(0);
}

const checkOnly = args[0] === "--check";
const digits = (s) => (s.match(/\d/g) || []).join("");
const holes = (s) => (s.match(/\{\w+\}/g) || []).sort().join(",");
let failed = false;

const codes = fs.existsSync(SRC) ? fs.readdirSync(SRC).filter((d) => fs.statSync(path.join(SRC, d)).isDirectory()) : [];
if (!codes.length) { console.error("no languages found in lang/src/"); process.exit(1); }

codes.forEach((code) => {
  const problems = [];
  const notes = [];
  const dir = path.join(SRC, code);
  if (!LANGS[code]) problems.push('"' + code + '" is not listed in LANGS in index.html');

  let meta = { ui: {}, cats: {} };
  try { meta = JSON.parse(fs.readFileSync(path.join(dir, "ui.json"), "utf8")); }
  catch (e) { problems.push("ui.json: " + e.message); }
  const ui = meta.ui || {}, cats = meta.cats || {};
  Object.keys(STR_EN).forEach((key) => {
    if (typeof ui[key] !== "string" || !ui[key].trim()) problems.push("ui.json: missing text for \"" + key + "\"");
    else if (holes(ui[key]) !== holes(STR_EN[key])) problems.push("ui.json: \"" + key + "\" must keep the placeholders " + (holes(STR_EN[key]) || "(none)"));
  });
  // A language may add "<key>_1" for a count of exactly one, where its grammar needs it.
  Object.keys(ui).forEach((key) => {
    if (!(key in STR_EN) && !(/_1$/.test(key) && key.slice(0, -2) in STR_EN)) problems.push("ui.json: unknown key \"" + key + "\"");
  });
  CAT_KEYS.forEach((k) => { if (typeof cats[k] !== "string" || !cats[k].trim()) problems.push("ui.json: missing category name \"" + k + "\""); });

  const rows = new Array(QUESTIONS.length);
  CAT_KEYS.forEach((cat) => {
    const file = path.join(dir, cat + ".txt");
    if (!fs.existsSync(file)) { problems.push(cat + ".txt is missing"); return; }
    const lines = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim());
    if (lines.length !== byCat[cat].length) {
      problems.push(cat + ".txt has " + lines.length + " lines, expected " + byCat[cat].length);
      return;
    }
    lines.forEach((line, n) => {
      const where = cat + ".txt line " + (n + 1);
      const parts = line.split(SEP).map((p) => p.trim());
      const en = QUESTIONS[byCat[cat][n]];
      if (parts.length !== 6) { problems.push(where + ": " + parts.length + " fields, expected 6"); return; }
      if (parts.some((p) => !p)) { problems.push(where + ": an empty field"); return; }
      const answers = parts.slice(1, 5);
      if (new Set(answers.map((a) => a.toLowerCase())).size !== 4) problems.push(where + ": two answers are the same");
      // A number in an English answer should be the same number in the translation.
      answers.forEach((a, k) => {
        if (/^[\d\s.,%°+\-–]+$/.test(en.a[k]) && digits(a) !== digits(en.a[k])) {
          problems.push(where + ": answer " + (k + 1) + " is \"" + a + "\" but the English is \"" + en.a[k] + "\"");
        } else if (digits(a) !== digits(en.a[k])) {
          notes.push(where + ": answer " + (k + 1) + " \"" + a + "\" has different digits from \"" + en.a[k] + "\"");
        }
      });
      rows[byCat[cat][n]] = parts;
    });
  });

  if (process.env.NOTES) notes.forEach((n) => console.log("  note  " + code + "/" + n));
  if (problems.length) {
    failed = true;
    console.log(code + ": " + problems.length + " problem(s)");
    problems.slice(0, 40).forEach((p) => console.log("  " + p));
    if (problems.length > 40) console.log("  … and " + (problems.length - 40) + " more");
    return;
  }
  const body = "/* Built by tools/make-lang.js from lang/src/" + code + "/. Edit the sources, not this file. */\n" +
    "BB_LANG(" + JSON.stringify(code) + ",{ui:" + JSON.stringify(ui) + ",cats:" + JSON.stringify(cats) +
    ",q:[\n" + rows.map((r) => JSON.stringify(r)).join(",\n") + "\n]});\n";
  const outFile = path.join(ROOT, "lang", code + ".js");
  if (checkOnly) {
    // The built file is committed, so it must match what the sources produce.
    const current = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : "";
    if (current !== body) {
      failed = true;
      console.log(code + ": lang/" + code + ".js is out of date with lang/src/" + code + "/ (run: npm run lang)");
    } else {
      console.log(code + ": ok (" + rows.length + " questions, " + Object.keys(ui).length + " interface texts)");
    }
    return;
  }
  fs.writeFileSync(outFile, body);
  console.log(code + ": lang/" + code + ".js written (" + rows.length + " questions, " + Math.round(body.length / 1024) + " KB)");
});

process.exit(failed ? 1 : 0);
