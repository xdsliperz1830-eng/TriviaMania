/**
 * Runs every suite in tests/ and reports a combined result.
 * Usage: npm test  (optionally: npm test -- gameplay rotation)
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const only = process.argv.slice(2);
const suites = fs
  .readdirSync(__dirname)
  .filter((f) => f.endsWith(".test.js"))
  .filter((f) => !only.length || only.some((o) => f.startsWith(o)))
  .sort();

if (!suites.length) {
  console.error("no test suites matched");
  process.exit(1);
}

const failures = [];
for (const suite of suites) {
  console.log(`\n── ${suite} ${"─".repeat(Math.max(0, 56 - suite.length))}`);
  const run = spawnSync(process.execPath, [path.join(__dirname, suite)], {
    stdio: "inherit"
  });
  if (run.status !== 0) failures.push(suite);
}

console.log("\n" + "═".repeat(60));
if (failures.length) {
  console.log(`FAILED: ${failures.join(", ")}`);
  process.exit(1);
}
console.log(`All ${suites.length} suites passed.`);
