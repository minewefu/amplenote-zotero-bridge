import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createPlugin } from "../plugin.mjs";
import { ZoteroCore as Core } from "../core.mjs";
import { reference, service, jsonResponse, FakeApp, pdf, note, annotation } from "./fixtures.mjs";

function setup(options = {}, source = {}) {
  const app = new FakeApp(options), s = service(source), plugin = createPlugin({ fetchImpl: s.fetch });
  const run = (name = "Sync selected references", type = "appOption") => plugin[type][name].call(plugin, app);
  return { app, s, plugin, run };
}

test("first import creates one note; a repeat leaves content unchanged", async () => {
  const { app, run } = setup();
  assert.equal((await run()).created, 1);
  const original = app.notes.get("local-1").body;
  assert.equal((await run()).unchanged, 1);
  assert.equal(app.notes.size, 1);
  assert.equal(app.writes, 1);
  assert.equal(app.notes.get("local-1").body, original);
});

test("new revision preserves manual edits; reverting source still creates newest matching revision", async () => {
  const { app, s, run } = setup();
  await run();
  const n = app.notes.get("local-1"), initial = structuredClone(s.items[0]);
  n.body += "\nMy manual notes must survive.\n";
  s.items[0].data.title = "Revised research"; s.items[0].version++;
  assert.equal((await run()).updated, 1);
  assert.ok(n.body.includes("My manual notes must survive."));
  assert.ok(n.body.indexOf("Revised research") < n.body.indexOf("Sample research"));
  s.items[0] = initial;
  assert.equal((await run()).updated, 1);
  assert.ok(n.body.indexOf("Sample research") < n.body.indexOf("Revised research"));
  assert.equal(app.notes.size, 1);
});

test("child-only revisions update an existing reference", async () => {
  const child = structuredClone(note), { app, run } = setup({}, { children: { ITEM0001: [child] } });
  await run(); child.data.note = "<p>Changed child without parent version bump</p>";
  assert.equal((await run()).updated, 1);
  assert.ok(app.notes.get("local-1").body.includes("Changed child"));
});

test("interrupted content write recovers the tagged empty note without duplication", async () => {
  const { app, run, plugin } = setup();
  app.failWrite = true;
  assert.equal((await run()).failed, 1);
  assert.equal(app.notes.size, 1); assert.equal(app.notes.get("local-1").body, "");
  assert.equal(plugin._busy, false);
  app.failWrite = false;
  assert.equal((await run()).updated, 1);
  assert.equal(app.notes.size, 1);
});

test("host write without readback evidence is recorded as failed", async () => {
  const { app, run } = setup(); app.ignoreWrite = true;
  const result = await run();
  assert.equal(result.created, 0); assert.equal(result.failed, 1);
  assert.ok(app.alerts.some(text => text.includes("could not be verified")));
});

test("a historical revision does not verify a failed source-reversion write", async () => {
  const { app, s, run } = setup();
  const initial = structuredClone(s.items[0]);
  await run();
  s.items[0].data.title = "A newer source revision";
  await run();
  const before = app.notes.get("local-1").body;
  s.items[0] = initial;
  app.ignoreWrite = true;
  const result = await run();
  assert.equal(result.failed, 1);
  assert.equal(result.updated, 0);
  assert.equal(app.notes.get("local-1").body, before);
  assert.ok(app.alerts.some(text => text.includes("could not be verified")));
  app.ignoreWrite = false;
  assert.equal((await run()).updated, 1);
  assert.equal((await run()).unchanged, 1);
});

test("a host that appends instead of prepending does not verify the current revision", async () => {
  const { app, s, run } = setup();
  await run();
  const insert = app.insertNoteContent.bind(app);
  app.insertNoteContent = (handle, content) => insert(handle, content, { atEnd: true });
  s.items[0].data.title = "This revision must be first";
  const result = await run();
  assert.equal(result.failed, 1);
  assert.equal(result.updated, 0);
  assert.ok(app.notes.get("local-1").body.indexOf("Sample research") <
    app.notes.get("local-1").body.indexOf("This revision must be first"));
});

test("partial batch stops and counts remaining references as unattempted", async () => {
  const { app, run } = setup({}, { items: [reference("ITEM0001"), reference("ITEM0002")] });
  app.failWrite = true;
  const result = await run();
  assert.equal(result.failed, 1); assert.equal(result.notAttempted, 1); assert.equal(app.notes.size, 1);
});

test("preview and cancelled bulk sync make no note changes", async () => {
  const { app, run } = setup();
  assert.equal(await run("Preview selection"), 1);
  app.confirmImport = false;
  assert.equal(await run(), null);
  assert.equal(app.notes.size, 0); assert.equal(app.writes, 0);
});

test("changed library metadata aborts before any note writes", async () => {
  const { app, run } = setup({}, { intercept: (u) => u.pathname.endsWith("/children") ? jsonResponse([], { "Last-Modified-Version": "43" }) : null });
  assert.equal(await run(), null);
  assert.equal(app.notes.size, 0);
  assert.ok(app.alerts.some(text => text.includes("changed during sync")));
});

