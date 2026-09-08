import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = new URL("./", import.meta.url);
const run = args => spawnSync(process.execPath, args, { cwd: fileURLToPath(root), encoding: "utf8", timeout: 60000 });
const build = run(["build.mjs"]);
if (build.status !== 0) throw new Error("Build failed: " + (build.stderr || build.error || build.stdout));
const testFiles = ["test/core.test.mjs", "test/plugin.test.mjs", "test/auto-sync.test.mjs"];
const result = run(["--test", "--test-reporter=tap", ...testFiles]);
await mkdir(new URL("evidence/", root), { recursive: true });
await writeFile(new URL("evidence/tests.tap", root), result.stdout + (result.stderr || ""));
const count = name => Number(new RegExp(`^# ${name} (\\d+)$`, "m").exec(result.stdout)?.[1] ?? -1);
const manifest = JSON.parse(await readFile(new URL("dist/manifest.json", root), "utf8"));
const fileHashes = {};
for (const [path, recorded] of Object.entries(manifest.files)) {
  const actual = createHash("sha256").update(await readFile(new URL(path, root))).digest("hex");
  fileHashes[path] = { sha256: actual, matchesBuild: actual === recorded };
}
for (const path of [...testFiles, "test/fixtures.mjs", "build.mjs", "verify.mjs"]) {
  fileHashes[path] = { sha256: createHash("sha256").update(await readFile(new URL(path, root))).digest("hex") };
}
const report = {
  generatedAt: new Date().toISOString(), nodeVersion: process.version,
  command: "node --test --test-reporter=tap " + testFiles.join(" "),
  exitCode: result.status, tests: count("tests"), passed: count("pass"), failed: count("fail"),
  skipped: count("skipped"), cancelled: count("cancelled"),
  scope: "Synthetic Zotero responses, in-memory Amplenote API fixtures, and a deterministic automatic-sync clock; includes evaluation and execution of the generated literal-object bundle. No authenticated host execution or real browser timer-lifecycle check.",
  authenticatedHostIntegrationVerified: false, paymentVerified: false, fileHashes,
};
report.verified = report.exitCode === 0 && report.tests > 0 && report.passed === report.tests && report.failed === 0 &&
  report.skipped === 0 && report.cancelled === 0 && Object.values(fileHashes).every(row => row.matchesBuild !== false);
await writeFile(new URL("evidence/verification.json", root), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ verified: report.verified, tests: report.tests, passed: report.passed, failed: report.failed,
  sourceAndBundleHashesMatch: Object.values(fileHashes).every(row => row.matchesBuild !== false),
  authenticatedHostIntegrationVerified: false }, null, 2));
if (!report.verified) { console.error(result.stdout + result.stderr); process.exitCode = 1; }
