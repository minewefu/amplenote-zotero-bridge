import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import plugin from "./plugin.mjs";

const root = new URL("./", import.meta.url);
const { version } = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const core = (await readFile(new URL("core.mjs", root), "utf8")).replace("export const ZoteroCore", "const ZoteroCore").trimEnd();
const adapter = (await readFile(new URL("plugin.mjs", root), "utf8"))
  .replace(/^import .*?;\r?\n/, "const Core = ZoteroCore;\n")
  .replace("export function createPlugin", "function createPlugin")
  .replace(/\nexport default createPlugin\(\);\s*$/, "\n").trimEnd();
const delegates = ["appOption", "insertText"].map(type => {
  const entries = Object.keys(plugin[type]).map(name =>
    `${JSON.stringify(name)}: function(app) { const instance = this._get(); return instance[${JSON.stringify(type)}][${JSON.stringify(name)}].call(instance, app); }`);
  return `${type}: {\n${entries.join(",\n")}\n}`;
});
delegates.push("onNavigate: function(app, ...args) { const instance = this._get(); return instance.onNavigate.call(instance, app, ...args); }");
// A literal object matches Amplenote's documented first-code-block format.
const bundle = `{\n_instance: null,\n_get() {\nif (!this._instance) {\n${core}\n${adapter}\nthis._instance = createPlugin();\n}\nreturn this._instance;\n},\n${delegates.join(",\n")}\n}\n`;
const metadata = `# Zotero Bridge\n\n| name | Zotero Bridge |\n| --- | --- |\n| icon | library_books |\n| description | Import Zotero references, notes and text annotations; insert citations. |\n| setting | Library type |\n| setting | Library ID |\n| setting | API key |\n| setting | Options JSON |\n\n`;
const note = metadata + "```javascript\n" + bundle + "```\n\nConfigure private settings after installing. Do not paste credentials into this note. Public-library smoke checks are documented in HOST_TEST_RESULTS.md; full compatibility and bounty acceptance remain unverified.\n";
await mkdir(new URL("dist/", root), { recursive: true });
await writeFile(new URL("dist/plugin.js", root), bundle);
await writeFile(new URL("dist/PLUGIN_NOTE.md", root), note);
const files = {};
for (const name of ["core.mjs", "plugin.mjs", "dist/plugin.js", "dist/PLUGIN_NOTE.md"]) {
  files[name] = createHash("sha256").update(await readFile(new URL(name, root))).digest("hex");
}
await writeFile(new URL("dist/manifest.json", root), JSON.stringify({ version, files, liveHostVerified: false }, null, 2) + "\n");
console.log("Built dist/plugin.js and dist/PLUGIN_NOTE.md; source and bundle hashes recorded.");