test("ambiguous or foreign record tags do not modify matching notes", async () => {
  const { app, run } = setup();
  const tag = Core.identityTag(Core.config({ libraryId: "123" }), reference());
  const a = await app.createNote("unrelated", [tag]); app.notes.get(a).body = "User-authored unrelated text";
  assert.equal((await run()).failed, 1); assert.equal(app.writes, 0);
  const b = await app.createNote("duplicate", [tag]);
  assert.equal((await run()).failed, 1); assert.equal(app.writes, 0);
  assert.ok(app.notes.has(b));
});

test("optional PDF copy uses data URL upload; repeat does not upload again", async () => {
  const { app, run } = setup({ copyAttachments: true }, { children: { ITEM0001: [pdf], PDFD0001: [annotation] }, files: { PDFD0001: new TextEncoder().encode("synthetic pdf fixture bytes") } });
  assert.equal((await run()).created, 1);
  assert.equal(app.uploads.length, 1);
  assert.ok(app.notes.get("local-1").body.includes("fixture-1.pdf"));
  assert.ok(app.notes.get("local-1").body.includes("A highlighted sentence"));
  assert.equal((await run()).unchanged, 1); assert.equal(app.uploads.length, 1);
});

test("attachment size failure occurs before creating a note", async () => {
  const { app, run } = setup({ copyAttachments: true, maxAttachmentBytes: 2 }, { children: { ITEM0001: [pdf] }, files: { PDFD0001: new Uint8Array([1, 2, 3]) } });
  assert.equal((await run()).failed, 1); assert.equal(app.notes.size, 0); assert.equal(app.uploads.length, 0);
});

test("upload failure never records a completed content revision", async () => {
  const { app, run } = setup({ copyAttachments: true }, { children: { ITEM0001: [pdf] }, files: { PDFD0001: new Uint8Array([1]) } });
  app.failUpload = true;
  assert.equal((await run()).failed, 1);
  assert.equal(app.notes.get("local-1").body, "");
});

test("citation picker uses scalar responses and inserts formatted output once", async () => {
  const { app, run } = setup(); app.promptAnswers = ["Sample", "ITEM0001"];
  assert.equal(await run("Insert formatted citation", "insertText"), null);
  assert.equal(app.selection, "(Example, 2026)");
  assert.equal(app.notes.size, 0);
});

test("bibliography preserves italics and handles unavailable insertion location", async () => {
  const { app, run } = setup(); app.promptAnswers = ["Sample", "ITEM0001"];
  await run("Insert bibliography entry", "insertText");
  assert.ok(app.selection.includes("*Sample research*"));
  app.promptAnswers = ["Sample", "ITEM0001"]; app.selectionAvailable = false; app.selection = "unchanged";
  await run("Insert formatted citation", "insertText");
  assert.equal(app.selection, "unchanged");
  assert.ok(app.alerts.some(text => text.includes("insertion point")));
});

test("cancelled reference picker leaves the original selection unchanged", async () => {
  const { app, run, s } = setup(); app.selection = "Keep this"; app.promptAnswers = [null];
  await run("Insert formatted citation", "insertText");
  assert.equal(app.selection, "Keep this"); assert.equal(s.calls.length, 0);
});

test("single-reference search imports and reuses one tagged note", async () => {
  const { app, run } = setup({}, { children: { ITEM0001: [note, pdf], PDFD0001: [annotation] } });
  app.promptAnswers = ["Sample", "ITEM0001"];
  assert.equal(await run("Search and import one reference"), "created");
  const body = app.notes.get("local-1").body;
  assert.ok(body.includes("A highlighted sentence"));
  app.promptAnswers = ["Sample", "ITEM0001"];
  assert.equal(await run("Search and import one reference"), "unchanged");
  assert.equal(app.notes.size, 1);
  assert.equal(app.writes, 1);
  assert.equal(app.notes.get("local-1").body, body);
});

test("cancelling the single-reference result chooser makes no note changes", async () => {
  const { app, run } = setup();
  app.promptAnswers = ["Sample", null];
  assert.equal(await run("Search and import one reference"), null);
  assert.equal(app.notes.size, 0);
  assert.equal(app.writes, 0);
});

test("failed tagging on a repeat import is not counted as unchanged success", async () => {
  const { app, run } = setup();
  await run();
  const before = app.notes.get("local-1").body;
  app.failTag = true;
  const result = await run();
  assert.equal(result.failed, 1);
  assert.equal(result.unchanged, 0);
  assert.equal(app.notes.get("local-1").body, before);
});

test("configure accepts multiple inputs plus action index and rejects bad JSON", async () => {
  const { app, run } = setup();
  app.promptAnswers = [["groups", "456", "fixture-key-only", '{"tags":["science"]}', -1]];
  await run("Configure");
  assert.equal(app.settings["Library ID"], "456");
  app.promptAnswers = [["groups", "999", "fixture-key-only", "not JSON", -1]];
  await run("Configure");
  assert.equal(app.settings["Library ID"], "456");
  assert.ok(!app.alerts.join(" ").includes("fixture-key-only"));
});

test("configuration blocks other actions until settings are saved or cancelled", async () => {
  const { app, run, s, plugin } = setup();
  let resolvePrompt;
  app.prompt = () => new Promise(resolve => { resolvePrompt = resolve; });
  const configuring = run("Configure");
  try {
    await run("Preview selection");
    assert.equal(s.calls.length, 0);
    assert.equal(plugin._busy, true);
  } finally {
    resolvePrompt(null);
    await configuring;
  }
  assert.equal(plugin._busy, false);
  assert.equal(await run("Preview selection"), 1);
});

test("a rejected configuration prompt releases the operation lock", async () => {
  const { app, run, plugin } = setup();
  app.prompt = async () => { throw new Error("Fixture prompt unavailable"); };
  await run("Configure");
  assert.equal(plugin._busy, false);
  assert.ok(app.alerts.some(text => text.includes("Settings were not fully saved")));
});

test("backoff persists across separate plugin actions", async () => {
  const { app, run, s, plugin } = setup({}, { intercept: () => jsonResponse({}, { "Retry-After": "60" }, 429) });
  await run("Preview selection"); await run("Preview selection");
  assert.equal(s.calls.length, 1); assert.equal(plugin._busy, false);
  assert.ok(app.alerts.some(text => text.includes("pause")));
});

test("host errors from another realm retain their message and redact credentials", async () => {
  const key = "synthetic-host-secret";
  const error = vm.runInNewContext('new Error("Host settings unavailable: synthetic-host-secret")');
  const { app, run } = setup({}, { intercept: () => { throw error; } });
  app.settings["API key"] = key;
  await run("Preview selection");
  assert.ok(app.alerts.some(text => text.includes("Host settings unavailable: [redacted]")));
  assert.ok(!app.alerts.join(" ").includes(key));
});

test("a concurrent action is refused and does not start another request", async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const { app, plugin, s, run } = setup({}, { intercept: async () => { await blocked; return null; } });
  const first = run("Preview selection");
  assert.equal(plugin._busy, true);
  await run("Preview selection");
  assert.equal(s.calls.length, 1);
  release(); await first;
  assert.equal(plugin._busy, false);
  assert.ok(app.alerts.some(text => text.includes("already running")));
});

test("built literal plugin evaluates and delegates an actual fixture import", async () => {
  const source = await readFile(new URL("../dist/plugin.js", import.meta.url), "utf8");
  const s = service(), app = new FakeApp();
  const context = { fetch: s.fetch, URL, Response, AbortController, setTimeout, clearTimeout, TextEncoder, crypto: globalThis.crypto, btoa };
  const plugin = vm.runInNewContext("(" + source + ")", context, { timeout: 1000 });
  const result = await plugin.appOption["Sync selected references"].call(plugin, app);
  assert.equal(result.created, 1); assert.equal(app.notes.size, 1);
  assert.equal((await plugin.appOption["Sync selected references"].call(plugin, app)).unchanged, 1);
});

test("generated plugin preserves the native fetch receiver in the browser realm", async () => {
  const source = await readFile(new URL("../dist/plugin.js", import.meta.url), "utf8");
  const s = service(), app = new FakeApp();
  let browserGlobal;
  function browserFetch(...args) {
    if (this !== browserGlobal) throw new TypeError("Illegal invocation");
    return s.fetch(...args);
  }
  const context = { fetch: browserFetch, URL, Response, AbortController, setTimeout, clearTimeout,
    TextEncoder, crypto: globalThis.crypto, btoa };
  const realm = vm.createContext(context);
  browserGlobal = vm.runInContext("globalThis", realm);
  const plugin = vm.runInContext("(" + source + ")", realm, { timeout: 1000 });
  const result = await plugin.appOption["Sync selected references"].call(plugin, app);
  assert.equal(result?.created, 1, app.alerts.join("\n"));
  assert.equal(app.notes.size, 1);
});

test("installation note contains only supported metadata keys and no repeated blank code lines", async () => {
  const note = await readFile(new URL("../dist/PLUGIN_NOTE.md", import.meta.url), "utf8");
  const beforeCode = note.split("```javascript")[0];
  const keys = beforeCode.split("\n").filter(line => line.startsWith("|") && !line.includes("---"))
    .map(line => line.split("|")[1].trim().toLowerCase());
  assert.deepEqual(keys, ["name", "icon", "description", "setting", "setting", "setting", "setting"]);
  const code = note.split("```javascript\n")[1].split("```")[0];
  assert.ok(!/\n{3,}/.test(code), "Amplenote Markdown import added a backslash at a repeated blank line");
});
